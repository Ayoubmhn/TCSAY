import { BadRequestException, Injectable } from '@nestjs/common';
import { Gender, HistoricalKind, Origin, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import { ageAtYearEnd, dayFromIso, isoDay } from '../common/dates';
import { num } from '../common/money';
import { fullName, notFound } from '../common/rules';
import { nameMatch, normalizeName } from '../imports/name-match';
import { nextMemberCode } from '../players/member-code';
import { Cell, excelDate, readXlsx, sheetNames } from '../players/import/xlsx-reader';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonReportsService } from '../reports/season-reports.service';
import { readDocxTables } from './docx-reader';

export const REGISTERS = ['PLAYERS', 'INCOME', 'EXPENSE'] as const;
export type Register = (typeof REGISTERS)[number];
export type Source = 'EXCEL' | 'WORD' | 'MANUAL';
type Status = 'ok' | 'warning' | 'error';

/** Colonnes du tableau modifiable, par registre (valeurs saisies, comme dans le cahier). */
export const COLUMNS: Record<Register, readonly string[]> = {
  PLAYERS: ['name', 'nameAr', 'gender', 'birth', 'category', 'phone', 'parent', 'remark', 'match'],
  INCOME: ['date', 'label', 'category', 'person', 'amount', 'reference', 'remark'],
  EXPENSE: ['date', 'label', 'category', 'person', 'amount', 'reference', 'remark'],
};
export type RawRow = Record<string, string>;

export const INCOME_CATEGORIES = ['FEES', 'DONATION', 'RENTAL', 'TOURNAMENT', 'GRANT', 'OTHER'] as const;
export const EXPENSE_CATEGORIES = ['SALARY', 'UTILITIES', 'EQUIPMENT', 'MAINTENANCE', 'TAX', 'SOCIAL', 'INSURANCE', 'FEDERATION', 'TRAVEL', 'SERVICES', 'OTHER'] as const;
const LABEL: Record<Register, string> = { PLAYERS: 'Joueurs', INCOME: 'Recettes', EXPENSE: 'Dépenses' };

/** Minuscules, sans accents ; l'arabe garde ses lettres (voyelles retirées). */
const norm = (s: string | null | undefined) => normalizeName(s ?? '');
const str = (c: Cell | undefined) => (c === null || c === undefined ? '' : String(c).trim());

/** En-têtes reconnus (français et arabe) → colonne du tableau. L'ordre compte : la première règle qui correspond gagne. */
const HEADERS: Record<Register, [string, RegExp][]> = {
  PLAYERS: [
    ['nameAr', /arabe|الاسم واللقب|الإسم|الاسم|اللقب/],
    ['birth', /naissance|ne le|ولادة|الميلاد/],
    ['gender', /genre|sexe|الجنس/],
    ['category', /categorie|الصنف|الفئة/],
    ['phone', /tel|portable|الهاتف|الجوال/],
    ['parent', /parent|tuteur|pere|mere|الولي|الأب|الام/],
    ['remark', /remarque|observation|note|ملاحظ/],
    ['name', /nom|prenom|joueur|adherent/],
  ],
  INCOME: [
    ['date', /date|التاريخ/],
    ['amount', /montant|somme|recette|entree|المبلغ|المداخيل|مداخيل|القيمة/],
    ['reference', /recu|n ?°|numero|ref|الوصل|وصل|رقم/],
    ['category', /nature|type|categorie|النوع|الصنف/],
    ['person', /joueur|nom|adherent|payeur|الاسم|اللاعب|المنخرط/],
    ['label', /libelle|designation|objet|motif|البيان|التفاصيل/],
    ['remark', /remarque|observation|ملاحظ/],
  ],
  EXPENSE: [
    ['date', /date|التاريخ/],
    ['amount', /montant|somme|depense|sortie|المبلغ|المصاريف|مصاريف|القيمة/],
    ['reference', /facture|recu|n ?°|numero|ref|فاتورة|وصل|رقم/],
    ['category', /nature|type|categorie|النوع|الصنف/],
    ['person', /beneficiaire|fournisseur|entraineur|nom|المستفيد|المزود|المدرب|الاسم/],
    ['label', /libelle|designation|objet|motif|البيان|التفاصيل/],
    ['remark', /remarque|observation|ملاحظ/],
  ],
};

/** Nature d'une recette d'après le texte (cahier en français ou en arabe). */
function incomeCategory(text: string, hasPerson: boolean): string {
  const t = norm(text);
  if (INCOME_CATEGORIES.includes(text.trim().toUpperCase() as never)) return text.trim().toUpperCase();
  if (/cotis|inscri|abonn|اشتراك|معلوم|انخراط|تسجيل/.test(t)) return 'FEES';
  if (/\bdon\b|dons|تبرع|هبة|هبات/.test(t)) return 'DONATION';
  if (/locat|terrain|reserv|كراء|ملعب/.test(t)) return 'RENTAL';
  if (/tournoi|competition|دورة|بطولة/.test(t)) return 'TOURNAMENT';
  if (/subvent|aide|منحة|دعم/.test(t)) return 'GRANT';
  if (/autre|divers|اخر|متفرق/.test(t)) return 'OTHER';
  return hasPerson ? 'FEES' : 'OTHER';
}

/** Nature d'une dépense d'après le texte. */
function expenseCategory(text: string): string {
  const t = norm(text);
  if (EXPENSE_CATEGORIES.includes(text.trim().toUpperCase() as never)) return text.trim().toUpperCase();
  if (/salaire|entraineur|coach|honorair|اجر|راتب|مدرب|منحة المدرب/.test(t)) return 'SALARY';
  if (/steg|sonede|electri|eau|internet|telephon|كهرباء|ماء|فاتورة|انترنات|هاتف/.test(t)) return 'UTILITIES';
  if (/balle|raquette|materiel|filet|كرات|معدات|مضرب|شباك/.test(t)) return 'EQUIPMENT';
  if (/entretien|reparation|peinture|travaux|صيانة|اصلاح|دهن|اشغال/.test(t)) return 'MAINTENANCE';
  if (/impot|taxe|fiscal|ضريبة|اداء|الاداءات|جباية/.test(t)) return 'TAX';
  if (/cnss|social|ضمان/.test(t)) return 'SOCIAL';
  if (/assuranc|تامين/.test(t)) return 'INSURANCE';
  if (/federat|licence|affiliat|engagement|جامعة|اجازة|اجازات|انخراط/.test(t)) return 'FEDERATION';
  if (/deplacement|transport|voyage|carburant|essence|تنقل|نقل|سفر|وقود/.test(t)) return 'TRAVEL';
  if (/comptab|nettoyage|prestat|gardien|محاسب|تنظيف|حارس|خدمات/.test(t)) return 'SERVICES';
  return 'OTHER';
}

/** Montant du cahier : « 1 200,500 », « 1.200,5 », « 120 د », « 120DT ». */
function parseAmount(s: string): number | null {
  let t = s.replace(/[^\d.,-]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

/** Date : « 2015-10-03 », « 03/10/2015 », « 3-10-15 », date Excel (nombre). */
function parseDate(s: string): { date: string | null; error?: string } {
  if (!s) return { date: null };
  const t = s.trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) return { date: excelDate(Number(t)) };
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y > 1950 && y <= 2100;
  };
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let m = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(t);
  if (m && valid(+m[1], +m[2], +m[3])) return { date: iso(+m[1], +m[2], +m[3]) };
  m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (valid(y, +m[2], +m[1])) return { date: iso(y, +m[2], +m[1]) };
  }
  return { date: null, error: `date « ${t} » illisible` };
}

/** Naissance : date complète ou année seule (1er janvier). */
function parseBirth(s: string): { date: string | null; yearOnly: boolean; error?: string } {
  const t = s.trim();
  if (!t) return { date: null, yearOnly: false };
  if (/^\d{4}$/.test(t) && +t > 1930 && +t <= new Date().getFullYear()) return { date: `${t}-01-01`, yearOnly: true };
  const d = parseDate(t);
  return d.date ? { date: d.date, yearOnly: false } : { date: null, yearOnly: false, error: `naissance « ${t} » illisible` };
}

function parseGender(s: string): Gender | null {
  const g = norm(s);
  if (['h', 'm', 'g', 'garcon', 'homme', 'masculin', 'ذكر', 'ولد'].includes(g)) return Gender.M;
  if (['f', 'fille', 'femme', 'feminin', 'انثى', 'انثي', 'بنت'].includes(g)) return Gender.F;
  return null;
}

/** Cellule Excel → texte du tableau (dates Excel converties si la colonne est une date). */
function cellText(c: Cell, key: string): string {
  if (typeof c === 'number' && (key === 'date' || key === 'birth') && c > 20000 && c < 80000) return excelDate(c);
  if (typeof c === 'number') return String(Math.round(c * 1000) / 1000);
  return str(c);
}

type PlayerRow = {
  line: number;
  status: Status;
  messages: string[];
  name: string;
  category: { id: string; code: string; name: string } | null;
  age: number | null;
  /** Joueur déjà connu (autre saison) : choisi automatiquement ou par l'administrateur. */
  player: { id: string; name: string; memberCode: string | null; seasons: string[] } | null;
  /** Joueurs qui ressemblent (à confirmer dans la colonne « Même joueur »). */
  candidates: { id: string; name: string; memberCode: string | null; birth: string | null; seasons: string[] }[];
  plan: {
    firstName: string;
    lastName: string;
    nameAr: string | null;
    gender: Gender | null;
    birthDate: string | null;
    birthYearOnly: boolean;
    phone: string | null;
    notes: string | null;
  };
};

type MoneyRow = {
  line: number;
  status: Status;
  messages: string[];
  category: string;
  date: string | null;
  amount: number | null;
  label: string;
  player: { id: string; name: string; memberCode: string | null } | null;
};

/**
 * Import de l'historique du club : saisons passées (HISTORICAL, verrouillées R1), registres Joueurs, Recettes et
 * Dépenses (salaires compris) depuis Excel, Word ou une saisie à la main (photo du cahier à côté). Tableau modifiable,
 * analyse, puis enregistrement en une fois (lot, origine IMPORT, source gardée : R14). Les montants anciens ne sont
 * jamais relancés ni modifiés (R7) : une erreur s'annule avec le lot entier (motif), puis on réimporte.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly reports: SeasonReportsService,
    private readonly audit: AuditService,
  ) {}

  /** Saison où l'on importe : historique seulement (les saisons gérées dans l'application ont déjà leurs données). */
  async season(id: string) {
    const s = await this.prisma.season.findUnique({ where: { id }, select: { id: true, label: true, status: true, startDate: true, endDate: true, archivedAt: true } });
    if (!s || s.archivedAt) throw notFound('Saison');
    if (s.status !== 'HISTORICAL') throw new BadRequestException(`R1 · L'import historique se fait dans une saison « Historique » (la saison ${s.label} est gérée dans l'application).`);
    return s;
  }

  // ───────────────────────── Lecture des fichiers ─────────────────────────

  /**
   * Fichier Excel (toutes les feuilles) ou Word (tous les tableaux) → lignes du tableau modifiable, colonnes
   * reconnues d'après les en-têtes. Un journal de caisse avec deux colonnes (recettes, dépenses) donne les
   * lignes du registre demandé seulement.
   */
  read(register: Register, buffer: Buffer, fileName: string): { source: Source; table: RawRow[]; parts: string[]; unknown: string[] } {
    const isDocx = /\.docx$/i.test(fileName);
    let grids: { name: string; rows: Cell[][] }[];
    try {
      if (isDocx) grids = readDocxTables(buffer).map((rows, i) => ({ name: `Tableau ${i + 1}`, rows }));
      else grids = this.sheets(buffer);
    } catch (e) {
      throw new BadRequestException(`Fichier illisible : ${e instanceof Error ? e.message : e}`);
    }
    if (!grids.length) throw new BadRequestException(isDocx ? 'Aucun tableau dans ce document Word.' : 'Aucune feuille dans ce fichier.');
    const table: RawRow[] = [];
    const parts: string[] = [];
    const unknown = new Set<string>();
    for (const g of grids) {
      const rows = g.rows.filter((r) => r.some((c) => str(c)));
      const found = this.mapHeader(register, rows);
      if (!found) continue;
      parts.push(`${g.name} (${rows.length - found.index - 1} lignes)`);
      found.unknown.forEach((u) => unknown.add(u));
      for (const r of rows.slice(found.index + 1)) {
        const raw: RawRow = Object.fromEntries(COLUMNS[register].map((k) => [k, ''])) as RawRow;
        for (const [k, i] of Object.entries(found.map)) raw[k] = cellText(r[i] ?? null, k);
        // Journal de caisse : la ligne n'a de montant que dans l'autre colonne → elle va dans l'autre registre.
        if (found.other >= 0 && !raw.amount && str(r[found.other])) continue;
        if (Object.values(raw).every((v) => !v)) continue;
        // Valeurs reconnues mises au format du tableau (listes de choix).
        if (register === 'INCOME') raw.category = incomeCategory(raw.category || raw.label, !!raw.person);
        if (register === 'EXPENSE') raw.category = expenseCategory(raw.category || `${raw.label} ${raw.person}`);
        if (register === 'PLAYERS') {
          const g = parseGender(raw.gender);
          if (g) raw.gender = g === Gender.F ? 'f' : 'h';
        }
        // Ligne de total du cahier : ignorée.
        if (/^(total|المجموع|الجملة)/.test(norm(raw.label || raw.name || raw.person))) continue;
        table.push(raw);
      }
    }
    if (!parts.length) {
      throw new BadRequestException(
        register === 'PLAYERS'
          ? 'En-têtes introuvables : il faut au moins une colonne « Nom » (ou « الاسم »). Sinon, saisissez les lignes à la main.'
          : 'En-têtes introuvables : il faut au moins une colonne « Montant » (ou « المبلغ »). Sinon, saisissez les lignes à la main.',
      );
    }
    return { source: isDocx ? 'WORD' : 'EXCEL', table: table.slice(0, 3000), parts, unknown: [...unknown] };
  }

  /** Toutes les feuilles du classeur. */
  private sheets(buffer: Buffer) {
    return sheetNames(buffer).map((name) => {
      const s = readXlsx(buffer, name);
      return { name: s.sheet, rows: s.rows };
    });
  }

  /** Ligne d'en-tête (dans les 10 premières) et colonnes reconnues. */
  private mapHeader(register: Register, rows: Cell[][]) {
    for (let index = 0; index < Math.min(rows.length, 10); index++) {
      const header = rows[index].map((c) => norm(str(c)));
      const map: Record<string, number> = {};
      const unknown: string[] = [];
      let other = -1;
      header.forEach((h, i) => {
        if (!h) return;
        // Journal de caisse : colonne de l'autre registre.
        if (register === 'INCOME' && /depense|sortie|مصاريف|المصاريف/.test(h)) return void (other = i);
        if (register === 'EXPENSE' && /recette|entree|مداخيل|المداخيل/.test(h)) return void (other = i);
        // N° d'ordre du cahier : sans intérêt pour l'import.
        if (/^(n|no|num|numero|ع|ر|الرقم|عدد)$/.test(h)) return;
        const rule = HEADERS[register].find(([key, re]) => re.test(h) && map[key] === undefined);
        if (rule) map[rule[0]] = i;
        else unknown.push(str(rows[index][i]));
      });
      const key = register === 'PLAYERS' ? map.name ?? map.nameAr : map.amount;
      // Au moins deux colonnes reconnues : un titre (« Liste des adhérents… ») n'est pas une ligne d'en-tête.
      if (key !== undefined && Object.keys(map).length >= 2) {
        // Arabe seulement : le nom arabe sert aussi de nom.
        if (register === 'PLAYERS' && map.name === undefined) {
          map.name = map.nameAr;
          delete map.nameAr;
        }
        return { index, map, unknown, other };
      }
    }
    return null;
  }

  // ───────────────────────── Analyse ─────────────────────────

  async preview(seasonId: string, register: Register, table: RawRow[]) {
    const season = await this.season(seasonId);
    const rows = table.slice(0, 3000).map((r) => Object.fromEntries(COLUMNS[register].map((k) => [k, String(r?.[k] ?? '').trim().slice(0, 300)])) as RawRow);
    const result = register === 'PLAYERS' ? await this.analyzePlayers(season, rows) : await this.analyzeMoney(season, register, rows);
    const count = (s: Status) => result.filter((r) => r.status === s).length;
    const amounts = register === 'PLAYERS' ? 0 : (result as MoneyRow[]).filter((r) => r.status !== 'error').reduce((t, r) => t + (r.amount ?? 0), 0);
    return {
      season: { id: season.id, label: season.label },
      register,
      total: result.length,
      ok: count('ok'),
      warnings: count('warning'),
      errors: count('error'),
      amount: Math.round(amounts * 1000) / 1000,
      found: register === 'PLAYERS' ? (result as PlayerRow[]).filter((r) => r.status !== 'error' && r.player).length : 0,
      categories: register === 'PLAYERS' ? (await this.categoryList()).map((c) => c.name) : [],
      rows: result,
    };
  }

  private categoryList() {
    return this.prisma.category.findMany({ where: { archivedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true, gender: true, pairCode: true, family: true } });
  }

  private async analyzePlayers(season: { id: string; label: string; startDate: Date }, rows: RawRow[]): Promise<PlayerRow[]> {
    const year = season.startDate.getUTCFullYear();
    const [cats, players] = await Promise.all([
      this.categoryList(),
      this.prisma.player.findMany({
        where: { archivedAt: null },
        select: { id: true, firstName: true, lastName: true, nameAr: true, birthDate: true, memberCode: true, enrollments: { select: { seasonId: true, season: { select: { label: true } } } } },
      }),
    ]);
    const leisure = cats.find((c) => c.family === 'LEISURE') ?? null;
    const seen = new Map<string, number>();
    const out: PlayerRow[] = [];

    for (const [i, raw] of rows.entries()) {
      if (Object.entries(raw).every(([k, v]) => k === 'match' || !v)) continue;
      const messages: string[] = [];
      let status: Status = 'ok';
      const fail = (m: string) => (messages.push(m), (status = 'error'));
      const warn = (m: string) => (messages.push(m), status === 'ok' && (status = 'warning'));
      const name = raw.name || raw.nameAr;
      const parts = name.split(/\s+/).filter(Boolean);
      const birth = parseBirth(raw.birth);
      const gender = parseGender(raw.gender);
      const row: PlayerRow = {
        line: i + 2,
        status: 'ok',
        messages,
        name,
        category: null,
        age: null,
        player: null,
        candidates: [],
        plan: {
          firstName: parts[0] ?? '',
          lastName: parts.slice(1).join(' ') || '—',
          nameAr: raw.nameAr && raw.name ? raw.nameAr : /[؀-ۿ]/.test(name) ? name : null,
          gender,
          birthDate: birth.date,
          birthYearOnly: birth.yearOnly,
          phone: raw.phone || null,
          notes: [raw.remark, raw.parent ? `Parent (cahier) : ${raw.parent}` : ''].filter(Boolean).join(' · ') || null,
        },
      };
      if (!name) fail('nom manquant');
      if (birth.error) warn(`${birth.error} : laissée vide`);
      if (birth.yearOnly) warn('année de naissance seulement (1er janvier)');
      row.age = birth.date ? ageAtYearEnd(dayFromIso(birth.date), year) : null;

      // Joueur déjà connu : même nom (français ou arabe), naissance compatible.
      if (name) {
        const byYear = (d: Date | null) => (d && birth.date ? d.getUTCFullYear() === Number(birth.date.slice(0, 4)) : true);
        const scored = players
          .map((p) => {
            const fr = nameMatch(name, fullName(p));
            const ar = p.nameAr && raw.nameAr ? nameMatch(raw.nameAr, p.nameAr) : { score: 0, weakest: 0 };
            const best = fr.score >= ar.score ? fr : ar;
            return { p, ...best, exactName: norm(name) === norm(fullName(p)) || (!!raw.nameAr && !!p.nameAr && norm(raw.nameAr) === norm(p.nameAr)) };
          })
          .filter((x) => x.score >= 0.85 && x.weakest >= 0.7 && byYear(x.p.birthDate))
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        row.candidates = scored.map(({ p }) => ({
          id: p.id,
          name: fullName(p),
          memberCode: p.memberCode,
          birth: p.birthDate ? isoDay(p.birthDate) : null,
          seasons: p.enrollments.map((e) => e.season.label).sort(),
        }));
        const pick = (id: string) => {
          const c = players.find((p) => p.id === id);
          return c ? { id: c.id, name: fullName(c), memberCode: c.memberCode, seasons: c.enrollments.map((e) => e.season.label).sort() } : null;
        };
        if (raw.match === 'new') {
          if (scored.length) messages.push('nouveau joueur (choisi)');
        } else if (raw.match) {
          row.player = pick(raw.match);
          if (!row.player) fail('joueur choisi introuvable');
        } else {
          // Automatique seulement si c'est sûr : même nom exact, une seule personne, naissance identique ou inconnue.
          const sure = scored.filter((x) => x.exactName && (!birth.date || !x.p.birthDate || isoDay(x.p.birthDate) === birth.date || birth.yearOnly));
          if (sure.length === 1) row.player = pick(sure[0].p.id);
          else if (scored.length) warn(`ressemble à ${scored.map((x) => `${fullName(x.p)}${x.p.memberCode ? ` (${x.p.memberCode})` : ''}`).join(', ')} : confirmez dans « Même joueur », sinon nouveau joueur`);
        }
        if (row.player) {
          const p = players.find((x) => x.id === row.player!.id)!;
          if (p.enrollments.some((e) => e.seasonId === season.id)) fail(`déjà inscrit à la saison ${season.label}`);
          else messages.push(`retrouvé${row.player.seasons.length ? ` (saisons ${row.player.seasons.join(', ')})` : ''}`);
        }
        const key = row.player?.id ?? `${norm(name)}|${birth.date ?? ''}`;
        if (seen.has(key)) fail(`doublon de la ligne ${seen.get(key)}`);
        seen.set(key, row.line);
      }

      // Genre : obligatoire pour un nouveau joueur ; pris de la fiche si le joueur est retrouvé.
      const knownGender = row.player ? (await this.prisma.player.findUnique({ where: { id: row.player.id }, select: { gender: true } }))?.gender ?? null : null;
      const g = gender ?? knownGender;
      if (!g) fail(`genre « ${raw.gender} » non reconnu (h ou f)`);

      // Catégorie de la saison : celle du cahier, sinon d'après l'âge et le genre, sinon Loisirs.
      const wanted = norm(raw.category);
      if (wanted) {
        const found =
          cats.find((c) => norm(c.code) === wanted || norm(c.name) === wanted) ??
          cats.filter((c) => norm(c.name).includes(wanted) || wanted.includes(norm(c.pairCode))).find((c) => !g || c.gender === g || c.gender === 'MIXED');
        if (found) row.category = { id: found.id, code: found.code, name: found.name };
        else warn(`catégorie « ${raw.category} » inconnue`);
      }
      if (!row.category && g) {
        const birthDate = birth.date ? dayFromIso(birth.date) : null;
        const fromPlayer = !birthDate && row.player ? (await this.prisma.player.findUnique({ where: { id: row.player.id }, select: { birthDate: true } }))?.birthDate : null;
        const b = birthDate ?? fromPlayer ?? null;
        if (b) {
          const s = await this.categories.suggest(b, g, year);
          if ('error' in s) warn(s.error ?? 'catégorie introuvable');
          else row.category = { id: s.category.id, code: s.category.code, name: s.category.name };
        }
      }
      if (!row.category && leisure) {
        row.category = { id: leisure.id, code: leisure.code, name: leisure.name };
        if (!wanted) warn('sans catégorie ni naissance : compté en « Loisirs »');
      }
      if (!row.category) fail('catégorie introuvable');
      row.status = status;
      out.push(row);
    }
    return out;
  }

  private async analyzeMoney(season: { id: string; startDate: Date; endDate: Date }, register: 'INCOME' | 'EXPENSE', rows: RawRow[]): Promise<MoneyRow[]> {
    const from = isoDay(season.startDate);
    const to = isoDay(season.endDate);
    const players =
      register === 'INCOME'
        ? await this.prisma.player.findMany({ where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true, nameAr: true, memberCode: true, enrollments: { where: { seasonId: season.id }, select: { id: true } } } })
        : [];
    const out: MoneyRow[] = [];
    for (const [i, raw] of rows.entries()) {
      if (Object.values(raw).every((v) => !v)) continue;
      const messages: string[] = [];
      let status: Status = 'ok';
      const fail = (m: string) => (messages.push(m), (status = 'error'));
      const warn = (m: string) => (messages.push(m), status === 'ok' && (status = 'warning'));
      const amount = parseAmount(raw.amount);
      if (amount === null) fail('montant manquant');
      else if (amount <= 0) fail('montant nul ou négatif');
      const d = parseDate(raw.date);
      if (d.error) warn(`${d.error} : laissée vide`);
      else if (!d.date) warn('sans date (comptée dans la saison)');
      else if (d.date < from || d.date > to) warn(`date hors de la saison (${from} → ${to})`);
      const text = `${raw.category} ${raw.label}`;
      const category = register === 'INCOME' ? incomeCategory(raw.category || raw.label, !!raw.person) : expenseCategory(raw.category || text);
      const label = raw.label || raw.person || (register === 'INCOME' ? 'Recette' : 'Dépense');
      let player: MoneyRow['player'] = null;
      // Joueur : colonne « Joueur / payeur », sinon le nom écrit dans le libellé (« Cotisation Nour Hammami », « اشتراك ياسين »).
      const who = raw.person || (category === 'FEES' ? raw.label.replace(/cotisations?|inscriptions?|abonnements?|tranche\s*\d*|اشتراك|معلوم|انخراط|تسجيل|\d+/gi, ' ').trim() : '');
      if (register === 'INCOME' && who) {
        const best = players
          .map((p) => ({ p, ...[nameMatch(who, fullName(p)), p.nameAr ? nameMatch(who, p.nameAr) : { score: 0, weakest: 0 }].sort((a, b) => b.score - a.score)[0] }))
          .filter((x) => x.score >= 0.85 && x.weakest >= 0.7)
          .sort((a, b) => b.score - a.score || b.p.enrollments.length - a.p.enrollments.length);
        if (best[0]) {
          player = { id: best[0].p.id, name: fullName(best[0].p), memberCode: best[0].p.memberCode };
          if (category === 'FEES' && !best[0].p.enrollments.length) warn(`${player.name} n'est pas inscrit à cette saison (importez d'abord les joueurs)`);
        } else if (category === 'FEES') warn('joueur non reconnu : recette gardée sans lien');
      }
      out.push({ line: i + 2, status, messages, category, date: d.date, amount, label, player });
    }
    return out;
  }

  // ───────────────────────── Enregistrement ─────────────────────────

  async commit(actor: AuthUser, seasonId: string, register: Register, table: RawRow[], source: Source, fileName: string | null) {
    const preview = await this.preview(seasonId, register, table);
    const valid = preview.rows.filter((r) => r.status !== 'error');
    if (!valid.length) throw new BadRequestException('Aucune ligne à enregistrer : corrigez les lignes en rouge.');
    const season = preview.season;
    const origin = fileName ? `${fileName}` : 'Saisie à la main';
    const result = await this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: { seasonId, label: `${LABEL[register]} · ${origin}`, status: 'DONE', register, source, fileName, rowCount: valid.length, createdById: actor.id },
        });
        let created = 0;
        let linked = 0;
        if (register === 'PLAYERS') {
          const year = (await tx.season.findUniqueOrThrow({ where: { id: seasonId } })).startDate.getUTCFullYear();
          for (const r of valid as PlayerRow[]) {
            let playerId = r.player?.id;
            if (!playerId) {
              const code = await nextMemberCode(tx, year);
              const p = await tx.player.create({
                data: {
                  ...code,
                  firstName: r.plan.firstName,
                  lastName: r.plan.lastName,
                  nameAr: r.plan.nameAr,
                  gender: r.plan.gender!,
                  birthDate: r.plan.birthDate ? dayFromIso(r.plan.birthDate) : null,
                  birthYearOnly: r.plan.birthYearOnly,
                  phone: r.plan.phone,
                  notes: r.plan.notes,
                  origin: Origin.IMPORT,
                  importRef: `Historique ${season.label} · ${origin} · ligne ${r.line}`,
                },
              });
              playerId = p.id;
              created++;
            } else {
              linked++;
              // Nom arabe du cahier : ajouté seulement s'il manque sur la fiche (jamais d'écrasement, R14).
              if (r.plan.nameAr) await tx.player.updateMany({ where: { id: playerId, nameAr: null }, data: { nameAr: r.plan.nameAr } });
            }
            await tx.enrollment.create({ data: { playerId, seasonId, categoryId: r.category!.id, origin: Origin.IMPORT, importBatchId: batch.id } });
          }
        } else {
          await tx.historicalEntry.createMany({
            data: (valid as MoneyRow[]).map((r) => {
              const raw = table[r.line - 2] ?? {};
              return {
                seasonId,
                batchId: batch.id,
                kind: register as HistoricalKind,
                category: r.category,
                date: r.date ? dayFromIso(r.date) : null,
                label: r.label.slice(0, 200),
                person: raw.person?.trim().slice(0, 150) || null,
                playerId: r.player?.id ?? null,
                amount: new Prisma.Decimal(r.amount!),
                reference: raw.reference?.trim().slice(0, 60) || null,
                note: raw.remark?.trim().slice(0, 300) || null,
                sourceRef: `${origin} · ligne ${r.line}`,
              };
            }),
          });
          created = valid.length;
        }
        await this.audit.log(
          actor.id,
          {
            action: `Import historique : ${LABEL[register].toLowerCase()}`,
            entity: 'ImportBatch',
            entityId: batch.id,
            target: `Saison ${season.label}`,
            after: register === 'PLAYERS' ? `${created} nouveaux joueurs, ${linked} retrouvés` : `${created} lignes, ${preview.amount} DT`,
          },
          tx,
        );
        return { batchId: batch.id, created, linked };
      },
      { timeout: 120_000 },
    );
    return { ...result, rows: valid.length, skipped: preview.errors, amount: preview.amount };
  }

  /**
   * Annulation d'un lot (motif) : recettes et dépenses archivées ; inscriptions du lot retirées ; joueurs créés par
   * l'import sans autre saison ni compte archivés (R8). Rien n'est supprimé du journal d'audit.
   */
  async cancel(actor: AuthUser, batchId: string, reason: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId }, include: { season: { select: { label: true } } } });
    if (!batch || !batch.register) throw notFound('Lot d’import');
    if (batch.cancelledAt) throw new BadRequestException('Ce lot est déjà annulé.');
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const entries = await tx.historicalEntry.updateMany({ where: { batchId, archivedAt: null }, data: { archivedAt: now } });
      const enrollments = await tx.enrollment.findMany({
        where: { importBatchId: batchId },
        select: { id: true, playerId: true, membership: { select: { id: true } }, _count: { select: { groups: true } } },
      });
      const removable = enrollments.filter((e) => !e.membership && !e._count.groups);
      await tx.enrollment.deleteMany({ where: { id: { in: removable.map((e) => e.id) } } });
      const orphans = await tx.player.findMany({
        where: { id: { in: removable.map((e) => e.playerId) }, origin: Origin.IMPORT, userId: null, archivedAt: null, enrollments: { none: {} }, parentLinks: { none: {} } },
        select: { id: true },
      });
      await tx.player.updateMany({ where: { id: { in: orphans.map((p) => p.id) } }, data: { archivedAt: now } });
      await tx.importBatch.update({ where: { id: batchId }, data: { cancelledAt: now, cancelReason: reason.trim() } });
      await this.audit.log(
        actor.id,
        { action: 'Import historique annulé', entity: 'ImportBatch', entityId: batchId, target: `${batch.label} · saison ${batch.season?.label ?? ''}`, reason, after: `${entries.count} écritures, ${removable.length} inscriptions, ${orphans.length} joueurs archivés` },
        tx,
      );
      return { entries: entries.count, enrollments: removable.length, players: orphans.length };
    });
  }

  // ───────────────────────── Consultation ─────────────────────────

  /** Saisons passées : chiffres (bilan), lots importés, rapports déposés. */
  async overview() {
    const seasons = await this.prisma.season.findMany({
      where: { archivedAt: null, status: { in: ['HISTORICAL', 'CLOSED'] } },
      orderBy: { startDate: 'desc' },
      select: { id: true, label: true, status: true, startDate: true, endDate: true },
    });
    const ids = seasons.map((s) => s.id);
    const [batches, enrollments, imported, files, drafts] = await Promise.all([
      this.prisma.importBatch.findMany({
        where: { seasonId: { in: ids }, register: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, seasonId: true, label: true, register: true, source: true, fileName: true, rowCount: true, createdAt: true, cancelledAt: true, cancelReason: true },
      }),
      this.prisma.enrollment.groupBy({ by: ['seasonId'], where: { seasonId: { in: ids } }, _count: true }),
      this.prisma.enrollment.groupBy({ by: ['seasonId'], where: { seasonId: { in: ids }, origin: Origin.IMPORT }, _count: true }),
      this.prisma.seasonReportFile.groupBy({ by: ['seasonId', 'kind'], where: { seasonId: { in: ids }, archivedAt: null }, _count: true }),
      this.prisma.seasonReportDraft.findMany({ where: { seasonId: { in: ids } }, select: { seasonId: true, kind: true } }),
    ]);
    const out = [];
    for (const s of seasons) {
      const money = await this.reports.money(s);
      const returning = await this.prisma.enrollment.count({ where: { seasonId: s.id, player: { enrollments: { some: { season: { startDate: { lt: s.startDate } } } } } } });
      out.push({
        id: s.id,
        label: s.label,
        status: s.status,
        startDate: isoDay(s.startDate),
        endDate: isoDay(s.endDate),
        players: enrollments.find((e) => e.seasonId === s.id)?._count ?? 0,
        importedPlayers: imported.find((e) => e.seasonId === s.id)?._count ?? 0,
        returning,
        income: money.income.total,
        expenses: money.expenses.total,
        result: money.result,
        reports: {
          MORAL: files.find((f) => f.seasonId === s.id && f.kind === 'MORAL')?._count ?? 0,
          FINANCIAL: files.find((f) => f.seasonId === s.id && f.kind === 'FINANCIAL')?._count ?? 0,
          drafts: drafts.filter((d) => d.seasonId === s.id).map((d) => d.kind),
        },
        batches: batches.filter((b) => b.seasonId === s.id).map(({ seasonId: _s, ...b }) => b),
      });
    }
    return out;
  }

  /** Écritures d'une saison (recettes ou dépenses), pour vérifier ce qui a été importé. */
  async entries(seasonId: string, kind: HistoricalKind) {
    const rows = await this.prisma.historicalEntry.findMany({
      where: { seasonId, kind, archivedAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
      select: { id: true, category: true, date: true, label: true, person: true, amount: true, reference: true, note: true, sourceRef: true, player: { select: { id: true, firstName: true, lastName: true, memberCode: true } } },
    });
    return rows.map((r) => ({
      ...r,
      date: r.date ? isoDay(r.date) : null,
      amount: num(r.amount),
      player: r.player ? { id: r.player.id, name: fullName(r.player), memberCode: r.player.memberCode } : null,
    }));
  }
}
