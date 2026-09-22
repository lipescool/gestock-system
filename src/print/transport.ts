// Trois façons d'atteindre une imprimante, une seule interface.
// Le reste de l'application ne sait pas laquelle est utilisée.

export type TransportKind = 'relay' | 'bluetooth' | 'usb' | 'network' | 'browser';

export interface PrintTransport {
  readonly kind: TransportKind;
  isAvailable(): boolean;
  isConnected(): boolean;
  connect(): Promise<void>;
  send(payload: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
  label(): string;
}


/* -------------------------------------------------------------------------
   Relais local — un petit service installe sur le poste.
   C'est le seul chemin ou le commercant ne choisit jamais son imprimante :
   le navigateur ne peut pas s'en souvenir, le relais si. Les autres
   transports restent la pour les postes ou il n'est pas installe.
   ------------------------------------------------------------------------- */

/** Le relais n'ecoute que sur la machine elle-meme. */
const RELAY_BASE = 'http://127.0.0.1:9110';

export interface RelayPrinter {
  name: string;
  driver: string;
  port: string;
  /** Vrai si le pilote laisse passer l'ESC/POS sans le reinterpreter. */
  raw: boolean;
}

/**
 * Le relais tourne-t-il ? Gestock le demande au demarrage pour savoir
 * s'il peut imprimer sans dialogue. La reponse doit etre rapide : si le
 * service est absent, la connexion est refusee aussitot et on n'attend
 * pas.
 */
export async function relayStatus(): Promise<{ printer: string; width: 58 | 80 } | null> {
  try {
    const res = await fetch(`${RELAY_BASE}/ping`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.service === 'gestock-relay'
      ? { printer: String(body.printer ?? ''), width: body.width === 80 ? 80 : 58 }
      : null;
  } catch {
    return null;
  }
}

/** Imprimantes du poste, pour que le commercant choisisse la sienne. */
export async function relayPrinters(): Promise<RelayPrinter[]> {
  const res = await fetch(`${RELAY_BASE}/printers`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('RELAY_UNREACHABLE');
  const body = await res.json();
  return Array.isArray(body.printers) ? body.printers : [];
}

/** Retient le choix dans le relais : il survit a la fermeture du navigateur. */
export async function relaySetPrinter(name: string, width: 58 | 80): Promise<void> {
  const res = await fetch(`${RELAY_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printer: name, width }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error('RELAY_CONFIG_FAILED');
}

export class RelayTransport implements PrintTransport {
  readonly kind = 'relay' as const;
  private connected = false;
  private printerName = '';

  /** @param printerName laisser vide pour utiliser celle reglee dans le relais. */
  constructor(printerName = '') {
    this.printerName = printerName;
  }

  isAvailable(): boolean {
    return true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  label(): string {
    return this.printerName;
  }

  async connect(): Promise<void> {
    const status = await relayStatus();
    if (!status) throw new Error('RELAY_NOT_RUNNING');
    if (!this.printerName) this.printerName = status.printer;
    if (!this.printerName) throw new Error('RELAY_NO_PRINTER');
    this.connected = true;
  }

  async send(payload: Uint8Array): Promise<void> {
    const q = this.printerName ? `?printer=${encodeURIComponent(this.printerName)}` : '';
    const res = await fetch(`${RELAY_BASE}/print${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload as BodyInit,
      signal: AbortSignal.timeout(20000),
    });

    // Le relais rend la cause exacte : on la remonte telle quelle pour
    // que le message affiche autre chose qu'un echec sans explication.
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ? `RELAY_${body.error}` : `RELAY_HTTP_${res.status}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

/* -------------------------------------------------------------------------
   Bluetooth — Web Bluetooth, disponible sur Chrome et Edge.
   Absent de Safari et de tous les navigateurs iOS : la page de réglages
   propose alors le réseau ou l'imprimante système.
   ------------------------------------------------------------------------- */

/** Services GATT des imprimantes thermiques courantes, par ordre de fréquence. */
/** Nom de la dernière imprimante appairée, pour la retrouver plus tard. */
const LAST_DEVICE = 'gestock.lastPrinter';

/** Nom de la dernière imprimante USB autorisée. */
const LAST_USB = 'gestock.lastUsbPrinter';

const PRINTER_SERVICES = [
  0x18f0,                                   // la grande majorité des 58/80 mm
  0xff00,
  0xffe0,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // puces Microchip / ISSC
  '0000ff00-0000-1000-8000-00805f9b34fb',
];

export class BluetoothTransport implements PrintTransport {
  readonly kind = 'bluetooth' as const;
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected === true && this.characteristic !== null;
  }

  label(): string {
    return this.device?.name ?? '';
  }

  /**
   * Établit la liaison avec l'imprimante.
   *
   * Trois cas, du plus rapide au plus lent :
   *
   * 1. L'appareil est déjà en mémoire et sa liaison tient : rien à faire.
   * 2. L'appareil est en mémoire mais la liaison est tombée — mise en
   *    veille, sortie de portée : on la rétablit sans rien demander.
   * 3. Aucun appareil connu : le navigateur ouvre son sélecteur.
   *
   * Sans les deux premiers cas, chaque impression rouvrait le sélecteur,
   * alors que l'imprimante était déjà appairée.
   */
  async connect(): Promise<void> {
    if (!this.isAvailable()) throw new Error('BLUETOOTH_UNSUPPORTED');

    if (this.device?.gatt) {
      if (this.characteristic && this.device.gatt.connected) return;
      try {
        await this.bind(await this.device.gatt.connect());
        return;
      } catch {
        // L'appareil retenu ne répond plus : on repart du sélecteur.
        this.device = null;
        this.characteristic = null;
      }
    }

    // Après un rechargement de page, l'objet est perdu mais l'autorisation
    // donnée au navigateur subsiste. `getDevices()` rend la liste des
    // appareils déjà autorisés : on y retrouve l'imprimante sans rouvrir
    // le sélecteur.
    const remembered = await this.rememberedDevice();
    if (remembered) {
      try {
        this.device = remembered;
        this.watchDisconnect(remembered);
        await this.bind(await remembered.gatt!.connect());
        return;
      } catch {
        // Imprimante éteinte ou hors de portée : on demande à l'utilisateur.
        this.device = null;
        this.characteristic = null;
      }
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: PRINTER_SERVICES.map((s) => ({ services: [s] })),
      optionalServices: PRINTER_SERVICES,
    });

    this.watchDisconnect(this.device);
    await this.bind(await this.device.gatt!.connect());
  }

  /**
   * Retrouve l'imprimante parmi les appareils déjà autorisés.
   *
   * Le nom retenu au dernier appairage sert de repère quand plusieurs
   * appareils ont été autorisés ; à défaut, on prend le premier.
   * `getDevices()` n'existe pas partout — Safari ne l'a pas — d'où le
   * garde-fou.
   */
  private async rememberedDevice(): Promise<BluetoothDevice | null> {
    const bt = navigator.bluetooth as Bluetooth & {
      getDevices?: () => Promise<BluetoothDevice[]>;
    };
    if (typeof bt.getDevices !== 'function') return null;

    try {
      const devices = await bt.getDevices();
      if (devices.length === 0) return null;
      const wanted = localStorage.getItem(LAST_DEVICE);
      return devices.find((d) => d.name === wanted) ?? devices[0];
    } catch {
      return null;
    }
  }

  /** La liaison retombe quand l'imprimante s'éteint : on l'oublie. */
  private watchDisconnect(device: BluetoothDevice): void {
    device.addEventListener('gattserverdisconnected', () => {
      this.characteristic = null;
    });
    if (device.name) localStorage.setItem(LAST_DEVICE, device.name);
  }

  /**
   * Retrouve la voie d'écriture sur l'appareil connecté.
   *
   * Les modèles n'exposent pas le même service : on les essaie tous
   * jusqu'à trouver une caractéristique qui accepte l'écriture.
   */
  private async bind(server: BluetoothRemoteGATTServer): Promise<void> {
    for (const service of PRINTER_SERVICES) {
      try {
        const svc = await server.getPrimaryService(service);
        for (const ch of await svc.getCharacteristics()) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            this.characteristic = ch;
            return;
          }
        }
      } catch {
        // Ce service n'existe pas sur ce modèle, on passe au suivant.
      }
    }
    throw new Error('NO_WRITABLE_CHARACTERISTIC');
  }

  /**
   * Le BLE plafonne autour de 512 octets par écriture, et beaucoup
   * d'imprimantes saturent bien avant. On envoie par blocs de 180 octets
   * avec une pause : sans cette pause, les tickets longs sortent tronqués.
   */
  async send(payload: Uint8Array): Promise<void> {
    if (!this.characteristic) throw new Error('NOT_CONNECTED');
    const CHUNK = 180;
    const withoutResponse = this.characteristic.properties.writeWithoutResponse;

    for (let offset = 0; offset < payload.length; offset += CHUNK) {
      const slice = payload.slice(offset, offset + CHUNK);
      if (withoutResponse) {
        await this.characteristic.writeValueWithoutResponse(slice);
      } else {
        await this.characteristic.writeValue(slice);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
  }
}

/* -------------------------------------------------------------------------
   USB — liaison directe par câble.

   C'est le transport le plus sûr sur un poste fixe : contrairement au
   Bluetooth, le navigateur retrouve seul l'imprimante déjà autorisée
   après un rechargement de page. Le sélecteur n'apparaît qu'une fois.

   Une réserve : Windows attribue son propre pilote d'impression aux
   imprimantes USB, et ce pilote garde l'appareil pour lui. Il faut le
   remplacer par WinUSB, à l'aide de l'utilitaire Zadig, pour que le
   navigateur puisse y accéder. L'imprimante disparaît alors de la liste
   des imprimantes Windows : elle n'est plus utilisable que par Gestock.
   ------------------------------------------------------------------------- */

/** Classe USB des imprimantes, telle que définie par la norme. */
const USB_PRINTER_CLASS = 0x07;

export class UsbTransport implements PrintTransport {
  readonly kind = 'usb' as const;
  private device: USBDevice | null = null;
  private endpoint = 0;

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  isConnected(): boolean {
    return this.device?.opened === true && this.endpoint > 0;
  }

  label(): string {
    return this.device?.productName ?? '';
  }

  async connect(): Promise<void> {
    if (!this.isAvailable()) throw new Error('USB_UNSUPPORTED');
    if (this.isConnected()) return;

    // Un appareil déjà autorisé se retrouve sans rien demander : c'est
    // tout l'intérêt de l'USB par rapport au Bluetooth.
    const known = await navigator.usb.getDevices();
    const remembered = known.find((d) => d.productName === localStorage.getItem(LAST_USB))
      ?? known[0];

    this.device = remembered ?? await navigator.usb.requestDevice({
      filters: [{ classCode: USB_PRINTER_CLASS }, { vendorId: 0x0483 }],
    });

    await this.open();
    if (this.device.productName) {
      localStorage.setItem(LAST_USB, this.device.productName);
    }
  }

  /** Ouvre l'appareil et retient la voie de sortie des données. */
  private async open(): Promise<void> {
    const d = this.device!;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);

    for (const iface of d.configuration!.interfaces) {
      for (const alt of iface.alternates) {
        // On retient l'interface d'impression, ou à défaut n'importe
        // quelle interface offrant une sortie en vrac.
        const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
        if (!out) continue;
        if (alt.interfaceClass !== USB_PRINTER_CLASS && iface.interfaceNumber !== 0) continue;

        try {
          await d.claimInterface(iface.interfaceNumber);
          if (alt.alternateSetting !== 0) {
            await d.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting);
          }
          this.endpoint = out.endpointNumber;
          return;
        } catch {
          // Interface déjà prise par le système : on essaie la suivante.
        }
      }
    }
    throw new Error('USB_NO_ENDPOINT');
  }

  async send(payload: Uint8Array): Promise<void> {
    if (!this.isConnected()) throw new Error('NOT_CONNECTED');
    // L'USB ne souffre pas des limites du Bluetooth : le ticket part
    // d'un seul bloc, sans découpage ni pause.
    const res = await this.device!.transferOut(this.endpoint, payload as BufferSource);
    if (res.status !== 'ok') throw new Error(`USB_${res.status.toUpperCase()}`);
  }

  async disconnect(): Promise<void> {
    try { await this.device?.close(); } catch { /* déjà fermé */ }
    this.device = null;
    this.endpoint = 0;
  }
}

/* -------------------------------------------------------------------------
   Réseau — imprimante Wi-Fi sur le réseau local.
   Un navigateur ne peut pas ouvrir un socket TCP brut vers le port 9100.
   On passe donc par un petit relais posé sur un poste du réseau, qui reçoit
   le flux en HTTP et le réémet en TCP. Le relais est fourni avec Gestock
   (dossier relay/) et ne demande aucune connexion internet.
   ------------------------------------------------------------------------- */

export class NetworkTransport implements PrintTransport {
  readonly kind = 'network' as const;
  private connected = false;

  private address: string;
  private relay: string;

  /**
   * @param address "192.168.1.50:9100" — l'adresse de l'imprimante.
   * @param relay   "192.168.1.10:7777" — le poste qui héberge le relais.
   */
  constructor(address: string, relay: string) {
    this.address = address;
    this.relay = relay;
  }

  isAvailable(): boolean {
    return this.address.length > 0 && this.relay.length > 0;
  }

  isConnected(): boolean {
    return this.connected;
  }

  label(): string {
    return this.address;
  }

  private relayUrl(path: string): string {
    const base = this.relay.startsWith('http') ? this.relay : `http://${this.relay}`;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  async connect(): Promise<void> {
    const res = await fetch(this.relayUrl(`/ping?target=${encodeURIComponent(this.address)}`), {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error('RELAY_UNREACHABLE');
    this.connected = true;
  }

  async send(payload: Uint8Array): Promise<void> {
    const res = await fetch(this.relayUrl(`/print?target=${encodeURIComponent(this.address)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload as BodyInit,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`PRINT_FAILED_${res.status}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

/* -------------------------------------------------------------------------
   Navigateur — dialogue d'impression système.
   Fonctionne partout, y compris sur iPhone et iPad via AirPrint. C'est le
   recours quand aucun des deux autres transports n'est possible. Le ticket
   est composé en HTML plutôt qu'en ESC/POS : voir receipt-html.ts.
   ------------------------------------------------------------------------- */

export class BrowserTransport implements PrintTransport {
  readonly kind = 'browser' as const;

  isAvailable(): boolean {
    return typeof window !== 'undefined';
  }

  isConnected(): boolean {
    return true;
  }

  label(): string {
    return 'system';
  }

  async connect(): Promise<void> {
    // Rien à connecter : le dialogue système gère le choix de l'imprimante.
  }

  /** Reçoit du HTML encodé en UTF-8, pas de l'ESC/POS. */
  async send(payload: Uint8Array): Promise<void> {
    const html = new TextDecoder().decode(payload);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);

    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();

    // On laisse la police et la mise en page se poser avant d'ouvrir le
    // dialogue, sinon Safari imprime une page vide.
    await new Promise((r) => setTimeout(r, 350));
    frame.contentWindow?.focus();
    frame.contentWindow?.print();

    setTimeout(() => frame.remove(), 60_000);
  }

  async disconnect(): Promise<void> {
    // Sans objet.
  }
}
