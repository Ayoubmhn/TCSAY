import type { ImportPreview, ImportRawRow, ImportRow, ImportStatus } from '../../lib/types';
import { Pill, type PillTone } from '../../components/ui/Pill';
import { ActionIcon } from '../../components/ui/ActionIcon';

const STATUS: Record<ImportStatus, { tone: PillTone; label: string }> = {
  ok: { tone: 'g', label: 'Prêt' },
  warning: { tone: 's', label: 'À vérifier' },
  error: { tone: 'r', label: 'Ignoré' },
};

/** Colonnes modifiables, dans l'ordre du fichier du cahier. */
const COLS: { key: keyof ImportRawRow; label: string; w: number; dir?: 'rtl'; placeholder?: string }[] = [
  { key: 'n', label: 'N°', w: 56 },
  { key: 'gender', label: 'Genre', w: 92 },
  { key: 'name', label: 'Nom et prénom', w: 190 },
  { key: 'nameAr', label: 'Nom en arabe', w: 160, dir: 'rtl' },
  { key: 'birth', label: 'Naissance', w: 122, placeholder: 'AAAA-MM-JJ' },
  { key: 'phone', label: 'Téléphone', w: 150 },
  { key: 'email', label: 'Email du joueur', w: 190, placeholder: 'si majeur' },
  { key: 'parent', label: 'Parent', w: 130 },
  { key: 'parentEmail', label: 'Email du parent', w: 200 },
  { key: 'group', label: 'Groupe', w: 140 },
  { key: 'city', label: 'Ville', w: 110 },
  { key: 'remark', label: 'Remarque', w: 200 },
];

export const EMPTY_RAW: ImportRawRow = { n: '', gender: '', name: '', nameAr: '', birth: '', phone: '', email: '', parent: '', parentEmail: '', group: '', city: '', remark: '' };

const cellCls = 'w-full min-w-0 rounded-[10px] bg-transparent px-2 py-1.5 text-[13.5px] text-fg outline-none focus:bg-card focus:outline-2 focus:outline-pri';

/**
 * Aperçu de l'import en tableau modifiable (comme dans Excel) : chaque cellule se corrige à l'écran (nom, email,
 * naissance, parent…), l'analyse est refaite par l'API après chaque modification ; rien n'est enregistré avant
 * « Confirmer l'import ». Ligne d'en-tête et colonne des noms fixes pendant le défilement.
 */
export function ImportTable({
  table,
  preview,
  filter,
  onChange,
}: {
  table: ImportRawRow[];
  preview?: ImportPreview;
  filter: 'all' | ImportStatus;
  onChange: (rows: ImportRawRow[]) => void;
}) {
  // Résultat de l'analyse par ligne du tableau (ligne 2 = première ligne de données).
  const byLine = new Map<number, ImportRow>((preview?.rows ?? []).map((r) => [r.line, r]));
  const set = (i: number, key: keyof ImportRawRow, value: string) => onChange(table.map((r, k) => (k === i ? { ...r, [key]: value } : r)));
  const groups = preview?.groups ?? [];

  return (
    <div className="overflow-auto rounded-[22px] border-[1.5px] border-line bg-card [max-height:70vh] [scrollbar-width:thin]">
      <table className="w-max border-separate border-spacing-0 text-start text-[13.5px]">
        <thead>
          <tr>
            <th className="sticky start-0 top-0 z-[3] min-w-[96px] border-b-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut">État</th>
            {COLS.map((c) => (
              <th
                key={c.key}
                style={{ minWidth: c.w }}
                className={`sticky top-0 z-[2] border-b-[1.5px] border-s-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut ${c.key === 'name' ? 'start-[96px] z-[3]' : ''}`}
              >
                {c.label}
              </th>
            ))}
            <th className="sticky top-0 z-[2] min-w-[160px] border-b-[1.5px] border-s-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut">Catégorie</th>
            <th className="sticky top-0 z-[2] min-w-[260px] border-b-[1.5px] border-s-[1.5px] border-line bg-fld px-2 py-2 text-start text-[12px] font-semibold text-mut">Contrôle</th>
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
            return (
              <tr key={i} className={tint}>
                <td className={`sticky start-0 z-[1] border-b-[1.5px] border-line px-2 py-1 ${tint}`}>
                  {status ? <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill> : <span className="text-[12px] text-mut">Vide</span>}
                </td>
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b-[1.5px] border-s-[1.5px] border-line p-0.5 ${c.key === 'name' ? `sticky start-[96px] z-[1] ${tint}` : ''}`}
                  >
                    {c.key === 'gender' ? (
                      <select aria-label={`Ligne ${i + 2} : genre`} className={cellCls} value={raw.gender} onChange={(e) => set(i, 'gender', e.target.value)}>
                        <option value="">—</option>
                        <option value="h">Garçon</option>
                        <option value="f">Fille</option>
                      </select>
                    ) : (
                      <input
                        aria-label={`Ligne ${i + 2} : ${c.label}`}
                        className={`${cellCls} ${c.key === 'name' ? 'font-semibold' : ''}`}
                        dir={c.dir}
                        value={raw[c.key]}
                        placeholder={c.placeholder}
                        list={c.key === 'group' ? 'import-groups' : undefined}
                        inputMode={c.key === 'phone' || c.key === 'n' ? 'tel' : c.key.toLowerCase().includes('email') ? 'email' : undefined}
                        onChange={(e) => set(i, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="border-b-[1.5px] border-s-[1.5px] border-line px-2 py-1 text-[12.5px]">
                  {r?.category ? r.category.name : '—'}
                  {r?.age !== null && r?.age !== undefined ? ` · ${r.age} ans` : ''}
                  {r?.group ? <span className="block text-mut">Groupe : {r.group.name}</span> : null}
                </td>
                <td className="max-w-[340px] border-b-[1.5px] border-s-[1.5px] border-line px-2 py-1 text-[12px] text-mut">
                  {r?.messages.length ? r.messages.join(' · ') : r ? 'OK' : ''}
                </td>
                <td className="border-b-[1.5px] border-line px-1 py-1">
                  <ActionIcon kind="remove" label="Retirer la ligne" onClick={() => onChange(table.filter((_, k) => k !== i))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id="import-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  );
}
