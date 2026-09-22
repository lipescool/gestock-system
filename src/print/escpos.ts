// Construction de flux ESC/POS pour tickets thermiques.
// Largeurs gérées : 58 mm (32 colonnes) et 80 mm (48 colonnes).

export type PaperWidth = 58 | 80;

/** Nombre de caractères par ligne en police A, pour chaque largeur. */
export const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };

const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private parts: number[] = [];
  readonly cols: number;
  readonly width: PaperWidth;

  constructor(width: PaperWidth = 58) {
    this.width = width;
    this.cols = COLUMNS[width];
    this.raw(ESC, 0x40);            // initialisation
    this.raw(ESC, 0x74, 0x10);      // page de codes 16 = Windows-1252 (accents FR)
  }

  private raw(...bytes: number[]): this {
    this.parts.push(...bytes);
    return this;
  }

  /**
   * Encode en Windows-1252 : l'imprimante ne comprend pas l'UTF-8.
   * Un caractère hors table est remplacé par son équivalent sans accent
   * plutôt que par un carré vide.
   */
  private encode(text: string): number[] {
    // Intl.NumberFormat sépare les milliers par une espace insécable étroite
    // (U+202F) en français, et les guillemets typographiques arrivent des
    // libellés saisis. Aucun de ces caractères n'existe en Windows-1252 :
    // sans cette substitution, « 2 000 FCFA » s'imprime « 2?000?FCFA ».
    const flat = text
      .replace(/[     ]/g, ' ')
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[×]/g, 'x');

    const out: number[] = [];
    for (const ch of flat.normalize('NFC')) {
      const code = ch.charCodeAt(0);
      if (code <= 0xff) {
        out.push(code);
      } else {
        // Dernier recours : on retire l'accent plutôt que d'imprimer un carré.
        const fallback = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out.push(...[...fallback].map((c) => (c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : 0x3f)));
      }
    }
    return out;
  }

  align(mode: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[mode]);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Taille : 1 = normal, 2 = double, jusqu'à 8. */
  size(w: number, h: number): this {
    const n = ((Math.min(w, 8) - 1) << 4) | (Math.min(h, 8) - 1);
    return this.raw(GS, 0x21, n);
  }

  underline(on: boolean): this {
    return this.raw(ESC, 0x2d, on ? 1 : 0);
  }

  text(value: string): this {
    return this.raw(...this.encode(value));
  }

  line(value = ''): this {
    return this.text(value).raw(0x0a);
  }

  /** Coupe le texte trop long plutôt que de laisser l'imprimante le replier. */
  lineClamped(value: string): this {
    if (this.encode(value).length <= this.cols) return this.line(value);
    let cut = value;
    while (this.encode(cut).length > this.cols - 1 && cut.length > 1) {
      cut = cut.slice(0, -1);
    }
    return this.line(`${cut}.`);
  }

  /**
   * Libellé à gauche, valeur à droite, remplissage entre les deux.
   * La largeur se mesure après substitution des caractères non imprimables :
   * un « … » compte pour trois caractères une fois encodé, pas un seul, et
   * l'écart décalait toute la colonne de droite.
   */
  keyValue(label: string, value: string, filler = ' '): this {
    const width = (s: string) => this.encode(s).length;

    const vw = width(value);
    const room = this.cols - vw - 1;

    let cut = label;
    while (width(cut) > room && cut.length > 1) {
      cut = `${cut.slice(0, -2)}.`;
    }

    const pad = Math.max(1, this.cols - width(cut) - vw);
    return this.line(cut + filler.repeat(pad) + value);
  }

  separator(char = '-'): this {
    return this.line(char.repeat(this.cols));
  }

  /**
   * Hauteur d'une ligne, en points. L'imprimante travaille par défaut
   * autour de 30 : assez pour du texte courant, beaucoup trop pour
   * coller une légende sous un code-barres.
   */
  lineSpacing(dots: number): this {
    return this.raw(ESC, 0x33, Math.max(0, Math.min(255, dots)));
  }

  /** Rend à l'imprimante son interligne habituel. */
  defaultLineSpacing(): this {
    return this.raw(ESC, 0x32);
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, lines);
  }

  /**
   * Code-barres Code128 imprimé sous le ticket.
   *
   * Le texte lisible n'est pas confié à l'imprimante : plusieurs
   * modèles le rendent collé à gauche, sans tenir compte de
   * l'alignement demandé, et le chiffre se retrouve décalé sous un
   * code pourtant centré. On le désactive et on l'écrit soi-même,
   * comme une ligne ordinaire — elle suit alors le centrage du reste.
   */
  barcode(data: string, height = 60): this {
    this.raw(GS, 0x68, height);        // hauteur
    this.raw(GS, 0x77, 2);             // largeur du module
    this.raw(GS, 0x48, 0);             // pas de texte imprimé par l'imprimante
    const bytes = this.encode(data);
    // Code128 : type 73, préfixe {B pour le jeu de caractères étendu.
    this.raw(GS, 0x6b, 73, bytes.length + 2, 0x7b, 0x42, ...bytes);
    // L'imprimante ne termine pas le code-barres par un saut de ligne :
    // sans celui-ci, le texte qui suit reste collé sur la même ligne et
    // se retrouve décalé à droite du code au lieu d'être dessous.
    // L'interligne est resserré le temps de cette légende, sinon elle
    // flotte à un demi-centimètre du code qu'elle désigne.
    this.lineSpacing(8);
    this.raw(0x0a);
    // Cette ligne hérite de l'alignement courant : centrée si le code
    // l'était, à gauche sinon.
    this.line(data);
    this.defaultLineSpacing();
    return this;
  }

  qrcode(data: string, moduleSize = 6): this {
    const bytes = this.encode(data);
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0);           // modèle 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 67, moduleSize);      // taille du module
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 69, 48);              // correction d'erreur
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48, ...bytes);
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 81, 48);              // impression
    return this;
  }

  /** Ouvre le tiroir-caisse relié à l'imprimante. */
  openDrawer(): this {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }

  cut(): this {
    return this.feed(3).raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}
