/**
 * Export des listes vers un tableur ou un document imprimable.
 *
 * Tout se fait dans le navigateur, sans bibliothèque ni serveur : le CSV
 * est une chaîne de caractères, le PDF passe par le dialogue d'impression
 * du système, qui sait enregistrer en PDF. L'application reste hors ligne.
 */

export interface ExportColumn<T> {
  /** Intitulé imprimé en tête de colonne. */
  header: string;
  /** Valeur d'une ligne, déjà mise en forme pour la lecture. */
  value: (row: T) => string;
  /** Aligné à droite dans le document : montants et quantités. */
  numeric?: boolean;
}

/**
 * Échappe une valeur pour le CSV.
 *
 * Un point-virgule, un guillemet ou un retour à la ligne dans un libellé
 * casserait le tableau. Les guillemets doublés sont la convention admise
 * par les tableurs.
 */
function csvCell(value: string): string {
  const v = value ?? '';
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Nom de fichier lisible et trié par date : « ventes-2026-09-21.csv ». */
function filename(base: string, ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

/**
 * Export vers un tableur.
 *
 * Le point-virgule sépare les colonnes, et non la virgule : c'est ce
 * qu'attend Excel dans les régions francophones, où la virgule est le
 * séparateur décimal. La marque d'octets en tête permet à Excel de
 * reconnaître l'UTF-8 et d'afficher correctement les accents.
 */
export function exportCsv<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  title: string,
): void {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(';'),
    ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(';')),
  ];

  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  download(blob, filename(title, 'csv'));
}

export interface PdfContext {
  shopName: string;
  title: string;
  /** Période couverte, telle qu'affichée à l'écran. */
  period?: string;
  /** Totaux ou compteurs repris du bandeau. */
  summary?: string;
}

/**
 * Export vers un PDF.
 *
 * Le document est composé en HTML puis confié au dialogue d'impression :
 * tous les navigateurs savent y enregistrer en PDF, et cela évite
 * d'embarquer une bibliothèque de plusieurs centaines de kilooctets pour
 * un tableau de texte.
 */
export function exportPdf<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  ctx: PdfContext,
): void {
  const esc = (s: string) =>
    (s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  const head = columns
    .map((c) => `<th class="${c.numeric ? 'r' : ''}">${esc(c.header)}</th>`)
    .join('');

  const body = rows
    .map((r) => `<tr>${columns
      .map((c) => `<td class="${c.numeric ? 'r' : ''}">${esc(c.value(r))}</td>`)
      .join('')}</tr>`)
    .join('');

  const printed = new Date().toLocaleString();

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${esc(ctx.title)}</title>
<style>
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-Regular.ttf') format('truetype'); font-weight:400 }
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-SemiBold.ttf') format('truetype'); font-weight:600 }
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-Bold.ttf') format('truetype'); font-weight:700 }

  /* Paysage : un tableau de six colonnes ne tient pas en portrait. */
  @page { size: A4 landscape; margin: 12mm; }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Outfit', sans-serif;
    font-size: 9pt;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  header { margin-bottom: 8mm; }
  h1 { margin: 0 0 1mm; font-size: 16pt; font-weight: 800; }
  .meta { font-size: 8.5pt; color: #4a5058; }
  .meta b { color: #000; }

  table { width: 100%; border-collapse: collapse; }
  th {
    background: #10715a;
    color: #fff;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    text-align: left;
    padding: 2.5mm 2mm;
  }
  td {
    padding: 2mm;
    border-bottom: .2mm solid #c9ced4;
    vertical-align: top;
  }
  /* Une ligne sur deux teintée : sur un tableau large, l'œil perd sa
     ligne d'un bout à l'autre. */
  tbody tr:nth-child(even) td { background: #f2f4f5; }
  .r { text-align: right; }

  /* L'en-tête se répète en haut de chaque page. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  footer {
    margin-top: 6mm;
    font-size: 7.5pt;
    color: #4a5058;
    text-align: right;
  }
</style></head>
<body>
  <header>
    <h1>${esc(ctx.title)}</h1>
    <div class="meta">
      <b>${esc(ctx.shopName)}</b>
      ${ctx.period ? ` &middot; ${esc(ctx.period)}` : ''}
      ${ctx.summary ? ` &middot; ${esc(ctx.summary)}` : ''}
      &middot; ${rows.length} lignes
    </div>
  </header>

  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>

  <footer>Édité le ${esc(printed)}</footer>
</body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  // La police et la mise en page doivent être posées avant l'ouverture du
  // dialogue, sans quoi certains navigateurs impriment une page vide.
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 400);
}
