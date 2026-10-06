const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC', // dates sans heure (colonne DATE) : pas de décalage de jour
});

/** « 2025-09-01T00:00:00.000Z » → « 01/09/2025 » */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

/** « 2025-09-01T00:00:00.000Z » → « 2025-09-01 » (valeur d'un champ date) */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}
