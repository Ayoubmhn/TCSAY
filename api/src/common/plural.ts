/**
 * Accorde un texte avec un nombre : « (s) » et « (x) » deviennent « s » / « x » au pluriel, rien au singulier
 * (0 et 1 au singulier, comme en français). pl(3, ' tranche(s) en retard') → « tranches en retard ».
 */
export function pl(n: number, text: string): string {
  const many = Math.abs(n) >= 2;
  return text.replace(/\((s|x)\)/g, (_, m: string) => (many ? m : ''));
}
