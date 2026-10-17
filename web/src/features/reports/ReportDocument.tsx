import type { ReactNode } from 'react';

/** Données des rapports de fin de saison (GET /seasons/:id/reports). */
export type ReportKind = 'MORAL' | 'FINANCIAL';
export type SeasonReports = {
  season: { id: string; label: string; status: string };
  previous: { id: string; label: string } | null;
  moral: {
    members: { total: number; boys: number; girls: number; newPlayers: number; returning: number; previousTotal: number | null; categories: { category: string; code: string; boys: number; girls: number }[] };
    staff: { groups: number; competitive: number; leisure: number; coaches: string[] };
    training: { sessions: number; marked: number; rate: number | null };
    competition: { matches: number; tournaments: { name: string; startDate: string; endDate: string; finished: boolean; winner: string | null; players: number }[] };
    events: { title: string; date: string; place: string }[];
  };
  financial: {
    income: { fees: number; feesCount: number; courts: number; courtsCount: number; tournaments: number; other: { category: string; count: number; amount: number }[]; imported: boolean; total: number; remaining: number; discounts: number };
    expenses: { salaries: number; categories: { category: string; count: number; amount: number }[]; total: number; unpaid: number };
    result: number;
    previous: { label: string; income: number; expenses: number; result: number } | null;
  };
  drafts: Record<ReportKind, { texts: Record<string, string>; version: number; from: 'season' | 'previous' | 'default'; updatedAt: string | null }>;
  files: { id: string; kind: ReportKind; fileName: string; mimeType: string; size: number; createdAt: string }[];
  /** Rapports déposés de la saison précédente (modèle pour rédiger ceux de cette saison). */
  previousFiles: { id: string; kind: ReportKind; fileName: string; mimeType: string; size: number; createdAt: string }[];
};

/** Sections rédigées par le bureau : clé, titre arabe, aide en français, texte proposé par défaut. */
export const TEXT_FIELDS: Record<ReportKind, { key: string; title: string; hint: string; fallback: (season: string) => string }[]> = {
  MORAL: [
    { key: 'intro', title: 'تقديم', hint: 'Introduction', fallback: (s) => `يتشرف المكتب المديري لنادي التنس بصيادة بأن يقدم إلى الجلسة العامة التقرير الأدبي للموسم الرياضي ${ltr(s)}، والذي يلخص نشاط النادي خلال هذا الموسم.` },
    { key: 'members', title: 'تعليق على المنخرطين', hint: 'Commentaire sur les membres (facultatif)', fallback: () => '' },
    { key: 'training', title: 'تعليق على التمارين والتأطير', hint: 'Commentaire sur l’entraînement (facultatif)', fallback: () => '' },
    { key: 'competition', title: 'تعليق على المسابقات', hint: 'Commentaire sur les compétitions (facultatif)', fallback: () => '' },
    { key: 'difficulties', title: 'الصعوبات', hint: 'Difficultés de la saison', fallback: () => 'واجه النادي خلال هذا الموسم بعض الصعوبات، من أهمها: ' },
    { key: 'goals', title: 'الآفاق والأهداف', hint: 'Projets et objectifs de la saison suivante', fallback: () => 'يطمح النادي خلال الموسم القادم إلى: ' },
    { key: 'conclusion', title: 'خاتمة', hint: 'Conclusion', fallback: () => 'وفي الختام، يتوجه المكتب المديري بالشكر إلى كل المنخرطين والأولياء والمدربين والمتطوعين على مساهمتهم في إنجاح هذا الموسم.' },
  ],
  FINANCIAL: [
    { key: 'intro', title: 'تقديم', hint: 'Introduction', fallback: (s) => `يتشرف أمين مال نادي التنس بصيادة بأن يقدم إلى الجلسة العامة التقرير المالي للموسم الرياضي ${ltr(s)}، والذي يبين مداخيل النادي ومصاريفه خلال هذا الموسم.` },
    { key: 'income', title: 'تعليق على المداخيل', hint: 'Commentaire sur les recettes (facultatif)', fallback: () => '' },
    { key: 'expenses', title: 'تعليق على المصاريف', hint: 'Commentaire sur les dépenses (facultatif)', fallback: () => '' },
    { key: 'notes', title: 'ملاحظات', hint: 'Remarques (dettes, dons, projets à financer…)', fallback: () => '' },
    { key: 'conclusion', title: 'خاتمة', hint: 'Conclusion', fallback: () => 'ويبقى المكتب المديري على ذمة الجلسة العامة لتقديم كل التوضيحات اللازمة حول هذا التقرير.' },
  ],
};

/** Catégories de dépenses en arabe (mêmes catégories que le module Dépenses). */
const EXPENSE_AR: Record<string, string> = {
  UTILITIES: 'فواتير الكهرباء والماء والاتصالات',
  EQUIPMENT: 'المعدات والكرات',
  MAINTENANCE: 'صيانة الملاعب والمحلات',
  TAX: 'الأداءات والتصاريح الجبائية',
  SOCIAL: 'التصاريح الاجتماعية (الضمان الاجتماعي)',
  INSURANCE: 'التأمين',
  FEDERATION: 'الجامعة التونسية للتنس (إجازات ومعاليم)',
  TRAVEL: 'التنقلات',
  SERVICES: 'خدمات (محاسبة، تنظيف…)',
  OTHER: 'مصاريف أخرى',
};

/** Autres recettes importées de l'historique (cahier, Excel, Word). */
const INCOME_AR: Record<string, string> = {
  DONATION: 'التبرعات والهبات',
  RENTAL: 'كراء الملاعب والمحلات',
  TOURNAMENT: 'مداخيل الدورات',
  GRANT: 'المنح والدعم',
  OTHER: 'مداخيل أخرى',
};

/** Texte isolé de gauche à droite (années « 2026-2027 », montants négatifs) dans une phrase arabe. */
const ltr = (s: string) => `\u2066${s}\u2069`;
/** Texte isolé dans son propre sens (titres en français au milieu de l'arabe). */
const iso = (s: string) => `\u2068${s}\u2069`;

/** Montant en dinars, chiffres latins (usage tunisien) : « 1 650,500 د.ت », signe moins gardé devant le nombre. */
export const DTar = (n: number) => `${ltr((n < 0 ? '−' : '') + Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 3 : 0, maximumFractionDigits: 3 }))} د.ت`;
const dayAr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-TN-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

/** Textes affichés : ceux du bureau, sinon le texte proposé. */
export function textsFor(kind: ReportKind, data: SeasonReports, edited?: Record<string, string>) {
  const saved = edited ?? data.drafts[kind].texts;
  return Object.fromEntries(TEXT_FIELDS[kind].map((f) => [f.key, saved[f.key] ?? f.fallback(data.season.label)]));
}

function H({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h3 className="mt-5 mb-2 border-b border-black/40 pb-1 text-[15px] font-bold">
      {n}. {children}
    </h3>
  );
}
function P({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <p className="my-1.5 whitespace-pre-wrap text-justify leading-[1.9]">{text}</p>;
}
function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-bold' : ''}>
      <td className="border border-black/50 px-2 py-1">{label}</td>
      <td className="border border-black/50 px-2 py-1 text-left tabular-nums" dir="ltr">
        {value}
      </td>
    </tr>
  );
}
const TABLE = 'my-2 w-full border-collapse text-[13px]';

/**
 * Rapport moral ou financier en arabe, format A4 (aperçu à l'écran et impression) : chiffres de la base,
 * textes du bureau, signatures. Police système arabe, de droite à gauche.
 */
export function ReportDocument({ data, kind, texts }: { data: SeasonReports; kind: ReportKind; texts: Record<string, string> }) {
  const s = data.season.label;
  const m = data.moral;
  const f = data.financial;
  return (
    <article dir="rtl" lang="ar" className="mx-auto w-[210mm] max-w-full bg-white px-[18mm] py-[16mm] text-[14px] text-black" style={{ fontFamily: '"Noto Naskh Arabic", "Amiri", "Traditional Arabic", "Segoe UI", Tahoma, sans-serif' }}>
      <header className="flex items-center gap-4 border-b-2 border-black pb-3">
        <img src="/logo-tcsay.png" alt="" className="h-[22mm] w-[22mm] object-contain" />
        <div className="flex-1 text-center">
          <div className="text-[15px] font-bold">نادي التنس بصيادة</div>
          <div className="text-[12px]">Tennis Club de Sayada</div>
          <h1 className="m-0 mt-2 text-[20px] font-bold">{kind === 'MORAL' ? 'التقرير الأدبي' : 'التقرير المالي'}</h1>
          <div className="text-[14px]">للموسم الرياضي {ltr(s)}</div>
        </div>
        <div className="w-[22mm]" />
      </header>

      <P text={texts.intro} />

      {kind === 'MORAL' ? (
        <>
          <H n={1}>المنخرطون</H>
          <table className={TABLE}>
            <tbody>
              <Row label="عدد المنخرطين" value={m.members.total} strong />
              <Row label="الذكور" value={m.members.boys} />
              <Row label="الإناث" value={m.members.girls} />
              <Row label="منخرطون جدد" value={m.members.newPlayers} />
              <Row label="أعادوا التسجيل" value={m.members.returning} />
              {m.members.previousTotal !== null && <Row label={`عدد المنخرطين في الموسم الفارط (${ltr(data.previous?.label ?? '')})`} value={m.members.previousTotal} />}
            </tbody>
          </table>
          {m.members.categories.length > 0 && (
            <table className={TABLE}>
              <thead>
                <tr className="bg-black/5">
                  <th className="border border-black/50 px-2 py-1 text-right">الصنف</th>
                  <th className="border border-black/50 px-2 py-1">ذكور</th>
                  <th className="border border-black/50 px-2 py-1">إناث</th>
                  <th className="border border-black/50 px-2 py-1">المجموع</th>
                </tr>
              </thead>
              <tbody>
                {m.members.categories.map((c) => (
                  <tr key={c.code}>
                    <td className="border border-black/50 px-2 py-1" dir="ltr" style={{ textAlign: 'right' }}>
                      {c.category}
                    </td>
                    <td className="border border-black/50 px-2 py-1 text-center">{c.boys}</td>
                    <td className="border border-black/50 px-2 py-1 text-center">{c.girls}</td>
                    <td className="border border-black/50 px-2 py-1 text-center font-bold">{c.boys + c.girls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <P text={texts.members} />

          <H n={2}>التأطير الفني والتمارين</H>
          <table className={TABLE}>
            <tbody>
              <Row label="عدد المجموعات" value={m.staff.groups} />
              <Row label="مجموعات المنافسة" value={m.staff.competitive} />
              <Row label="مجموعات الترفيه" value={m.staff.leisure} />
              <Row label="عدد المدربين" value={m.staff.coaches.length} />
              <Row label="عدد الحصص المسجلة" value={m.training.sessions} />
              {m.training.rate !== null && <Row label="نسبة الحضور" value={`${m.training.rate} %`} />}
            </tbody>
          </table>
          {m.staff.coaches.length > 0 && <p className="my-1.5">المدربون: {m.staff.coaches.map(iso).join('، ')}.</p>}
          <P text={texts.training} />

          <H n={3}>المسابقات والدورات</H>
          {m.competition.tournaments.length ? (
            <table className={TABLE}>
              <thead>
                <tr className="bg-black/5">
                  <th className="border border-black/50 px-2 py-1 text-right">الدورة</th>
                  <th className="border border-black/50 px-2 py-1">التاريخ</th>
                  <th className="border border-black/50 px-2 py-1">المشاركون</th>
                  <th className="border border-black/50 px-2 py-1">الفائز</th>
                </tr>
              </thead>
              <tbody>
                {m.competition.tournaments.map((t) => (
                  <tr key={t.name + t.startDate}>
                    <td className="border border-black/50 px-2 py-1">{t.name}</td>
                    <td className="border border-black/50 px-2 py-1 text-center">{dayAr(t.startDate)}</td>
                    <td className="border border-black/50 px-2 py-1 text-center">{t.players}</td>
                    <td className="border border-black/50 px-2 py-1 text-center">{t.winner ?? (t.finished ? '—' : 'لم تنته بعد')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="my-1.5">لم تنظم دورات خلال هذا الموسم.</p>
          )}
          <p className="my-1.5">عدد المباريات المسجلة: {m.competition.matches}.</p>
          <P text={texts.competition} />

          <H n={4}>التظاهرات</H>
          {m.events.length ? (
            <ul className="my-1.5 list-disc pe-0 ps-6">
              {m.events.map((e) => (
                <li key={e.title + e.date}>
                  {iso(e.title)} — {dayAr(e.date)}
                  {e.place ? ` (${iso(e.place)})` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="my-1.5">لا توجد تظاهرات مسجلة.</p>
          )}

          <H n={5}>الصعوبات</H>
          <P text={texts.difficulties} />
          <H n={6}>الآفاق والأهداف</H>
          <P text={texts.goals} />
        </>
      ) : (
        <>
          <H n={1}>المداخيل</H>
          <table className={TABLE}>
            <tbody>
              <Row label={`معاليم الانخراط والتمارين (${f.income.feesCount} دفعة)`} value={DTar(f.income.fees)} />
              <Row label={`كراء الملاعب (${f.income.courtsCount} حجز)`} value={DTar(f.income.courts)} />
              <Row label="معاليم المشاركة في الدورات" value={DTar(f.income.tournaments)} />
              {f.income.other.map((o) => (
                <Row key={o.category} label={INCOME_AR[o.category] ?? o.category} value={DTar(o.amount)} />
              ))}
              <Row label="مجموع المداخيل" value={DTar(f.income.total)} strong />
            </tbody>
          </table>
          <table className={TABLE}>
            <tbody>
              <Row label="معاليم الانخراط المتبقية للاستخلاص" value={DTar(f.income.remaining)} />
              <Row label="التخفيضات الممنوحة (إخوة، حالات خاصة)" value={DTar(f.income.discounts)} />
            </tbody>
          </table>
          <P text={texts.income} />

          <H n={2}>المصاريف</H>
          <table className={TABLE}>
            <tbody>
              <Row label="أجور المدربين" value={DTar(f.expenses.salaries)} />
              {f.expenses.categories.map((c) => (
                <Row key={c.category} label={EXPENSE_AR[c.category] ?? c.category} value={DTar(c.amount)} />
              ))}
              <Row label="مجموع المصاريف" value={DTar(f.expenses.total)} strong />
            </tbody>
          </table>
          {f.expenses.unpaid > 0 && <p className="my-1.5">مصاريف وأجور غير مدفوعة بعد: {DTar(f.expenses.unpaid)}.</p>}
          <P text={texts.expenses} />

          <H n={3}>النتيجة</H>
          <table className={TABLE}>
            <tbody>
              <Row label="مجموع المداخيل" value={DTar(f.income.total)} />
              <Row label="مجموع المصاريف" value={DTar(f.expenses.total)} />
              <Row label={f.result >= 0 ? 'الفائض' : 'العجز'} value={DTar(Math.abs(f.result))} strong />
            </tbody>
          </table>
          {f.previous && (
            <table className={TABLE}>
              <thead>
                <tr className="bg-black/5">
                  <th className="border border-black/50 px-2 py-1 text-right">المقارنة</th>
                  <th className="border border-black/50 px-2 py-1">{ltr(f.previous.label)}</th>
                  <th className="border border-black/50 px-2 py-1">{ltr(s)}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['المداخيل', f.previous.income, f.income.total],
                    ['المصاريف', f.previous.expenses, f.expenses.total],
                    ['النتيجة', f.previous.result, f.result],
                  ] as const
                ).map(([l, a, b]) => (
                  <tr key={l}>
                    <td className="border border-black/50 px-2 py-1">{l}</td>
                    <td className="border border-black/50 px-2 py-1 text-center tabular-nums" dir="ltr">
                      {DTar(a)}
                    </td>
                    <td className="border border-black/50 px-2 py-1 text-center tabular-nums" dir="ltr">
                      {DTar(b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <H n={4}>ملاحظات</H>
          <P text={texts.notes} />
        </>
      )}

      <P text={texts.conclusion} />

      <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-[14px]">
        <div>
          <div className="font-bold">{kind === 'MORAL' ? 'الكاتب العام' : 'أمين المال'}</div>
          <div className="mt-14 border-t border-dotted border-black/60" />
        </div>
        <div>
          <div className="font-bold">رئيس النادي</div>
          <div className="mt-14 border-t border-dotted border-black/60" />
        </div>
      </footer>
    </article>
  );
}
