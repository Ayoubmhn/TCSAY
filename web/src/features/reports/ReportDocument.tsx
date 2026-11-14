import type { ReactNode } from 'react';

/** Données des rapports de fin de saison (GET /seasons/:id/reports). */
export type ReportKind = 'MORAL' | 'FINANCIAL';
export type Letterhead = { nameFr: string; nameAr: string; addressFr: string; addressAr: string; phone: string; fax: string };
export type SeasonReports = {
  season: { id: string; label: string; status: string };
  previous: { id: string; label: string } | null;
  letterhead: Letterhead;
  moral: {
    firstSession: string;
    members: {
      total: number;
      boys: number;
      girls: number;
      newPlayers: number;
      returning: number;
      previousTotal: number | null;
      categories: { category: string; code: string; boys: number; girls: number }[];
    };
    staff: { groups: number; competitive: number; leisure: number; coaches: string[] };
    training: { sessions: number; marked: number; rate: number | null };
    competition: { matches: number; tournaments: { name: string; startDate: string; endDate: string; finished: boolean; winner: string | null; players: number }[] };
    events: { title: string; date: string; place: string }[];
  };
  financial: {
    income: {
      fees: number;
      feesCount: number;
      courts: number;
      courtsCount: number;
      tournaments: number;
      other: { category: string; count: number; amount: number }[];
      imported: boolean;
      total: number;
      remaining: number;
      discounts: number;
    };
    expenses: { salaries: number; categories: { category: string; count: number; amount: number }[]; total: number; unpaid: number };
    result: number;
    previous: { label: string; income: number; expenses: number; result: number } | null;
  };
  drafts: Record<ReportKind, { texts: Record<string, string>; version: number; from: 'season' | 'previous' | 'default'; updatedAt: string | null }>;
  files: { id: string; kind: ReportKind; fileName: string; mimeType: string; size: number; createdAt: string }[];
  /** Rapports déposés de la saison précédente (modèle pour rédiger ceux de cette saison). */
  previousFiles: { id: string; kind: ReportKind; fileName: string; mimeType: string; size: number; createdAt: string }[];
};

/** Texte isolé de gauche à droite (années, montants) dans une phrase arabe. */
const ltr = (s: string) => `⁦${s}⁩`;
/** Texte isolé dans son propre sens (noms en français au milieu de l'arabe). */
const iso = (s: string) => `⁨${s}⁩`;
/** « 2025-2026 » → « 2025 / 2026 », lu de droite à gauche comme sur les rapports du club (2025 à droite). */
const seasonAr = (label: string) => `\u2067${label.replace(/\s*[-/]\s*/, ' / ')}\u2069`;
/** Mois tunisiens. */
const MONTHS_AR = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthYearAr = (d: string) => `${MONTHS_AR[Number(d.slice(5, 7)) - 1]} ${ltr(d.slice(0, 4))}`;
export const dayAr = (d: string) => `${ltr(String(Number(d.slice(8, 10))).padStart(2, '0'))} ${MONTHS_AR[Number(d.slice(5, 7)) - 1]} ${ltr(d.slice(0, 4))}`;
/** Montant à la manière du club : « 52 830,000 » (trois décimales, chiffres latins). */
export const amt = (n: number) =>
  ltr(
    (n < 0 ? '−' : '') +
      Math.abs(n)
        .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
        .replace(/\u202f/g, '\u00a0'),
  );
/** Montant saisi (« 1 200,5 », « 1200.500 ») ; vide = null. */
export const parseAmt = (s?: string) => {
  const t = (s ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Listes enregistrées en JSON dans les textes du bureau. */
export type ResultRow = { date: string; text: string };
export type DebtRow = { label: string; amount: string };
export type ManualIncome = { federation?: string; wilaya?: string; municipality?: string; supporters?: string; membership?: string };
export function parseList<T>(s?: string): T[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function parseObj<T extends object>(s?: string): T {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : ({} as T);
  } catch {
    return {} as T;
  }
}

export type FieldType = 'line' | 'text' | 'number' | 'toggle' | 'results' | 'debts' | 'income';
export type TextField = { key: string; title: string; hint: string; type: FieldType; fallback: (d: SeasonReports) => string };

/** Champs rédigés par le bureau, dans l'ordre du rapport (modèle des rapports papier du club). */
export const TEXT_FIELDS: Record<ReportKind, TextField[]> = {
  MORAL: [
    { key: 'basmala', title: 'البسملة', hint: 'Formule d’ouverture (vide = retirée)', type: 'line', fallback: () => 'بسم الله الرحمان الرحيم' },
    { key: 'greeting', title: 'التحية', hint: 'Salutation', type: 'line', fallback: () => 'حضرات السادة، ضيوفنا الكرام.' },
    {
      key: 'intro',
      title: 'تقديم',
      hint: 'Introduction',
      type: 'text',
      fallback: (d) =>
        `يسر الهيئة المديرة لنادي التنس بصيادة تقديم التقرير الأدبي للموسم الرياضي ${seasonAr(d.season.label)} قصد عرض نشاط النادي طيلة الموسم والوقوف على أهم إنجازاته والسعي إلى تجاوز الصعوبات التي واجهها.`,
    },
    {
      key: 'start',
      title: 'انطلاق النشاط',
      hint: 'Début de la saison, encadrement',
      type: 'text',
      fallback: (d) => {
        const coaches = d.moral.staff.coaches.map(iso);
        const who = coaches.length ? ` تحت إشراف الإطار الفني للنادي المتكون من السادة: ${coaches.join('، ')}` : '';
        return `كان انطلاق نشاط النادي في بداية شهر ${monthYearAr(d.moral.firstSession)}${who}.`;
      },
    },
    { key: 'licensed', title: 'عدد المجازين', hint: 'Joueurs licenciés à la fédération (facultatif)', type: 'number', fallback: () => '' },
    { key: 'committee', title: 'اللجنة الفنية', hint: 'Comité technique : missions et composition (facultatif)', type: 'text', fallback: () => '' },
    { key: 'infrastructure', title: 'البنية التحتية', hint: 'Installations, projets, démarches (facultatif)', type: 'text', fallback: () => '' },
    { key: 'results', title: 'نتائج اللاعبين في الدورات الوطنية للتنس', hint: 'Résultats des joueurs (un résultat par ligne)', type: 'results', fallback: () => '[]' },
    {
      key: 'thanks',
      title: 'شكر',
      hint: 'Remerciements',
      type: 'text',
      fallback: () => 'ولا يسع الهيئة المديرة إلا أن تتقدم بجزيل الشكر للإطار الفني المشرف على تكوين اللاعبين وتثمن دور الأولياء لتعاونهم معنا في تأطير أبنائنا.',
    },
    { key: 'difficulties', title: 'الصعوبات', hint: 'Difficultés (une par ligne)', type: 'text', fallback: () => '' },
    { key: 'goals', title: 'الآفاق والأهداف', hint: 'Objectifs de la saison suivante (facultatif)', type: 'text', fallback: () => '' },
    {
      key: 'conclusion',
      title: 'خاتمة',
      hint: 'Conclusion',
      type: 'text',
      fallback: () =>
        'وفي الختام تتقدم الهيئة المديرة لنادي التنس بصيادة بجزيل الشكر للسادة الأولياء الذين وضعوا ثقتهم في الإطار الإداري والفني، وتهيب بكل من يهمه العمل الجمعياتي ألا يبخل على النادي بمزيد الدعم حتى يستمر في تحقيق أهداف رسالته.\nنسأل الله أن نكون قد وفقنا في مسعانا، ودمتم خير سند لنادي التنس بصيادة.',
    },
    { key: 'closing', title: 'الختم', hint: 'Formule finale', type: 'line', fallback: () => 'والسلام' },
    {
      key: 'showStats',
      title: 'إحصائيات',
      hint: 'Ajouter les tableaux de chiffres (membres par catégorie, groupes, présences, tournois du club, événements)',
      type: 'toggle',
      fallback: () => '0',
    },
  ],
  FINANCIAL: [
    { key: 'basmala', title: 'البسملة', hint: 'Formule d’ouverture (vide = retirée)', type: 'line', fallback: () => 'بسم الله الرحمان الرحيم' },
    { key: 'association', title: 'الجمعية', hint: 'Nom de l’association', type: 'line', fallback: () => 'الجمعية الرياضية : نادي التنس بصيادة' },
    { key: 'greeting', title: 'التحية', hint: 'Salutation', type: 'line', fallback: () => 'حضرات السادة ضيوفنا الكرام' },
    { key: 'salute', title: 'تحية', hint: 'Formule', type: 'line', fallback: () => 'تحية رياضية وبعد.' },
    {
      key: 'intro',
      title: 'تقديم',
      hint: 'Introduction',
      type: 'text',
      fallback: (d) => `باسمي وباسم كل أعضاء الهيئة المديرة لنادي التنس بصيادة اسمحوا لي أن أتلو عليكم التقرير المالي للموسم الرياضي ${seasonAr(d.season.label)}.`,
    },
    { key: 'manualIncome', title: 'مساهمات', hint: 'Recettes hors application (subventions, dons, adhésions)', type: 'income', fallback: () => '{}' },
    { key: 'bankStart', title: 'الرصيد البنكي بداية الموسم', hint: 'Solde bancaire au début de la saison', type: 'number', fallback: () => '' },
    { key: 'bankEnd', title: 'الرصيد البنكي نهاية الموسم', hint: 'Solde bancaire à la fin (vide = calculé)', type: 'number', fallback: () => '' },
    { key: 'debtsPeriod', title: 'فترة الديون', hint: 'Saisons des dettes (ex. 2019 / 2023)', type: 'line', fallback: () => '' },
    { key: 'debts', title: 'كشف عن الديون', hint: 'Dettes des saisons précédentes (créancier, montant)', type: 'debts', fallback: () => '[]' },
    { key: 'notes', title: 'ملاحظات', hint: 'Remarques (facultatif)', type: 'text', fallback: () => '' },
    {
      key: 'conclusion',
      title: 'خاتمة',
      hint: 'Conclusion',
      type: 'text',
      fallback: () =>
        'وفي الختام تود الهيئة المديرة أن تتقدم بفائق الشكر والامتنان إلى كل من دعم النادي معنويا وماديا.\nختاما نسأل الله أن نكون قد وفقنا في مسعانا.\nوفقنا الله وإياكم ودمتم خير سند لنادي التنس بصيادة ولكم منا جزيل الشكر.',
    },
    { key: 'closing', title: 'الختم', hint: 'Formule finale', type: 'line', fallback: () => 'والسلام' },
    { key: 'showStats', title: 'إحصائيات', hint: 'Ajouter le reste à encaisser, les réductions et la comparaison avec la saison précédente', type: 'toggle', fallback: () => '0' },
  ],
};

/** Recettes hors application, dans l'ordre du rapport du club. */
export const MANUAL_INCOME: { key: keyof ManualIncome; label: string; fr: string }[] = [
  { key: 'federation', label: 'مساهمة الجامعة التونسية للتنس', fr: 'Fédération tunisienne de tennis' },
  { key: 'wilaya', label: 'مساهمة الولاية', fr: 'Gouvernorat (wilaya)' },
  { key: 'municipality', label: 'مساهمة البلدية', fr: 'Municipalité' },
  { key: 'supporters', label: 'مساهمة الأحباء', fr: 'Amis du club (dons)' },
  { key: 'membership', label: 'الانخراطات', fr: 'Adhésions' },
];

/** Autres recettes importées de l'historique (cahier, Excel, Word). */
const INCOME_AR: Record<string, string> = {
  DONATION: 'تبرعات وهبات',
  RENTAL: 'كراء الملاعب والمحلات',
  TOURNAMENT: 'مداخيل الدورات',
  GRANT: 'منح ودعم',
  OTHER: 'مداخيل أخرى',
};

/** Dépenses : lignes du rapport du club (toujours affichées), puis les autres catégories si elles ont un montant. */
const EXPENSE_LINES: { label: string; cats: string[] }[] = [
  { label: 'منح المدربين', cats: ['SALARY'] },
  { label: 'الجامعة التونسية للتنس', cats: ['FEDERATION'] },
  { label: 'مصاريف إدارية (تنظيم الدورات الوطنية للتنس)', cats: ['ADMIN'] },
  { label: 'صيانة الملاعب', cats: ['MAINTENANCE'] },
  { label: 'خلاص القباضة', cats: ['TAX'] },
  { label: 'مصاريف الكهرباء والماء', cats: ['UTILITIES'] },
  { label: 'شراء تجهيزات رياضية', cats: ['EQUIPMENT'] },
  { label: 'تأمين', cats: ['INSURANCE'] },
  { label: 'أعباء مالية', cats: ['BANK'] },
];
const EXPENSE_EXTRA: Record<string, string> = { SOCIAL: 'الضمان الاجتماعي', TRAVEL: 'التنقلات', SERVICES: 'خدمات (محاسبة، تنظيف…)', OTHER: 'مصاريف أخرى' };

/** Textes affichés : ceux du bureau, sinon le texte proposé. */
export function textsFor(kind: ReportKind, data: SeasonReports, edited?: Record<string, string>) {
  const saved = edited ?? data.drafts[kind].texts;
  return Object.fromEntries(TEXT_FIELDS[kind].map((f) => [f.key, saved[f.key] ?? f.fallback(data)]));
}

/** Calculs du rapport financier : recettes (application + saisies du bureau), dépenses par ligne, balance, dettes. */
export function financialSheet(data: SeasonReports, texts: Record<string, string>) {
  const f = data.financial;
  const manual = parseObj<ManualIncome>(texts.manualIncome);
  const other = (cat: string) => f.income.other.find((o) => o.category === cat)?.amount ?? 0;
  const income: { label: string; amount: number }[] = [
    { label: 'اشتراكات اللاعبين', amount: f.income.fees },
    ...MANUAL_INCOME.map((m) => ({ label: m.label, amount: (parseAmt(manual[m.key]) ?? 0) + (m.key === 'supporters' ? other('DONATION') : 0) })),
    ...(f.income.courts ? [{ label: 'كراء الملاعب (الحجوزات)', amount: f.income.courts }] : []),
    ...(f.income.tournaments ? [{ label: 'معاليم المشاركة في الدورات', amount: f.income.tournaments }] : []),
    ...f.income.other.filter((o) => o.category !== 'DONATION').map((o) => ({ label: INCOME_AR[o.category] ?? o.category, amount: o.amount })),
  ];
  const byCat = (c: string) => (c === 'SALARY' ? f.expenses.salaries : (f.expenses.categories.find((x) => x.category === c)?.amount ?? 0));
  const known = new Set(EXPENSE_LINES.flatMap((l) => l.cats));
  const expenses = [
    ...EXPENSE_LINES.map((l) => ({ label: l.label, amount: l.cats.reduce((t, c) => t + byCat(c), 0) })),
    ...f.expenses.categories.filter((c) => !known.has(c.category) && c.amount).map((c) => ({ label: EXPENSE_EXTRA[c.category] ?? c.category, amount: c.amount })),
  ];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const incomeTotal = round(income.reduce((t, x) => t + x.amount, 0));
  const expenseTotal = round(expenses.reduce((t, x) => t + x.amount, 0));
  const diff = round(incomeTotal - expenseTotal);
  const bankStart = parseAmt(texts.bankStart);
  const bankEnd = parseAmt(texts.bankEnd) ?? (bankStart !== null ? round(bankStart + diff) : null);
  const debts = parseList<DebtRow>(texts.debts).filter((x) => x.label?.trim() || parseAmt(x.amount));
  const debtsTotal = round(debts.reduce((t, x) => t + (parseAmt(x.amount) ?? 0), 0));
  return { income, expenses, incomeTotal, expenseTotal, diff, bankStart, bankEnd, debts, debtsTotal };
}

const CELL = 'border border-black px-3 py-[3px]';
/** Tableau à deux colonnes (libellé, montant) comme sur les rapports du club. */
function AmountTable({ title, rows, total }: { title?: string; rows: { label: string; amount: ReactNode; strong?: boolean }[]; total?: { label: string; amount: ReactNode } }) {
  return (
    <table className="my-1.5 w-full break-inside-avoid border-collapse text-[13.5px]">
      <tbody>
        {title && (
          <tr>
            <td colSpan={2} className={`${CELL} text-center font-bold`}>
              {title}
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i} className={r.strong ? 'font-bold' : ''}>
            <td className={`${CELL} w-[62%] text-center`}>{r.label}</td>
            <td className={`${CELL} text-center tabular-nums`}>{r.amount}</td>
          </tr>
        ))}
        {total && (
          <tr className="font-bold">
            <td className={`${CELL} text-center`}>{total.label}</td>
            <td className={`${CELL} text-center tabular-nums`}>{total.amount}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function H({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <h3 className={`mt-3 mb-1.5 text-[15px] font-bold underline underline-offset-4 ${center ? 'text-center' : ''}`}>{children}</h3>;
}
function P({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <p className="my-1.5 whitespace-pre-wrap text-justify leading-[1.85]">{text}</p>;
}
/** Une ligne par élément (difficultés, missions…). */
function Lines({ text }: { text?: string }) {
  const lines = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return (
    <ul className="my-2 list-none ps-8 leading-[2]">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** Papier à en-tête : nom du club en français et en arabe, logo au centre ; adresse en pied de page (répétés à chaque page imprimée). */
function Letter({ lh, children }: { lh: Letterhead; children: ReactNode }) {
  const contactAr = [lh.phone && `الهاتف : ${ltr(lh.phone)}`, lh.fax && `الفاكس : ${ltr(lh.fax)}`].filter(Boolean).join(' – ');
  const contactFr = [lh.phone && `Tél : ${lh.phone}`, lh.fax && `Fax : ${lh.fax}`].filter(Boolean).join(' – ');
  const footer = lh.addressAr || lh.addressFr || contactAr;
  const footerContent = (
    <div className="grid grid-cols-2 gap-6 text-[13px] italic">
      <div>
        {lh.addressAr && <div>العنوان : {lh.addressAr}</div>}
        {contactAr && <div>{contactAr}</div>}
      </div>
      <div dir="ltr" className="text-start" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
        {lh.addressFr && <div>Adresse : {lh.addressFr}</div>}
        {contactFr && <div>{contactFr}</div>}
      </div>
    </div>
  );
  return (
    <>
      {footer && <div className="fixed inset-x-0 bottom-0 hidden px-[16mm] pb-[10mm] print:block">{footerContent}</div>}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <td className="px-[16mm] pt-[10mm] pb-2">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="text-[16px] font-bold">{lh.nameAr}</div>
                <img src="/logo-tcsay.png" alt="" className="h-[20mm] w-[20mm] object-contain grayscale" />
                <div dir="ltr" className="text-end text-[17px] tracking-wide" style={{ fontFamily: '"Trajan Pro", "Cinzel", Georgia, "Times New Roman", serif' }}>
                  {lh.nameFr}
                </div>
              </div>
            </td>
          </tr>
        </thead>
        {footer && (
          <tfoot>
            <tr>
              {/* Écran : pied à la fin du rapport. Impression : place réservée, le pied fixe est répété en bas de chaque page. */}
              <td className="px-[16mm] pt-4 pb-[10mm] print:h-[24mm] print:p-0">
                <div className="print:hidden">{footerContent}</div>
              </td>
            </tr>
          </tfoot>
        )}
        <tbody>
          <tr>
            <td className="px-[18mm] align-top">{children}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/** Formule finale et signatures (gardées ensemble) : responsable à droite, cachet du club au centre, président à gauche. */
function Signatures({ closing, right, left }: { closing?: string; right: string; left: string }) {
  return (
    <div className="break-inside-avoid">
      {closing?.trim() && <p className="mt-4 text-center">{closing}</p>}
      <footer className="mt-5 grid grid-cols-3 items-start gap-4 text-center text-[15px]">
        <div className="font-bold">{right}</div>
        <div>
          <div>عن الهيئة المديرة</div>
          <div className="mx-auto mt-2 h-[22mm] w-[22mm] rounded-full border border-dashed border-black/30" aria-hidden="true" />
        </div>
        <div className="font-bold">{left}</div>
      </footer>
    </div>
  );
}

/**
 * Rapport moral ou financier en arabe, au modèle des rapports du club (papier à en-tête, formules, tableaux « بيان الموارد »,
 * « بيان المصاريف », « الموازنة المالية », dettes, signatures et cachet) : chiffres de la base, textes et montants du bureau.
 */
export function ReportDocument({ data, kind, texts }: { data: SeasonReports; kind: ReportKind; texts: Record<string, string> }) {
  const s = seasonAr(data.season.label);
  const m = data.moral;
  const stats = texts.showStats === '1';
  return (
    <article
      dir="rtl"
      lang="ar"
      className="mx-auto w-[210mm] max-w-full bg-white text-[14px] text-black"
      style={{ fontFamily: '"Simplified Arabic", "Traditional Arabic", "Noto Naskh Arabic", "Amiri", "Segoe UI", Tahoma, sans-serif' }}
    >
      <Letter lh={data.letterhead}>
        {texts.basmala?.trim() && <div className="mt-2 text-center text-[16px]">{texts.basmala}</div>}
        {kind === 'MORAL' ? (
          <>
            <h1 className="my-3 text-center text-[19px] font-bold">التقرير الأدبي للموسم الرياضي {s}</h1>
            {texts.greeting?.trim() && <p className="my-2 text-[16px] font-bold">{texts.greeting}</p>}
            <P text={texts.intro} />

            <H>انطلاق النشاط</H>
            <P text={texts.start} />
            {m.members.total > 0 && (
              <p className="my-2 leading-[2]">
                بلغ عدد المنخرطين {ltr(String(m.members.total))} منخرطا{parseAmt(texts.licensed) ? ` منهم ${ltr(String(parseAmt(texts.licensed)))} مجازا` : ''}.
              </p>
            )}
            {texts.committee?.trim() && (
              <>
                <H>اللجنة الفنية</H>
                <Lines text={texts.committee} />
              </>
            )}
            <P text={texts.infrastructure} />

            {stats && <MoralStats data={data} />}

            {parseList<ResultRow>(texts.results).some((r) => r.text?.trim()) && (
              <>
                <H center>نتائج اللاعبين في الدورات الوطنية للتنس</H>
                <div className="leading-[2]">
                  {parseList<ResultRow>(texts.results)
                    .filter((r) => r.text?.trim())
                    .map((r, i) => (
                      <div key={i} className="my-1.5 break-inside-avoid">
                        {r.date && <div className="font-bold">يوم {dayAr(r.date)}</div>}
                        <div>{r.text}</div>
                      </div>
                    ))}
                </div>
              </>
            )}
            <P text={texts.thanks} />

            {texts.difficulties?.trim() && (
              <>
                <H>الصعوبات</H>
                <Lines text={texts.difficulties} />
              </>
            )}
            {texts.goals?.trim() && (
              <>
                <H>الآفاق والأهداف</H>
                <P text={texts.goals} />
              </>
            )}
            <P text={texts.conclusion} />
            <Signatures closing={texts.closing} right="الكاتب العام" left="الرئيس" />
          </>
        ) : (
          <FinancialBody data={data} texts={texts} season={s} stats={stats} />
        )}
      </Letter>
    </article>
  );
}

function FinancialBody({ data, texts, season, stats }: { data: SeasonReports; texts: Record<string, string>; season: string; stats: boolean }) {
  const f = data.financial;
  const sheet = financialSheet(data, texts);
  return (
    <>
      <h1 className="mt-3 mb-1 text-center text-[19px] font-bold">التقرير المالي للموسم الرياضي</h1>
      <div className="mb-3 text-center text-[18px] font-bold">{season}</div>
      {texts.association?.trim() && <p className="my-2 text-[16px] font-bold underline underline-offset-4">{texts.association}</p>}
      {texts.greeting?.trim() && <p className="my-1">{texts.greeting}</p>}
      {texts.salute?.trim() && <p className="my-1">{texts.salute}</p>}
      <P text={texts.intro} />

      <div className="break-inside-avoid">
        <H>المداخيل:</H>
        <AmountTable
          title="بيان الموارد"
          rows={sheet.income.map((r) => ({ label: r.label, amount: amt(r.amount) }))}
          total={{ label: 'جملة المداخيل', amount: amt(sheet.incomeTotal) }}
        />
      </div>

      <div className="break-inside-avoid">
        <H>المصاريف:</H>
        <AmountTable
          title="بيان المصاريف"
          rows={sheet.expenses.map((r) => ({ label: r.label, amount: amt(r.amount) }))}
          total={{ label: 'جملة المصاريف', amount: amt(sheet.expenseTotal) }}
        />
      </div>

      <AmountTable
        title="الموازنة المالية"
        rows={[
          ...(sheet.bankStart !== null ? [{ label: 'الرصيد البنكي بداية الموسم', amount: amt(sheet.bankStart) }] : []),
          { label: 'المداخيل', amount: amt(sheet.incomeTotal) },
          { label: 'المصاريف', amount: amt(sheet.expenseTotal) },
          { label: sheet.diff >= 0 ? 'الفارق / الفائض' : 'الفارق / العجز', amount: amt(Math.abs(sheet.diff)), strong: true },
          ...(sheet.bankEnd !== null ? [{ label: 'الرصيد البنكي نهاية الموسم', amount: amt(sheet.bankEnd), strong: true }] : []),
        ]}
      />

      {stats && (
        <>
          <AmountTable
            rows={[
              { label: 'معاليم الاشتراكات المتبقية للاستخلاص', amount: amt(f.income.remaining) },
              { label: 'التخفيضات الممنوحة (إخوة، حالات خاصة)', amount: amt(f.income.discounts) },
              ...(f.expenses.unpaid > 0 ? [{ label: 'مصاريف وأجور غير مدفوعة بعد', amount: amt(f.expenses.unpaid) }] : []),
            ]}
          />
          {f.previous && (
            <table className="my-2 w-full break-inside-avoid border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={CELL}>المقارنة</th>
                  <th className={CELL}>{seasonAr(f.previous.label)}</th>
                  <th className={CELL}>{season}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['المداخيل', f.previous.income, sheet.incomeTotal],
                    ['المصاريف', f.previous.expenses, sheet.expenseTotal],
                    ['النتيجة', f.previous.result, sheet.diff],
                  ] as const
                ).map(([l, a, b]) => (
                  <tr key={l}>
                    <td className={`${CELL} text-center`}>{l}</td>
                    <td className={`${CELL} text-center tabular-nums`}>{amt(a)}</td>
                    <td className={`${CELL} text-center tabular-nums`}>{amt(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {sheet.debts.length > 0 && (
        <div className="break-inside-avoid">
          <p className="my-3 font-bold">كما نعلمكم بأن الديون المتخلدة بذمة الجمعية للمواسم السابقة تساوي {amt(sheet.debtsTotal)}</p>
          <H center>كشف حول الديون المتخلدة{texts.debtsPeriod?.trim() ? ` بعنوان المواسم الرياضية ${ltr(texts.debtsPeriod.trim())}` : ''}</H>
          <table className="my-2 w-full border-collapse text-[14px]">
            <thead>
              <tr>
                <th className={CELL}>كشف عن الديون</th>
                <th className={CELL}>مبلغ الدين</th>
              </tr>
            </thead>
            <tbody>
              {sheet.debts.map((x, i) => (
                <tr key={i}>
                  <td className={`${CELL} w-[62%] text-center`}>{x.label}</td>
                  <td className={`${CELL} text-center tabular-nums`}>{amt(parseAmt(x.amount) ?? 0)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className={`${CELL} text-center`}>مجموع الديون</td>
                <td className={`${CELL} text-center tabular-nums`}>{amt(sheet.debtsTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <P text={texts.notes} />
      <P text={texts.conclusion} />
      <Signatures closing={texts.closing} right="أمين المال" left="رئيس النادي" />
    </>
  );
}

/** Tableaux de chiffres facultatifs du rapport moral (membres, encadrement, tournois du club, événements). */
function MoralStats({ data }: { data: SeasonReports }) {
  const m = data.moral;
  return (
    <div>
      <H>إحصائيات الموسم</H>
      <AmountTable
        rows={[
          { label: 'عدد المنخرطين', amount: ltr(String(m.members.total)), strong: true },
          { label: 'الذكور / الإناث', amount: ltr(`${m.members.boys} / ${m.members.girls}`) },
          { label: 'منخرطون جدد / أعادوا التسجيل', amount: ltr(`${m.members.newPlayers} / ${m.members.returning}`) },
          ...(m.members.previousTotal !== null ? [{ label: 'عدد المنخرطين في الموسم الفارط', amount: ltr(String(m.members.previousTotal)) }] : []),
          { label: 'عدد المجموعات (منافسة / ترفيه)', amount: ltr(`${m.staff.groups} (${m.staff.competitive} / ${m.staff.leisure})`) },
          { label: 'عدد الحصص المسجلة', amount: ltr(String(m.training.sessions)) },
          ...(m.training.rate !== null ? [{ label: 'نسبة الحضور', amount: ltr(`${m.training.rate} %`) }] : []),
        ]}
      />
      {m.members.categories.length > 0 && (
        <table className="my-2 w-full break-inside-avoid border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={CELL}>الصنف</th>
              <th className={CELL}>ذكور</th>
              <th className={CELL}>إناث</th>
              <th className={CELL}>المجموع</th>
            </tr>
          </thead>
          <tbody>
            {m.members.categories.map((c) => (
              <tr key={c.code}>
                <td className={`${CELL} text-center`}>{iso(c.category)}</td>
                <td className={`${CELL} text-center`}>{c.boys}</td>
                <td className={`${CELL} text-center`}>{c.girls}</td>
                <td className={`${CELL} text-center font-bold`}>{c.boys + c.girls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.competition.tournaments.length > 0 && (
        <table className="my-2 w-full break-inside-avoid border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={CELL}>دورات النادي</th>
              <th className={CELL}>التاريخ</th>
              <th className={CELL}>المشاركون</th>
              <th className={CELL}>الفائز</th>
            </tr>
          </thead>
          <tbody>
            {m.competition.tournaments.map((t) => (
              <tr key={t.name + t.startDate}>
                <td className={`${CELL} text-center`}>{iso(t.name)}</td>
                <td className={`${CELL} text-center`}>{dayAr(t.startDate)}</td>
                <td className={`${CELL} text-center`}>{t.players}</td>
                <td className={`${CELL} text-center`}>{t.winner ? iso(t.winner) : t.finished ? '—' : 'لم تنته بعد'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.events.length > 0 && (
        <ul className="my-2 list-disc ps-8 leading-[2]">
          {m.events.map((e) => (
            <li key={e.title + e.date}>
              {iso(e.title)} — {dayAr(e.date)}
              {e.place ? ` (${iso(e.place)})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
