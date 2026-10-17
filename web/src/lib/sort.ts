/** Tri à la française (accents, majuscules) des listes d'acteurs. */
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export type SortOption<T> = { value: string; label: string; compare: (a: T, b: T) => number };

export const byText = <T,>(get: (x: T) => string | null | undefined) => (a: T, b: T) => collator.compare(get(a) ?? '', get(b) ?? '');

/** Valeurs absentes toujours en fin de liste, quel que soit le sens. */
export const byNumber =
  <T,>(get: (x: T) => number | null | undefined, desc = false) =>
  (a: T, b: T) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return desc ? y - x : x - y;
  };

type Named = { firstName: string; lastName: string };

/** Options communes : nom (A → Z, Z → A) et prénom. */
export function nameSorts<T extends Named>(): SortOption<T>[] {
  const last = (a: T, b: T) => byText<T>((x) => x.lastName)(a, b) || byText<T>((x) => x.firstName)(a, b);
  return [
    { value: 'name', label: 'Nom (A → Z)', compare: last },
    { value: 'name-desc', label: 'Nom (Z → A)', compare: (a, b) => last(b, a) },
    { value: 'first', label: 'Prénom (A → Z)', compare: (a, b) => byText<T>((x) => x.firstName)(a, b) || byText<T>((x) => x.lastName)(a, b) },
  ];
}

export function sortRows<T>(rows: T[], options: SortOption<T>[], value: string): T[] {
  const option = options.find((o) => o.value === value) ?? options[0];
  return [...rows].sort(option.compare);
}
