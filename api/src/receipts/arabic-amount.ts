/**
 * Montant en lettres, en arabe, pour les reçus (ex. 300 → « ثلاثمائة دينار »).
 * Dinars jusqu'à 999 999, puis millimes. Valeur proposée : l'admin peut la corriger avant l'impression.
 */
const UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** 0 à 999. */
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(UNITS[r]);
    else {
      const u = r % 10;
      const t = Math.floor(r / 10);
      parts.push(u ? `${UNITS[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

/** 0 à 999 999. */
function words(n: number): string {
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (th === 1) parts.push('ألف');
  else if (th === 2) parts.push('ألفان');
  else if (th >= 3 && th <= 10) parts.push(`${below1000(th)} آلاف`);
  else if (th > 10) parts.push(`${below1000(th)} ألف`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' و');
}

/** Nom de l'unité accordé au nombre (1 : dinar, 2 : duel, 3–10 : pluriel, 11–99 : accusatif, sinon singulier). */
function unit(n: number, one: string, two: string, few: string, many: string): string {
  const r = n % 100;
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  const text = words(n);
  if (r >= 3 && r <= 10) return `${text} ${few}`;
  if (r >= 11) return `${text} ${many}`;
  return `${text} ${one}`;
}

export function amountInArabicWords(amount: number): string {
  const total = Math.round(amount * 1000);
  const dinars = Math.floor(total / 1000);
  const millimes = total % 1000;
  if (dinars > 999_999) return '';
  const parts: string[] = [];
  if (dinars) parts.push(unit(dinars, 'دينار', 'ديناران', 'دنانير', 'دينارا'));
  if (millimes) parts.push(unit(millimes, 'مليم', 'مليمان', 'مليمات', 'مليما'));
  return parts.length ? parts.join(' و') : 'صفر دينار';
}
