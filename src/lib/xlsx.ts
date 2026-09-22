import { makeZip } from './zip';

/**
 * Écriture de classeurs Excel, sans bibliothèque.
 *
 * Un fichier .xlsx est une archive ZIP contenant quelques documents XML
 * décrits par la norme OpenXML. En produire un demande d'écrire ces
 * documents à la main, mais évite d'embarquer une bibliothèque de
 * plusieurs centaines de kilooctets dans une application qui doit
 * s'installer sur un téléphone en zone mal desservie.
 *
 * Par rapport au CSV, trois différences qui comptent à l'usage : les
 * colonnes arrivent à la bonne largeur, l'en-tête est figé et lisible,
 * et les montants sont de vrais nombres — on peut les trier et les
 * additionner sans reformater.
 */

export interface SheetColumn<T> {
  header: string;
  value: (row: T) => string;
  /** La valeur est un nombre : elle sera écrite comme telle. */
  numeric?: boolean;
}

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}

/** Nom de colonne Excel : 1 → A, 27 → AA. */
function colName(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Extrait la valeur numérique d'un montant mis en forme.
 *
 * Les colonnes arrivent déjà formatées pour l'écran — « 2 000 FCFA »,
 * « 45 pièce ». Excel doit recevoir 2000, pas la chaîne : sinon la
 * colonne ne se trie pas et ne s'additionne pas.
 */
function toNumber(text: string): number | null {
  const cleaned = text
    .replace(/[\s  ]/g, '')
    .replace(/[^\d,.\-+]/g, '')
    .replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Largeur de colonne, estimée d'après le contenu le plus long. */
function columnWidth<T>(col: SheetColumn<T>, rows: T[]): number {
  let max = col.header.length;
  // Au-delà de deux cents lignes, l'échantillon suffit : parcourir tout
  // le tableau pour affiner une largeur n'apporte rien.
  for (const r of rows.slice(0, 200)) {
    const len = col.value(r).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 3));
}

export function exportXlsx<T>(
  rows: T[],
  columns: SheetColumn<T>[],
  sheetName: string,
  filename: string,
): void {
  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(c, rows)}" customWidth="1"/>`)
    .join('');

  // Ligne d'en-tête, style 1 : gras sur fond vert.
  const headerCells = columns
    .map((c, i) => `<c r="${colName(i + 1)}1" t="inlineStr" s="1"><is><t>${esc(c.header)}</t></is></c>`)
    .join('');

  const bodyRows = rows.map((row, ri) => {
    const r = ri + 2;
    const cells = columns.map((c, ci) => {
      const ref = `${colName(ci + 1)}${r}`;
      const raw = c.value(row);

      if (c.numeric) {
        const n = toNumber(raw);
        if (n !== null) return `<c r="${ref}" s="2"><v>${n}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(raw)}</t></is></c>`;
    }).join('');

    return `<row r="${r}">${cells}</row>`;
  }).join('');

  const lastCol = colName(columns.length);
  const lastRow = rows.length + 1;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1" ht="22" customHeight="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF10715A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

  const safeName = sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ');

  makeZipDownload({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,

    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,

    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,

    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,

    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': styles,
  }, filename);
}

function makeZipDownload(files: Record<string, string>, filename: string): void {
  const blob = makeZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
