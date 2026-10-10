import { inflateRawSync } from 'node:zlib';

/**
 * Lecteur Excel (.xlsx) fait main, sans bibliothèque : un .xlsx est une archive ZIP de fichiers XML.
 * On lit la feuille demandée (ou la première) et on renvoie ses lignes sous forme de tableaux de valeurs
 * (texte ou nombre ; les dates Excel restent des nombres de jours, convertis par l'appelant).
 */
export type Cell = string | number | null;

function unzip(buffer: Buffer): Map<string, Buffer> {
  // Fin du répertoire central : signature 0x06054b50, dans les 64 Ko de fin.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('fichier non reconnu : ce n’est pas un fichier Excel (.xlsx).');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('archive Excel endommagée.');
    const method = buffer.readUInt16LE(p + 10);
    const size = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Texte d'un élément <si> ou <is> : concatène tous les <t> (texte enrichi compris). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

/** « C12 » → index de colonne 2 (base 0). */
function columnIndex(ref: string) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(buffer: Buffer, sheetName?: string): { sheet: string; rows: Cell[][] } {
  const files = unzip(buffer);
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  // Feuilles du classeur et fichiers correspondants.
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? '';
      const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? '';
      return [id, target.startsWith('/') ? target.slice(1) : `xl/${target}`];
    }),
  );
  const sheets = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(/name="([^"]+)"/.exec(m[0])?.[1] ?? ''),
    file: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? '',
  }));
  if (!sheets.length) throw new Error('aucune feuille dans ce fichier.');
  const sheet = sheets.find((s) => sheetName && s.name.toLowerCase() === sheetName.toLowerCase()) ?? sheets[0];
  const xml = text(sheet.file);

  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? rows.length + 1) - 1;
    const row: Cell[] = [];
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : row.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = v !== undefined ? decode(v) : null;
      else if (type === 'b') value = v === '1' ? 'VRAI' : 'FAUX';
      else if (v !== undefined) value = Number(v);
      if (typeof value === 'string') value = value.trim() || null;
      row[col] = value;
    }
    rows[r] = Array.from(row, (x) => x ?? null);
  }
  return { sheet: sheet.name, rows: Array.from(rows, (x) => x ?? []) };
}

/** Date Excel (nombre de jours depuis le 30/12/1899) → « AAAA-MM-JJ ». */
export function excelDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
