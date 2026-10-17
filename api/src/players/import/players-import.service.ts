import { BadRequestException, Injectable } from '@nestjs/common';
import { Gender, Origin, PaymentPlan, Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/auth-user';
import { hashPassword } from '../../auth/password';
import { CategoriesService } from '../../categories/categories.service';
import { ageAtYearEnd, dayFromIso } from '../../common/dates';
import { PLACEHOLDER_DOMAIN } from '../../common/placeholder';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { nextMemberCode } from '../member-code';
import { Cell, excelDate, readXlsx } from './xlsx-reader';


type Status = 'ok' | 'warning' | 'error';
type ParentPlan = { key: string; name: string; phone: string | null; email: string | null; existingId: string | null; sharedWith: number[] };

/** Ligne du tableau modifiable (valeurs saisies, comme dans le fichier Excel). */
export const RAW_COLUMNS = ['n', 'gender', 'name', 'nameAr', 'birth', 'phone', 'email', 'parent', 'parentEmail', 'group', 'city', 'remark'] as const;
export type RawRow = Record<(typeof RAW_COLUMNS)[number], string>;
/** En-têtes équivalents du fichier Excel (reconnus par l'analyse). */
const RAW_HEADER: RawRow = {
  n: 'N°',
  gender: 'Genre',
  name: 'Nom et prénom (FR)',
  nameAr: 'Nom en arabe',
  birth: 'Date de naissance',
  phone: 'Téléphone',
  email: 'Email du joueur',
  parent: 'Parent / tuteur',
  parentEmail: 'Email du parent',
  group: 'Groupe',
  city: 'Ville',
  remark: 'Remarque',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportRow = {
  line: number;
  n: number | null;
  name: string;
  firstName: string;
  lastName: string;
  nameAr: string | null;
  gender: Gender | null;
  birthDate: string | null;
  birthYearOnly: boolean;
  age: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  city: string | null;
  parents: ParentPlan[];
  /** Valeurs de la ligne (tableau modifiable de l'aperçu). */
  raw: RawRow;
  groupLabel: string | null;
  group: { id: string; name: string } | null;
  category: { id: string; code: string; name: string } | null;
  derogation: boolean;
  status: Status;
  messages: string[];
};

/** Minuscules, sans accents ni espaces multiples : comparaison « exacte » souple (majuscules, accents, espaces). */
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const digits = (s: string) => s.replace(/\D/g, '');
/** « 99104101 » → « +216 99 104 101 ». */
function formatPhone(raw: string) {
  const d = digits(raw).replace(/^216(?=\d{8}$)/, '');
  return d.length === 8 ? `+216 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : raw.trim();
}
const str = (c: Cell | undefined) => (c === null || c === undefined ? null : String(c).trim() || null);

/** Date du cahier : « 2019-04-28 », « 28/04/2019 », « 2019 » (année seule), ou date Excel. */
function parseBirth(c: Cell | undefined): { date: string | null; yearOnly: boolean; error?: string } {
  if (c === null || c === undefined || c === '') return { date: null, yearOnly: false };
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y > 1900 && y <= new Date().getFullYear();
  };
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (typeof c === 'number') {
    if (c >= 1900 && c <= 2100) return { date: `${c}-01-01`, yearOnly: true };
    return { date: excelDate(c), yearOnly: false };
  }
  const s = c.trim();
  let m = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(s);
  if (m && valid(+m[1], +m[2], +m[3])) return { date: iso(+m[1], +m[2], +m[3]), yearOnly: false };
  m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(s);
  if (m && valid(+m[3], +m[2], +m[1])) return { date: iso(+m[3], +m[2], +m[1]), yearOnly: false };
  m = /^(\d{4})$/.exec(s);
  if (m) return { date: `${m[1]}-01-01`, yearOnly: true };
  return { date: null, yearOnly: false, error: `date de naissance illisible « ${s} »` };
}

function parseGender(c: Cell | undefined): Gender | null {
  const g = norm(str(c));
  if (['h', 'm', 'g', 'garcon', 'homme', 'masculin'].includes(g)) return Gender.M;
  if (['f', 'fille', 'femme', 'feminin'].includes(g)) return Gender.F;
  return null;
}

/**
 * Import des joueurs depuis le fichier Excel du cahier : aperçu ligne par ligne (rien n'est enregistré), puis
 * confirmation (tout ou rien). Groupe : nom exact parmi les groupes de la saison active, sinon aucun groupe.
 * Parents : prénom du cahier, nom « Exemple », email provisoire (jamais utilisé) ; les frères et sœurs avec le même
 * téléphone et le même prénom de parent partagent le même parent. Origine IMPORT et ligne d'origine conservées (R14).
 */
@Injectable()
export class PlayersImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  async analyze(buffer: Buffer, fileName: string) {
    let parsed: ReturnType<typeof readXlsx>;
    try {
      parsed = readXlsx(buffer, 'Joueurs');
    } catch (e) {
      throw new BadRequestException(`Fichier illisible : ${e instanceof Error ? e.message : e}`);
    }
    return this.analyzeRows(parsed.rows, fileName);
  }

  /** Aperçu du tableau corrigé à l'écran (mêmes règles que le fichier). */
  analyzeTable(table: RawRow[], fileName: string) {
    return this.analyzeRows(tableToRows(table), fileName);
  }

  private async analyzeRows(rows: Cell[][], fileName: string) {
    const headerIndex = rows.findIndex((r) => r.some((c) => norm(str(c)).includes('nom et prenom')));
    if (headerIndex < 0) throw new BadRequestException('Colonne « Nom et prénom (FR) » introuvable dans le fichier.');
    const header = rows[headerIndex].map((c) => norm(str(c)));
    const col = (test: (h: string) => boolean) => header.findIndex((h) => test(h));
    const C = {
      n: col((h) => h === 'n°' || h === 'no' || h === 'n'),
      gender: col((h) => h.startsWith('genre') || h === 'sexe'),
      name: col((h) => h.includes('nom et prenom')),
      nameAr: col((h) => h.includes('arabe')),
      birth: col((h) => h.includes('naissance')),
      phone: col((h) => h.includes('telephone') || h.includes('tel')),
      parent: col((h) => (h.includes('parent') || h.includes('tuteur')) && !h.includes('mail')),
      email: col((h) => h.includes('mail') && !h.includes('parent')),
      parentEmail: col((h) => h.includes('mail') && h.includes('parent')),
      group: col((h) => h.includes('groupe')),
      city: col((h) => h.includes('ville')),
      remark: col((h) => h.includes('remarque')),
    };
    const at = (r: Cell[], i: number) => (i >= 0 ? r[i] : null);

    const season = await this.access.activeSeason();
    const year = season.startDate.getUTCFullYear();
    const [groups, leisure, existingPlayers, existingParents] = await Promise.all([
      this.prisma.trainingGroup.findMany({
        where: { seasonId: season.id, archivedAt: null },
        select: { id: true, name: true, kind: true, capacity: true, categoryId: true, _count: { select: { members: true } } },
      }),
      this.prisma.category.findFirst({ where: { family: 'LEISURE', archivedAt: null } }),
      this.prisma.player.findMany({ select: { firstName: true, lastName: true, birthDate: true, memberCode: true } }),
      this.prisma.user.findMany({ where: { roles: { has: Role.PARENT } }, select: { id: true, firstName: true, phone: true, email: true } }),
    ]);
    const groupByName = new Map(groups.map((g) => [norm(g.name), g]));
    const seats = new Map(groups.map((g) => [g.id, g.capacity - g._count.members]));
    const parentsByKey = new Map<string, ParentPlan>();
    const seen = new Map<string, number>();

    const result: ImportRow[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = str(at(r, C.name));
      // Ligne vide, ou note de bas de tableau (ni nom, ni n°) : ignorée.
      if (!name && typeof at(r, C.n) !== 'number' && !Number(str(at(r, C.n)))) continue;
      const messages: string[] = [];
      let status: Status = 'ok';
      const fail = (m: string) => {
        messages.push(m);
        status = 'error';
      };
      const warn = (m: string) => {
        messages.push(m);
        if (status === 'ok') status = 'warning';
      };
      const nRaw = at(r, C.n);
      const row: ImportRow = {
        line: i + 1,
        n: typeof nRaw === 'number' ? nRaw : Number(str(nRaw)) || null,
        name: name ?? '',
        firstName: '',
        lastName: '',
        nameAr: str(at(r, C.nameAr)),
        gender: parseGender(at(r, C.gender)),
        birthDate: null,
        birthYearOnly: false,
        age: null,
        phone: null,
        email: null,
        notes: null,
        city: str(at(r, C.city)),
        parents: [],
        raw: Object.fromEntries(RAW_COLUMNS.map((k) => [k, str(at(r, C[k])) ?? ''])) as RawRow,
        groupLabel: str(at(r, C.group)),
        group: null,
        category: null,
        derogation: false,
        status: 'ok',
        messages,
      };
      if (!name) {
        fail('nom manquant');
      } else {
        // Prénom = premier mot, nom = la suite (à corriger dans la fiche pour les prénoms composés).
        const parts = name.split(/\s+/);
        row.firstName = parts[0];
        row.lastName = parts.slice(1).join(' ') || '—';
      }
      if (!row.gender) fail(`genre « ${str(at(r, C.gender)) ?? ''} » non reconnu (h ou f)`);

      const birth = parseBirth(at(r, C.birth));
      if (birth.error) warn(`${birth.error} : date laissée vide`);
      row.birthDate = birth.date;
      row.birthYearOnly = birth.yearOnly;
      // Date lisible dans le tableau (date Excel convertie).
      if (birth.date) row.raw.birth = birth.yearOnly ? birth.date.slice(0, 4) : birth.date;
      if (row.gender) row.raw.gender = row.gender === Gender.F ? 'f' : 'h';
      const email = str(at(r, C.email))?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) warn(`email du joueur « ${email} » invalide : non enregistré`);
      else row.email = email;
      if (birth.yearOnly) warn('année seulement : date enregistrée au 1er janvier, à compléter');
      if (!row.birthDate && !birth.error) warn('date de naissance manquante');
      row.age = row.birthDate ? ageAtYearEnd(dayFromIso(row.birthDate), year) : null;
      const minor = row.age === null || row.age < 18;

      // Téléphones et parents (« Khaoula / Moez » avec deux numéros = deux parents).
      const phones = (str(at(r, C.phone)) ?? '')
        .split(/[/,;]| et /)
        .map((p) => p.trim())
        .filter((p) => digits(p).length >= 6)
        .map(formatPhone);
      const parentNames = (str(at(r, C.parent)) ?? '')
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      const parentEmails = (str(at(r, C.parentEmail)) ?? '')
        .split(/[/,;]/)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      parentEmails.filter((e) => !EMAIL.test(e)).forEach((e) => warn(`email du parent « ${e} » invalide : email provisoire`));
      row.phone = phones[0] ?? null;
      const extraNotes: string[] = [];
      if (minor) {
        const names = parentNames.length ? parentNames : phones.length ? ['Parent'] : [];
        for (const [k, pn] of names.entries()) {
          const phone = phones[k] ?? phones[0] ?? null;
          const mail = parentEmails[k] && EMAIL.test(parentEmails[k]) ? parentEmails[k] : null;
          const key = mail ? `@${mail}` : `${digits(phone ?? '')}|${norm(pn)}`;
          let plan = parentsByKey.get(key);
          if (!plan) {
            let existing = mail
              ? existingParents.find((u) => u.email?.toLowerCase() === mail)
              : phone
                ? existingParents.find((u) => u.phone && digits(u.phone) === digits(phone) && norm(u.firstName) === norm(pn))
                : undefined;
            let email = mail;
            if (mail && !existing) {
              // Adresse déjà prise par un compte qui n'est pas parent : on garde un email provisoire.
              const other = await this.prisma.user.findUnique({ where: { email: mail }, select: { id: true } });
              if (other) {
                warn(`email « ${mail} » déjà utilisé par un autre compte : email provisoire pour ce parent`);
                email = null;
                existing = undefined;
              }
            }
            plan = { key, name: pn, phone, email, existingId: existing?.id ?? null, sharedWith: [] };
            parentsByKey.set(key, plan);
          }
          plan.sharedWith.push(row.line);
          row.parents.push(plan);
        }
        phones.slice(Math.max(names.length, 1)).forEach((p) => extraNotes.push(`Autre téléphone : ${p}`));
        if (!row.parents.length) warn('aucun parent ni téléphone : parent à lier');
      } else {
        phones.slice(1).forEach((p) => extraNotes.push(`Autre téléphone : ${p}`));
        if (parentNames.length) extraNotes.push(`Parent / tuteur (cahier) : ${parentNames.join(' / ')}`);
      }
      const remark = str(at(r, C.remark));
      row.notes = [remark, ...extraNotes].filter(Boolean).join(' · ') || null;

      // Catégorie de la saison : Loisirs pour les groupes loisirs, sinon selon l'âge et le genre.
      const label = row.groupLabel;
      const matched = label ? groupByName.get(norm(label)) : undefined;
      const isLeisure = norm(label).startsWith('loisir') || matched?.kind === 'LEISURE';
      if (isLeisure && leisure) {
        row.category = { id: leisure.id, code: leisure.code, name: leisure.name };
      } else if (row.birthDate && row.gender) {
        const s = await this.categories.suggest(dayFromIso(row.birthDate), row.gender, year);
        if ('error' in s) warn(`${s.error} : pas d'inscription à la saison`);
        else row.category = { id: s.category.id, code: s.category.code, name: s.category.name };
      } else if (!row.birthDate) {
        warn('sans date de naissance : catégorie et inscription à compléter');
      }

      // Groupe : nom exact, sinon aucun groupe.
      if (label && !matched) warn(`groupe « ${label} » introuvable : aucun groupe`);
      if (matched) {
        if (!row.category) warn(`groupe « ${matched.name} » trouvé mais joueur non inscrit (catégorie inconnue) : aucun groupe`);
        else if ((seats.get(matched.id) ?? 0) <= 0) warn(`groupe « ${matched.name} » complet (${matched.capacity}) : aucun groupe`);
        else {
          seats.set(matched.id, (seats.get(matched.id) ?? 0) - 1);
          row.group = { id: matched.id, name: matched.name };
          if (matched.categoryId && matched.categoryId !== row.category.id) {
            row.derogation = true;
            warn(`catégorie différente de celle du groupe : dérogation « Import du cahier »`);
          }
        }
      }

      // Doublons : dans le fichier et dans la base.
      if (name) {
        const key = `${norm(name)}|${row.birthDate ?? ''}`;
        const sameName = [...seen.entries()].filter(([k]) => k.startsWith(`${norm(name)}|`));
        if (seen.has(key)) fail(`doublon de la ligne ${seen.get(key)} (même nom, même date)`);
        else if (sameName.length) warn(`même nom qu'à la ligne ${sameName.map(([, l]) => l).join(', ')} (date différente) : doublon possible`);
        seen.set(key, row.line);
        const inDb = existingPlayers.filter((p) => norm(`${p.firstName} ${p.lastName}`) === norm(name));
        const exact = inDb.find((p) => (p.birthDate?.toISOString().slice(0, 10) ?? null) === row.birthDate);
        if (exact) fail(`déjà enregistré (${exact.memberCode ?? 'sans code'})`);
        else if (inDb.length) warn(`homonyme déjà enregistré (${inDb.map((p) => p.memberCode).join(', ')})`);
      }
      row.status = status;
      result.push(row);
    }

    const count = (s: Status) => result.filter((r) => r.status === s).length;
    const newParents = [...parentsByKey.values()].filter((p) => !p.existingId && result.some((r) => r.status !== 'error' && r.parents.includes(p)));
    return {
      fileName,
      season: season.label,
      codeYear: year % 100,
      total: result.length,
      ok: count('ok'),
      warnings: count('warning'),
      errors: count('error'),
      newParents: newParents.length,
      withGroup: result.filter((r) => r.status !== 'error' && r.group).length,
      groups: groups.map((g) => g.name).sort((a, b) => a.localeCompare(b, 'fr')),
      rows: result,
    };
  }

  /** Enregistre les lignes valides (vertes et sable) en une seule transaction ; les lignes en erreur sont ignorées. */
  async commit(actor: AuthUser, buffer: Buffer, fileName: string, plan: PaymentPlan = PaymentPlan.FULL) {
    return this.commitPreview(actor, await this.analyze(buffer, fileName), fileName, plan);
  }

  /** Enregistre le tableau corrigé à l'écran (mêmes règles, réanalysé avant l'enregistrement). */
  async commitTable(actor: AuthUser, table: RawRow[], fileName: string, plan: PaymentPlan = PaymentPlan.FULL) {
    return this.commitPreview(actor, await this.analyzeTable(table, fileName), `${fileName} (corrigé à l’écran)`, plan);
  }

  private async commitPreview(actor: AuthUser, preview: Awaited<ReturnType<PlayersImportService['analyzeRows']>>, fileName: string, plan: PaymentPlan) {
    const rows = preview.rows.filter((r) => r.status !== 'error');
    if (!rows.length) throw new BadRequestException('Aucune ligne importable dans ce fichier.');
    const season = await this.access.activeSeason();
    const year = season.startDate.getUTCFullYear();
    const lockedHash = await hashPassword(randomBytes(24).toString('hex'));

    const report = await this.prisma.$transaction(
      async (tx) => {
        const parentIds = new Map<string, string>();
        let withoutFee = 0;
        const out: {
          line: number;
          n: number | null;
          name: string;
          memberCode: string;
          group: string | null;
          category: string | null;
          parents: string[];
          messages: string[];
          membership: boolean;
        }[] = [];
        for (const row of rows) {
          const code = await nextMemberCode(tx, year);
          const player = await tx.player.create({
            data: {
              ...code,
              firstName: row.firstName,
              lastName: row.lastName,
              nameAr: row.nameAr,
              birthDate: row.birthDate ? dayFromIso(row.birthDate) : null,
              birthYearOnly: row.birthYearOnly,
              gender: row.gender!,
              phone: row.phone,
              email: row.email,
              city: row.city,
              notes: row.notes,
              origin: Origin.IMPORT,
              importRef: `${fileName} · ligne ${row.line}${row.n ? ` (n° ${row.n})` : ''}`,
            },
          });
          const parentNames: string[] = [];
          for (const [k, plan] of row.parents.entries()) {
            let parentId = plan.existingId ?? parentIds.get(plan.key);
            if (!parentId) {
              const parent = await tx.user.create({
                data: {
                  email: plan.email ?? `parent.${code.memberCode.toLowerCase()}${k ? `.${k + 1}` : ''}@${PLACEHOLDER_DOMAIN}`,
                  roles: [Role.PARENT],
                  firstName: plan.name,
                  lastName: 'Exemple',
                  phone: plan.phone,
                  passwordHash: lockedHash,
                  mustChangePassword: true,
                },
              });
              parentId = parent.id;
              parentIds.set(plan.key, parentId);
            }
            await tx.parentLink.create({ data: { parentId, playerId: player.id } });
            parentNames.push(`${plan.name} Exemple`);
          }
          let membership = false;
          if (row.category) {
            const enrollment = await tx.enrollment.create({ data: { playerId: player.id, seasonId: season.id, categoryId: row.category.id } });
            if (row.group) {
              await tx.groupMember.create({
                data: { groupId: row.group.id, enrollmentId: enrollment.id, derogationReason: row.derogation ? 'Import du cahier' : null },
              });
            }
            // Tout joueur inscrit paie sa cotisation : créée depuis le tarif de sa catégorie (ou de son groupe).
            const created = await this.payments.buildMembership(tx, actor.id, { ...enrollment, player }, season, plan, row.group ? [row.group.id] : []);
            membership = Boolean(created);
            if (!created) withoutFee++;
          }
          out.push({
            line: row.line,
            n: row.n,
            name: row.name,
            memberCode: code.memberCode,
            group: row.group?.name ?? null,
            category: row.category?.name ?? null,
            parents: parentNames,
            messages: row.messages,
            membership,
          });
        }
        await this.audit.log(
          actor.id,
          {
            action: 'Import de joueurs',
            entity: 'Player',
            target: fileName,
            after: `${out.length} joueur(s), ${parentIds.size} parent(s) créé(s), ${out.filter((o) => o.group).length} affecté(s) à un groupe`,
            reason: preview.errors ? `${preview.errors} ligne(s) ignorée(s) (erreurs)` : null,
          },
          tx,
        );
        return { imported: out, parentsCreated: parentIds.size, withoutFee };
      },
      { timeout: 120_000 },
    );
    return {
      ...report,
      skipped: preview.rows.filter((r) => r.status === 'error').map((r) => ({ line: r.line, n: r.n, name: r.name, messages: r.messages })),
    };
  }
}

/** Tableau de l'écran → lignes « comme le fichier » (en-têtes reconnus par l'analyse). */
function tableToRows(table: RawRow[]): Cell[][] {
  return [RAW_COLUMNS.map((k) => RAW_HEADER[k]), ...table.map((r) => RAW_COLUMNS.map((k) => (r[k] ?? '').toString().trim() || null))];
}
