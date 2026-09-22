import {
  RelayTransport, BluetoothTransport, UsbTransport, NetworkTransport, BrowserTransport,
  relayStatus,
  type PrintTransport, type TransportKind,
} from './transport';
import { buildReceipt, buildReceiptHtml, type ReceiptContext } from './receipt';
import type { Order } from '../db/schema';
import { EscPosBuilder } from './escpos';
import { REGLAGES_PAR_DEFAUT, type EtiquetteTspl, type ReglagesTspl } from './tspl';
import { construirePlancheBitmap, construireEssaiBitmap } from './tsplBitmap';

/**
 * Point d'entrée unique de l'impression. L'appelant demande « imprime ce
 * ticket » sans savoir si le flux part en Bluetooth, sur le réseau, ou vers
 * le dialogue du système.
 */
class PrintService {
  private transport: PrintTransport | null = null;

  /** Le Bluetooth manque sur iOS et Safari : on le signale avant de l'offrir. */
  bluetoothSupported(): boolean {
    return new BluetoothTransport().isAvailable();
  }

  /** L'USB n'existe que sur Chrome et Edge, comme le Bluetooth. */
  usbSupported(): boolean {
    return new UsbTransport().isAvailable();
  }

  /**
   * Le relais local est-il installe et regle ?
   *
   * C'est le seul chemin sans dialogue : quand il repond, on l'utilise
   * de preference a tout le reste, quel que soit le transport choisi
   * dans les reglages.
   */
  async relayReady(): Promise<boolean> {
    const status = await relayStatus();
    return status !== null && status.printer.length > 0;
  }

  currentKind(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }

  deviceLabel(): string {
    return this.transport?.label() ?? '';
  }

  async use(kind: TransportKind, opts?: { address?: string; relay?: string }): Promise<void> {
    if (this.transport && this.transport.kind !== kind) {
      await this.transport.disconnect();
    }
    switch (kind) {
      case 'relay':
        this.transport = new RelayTransport(opts?.address ?? '');
        break;
      case 'bluetooth':
        this.transport = new BluetoothTransport();
        break;
      case 'usb':
        this.transport = new UsbTransport();
        break;
      case 'network':
        this.transport = new NetworkTransport(opts?.address ?? '', opts?.relay ?? '');
        break;
      case 'browser':
        this.transport = new BrowserTransport();
        break;
    }
  }

  async connect(): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');
    await this.transport.connect();
  }

  /**
   * Prepare l'impression selon l'imprimante choisie.
   *
   * Le choix du commercant prime, toujours : s'il a designe une
   * imprimante Bluetooth, c'est elle qui imprime, meme quand le service
   * local tourne et imprimerait sans rien demander. Un reglage qu'on
   * contourne pour son bien ne vaut rien.
   *
   * Le service reste le recours : quand le transport choisi ne repond
   * pas, la vente s'imprime par lui plutot que d'echouer.
   */
  async useBest(
    choisi: TransportKind,
    opts?: { address?: string; relay?: string },
  ): Promise<TransportKind> {
    try {
      await this.use(choisi, opts);
      if (!this.isConnected()) await this.connect();
      return choisi;
    } catch (e) {
      // Le repli ne s'applique pas si le choix EST le service, ni quand
      // le commercant a simplement referme le selecteur du navigateur :
      // reimprimer ailleurs serait alors une surprise desagreable.
      const annule = e instanceof Error && e.name === 'NotFoundError';
      if (choisi === 'relay' || annule || !(await this.relayReady())) throw e;

      await this.use('relay');
      await this.connect();
      return 'relay';
    }
  }

  async disconnect(): Promise<void> {
    await this.transport?.disconnect();
  }

  /**
   * Le transport « navigateur » veut du HTML, les deux autres de l'ESC/POS.
   * C'est la seule différence, et elle est absorbée ici.
   */
  async printReceipt(order: Order, ctx: ReceiptContext): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');
    const payload = this.transport.kind === 'browser'
      ? buildReceiptHtml(order, ctx)
      : buildReceipt(order, ctx);
    await this.transport.send(payload);
  }

  async printRaw(payload: Uint8Array): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');
    await this.transport.send(payload);
  }

  /**
   * Étiquettes à imprimer, dans le langage de la machine.
   *
   * Deux langages, un seul appel : l'appelant décrit ce qu'il veut,
   * pas comment le dire. ESC/POS pour une imprimante à tickets
   * détournée, TSPL pour une vraie étiqueteuse.
   */
  async printLabels(
    etiquettes: EtiquetteTspl[],
    langage: 'escpos' | 'tspl',
    reglages: ReglagesTspl,
    opts: { avecNom?: boolean; avecPrix?: boolean } = {},
  ): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');

    if (langage === 'tspl') {
      /* L'étiquette est dessinée puis envoyée en image : c'est la
         seule façon de centrer exactement le texte, puisque le
         navigateur en mesure alors la largeur réelle. Les commandes
         de texte TSPL obligeaient à deviner cette largeur, et le
         décalage variait avec chaque nom. */
      await this.transport.send(
        await construirePlancheBitmap(etiquettes, reglages, opts),
      );
      return;
    }

    /* ESC/POS : la vignette n'existe pas, on enchaîne les lignes et
       on laisse le papier défiler. Le rendu est moins net, mais une
       imprimante à tickets peut dépanner. */
    const b = new EscPosBuilder(reglages.largeurMm >= 80 ? 80 : 58);
    for (const e of etiquettes) {
      for (let i = 0; i < Math.max(1, e.exemplaires); i++) {
        b.align('center');
        if (opts.avecNom !== false && e.nom) {
          b.bold(true).lineClamped(e.nom).bold(false);
        }
        if (opts.avecPrix !== false && e.prix) {
          b.bold(true).size(1, 2).line(e.prix).size(1, 1).bold(false);
        }
        b.barcode(e.codeBarres, 50);
        b.feed(2);
      }
    }
    await this.transport.send(b.build());
  }

  /**
   * Étiquette d'essai.
   *
   * Elle ressemble à ce qui sortira pour de vrai : un nom de produit,
   * un prix, un code-barres. Ni nom de boutique ni remerciement —
   * c'est une vignette de rayon, pas un ticket de caisse.
   *
   * Pas de coupe non plus : un rouleau d'étiquettes se détache seul,
   * et la commande de coupe gâcherait une vignette.
   */
  async printLabelTest(
    _shopName: string, width: 58 | 80,
    langage: 'escpos' | 'tspl' = 'escpos',
    reglages?: ReglagesTspl,
  ): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');

    if (langage === 'tspl') {
      await this.transport.send(
        await construireEssaiBitmap(
          reglages ?? { ...REGLAGES_PAR_DEFAUT, largeurMm: width },
        ),
      );
      return;
    }

    /* Un nom et un prix d'exemple : le commerçant vérifie que tout
       tient sur la vignette, et que la douchette relit le code. */
    const nom = 'PRODUIT D ESSAI';
    const prix = '2 500 FCFA';

    if (this.transport.kind === 'browser') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{size:${width}mm 40mm;margin:1.5mm}
        body{font-family:'Outfit',sans-serif;text-align:center;margin:0;
             display:flex;flex-direction:column;align-items:center;gap:1mm}
        .n{font-size:${width === 80 ? 12 : 10}px;font-weight:700;
           text-transform:uppercase;line-height:1.1}
        .p{font-size:${width === 80 ? 14 : 12}px;font-weight:800}
        </style></head>
        <body><div class="n">${nom}</div><div class="p">${prix}</div></body></html>`;
      await this.transport.send(new TextEncoder().encode(html));
      return;
    }

    const b = new EscPosBuilder(width);
    b.align('center');
    b.bold(true).lineClamped(nom).bold(false);
    b.bold(true).size(1, 2).line(prix).size(1, 1).bold(false);
    b.barcode('2003050875886', 50);
    b.feed(1);
    await this.transport.send(b.build());
  }

  /** Page de test : vérifie la largeur, les accents et le code-barres. */
  async printTest(shopName: string, width: 58 | 80): Promise<void> {
    if (!this.transport) throw new Error('NO_TRANSPORT');

    if (this.transport.kind === 'browser') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{size:${width}mm auto;margin:3mm}
        body{font-family:'Outfit',monospace;width:${width - 6}mm;font-size:${width === 58 ? 10 : 12}px}
        h1{text-align:center;font-weight:800}</style></head>
        <body><h1>${shopName}</h1><p>Test ${width} mm — éàçùôî ÉÀÇ</p>
        <p>${'1234567890'.repeat(5).slice(0, width === 58 ? 32 : 48)}</p></body></html>`;
      await this.transport.send(new TextEncoder().encode(html));
      return;
    }

    const b = new EscPosBuilder(width);
    b.align('center').bold(true).size(2, 2).line(shopName).size(1, 1).bold(false);
    b.separator('=');
    b.align('left');
    b.line(`Test ${width} mm`);
    b.line('Accents : éàçùôî ÉÀÇÙÔÎ');
    b.line('0'.padEnd(b.cols, '123456789').slice(0, b.cols));
    b.separator();
    b.align('center').barcode('GESTOCK123', 50);
    b.cut();
    await this.transport.send(b.build());
  }
}

export const printer = new PrintService();
export type { ReceiptContext };
