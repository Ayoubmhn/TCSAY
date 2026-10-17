import { Cell, decode, unzip } from '../players/import/xlsx-reader';

/**
 * Lecteur Word (.docx) fait main, sans bibliothèque : un .docx est une archive ZIP ; le texte est dans
 * `word/document.xml`. On en tire les tableaux (lignes `w:tr`, cases `w:tc`) et les paragraphes.
 */
function documentXml(buffer: Buffer): string {
  let files: Map<string, Buffer>;
  try {
    files = unzip(buffer);
  } catch {
    throw new Error('fichier non reconnu : ce n’est pas un fichier Word (.docx).');
  }
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('fichier non reconnu : ce n’est pas un fichier Word (.docx).');
  return xml.toString('utf8');
}

/** Texte d'un paragraphe : tous les <w:t>, tabulations et retours à la ligne en espaces. */
const paragraphText = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g)]
    .map((m) => (m[2] ? ' ' : decode(m[1])))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const paragraphs = (xml: string) => [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((m) => paragraphText(m[1]));

/** Tableaux du document (sans les tableaux imbriqués) : chaque tableau = lignes de cases (texte). */
export function readDocxTables(buffer: Buffer): Cell[][][] {
  const xml = documentXml(buffer);
  const tables: Cell[][][] = [];
  // Découpe au premier niveau : on compte les <w:tbl> ouverts pour ignorer les tableaux imbriqués.
  const re = /<w:tbl>|<w:tbl\s[^>]*>|<\/w:tbl>/g;
  let depth = 0;
  let start = -1;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === '</w:tbl>') {
      depth--;
      if (depth === 0 && start >= 0) {
        const body = xml.slice(start, m.index);
        const rows = [...body.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((tr) =>
          [...tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((tc) => paragraphs(tc[1]).filter(Boolean).join(' ') || null),
        );
        tables.push(rows);
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return tables;
}

/** Texte du document, paragraphe par paragraphe (tableaux compris, une ligne par paragraphe non vide). */
export function readDocxText(buffer: Buffer): string[] {
  return paragraphs(documentXml(buffer)).filter(Boolean);
}
