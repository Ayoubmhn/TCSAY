import type { ReactNode } from 'react';
import type { ImportPreview, ImportRawRow, ImportRow, ImportStatus, PaymentRawRow, PaymentUpdatePreview } from '../../lib/types';
import { DT } from '../../lib/format';
import { Pill, type PillTone } from '../../components/ui/Pill';
import { ActionIcon } from '../../components/ui/ActionIcon';

const STATUS: Record<ImportStatus, { tone: PillTone; label: string }> = {
  ok: { tone: 'g', label: 'Prêt' },
  warning: { tone: 's', label: 'À vérifier' },
  error: { tone: 'r', label: 'Ignoré' },
};

type Col<K extends string> = { key: K; label: string; w: number; dir?: 'rtl'; placeholder?: string; choices?: [string, string][]; list?: string; mode?: 'tel' | 'email' | 'decimal' };

/** Colonnes modifiables, dans l'ordre du fichier du cahier. */
const PLAYER_COLS: Col<keyof ImportRawRow>[] = [
  { key: 'n', label: 'N°', w: 56, mode: 'tel' },
  { key: 'gender', label: 'Genre', w: 92, choices: [['', '—'], ['h', 'Garçon'], ['f', 'Fille']] },
  { key: 'name', label: 'Nom et prénom', w: 190 },
  { key: 'nameAr', label: 'Nom en arabe', w: 160, dir: 'rtl' },
  { key: 'birth', label: 'Naissance', w: 122, placeholder: 'AAAA-MM-JJ' },
  { key: 'phone', label: 'Téléphone', w: 150, mode: 'tel' },
  { key: 'email', label: 'Email du joueur', w: 190, placeholder: 'si majeur', mode: 'email' },
  { key: 'parent', label: 'Parent', w: 130 },
  { key: 'parentEmail', label: 'Email du parent', w: 200, mode: 'email' },
  { key: 'group', label: 'Groupe', w: 140, list: 'import-groups' },
  { key: 'city', label: 'Ville', w: 110 },
  { key: 'remark', label: 'Remarque', w: 200 },
];

const PAYMENT_COLS: Col<keyof PaymentRawRow>[] = [
  { key: 'name', label: 'Joueur', w: 180 },
  { key: 'nameAr', label: 'Nom en arabe', w: 150, dir: 'rtl' },
  { key: 'amount', label: 'Montant dû', w: 100, mode: 'decimal' },
  { key: 'paid', label: 'Payé', w: 90, mode: 'decimal' },
  { key: 'method', label: 'Mode', w: 110, choices: [['', 'Espèces'], ['Espèces', 'Espèces'], ['Chèque', 'Chèque']] },
  { key: 'receipt', label: 'N° reçu', w: 100, mode: 'tel' },
  { key: 'date', label: 'Date', w: 120, placeholder: 'AAAA-MM-JJ' },
];

export const EMPTY_RAW: ImportRawRow = { n: '', gender: '', name: '', nameAr: '', birth: '', phone: '', email: '', parent: '', parentEmail: '', group: '', city: '', remark: '' };
export const EMPTY_PAYMENT: PaymentRawRow = { name: '', nameAr: '', amount: '', paid: '', method: '', receipt: '', date: '' };

/** Cases douteuses signalées par l'IA : index de ligne du tableau → colonne → raison. */
export type Doubts = Map<number, Record<string, string>>;

const cellCls = 'w-full min-w-0 rounded-[10px] bg-transparent px-2 py-1.5 text-[13.5px] text-fg outline-none focus:bg-card focus:outline-2 focus:outline-pri';

type Result = { line: number; status: ImportStatus; messages: string[] };

/**
 * Tableau modifiable (comme dans Excel) : chaque cellule se corrige à l'écran, l'analyse est refaite par l'API après
 * chaque modification ; rien n'est enregistré avant la confirmation. Ligne d'en-tête et colonne des noms fixes pendant
 * le défilement. Cases lues par l'IA avec un doute : bordure pointillée et raison sous la case.
 */
function EditableTable<R extends Record<string, string>, X extends Result>({
  cols,
  stickyKey,
  table,
  results,
  filter,
  onChange,
  extra,
  doubts,
  onDoubts,
  highlight,
  onFocusRow,
  footer,
}: {
  cols: Col<keyof R & string>[];
  stickyKey: keyof R & string;
  table: R[];
  results: X[];
  filter: 'all' | ImportStatus;
  onChange: (rows: R[]) => void;
  extra: { label: string; w: number; render: (r: X | undefined) => ReactNode };
  doubts?: Doubts;
  onDoubts?: (d: Doubts) => void;
  highlight?: number | null;
  onFocusRow?: (i: number) => void;
  footer?: ReactNode;
}) {
  // Résultat de l'analyse par ligne du tableau (ligne 2 = première ligne de données).
  const byLine = new Map<number, X>(results.map((r) => [r.line, r]));
  const set = (i: number, key: keyof R & string, value: string) => {
    onChange(table.map((r, k) => (k === i ? { ...r, [key]: value } : r)));
    // Case corrigée : le doute de l'IA disparaît.
    const d = doubts?.get(i);
    if (d && d[key] !== undefined && onDoubts) {
      const next = new Map(doubts);
      const rest = { ...d };
      delete rest[key];
      if (Object.keys(rest).length) next.set(i, rest);
      else next.delete(i);
      onDoubts(next);
    }
  };
  const remove = (i: number) => {
    onChange(table.filter((_, k) => k !== i));
    if (doubts && onDoubts) onDoubts(new Map([...doubts].filter(([k]) => k !== i).map(([k, v]) => [k > i ? k - 1 : k, v])));
  };
  const th = 'sticky top-0 z-[2] border-b-[1.5px] border-s-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut';

  return (
    <div className="overflow-auto rounded-[22px] border-[1.5px] border-line bg-card [max-height:70vh] [scrollbar-width:thin]">
      <table className="w-max border-separate border-spacing-0 text-start text-[13.5px]">
        <thead>
          <tr>
            <th className="sticky start-0 top-0 z-[3] min-w-[96px] border-b-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut">État</th>
            {cols.map((c) => (
              <th key={c.key} style={{ minWidth: c.w }} className={`${th} ${c.key === stickyKey ? 'start-[96px] z-[3]' : ''}`}>
                {c.label}
              </th>
            ))}
            <th style={{ minWidth: extra.w }} className={th}>
              {extra.label}
            </th>
            <th className={`${th} min-w-[260px]`}>Contrôle</th>
            <th className="sticky top-0 z-[2] border-b-[1.5px] border-line bg-fld px-2 py-2" aria-label="Retirer" />
          </tr>
        </thead>
        <tbody>
          {table.map((raw, i) => {
            const r = byLine.get(i + 2);
            const status: ImportStatus | undefined = r?.status;
            if (filter !== 'all' && status !== filter) return null;
            // Couleurs opaques : les colonnes fixes (état, nom) cachent ce qui défile dessous.
            const tint = status === 'error' ? 'bg-topay' : status === 'warning' ? 'bg-[color-mix(in_srgb,var(--ps)_28%,var(--card))]' : 'bg-card';
            const rowDoubts = doubts?.get(i);
            return (
              <tr key={i} className={`${tint} ${highlight === i ? 'outline-2 -outline-offset-2 outline-pri' : ''}`} onFocusCapture={() => onFocusRow?.(i)}>
                <td className={`sticky start-0 z-[1] border-b-[1.5px] border-line px-2 py-1 ${tint}`}>
                  {status ? <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill> : <span className="text-[12px] text-mut">Vide</span>}
                </td>
                {cols.map((c) => {
                  const doubt = rowDoubts?.[c.key];
                  return (
                    <td
                      key={c.key}
                      className={`border-b-[1.5px] border-s-[1.5px] border-line p-0.5 align-top ${c.key === stickyKey ? `sticky start-[96px] z-[1] ${tint}` : ''}`}
                    >
                      <div className={doubt !== undefined ? 'rounded-[10px] bg-[color-mix(in_srgb,var(--ps)_40%,var(--card))] outline-[1.5px] -outline-offset-2 outline-dashed outline-[#c58a1c]' : ''}>
                        {c.choices ? (
                          <select aria-label={`Ligne ${i + 2} : ${c.label}`} className={cellCls} value={raw[c.key]} onChange={(e) => set(i, c.key, e.target.value)}>
                            {c.choices.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={`Ligne ${i + 2} : ${c.label}`}
                            className={`${cellCls} ${c.key === stickyKey ? 'font-semibold' : ''}`}
                            dir={c.dir}
                            value={raw[c.key]}
                            placeholder={c.placeholder}
                            list={c.list}
                            inputMode={c.mode}
                            onChange={(e) => set(i, c.key, e.target.value)}
                          />
                        )}
                        {doubt !== undefined && <small className="block px-2 pb-1 text-[11px] leading-tight text-[#8a5a00]">IA : {doubt}</small>}
                      </div>
                    </td>
                  );
                })}
                <td className="border-b-[1.5px] border-s-[1.5px] border-line px-2 py-1 text-[12.5px]">{extra.render(r)}</td>
                <td className="max-w-[340px] border-b-[1.5px] border-s-[1.5px] border-line px-2 py-1 text-[12px] text-mut">
                  {r?.messages.length ? r.messages.join(' · ') : r ? 'OK' : ''}
                </td>
                <td className="border-b-[1.5px] border-line px-1 py-1">
                  <ActionIcon kind="remove" label="Retirer la ligne" onClick={() => remove(i)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

type Common = { filter: 'all' | ImportStatus; doubts?: Doubts; onDoubts?: (d: Doubts) => void; highlight?: number | null; onFocusRow?: (i: number) => void };

/** Aperçu de l'import des joueurs (fichier Excel ou photos lues par l'IA). */
export function ImportTable({ table, preview, onChange, ...rest }: Common & { table: ImportRawRow[]; preview?: ImportPreview; onChange: (rows: ImportRawRow[]) => void }) {
  const groups = preview?.groups ?? [];
  return (
    <EditableTable<ImportRawRow, ImportRow>
      cols={PLAYER_COLS}
      stickyKey="name"
      table={table}
      results={preview?.rows ?? []}
      onChange={onChange}
      extra={{
        label: 'Catégorie',
        w: 160,
        render: (r) => (
          <>
            {r?.category ? r.category.name : '—'}
            {r?.age !== null && r?.age !== undefined ? ` · ${r.age} ans` : ''}
            {r?.group ? <span className="block text-mut">Groupe : {r.group.name}</span> : null}
          </>
        ),
      }}
      footer={
        <datalist id="import-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      }
      {...rest}
    />
  );
}

type PaymentResult = PaymentUpdatePreview['rows'][number];

/** Aperçu des paiements du cahier lus sur une photo (joueur reconnu, réduction, reçu). */
export function PaymentTable({ table, preview, onChange, ...rest }: Common & { table: PaymentRawRow[]; preview?: PaymentUpdatePreview; onChange: (rows: PaymentRawRow[]) => void }) {
  return (
    <EditableTable<PaymentRawRow, PaymentResult>
      cols={PAYMENT_COLS}
      stickyKey="name"
      table={table}
      results={preview?.rows ?? []}
      onChange={onChange}
      extra={{
        label: 'Joueur reconnu',
        w: 200,
        render: (r) =>
          r?.player ? (
            <>
              <b className="font-medium">{r.player.name}</b>
              {r.player.memberCode ? <span className="text-mut"> · {r.player.memberCode}</span> : null}
              {r.paid ? <span className="block text-mut">Payé {DT(r.paid)}{r.due !== null ? ` sur ${DT(r.due)}` : ''}</span> : null}
            </>
          ) : (
            '—'
          ),
      }}
      {...rest}
    />
  );
}
