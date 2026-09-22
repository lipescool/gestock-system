import Dexie, { type Table } from 'dexie';
import type {
  Setting, Translation, Category, Product, Order, PaymentMethod,
  ExpenseCategory, Expense, StockMovement, AuditLog, User, Backup, Printer,
} from './schema';

export class GestockDB extends Dexie {
  settings!: Table<Setting, string>;
  translations!: Table<Translation, number>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  orders!: Table<Order, string>;
  paymentMethods!: Table<PaymentMethod, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  expenses!: Table<Expense, string>;
  stockMovements!: Table<StockMovement, string>;
  auditLogs!: Table<AuditLog, string>;
  users!: Table<User, string>;
  backups!: Table<Backup, string>;
  printers!: Table<Printer, string>;

  constructor() {
    super('gestock');
    this.version(1).stores({
      settings: 'key',
      translations: '++id, [lang+key], lang, key',
      categories: 'id, position, archived',
      products: 'id, categoryId, barcode, sku, name, archived, stock',
      orders: 'id, ref, status, type, createdAt, closedAt, paymentMethodId',
      paymentMethods: 'id, position, enabled',
      expenseCategories: 'id',
      expenses: 'id, categoryId, spentAt, paymentMethodId',
      stockMovements: 'id, productId, createdAt, reason, orderId',
      auditLogs: 'id, entity, entityId, createdAt, action',
      users: 'id, role, active',
      backups: 'id, createdAt, kind',
    });

    // Version 2 : les imprimantes sont enregistrées plutôt que reconfigurées
    // à chaque ouverture. Dexie conserve les données existantes.
    this.version(2).stores({
      printers: 'id, isDefault, lastUsedAt',
    });
  }
}

export const db = new GestockDB();

export const uid = (): string =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const now = (): number => Date.now();

/**
 * Tableau vide partagé, pour les valeurs de repli des requêtes.
 *
 * `useLiveQuery(...) ?? []` crée un nouveau tableau à chaque rendu. Utilisé
 * dans une dépendance de `useEffect` ou de `useMemo`, il les relance
 * indéfiniment : c'est ce qui faisait clignoter les écrans pendant le
 * chargement. Une référence constante règle le problème.
 */
const FROZEN: never[] = Object.freeze([]) as never[];

/**
 * Renvoie le tableau vide partagé, typé comme la requête l'attend.
 *
 * Une constante `readonly` obligeait chaque appelant à une conversion ;
 * une fonction générique rend le type sans détour, tout en renvoyant
 * toujours la même référence.
 */
export const EMPTY = <T>(): T[] => FROZEN as unknown as T[];

/** Même rôle que `EMPTY`, pour les requêtes qui renvoient un objet. */
export const EMPTY_MAP: Readonly<Record<string, never>> = Object.freeze({});
