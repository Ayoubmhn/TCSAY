import type { Category } from './types';

/** Paire de catégories (garçons et filles d'un même âge, ex. Lutins / Lutines), affichée comme une seule catégorie. */
export type CategoryPair = {
  code: string;
  name: string;
  family: Category['family'];
  categories: Category[];
  boys: number;
  girls: number;
  playersCount: number;
  note: string | null;
};

/** « Lutins (-8) » + « Lutines (-8) » → « Lutins / Lutines (-8) » ; « Entreprise Messieurs » + « Entreprise Dames » → « Entreprise (Messieurs / Dames) ». */
export function pairName(list: Category[]): string {
  if (list.length < 2) return list[0]?.name ?? '';
  const [a, b] = [list.find((c) => c.gender === 'M') ?? list[0], list.find((c) => c.gender === 'F') ?? list[1]];
  const suffix = (s: string) => / \([^)]*\)$/.exec(s)?.[0] ?? '';
  const sa = suffix(a.name);
  if (sa && sa === suffix(b.name)) return `${a.name.slice(0, -sa.length)} / ${b.name.slice(0, -sa.length)}${sa}`;
  const wa = a.name.split(' ');
  const wb = b.name.split(' ');
  let i = 0;
  while (i < wa.length - 1 && i < wb.length - 1 && wa[i] === wb[i]) i++;
  const strip = (s: string) => s.replace(/^\((.*)\)$/, '$1');
  if (i > 0) return `${wa.slice(0, i).join(' ')} (${strip(wa.slice(i).join(' '))} / ${strip(wb.slice(i).join(' '))})`;
  return `${a.name} / ${b.name}`;
}

/** Catégories regroupées par paire, dans l'ordre des catégories. */
export function categoryPairs(categories: Category[]): CategoryPair[] {
  const map = new Map<string, Category[]>();
  for (const c of categories) map.set(c.pairCode, [...(map.get(c.pairCode) ?? []), c]);
  return [...map.entries()].map(([code, list]) => ({
    code,
    name: pairName(list),
    family: list[0].family,
    categories: list,
    boys: list.filter((c) => c.gender !== 'F').reduce((n, c) => n + c.playersCount, 0),
    girls: list.filter((c) => c.gender === 'F').reduce((n, c) => n + c.playersCount, 0),
    playersCount: list.reduce((n, c) => n + c.playersCount, 0),
    note: list.map((c) => c.note).filter(Boolean).join(' · ') || null,
  }));
}

/** Catégorie de la paire selon le genre du joueur (catégorie mixte ou seule de la paire sinon). */
export function categoryFor(categories: Category[], pairCode: string, gender: '' | 'M' | 'F'): Category | undefined {
  const list = categories.filter((c) => c.pairCode === pairCode);
  return list.find((c) => c.gender === gender) ?? list.find((c) => c.gender === 'MIXED') ?? (list.length === 1 ? list[0] : undefined);
}
