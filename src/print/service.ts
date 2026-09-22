import {
  RelayTransport, BluetoothTransport, UsbTransport, NetworkTransport, BrowserTransport,
  relayStatus,
  type PrintTransport, type TransportKind,
} from './transport';
import { buildReceipt, buildReceiptHtml, type ReceiptContext } from './receipt';
import type { Order } from '../db/schema';
import { EscPosBuilder } from './escpos';

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
