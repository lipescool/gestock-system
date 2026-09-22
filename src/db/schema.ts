// Schéma de la base locale Gestock (IndexedDB via Dexie).
// Tout est local : aucune donnée ne quitte l'appareil.

export type Uid = string;

/** Réglage clé/valeur. Toute la configuration passe par ici. */
export interface Setting {
  key: string;
  value: unknown;
}

/** Une traduction. Aucune chaîne d'interface n'est écrite en dur ailleurs. */
export interface Translation {
  id?: number;
  lang: string;   // 'fr' | 'en' | ...
  key: string;    // 'menu.dashboard'
  value: string;
  /** Vrai si le commerçant a reformulé ce texte : la mise à jour du code
   *  ne l'écrase alors plus. */
  customized?: boolean;
}

export interface Category {
  id: Uid;
  name: string;          // libellé saisi par le commerçant
  icon: string;          // emoji ou nom d'icône
  position: number;
  archived: boolean;
  updatedAt: number;
}

export interface Product {
  id: Uid;
  name: string;
  categoryId: Uid | null;
  barcode: string | null;   // EAN/Code128, unique quand renseigné
  sku: string | null;
  price: number;            // prix de vente, en unités mineures (centimes)
  cost: number;             // prix d'achat, pour la marge
  stock: number;
  stockAlert: number;       // seuil d'alerte
  unit: string;             // pièce, kg, litre…
  image: string | null;     // dataURL ou null
  tags: string[];           // 'best-seller', etc.
  archived: boolean;
  updatedAt: number;
}

export type OrderType = 'dine-in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'paid' | 'cancelled' | 'refunded';

export interface OrderLine {
  productId: Uid;
  name: string;       // figé au moment de la vente
  unitPrice: number;  // figé
  unitCost: number;   // figé, pour la marge historique
  qty: number;
  discount: number;   // remise sur la ligne
}

export interface Order {
  id: Uid;
  ref: string;               // #ID1902
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  tableNumber: string | null;
  lines: OrderLine[];
  subtotal: number;
  taxRate: number;           // en pourcentage
  taxAmount: number;
  discount: number;          // remise globale
  additionalFee: number;
  total: number;
  paymentMethodId: Uid | null;
  paidAmount: number;
  changeAmount: number;
  note: string | null;
  userId: Uid | null;
  createdAt: number;
  closedAt: number | null;
  updatedAt: number;
}

export interface PaymentMethod {
  id: Uid;
  name: string;          // Espèces, Orange Money, Wave, Carte…
  icon: string;
  /** Conservés pour les bases existantes ; plus exposés dans l'interface,
   *  faute de pouvoir les éprouver sur le matériel visé. */
  opensDrawer: boolean;
  requiresRef: boolean;
  enabled: boolean;
  position: number;
  updatedAt: number;
}

export interface ExpenseCategory {
  id: Uid;
  name: string;
  updatedAt: number;
}

export interface Expense {
  id: Uid;
  categoryId: Uid | null;
  label: string;
  amount: number;
  paymentMethodId: Uid | null;
  note: string | null;
  attachment: string | null;  // photo du reçu
  userId: Uid | null;
  spentAt: number;
  createdAt: number;
  updatedAt: number;
}

/** Journal immuable : chaque mouvement de stock y est ajouté, jamais modifié. */
export type StockReason =
  | 'sale' | 'refund' | 'purchase' | 'adjustment'
  | 'loss' | 'return' | 'inventory' | 'initial';

export interface StockMovement {
  id: Uid;
  productId: Uid;
  delta: number;        // négatif = sortie
  stockAfter: number;
  reason: StockReason;
  orderId: Uid | null;
  note: string | null;
  userId: Uid | null;
  createdAt: number;
}

/** Journal d'audit : tout ce qui est fait, automatique ou manuel, s'y ajoute. */
export interface AuditLog {
  id: Uid;
  entity: string;       // 'product' | 'order' | 'expense' | 'setting'…
  entityId: string;
  action: string;       // 'create' | 'update' | 'delete' | 'backup'…
  before: unknown | null;
  after: unknown | null;
  userId: Uid | null;
  createdAt: number;
}

export type UserRole = 'owner' | 'manager' | 'cashier';

export interface User {
  id: Uid;
  name: string;
  role: UserRole;
  pinHash: string | null;
  /** Question de secours, en clair : elle n'a de valeur que par sa
   *  réponse, et le commerçant doit pouvoir la relire. */
  recoveryQuestion?: string | null;
  /** Réponse attendue, sous forme d'empreinte comme le code. */
  recoveryHash?: string | null;
  avatar: string | null;
  active: boolean;
  updatedAt: number;
}

/**
 * Une imprimante enregistrée. Le commerçant peut en avoir plusieurs : une
 * thermique pour les tickets, une autre pour les étiquettes, une de secours.
 */
export interface Printer {
  id: Uid;
  name: string;                  // « Caisse », « Étiquettes », « Réserve »
  transport: 'relay' | 'bluetooth' | 'usb' | 'network' | 'browser';
  width: 58 | 80;
  /** Bluetooth : identifiant renvoyé par le navigateur, pour reconnecter
   *  sans repasser par le sélecteur quand le navigateur le permet. */
  deviceId: string | null;
  deviceName: string | null;
  /** Réseau : « 192.168.1.50:9100 » et l'adresse du relais. */
  address: string;
  relay: string;
  isDefault: boolean;
  lastUsedAt: number | null;
  updatedAt: number;
}

export interface Backup {
  id: Uid;
  kind: 'auto' | 'manual';
  size: number;
  checksum: string;
  createdAt: number;
}
