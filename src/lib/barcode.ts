import JsBarcode from 'jsbarcode';

/* -------------------------------------------------------------------------
   Lecture — douchette USB/Bluetooth.
   Une douchette se présente au système comme un clavier : elle tape le code
   très vite puis envoie Entrée. On distingue donc un scan d'une saisie
   manuelle par la vitesse entre les touches, pas par un pilote.
   ------------------------------------------------------------------------- */

export function listenScanner(
  onScan: (code: string) => void,
  opts: { minLength?: number; maxGapMs?: number } = {},
): () => void {
  const minLength = opts.minLength ?? 4;
  const maxGap = opts.maxGapMs ?? 35;

  let buffer = '';
  let lastKeyAt = 0;

  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    const t = performance.now();

    if (t - lastKeyAt > maxGap) buffer = '';
    lastKeyAt = t;

    if (e.key === 'Enter') {
      if (buffer.length >= minLength) {
        // Le code est complet et rapide : c'est un scan, pas une frappe.
        if (typing) e.preventDefault();
        onScan(buffer);
      }
      buffer = '';
      return;
    }

    if (e.key.length === 1) buffer += e.key;
  };

  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

/* -------------------------------------------------------------------------
   Génération
   ------------------------------------------------------------------------- */

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'EAN8' | 'CODE39' | 'UPC';

/** Clé de contrôle EAN-13, calculée sur les douze premiers chiffres. */
export function ean13CheckDigit(twelve: string): number {
  const sum = [...twelve].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * Code interne pour un produit sans code fabricant.
 *
 * Le préfixe 200 est réservé à l'usage interne des commerces : ces
 * codes ne peuvent entrer en conflit avec aucun produit du commerce
 * mondial.
 *
 * Les neuf chiffres qui suivent sont tirés au hasard, et non pris
 * dans une suite. Deux raisons :
 *
 * - une suite donnait des codes presque identiques — 2000000000015,
 *   2000000000022 — qu'on confond en les lisant ou en les tapant ;
 *
 * - elle se fondait sur le nombre de produits, si bien qu'une
 *   suppression suivie d'une création réattribuait le même code à
 *   deux articles différents. Une vente se serait comptée sur le
 *   mauvais produit.
 */
export function generateInternalBarcode(): string {
  const chiffres = crypto.getRandomValues(new Uint8Array(9));
  const corps = '200' + [...chiffres].map((o) => o % 10).join('');
  return corps + ean13CheckDigit(corps);
}

export function renderBarcodeSvg(
  value: string,
  format: BarcodeFormat = 'CODE128',
  opts: { width?: number; height?: number; showText?: boolean; fontSize?: number } = {},
): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, {
    format,
    width: opts.width ?? 2,
    height: opts.height ?? 60,
    displayValue: opts.showText ?? true,
    fontSize: opts.fontSize ?? 14,
    fontOptions: 'bold',
    font: 'Outfit',
    margin: 4,
    background: '#ffffff',
    lineColor: '#000000',
  });
  return new XMLSerializer().serializeToString(svg);
}

/* -------------------------------------------------------------------------
   Planches d'étiquettes.
   Les valeurs de mise en page reprennent celles validées sur imprimante
   dans warishop/IMPRESSION_ETIQUETTES.md : 8 points par millimètre à 200 dpi.
   ------------------------------------------------------------------------- */

export interface LabelItem {
  name: string;
  barcode: string;
  price: string;
  qty: number;
}

export interface SheetFormat {
  /** Format du papier, en millimètres. */
  paper: { w: number; h: number };
  /** Grille d'étiquettes sur la planche. */
  grid: { cols: number; rows: number };
}

export const SHEET_FORMATS: Record<string, SheetFormat> = {
  '58x40': { paper: { w: 58, h: 40 }, grid: { cols: 1, rows: 1 } },
  '60x40': { paper: { w: 60, h: 40 }, grid: { cols: 1, rows: 1 } },
  '80x80': { paper: { w: 80, h: 80 }, grid: { cols: 2, rows: 3 } },
  '100x100': { paper: { w: 100, h: 100 }, grid: { cols: 2, rows: 4 } },
  'A4': { paper: { w: 210, h: 297 }, grid: { cols: 4, rows: 10 } },
};

/**
 * Planche d'étiquettes en HTML, pour le dialogue d'impression.
 * Chaque cellule est encadrée et son contenu centré, comme sur les planches
 * validées de Warishop.
 */
export function buildLabelSheetHtml(
  items: LabelItem[],
  formatKey: keyof typeof SHEET_FORMATS,
  opts: { showPrice?: boolean; showName?: boolean } = {},
): string {
  const fmt = SHEET_FORMATS[formatKey];
  const showPrice = opts.showPrice ?? true;
  const showName = opts.showName ?? true;

  const cellW = fmt.paper.w / fmt.grid.cols;
  const cellH = fmt.paper.h / fmt.grid.rows;

  // Une étiquette par unité demandée : cinq exemplaires d'un produit
  // occupent cinq cases.
  const expanded = items.flatMap((it) => Array.from({ length: Math.max(1, it.qty) }, () => it));

  const cells = expanded
    .map((it) => {
      const svg = renderBarcodeSvg(it.barcode, 'CODE128', {
        width: 2,
        height: Math.round(cellH * 1.6),
        showText: true,
        fontSize: 12,
      });
      return `<div class="cell">
        ${showName ? `<div class="name">${escapeHtml(it.name)}</div>` : ''}
        ${showPrice ? `<div class="price">${escapeHtml(it.price)}</div>` : ''}
        <div class="code">${svg}</div>
      </div>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family:'Outfit'; src:url('/fonts/Outfit-SemiBold.ttf') format('truetype'); font-weight:600 }
  @font-face { font-family:'Outfit'; src:url('/fonts/Outfit-Bold.ttf') format('truetype'); font-weight:700 }
  @page { size: ${fmt.paper.w}mm ${fmt.paper.h}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family:'Outfit',sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${fmt.grid.cols}, ${cellW}mm);
    grid-auto-rows: ${cellH}mm;
    width: ${fmt.paper.w}mm;
  }
  .cell {
    border: .3mm solid #000;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 1mm; overflow: hidden; gap: .5mm;
    page-break-inside: avoid;
  }
  .name {
    font-weight: 600; font-size: ${Math.max(6, Math.round(cellW / 5))}pt;
    text-align: center; line-height: 1.1;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .price { font-weight: 700; font-size: ${Math.max(7, Math.round(cellW / 4))}pt; }
  .code svg { max-width: ${cellW - 4}mm; height: auto; }
</style></head>
<body><div class="sheet">${cells}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
