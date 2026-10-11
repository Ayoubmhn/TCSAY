import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountKind, Origin, PaymentKind, PaymentMethod, PaymentPlan } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { dayFromIso, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { fullName } from '../common/rules';
import { PaymentsService } from '../payments/payments.service';
import { Cell, excelDate, readXlsx } from '../players/import/xlsx-reader';
import { PrismaService } from '../prisma/prisma.service';
import { amountInArabicWords } from '../receipts/arabic-amount';
import { isArabic, nameScore, normalizeName, similarity, splitListName } from './name-match';

type Status = 'ok' | 'warning' | 'error';
const str = (c: Cell | undefined) => (c === null || c === undefined ? null : String(c).trim() || null);
const norm = (s: string | null | undefined) => normalizeName(s ?? '');
/** Nom de groupe : sans accents ni majuscules, mais chiffres gardés (« Lutins 1 » ≠ « Lutins 2 »). */
const groupKey = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/+]+/g, ' ')
    .trim();

type PlayerRef = { id: string; name: string; memberCode: string | null };
type GroupRow = {
  line: number;
  groupLabel: string | null;
  name: string;
  group: { id: string; name: string } | null;
  player: PlayerRef | null;
  correction: { from: string; to: string; firstName: string; lastName: string } | null;
  action: 'add' | 'move' | 'none';
  from: string | null;
  status: Status;
  messages: string[];
};
type PaymentRow = {
  line: number;
  name: string;
  nameAr: string | null;
  player: PlayerRef | null;
  base: number | null;
  due: number | null;
  alreadyPaid: number;
  paid: number | null;
  method: PaymentMethod;
  receipt: number | null;
  date: string;
  status: Status;
  messages: string[];
};

/** Seuils de reconnaissance d'un nom : au-dessus de SURE, sûr ; entre MAYBE et SURE, à vérifier ; en dessous, introuvable. */
const SURE = 0.86;
const MAYBE = 0.55;

function headerRow(rows: Cell[][], test: (h: string) => boolean) {
  const i = rows.findIndex((r) => r.some((c) => test(norm(str(c)) || String(c ?? ''))));
  if (i < 0) return null;
  return { index: i, header: rows[i].map((c) => String(c ?? '').trim()) };
}

/**
 * Mises à jour par fichier Excel, sur les joueurs déjà enregistrés :
 * - affectation aux groupes (listes de convocation), avec correction de l'orthographe des noms ;
 * - paiements déjà faits (cahier) : montant dû (réduction), somme payée, mode, n° de reçu du carnet.
 * Toujours en deux temps : aperçu (rien n'est enregistré), puis confirmation (fichier ré-analysé).
 */
@Injectable()
export class UpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  private read(buffer: Buffer) {
    try {
      return readXlsx(buffer).rows;
    } catch (e) {
      throw new BadRequestException(`Fichier illisible : ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Joueurs non archivés avec leur inscription de la saison, leur groupe et leur cotisation. */
  private async players(seasonId: string) {
    const players = await this.prisma.player.findMany({
      where: { archivedAt: null },
      include: {
        enrollments: {
          where: { seasonId },
          include: {
            category: { select: { id: true, name: true } },
            groups: { include: { group: { select: { id: true, name: true, archivedAt: true } } } },
            membership: { include: { installments: { include: { payments: true }, orderBy: { number: 'asc' } } } },
          },
        },
      },
    });
    return players.map((p) => ({
      p,
      names: [`${p.firstName} ${p.lastName}`, `${p.lastName} ${p.firstName}`, p.nameAr ?? ''],
    }));
  }

  private matchPlayer(name: string, index: Awaited<ReturnType<UpdatesService['players']>>) {
    const query = normalizeName(name).split(' ').filter(Boolean);
    const arabic = isArabic(name);
    // Le prénom doit correspondre : « Zeineb Jaballah » n'est jamais « Yazid Jaballah ».
    const firstOk = (p: (typeof index)[number]['p']) => {
      // Prénom composé (« Mohamed Malek ») : un de ses mots suffit.
      // Import du cahier : « Mohamed Malek Gadhab » a pu être découpé en prénom « Mohamed », nom « Malek Gadhab ».
      const last = normalizeName(p.lastName).split(' ');
      const firsts = arabic
        ? normalizeName(p.nameAr ?? '').split(' ').slice(0, 1)
        : [...normalizeName(p.firstName).split(' '), ...(last.length >= 2 ? [last[0]] : [])];
      return firsts.some((f) => f && query.some((w) => similarity(w, f) >= 0.6));
    };
    const scored = index
      .map((x) => ({ p: x.p, score: Math.max(0, ...x.names.filter(Boolean).map((n) => nameScore(name, n))), first: firstOk(x.p) }))
      .sort((x, y) => y.score - x.score);
    const ok = scored.filter((x) => x.first);
    const best = ok[0];
    if (!best || best.score < MAYBE) {
      const near = scored[0] && scored[0].score >= MAYBE ? ` (le plus proche, « ${fullName(scored[0].p)} », a un autre prénom)` : '';
      return { player: null, score: best?.score ?? 0, messages: [`joueur « ${name} » introuvable${near}`], status: 'error' as Status };
    }
    const second = ok[1]?.score ?? 0;
    const messages: string[] = [];
    let status: Status = 'ok';
    if (best.score < SURE) {
      status = 'warning';
      messages.push(`reconnu avec ${Math.round(best.score * 100)} % de ressemblance : à vérifier`);
    }
    if (second >= MAYBE && best.score - second < 0.04) {
      status = 'warning';
      messages.push('homonyme possible : vérifiez le joueur choisi');
    }
    return { player: best.p, score: best.score, messages, status };
  }

  // ───────────────────────── Affectation aux groupes ─────────────────────────

  async analyzeGroups(buffer: Buffer, fileName: string) {
    const rows = this.read(buffer);
    const head = headerRow(rows, (h) => h.includes('groupe'));
    if (!head) throw new BadRequestException('Colonne « Groupe » introuvable (colonnes attendues : Groupe, Joueur).');
    const h = head.header.map((x) => norm(x));
    const cGroup = h.findIndex((x) => x.includes('groupe'));
    const cName = h.findIndex((x) => x.includes('joueur') || x.includes('nom'));
    if (cName < 0) throw new BadRequestException('Colonne « Joueur » introuvable.');

    const season = await this.access.activeSeason();
    const [groups, index] = await Promise.all([
      this.prisma.trainingGroup.findMany({
        where: { seasonId: season.id, archivedAt: null },
        select: { id: true, name: true, capacity: true, categoryId: true, category: { select: { name: true } }, _count: { select: { members: true } } },
      }),
      this.players(season.id),
    ]);
    const seats = new Map(groups.map((g) => [g.id, g.capacity - g._count.members]));
    const seen = new Map<string, number>();

    const out: GroupRow[] = [];
    for (let i = head.index + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const label = str(r[cGroup]);
      const name = str(r[cName]);
      if (!name) continue;
      const messages: string[] = [];
      let status: Status = 'ok';
      const warn = (m: string) => {
        messages.push(m);
        if (status === 'ok') status = 'warning';
      };
      const fail = (m: string) => {
        messages.push(m);
        status = 'error';
      };

      // Groupe : nom exact seulement (majuscules, accents et espaces ignorés). Jamais de rapprochement approximatif :
      // « Benjamins 1 » et « Benjamines 1 » ne doivent pas être confondus.
      const group = groups.find((g) => groupKey(g.name) === groupKey(label));
      if (!group) fail(label ? `groupe « ${label} » introuvable : créez-le dans Groupes (ou corrigez le nom)` : 'groupe manquant');

      const m = this.matchPlayer(name, index);
      messages.push(...m.messages);
      if (m.status === 'error') status = 'error';
      else if (m.status === 'warning' && status === 'ok') status = 'warning';
      const p = m.player;
      const enrollment = p?.enrollments[0];

      // Orthographe : le nom de la liste fait foi (corrigé à la confirmation si la case est cochée).
      let correction: { from: string; to: string; firstName: string; lastName: string } | null = null;
      if (p) {
        const wanted = splitListName(name);
        const words = (x: string) => norm(x).split(' ').filter(Boolean).length;
        // Jamais de mot perdu : une liste plus courte que le nom enregistré (« Malek Ghadhab » / « Mohamed Malek Gadhab ») ne corrige rien.
        if (
          norm(`${wanted.firstName} ${wanted.lastName}`) !== norm(`${p.firstName} ${p.lastName}`) &&
          words(`${wanted.firstName} ${wanted.lastName}`) >= words(`${p.firstName} ${p.lastName}`)
        ) {
          correction = { from: fullName(p), to: `${wanted.firstName} ${wanted.lastName}`.trim(), ...wanted };
        }
        const prev = seen.get(p.id);
        if (prev !== undefined) fail(`même joueur qu’à la ligne ${prev}`);
        else seen.set(p.id, i + 1);
      }

      let action: 'add' | 'move' | 'none' = 'none';
      let from: string | null = null;
      if (p && !enrollment) fail('joueur non inscrit sur la saison (date de naissance à compléter) : impossible de l’affecter');
      if (p && enrollment && group && status !== 'error') {
        const current = enrollment.groups.filter((x) => !x.group.archivedAt).map((x) => x.group);
        if (current.some((g) => g.id === group.id)) {
          messages.push('déjà dans ce groupe');
        } else {
          from = current.map((g) => g.name).join(', ') || null;
          action = current.length ? 'move' : 'add';
          if (from) warn(`changera de groupe (actuellement : ${from})`);
          const left = seats.get(group.id) ?? 0;
          if (left <= 0) fail(`groupe ${group.name} complet (R4)`);
          else seats.set(group.id, left - 1);
          if (group.categoryId && group.categoryId !== enrollment.categoryId) {
            warn(`catégorie ${enrollment.category.name} ≠ groupe ${group.category?.name ?? ''} : dérogation « Liste de convocation »`);
          }
        }
      }
      out.push({
        line: i + 1,
        groupLabel: label,
        name,
        group: group ? { id: group.id, name: group.name } : null,
        player: p ? { id: p.id, name: fullName(p), memberCode: p.memberCode } : null,
        correction,
        action,
        from,
        status,
        messages,
      });
    }
    const count = (s: Status) => out.filter((r) => r.status === s).length;
    return {
      fileName,
      season: season.label,
      total: out.length,
      ok: count('ok'),
      warnings: count('warning'),
      errors: count('error'),
      corrections: out.filter((r) => r.status !== 'error' && r.correction).length,
      moves: out.filter((r) => r.status !== 'error' && r.action !== 'none').length,
      groups: groups.map((g) => g.name).sort((a, b) => a.localeCompare(b, 'fr')),
      rows: out,
    };
  }

  async commitGroups(actor: AuthUser, buffer: Buffer, fileName: string, correctNames: boolean) {
    const preview = await this.analyzeGroups(buffer, fileName);
    const rows = preview.rows.filter((r) => r.status !== 'error' && r.player);
    if (!rows.length) throw new BadRequestException('Aucune ligne applicable dans ce fichier.');
    const season = await this.access.activeSeason();
    let moved = 0;
    let renamed = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const r of rows) {
          const player = r.player!;
          if (correctNames && r.correction) {
            await tx.player.update({
              where: { id: player.id },
              data: { firstName: r.correction.firstName, lastName: r.correction.lastName, version: { increment: 1 } },
            });
            await this.audit.log(
              actor.id,
              { action: 'Nom corrigé (liste)', entity: 'Player', entityId: player.id, target: r.correction.to, before: r.correction.from, after: r.correction.to, reason: fileName },
              tx,
            );
            renamed++;
          }
          if (r.action === 'none' || !r.group) continue;
          const enrollment = await tx.enrollment.findUniqueOrThrow({
            where: { playerId_seasonId: { playerId: player.id, seasonId: season.id } },
            include: { groups: { include: { group: true } } },
          });
          // Changement de groupe : retiré de ses groupes actuels de la saison.
          for (const gm of enrollment.groups.filter((x) => !x.group.archivedAt && x.groupId !== r.group!.id)) {
            await tx.groupMember.delete({ where: { id: gm.id } });
          }
          const group = await tx.trainingGroup.findUniqueOrThrow({ where: { id: r.group.id } });
          await tx.groupMember.create({
            data: {
              groupId: group.id,
              enrollmentId: enrollment.id,
              derogationReason: group.categoryId && group.categoryId !== enrollment.categoryId ? 'Liste de convocation' : null,
            },
          });
          moved++;
        }
        await this.audit.log(
          actor.id,
          {
            action: 'Affectation aux groupes (fichier)',
            entity: 'GroupMember',
            target: fileName,
            after: `${moved} affectation(s), ${renamed} nom(s) corrigé(s)`,
            reason: preview.errors ? `${preview.errors} ligne(s) ignorée(s)` : null,
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    return { moved, renamed, skipped: preview.rows.filter((r) => r.status === 'error').map((r) => ({ line: r.line, name: r.name, messages: r.messages })) };
  }

  // ───────────────────────── Paiements du cahier ─────────────────────────

  async analyzePayments(buffer: Buffer, fileName: string) {
    const rows = this.read(buffer);
    const isName = (h: string) => h.includes('joueur') || h.includes('nom') || h.includes('الاسم');
    const head = headerRow(rows, isName);
    if (!head) throw new BadRequestException('Colonne « Joueur » (ou « Nom en arabe ») introuvable.');
    const h = head.header.map((x) => x.toLowerCase());
    const hn = head.header.map((x) => norm(x));
    const col = (...tests: ((x: string, raw: string) => boolean)[]) => hn.findIndex((x, i) => tests.some((t) => t(x, h[i])));
    const C = {
      name: col((x) => x.includes('joueur') || (x.includes('nom') && !x.includes('arabe'))),
      nameAr: col((x) => x.includes('arabe'), (_x, raw) => raw.includes('الاسم')),
      amount: col((x) => x.includes('montant') || x.includes('du'), (_x, raw) => raw.includes('المبلغ')),
      paid: col((x) => x.startsWith('paye') || x.includes('verse'), (_x, raw) => raw.includes('الدفع')),
      method: col((x) => x.includes('mode'), (_x, raw) => raw.includes('طريقة')),
      receipt: col((x) => x.includes('recu'), (_x, raw) => raw.includes('الوصل')),
      date: col((x) => x.includes('date'), (_x, raw) => raw.includes('التاريخ')),
    };
    if (C.paid < 0) throw new BadRequestException('Colonne « Payé » introuvable.');

    const season = await this.access.activeSeason();
    const index = await this.players(season.id);
    const existing = new Set((await this.prisma.receipt.findMany({ select: { number: true } })).map((r) => r.number));
    const seenReceipts = new Map<number, number>();

    const out: PaymentRow[] = [];
    for (let i = head.index + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const nameFr = C.name >= 0 ? str(r[C.name]) : null;
      const nameAr = C.nameAr >= 0 ? str(r[C.nameAr]) : null;
      if (!nameFr && !nameAr) continue;
      const messages: string[] = [];
      let status: Status = 'ok';
      const warn = (m: string) => {
        messages.push(m);
        if (status === 'ok') status = 'warning';
      };
      const fail = (m: string) => {
        messages.push(m);
        status = 'error';
      };

      // Joueur : par le nom français s'il est donné, sinon par le nom arabe.
      const fr = nameFr ? this.matchPlayer(nameFr, index) : null;
      const ar = nameAr ? this.matchPlayer(nameAr, index) : null;
      const m = fr && fr.player && (!ar?.player || fr.score >= ar.score) ? fr : (ar ?? fr)!;
      messages.push(...m.messages);
      if (m.status === 'error') status = 'error';
      else if (m.status === 'warning') status = 'warning';
      if (fr?.player && ar?.player && fr.player.id !== ar.player.id) warn('nom français et nom arabe ne désignent pas le même joueur');
      const p = m.player;
      const enrollment = p?.enrollments[0];
      if (p && !enrollment) fail('joueur non inscrit sur la saison (date de naissance à compléter)');

      const money = (c: Cell | undefined) => {
        const s = str(c);
        if (!s) return null;
        if (/خالص|payé|paye|solde/i.test(s)) return 'FULL' as const;
        const n = Number(s.replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
      };
      const amountCell = C.amount >= 0 ? money(r[C.amount]) : null;
      const paidCell = money(r[C.paid]);
      const membership = enrollment?.membership;
      // Tarif avant réduction : celui de la cotisation, sinon le tarif de sa catégorie / son groupe (cotisation à créer).
      const fee =
        enrollment && !membership
          ? await this.payments.findFee(this.prisma, season.id, enrollment.categoryId, enrollment.groups.map((g) => g.groupId))
          : null;
      const base = membership ? num(membership.baseAmount ?? membership.totalAmount) : fee ? num(fee.amount) : null;
      const alreadyPaid = membership ? membership.installments.reduce((t, x) => t + x.payments.reduce((u, y) => u + num(y.amount), 0), 0) : 0;
      const due = typeof amountCell === 'number' && !Number.isNaN(amountCell) ? amountCell : membership ? num(membership.totalAmount) : base;
      let paid = typeof paidCell === 'number' ? paidCell : paidCell === 'FULL' && due ? due - alreadyPaid : null;
      if (amountCell !== null && Number.isNaN(amountCell)) fail('montant illisible');
      if (paidCell !== null && Number.isNaN(paid ?? NaN)) fail('somme payée illisible');
      if (!paid || paid <= 0) fail('aucune somme payée');
      if (enrollment && !membership) {
        if (fee) warn('cotisation créée à la confirmation (tarif de sa catégorie)');
        else fail('aucun tarif d’entraînement pour sa catégorie : créez le tarif d’abord');
      }
      if (base !== null && due !== null && due > base + 0.0005) fail(`montant ${dt(due)} supérieur au tarif ${dt(base)}`);
      if (base !== null && due !== null && due < base - 0.0005) warn(`réduction de ${dt(base - due)} (tarif ${dt(base)} → ${dt(due)})`);
      if (paid && due !== null && paid > due - alreadyPaid + 0.0005) fail(`payé ${dt(paid)} > reste dû ${dt(due - alreadyPaid)}`);
      if (paid) paid = Math.round(paid * 1000) / 1000;

      const receiptRaw = C.receipt >= 0 ? str(r[C.receipt]) : null;
      const receipt = receiptRaw ? Number(receiptRaw.replace(/\D/g, '')) : null;
      if (receiptRaw && !receipt) fail(`n° de reçu illisible « ${receiptRaw} »`);
      if (receipt && existing.has(receipt)) {
        messages.push(`reçu n° ${String(receipt).padStart(7, '0')} déjà enregistré : ligne déjà importée`);
        status = 'error';
      }
      if (receipt) {
        const prev = seenReceipts.get(receipt);
        if (prev) fail(`même n° de reçu qu’à la ligne ${prev}`);
        else seenReceipts.set(receipt, i + 1);
      }
      if (!receipt) warn('sans n° de reçu');

      const methodRaw = C.method >= 0 ? norm(str(r[C.method])) : '';
      const method = /cheque|chq|شيك|صك/.test(methodRaw) ? PaymentMethod.CHEQUE : PaymentMethod.CASH;
      const dateCell = C.date >= 0 ? r[C.date] : null;
      const date =
        typeof dateCell === 'number' ? excelDate(dateCell) : /^\d{2}\/\d{2}\/\d{4}$/.test(str(dateCell) ?? '') ? str(dateCell)!.split('/').reverse().join('-') : todayIso();

      out.push({
        line: i + 1,
        name: nameFr ?? nameAr!,
        nameAr,
        player: p ? { id: p.id, name: fullName(p), memberCode: p.memberCode } : null,
        base,
        due,
        alreadyPaid,
        paid,
        method,
        receipt,
        date,
        status,
        messages,
      });
    }
    const count = (s: Status) => out.filter((r) => r.status === s).length;
    return {
      fileName,
      season: season.label,
      total: out.length,
      ok: count('ok'),
      warnings: count('warning'),
      errors: count('error'),
      amount: out.filter((r) => r.status !== 'error').reduce((t, r) => t + (r.paid ?? 0), 0),
      rows: out,
    };
  }

  async commitPayments(actor: AuthUser, buffer: Buffer, fileName: string, plan: PaymentPlan) {
    const preview = await this.analyzePayments(buffer, fileName);
    const rows = preview.rows.filter((r) => r.status !== 'error' && r.player && r.paid);
    if (!rows.length) throw new BadRequestException('Aucune ligne applicable dans ce fichier.');
    const season = await this.access.activeSeason();
    const done: { line: number; name: string; paid: number; receipt: number | null }[] = [];
    const failed: { line: number; name: string; messages: string[] }[] = [];
    // Ligne par ligne : une ligne en échec n'empêche pas les autres (elle est listée dans le rapport).
    for (const r of rows) {
      try {
        const playerId = r.player!.id;
        let info = await this.payments.membershipInfo(playerId);
        if (!info.membership) {
          await this.payments.changePlan(actor, playerId, plan);
          info = await this.payments.membershipInfo(playerId);
        }
        const m = info.membership!;
        if (r.due !== null && Math.abs(r.due - m.total) > 0.0005) {
          if (r.due > m.base + 0.0005) throw new Error(`montant supérieur au tarif ${dt(m.base)}`);
          await this.payments.setDiscount(actor, playerId, {
            kind: r.due <= 0.0005 ? DiscountKind.EXEMPT : DiscountKind.SPECIAL,
            amount: r.due <= 0.0005 ? undefined : Math.round((m.base - r.due) * 1000) / 1000,
            reason: `Montant du cahier${r.receipt ? ` (reçu n° ${String(r.receipt).padStart(7, '0')})` : ''}`,
          });
        }
        await this.prisma.$transaction(async (tx) => {
          const enrollment = await tx.enrollment.findUniqueOrThrow({
            where: { playerId_seasonId: { playerId, seasonId: season.id } },
            include: {
              player: true,
              membership: { include: { installments: { include: { payments: true }, orderBy: { number: 'asc' } } } },
            },
          });
          let left = r.paid!;
          let first: string | null = null;
          let label = '';
          for (const inst of enrollment.membership!.installments) {
            if (left <= 0.0005) break;
            const rest = num(inst.amount) - inst.payments.reduce((t, p) => t + num(p.amount), 0);
            if (rest <= 0.0005) continue;
            const amount = Math.round(Math.min(rest, left) * 1000) / 1000;
            const pay = await tx.payment.create({
              data: {
                installmentId: inst.id,
                amount,
                kind: PaymentKind.PAYMENT,
                method: r.method,
                paidAt: dayFromIso(r.date),
                recordedById: actor.id,
                origin: Origin.IMPORT,
                note: `Cahier · ${fileName}${r.receipt ? ` · reçu n° ${String(r.receipt).padStart(7, '0')}` : ''}`,
              },
            });
            first ??= pay.id;
            label ||= inst.count > 1 ? `Tranche ${inst.number}/${inst.count}` : 'Cotisation';
            left = Math.round((left - amount) * 1000) / 1000;
          }
          if (left > 0.0005) throw new Error(`reste ${dt(left)} non affecté : somme payée supérieure au dû`);
          if (r.receipt && first) {
            await tx.receipt.create({
              data: {
                number: r.receipt,
                paymentId: first,
                payerName: fullName(enrollment.player),
                amount: r.paid!,
                amountWords: amountInArabicWords(r.paid!),
                label,
                method: r.method,
                seasonLabel: season.label,
                issuedOn: dayFromIso(r.date),
                issuedById: actor.id,
              },
            });
          }
          await this.audit.log(
            actor.id,
            {
              action: 'Paiement importé (cahier)',
              entity: 'Payment',
              entityId: first ?? undefined,
              target: `${fullName(enrollment.player)}${r.receipt ? ` · reçu n° ${String(r.receipt).padStart(7, '0')}` : ''}`,
              after: `${dt(r.paid!)} · ${r.method === PaymentMethod.CHEQUE ? 'chèque' : 'espèces'} · ${r.date}`,
              reason: fileName,
            },
            tx,
          );
        });
        done.push({ line: r.line, name: r.player!.name, paid: r.paid!, receipt: r.receipt });
      } catch (e) {
        failed.push({ line: r.line, name: r.name, messages: [e instanceof Error ? e.message : String(e)] });
      }
    }
    return {
      imported: done,
      total: done.reduce((t, d) => t + d.paid, 0),
      failed,
      skipped: preview.rows.filter((r) => r.status === 'error').map((r) => ({ line: r.line, name: r.name, messages: r.messages })),
    };
  }
}
