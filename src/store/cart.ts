import { create } from 'zustand';
import { db, uid, now } from '../db';
import { applyStockMovement, logAudit } from '../db/audit';
import type { Order, OrderLine, OrderType, Product, Uid } from '../db/schema';

interface CartState {
  lines: OrderLine[];
  type: OrderType;
  customerName: string;
  tableNumber: string;
  discount: number;
  additionalFee: number;
  note: string;

  /** Renvoie false si le stock n'a pas permis d'ajouter la quantité demandée. */
  add: (product: Product, qty?: number) => boolean;
  setQty: (productId: Uid, qty: number, maxStock?: number) => void;
  removeLine: (productId: Uid) => void;
  setLineDiscount: (productId: Uid, discount: number) => void;
  setType: (type: OrderType) => void;
  setField: (field: 'customerName' | 'tableNumber' | 'note', value: string) => void;
  setDiscount: (v: number) => void;
  setFee: (v: number) => void;
  clear: () => void;

  count: () => number;
  subtotal: () => number;
  totals: (taxRate: number) => { subtotal: number; taxAmount: number; total: number };
  checkout: (args: {
    taxRate: number;
    paymentMethodId: Uid | null;
    paidAmount: number;
    userId: Uid | null;
  }) => Promise<Order>;
}

const EMPTY = {
  lines: [] as OrderLine[],
  type: 'takeaway' as OrderType,
  customerName: '',
  tableNumber: '',
  discount: 0,
  additionalFee: 0,
  note: '',
};

/** Numéro de ticket lisible : #GS + date compacte + compteur du jour. */
async function nextRef(): Promise<string> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayCount = await db.orders.where('createdAt').above(start.getTime()).count();
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `#GS${stamp}-${String(todayCount + 1).padStart(3, '0')}`;
}

export const useCart = create<CartState>((set, get) => ({
  ...EMPTY,

  /**
   * Ajoute un article, sans jamais dépasser le stock disponible.
   *
   * Sans ce plafond, on pouvait mettre quatre unités d'un produit qui n'en
   * avait que deux : la vente passait et le stock tombait à −2. Un stock
   * négatif n'existe pas dans une boutique, il signale seulement qu'on a
   * vendu ce qu'on n'avait pas.
   *
   * Renvoie `false` quand la demande a été refusée ou rabotée, pour que
   * l'appelant puisse le signaler à l'écran.
   */
  add: (product, qty = 1) => {
    const lines = [...get().lines];
    const existing = lines.find((l) => l.productId === product.id);
    const inCart = existing?.qty ?? 0;
    const room = product.stock - inCart;

    if (room <= 0) return false;

    const added = Math.min(qty, room);

    if (existing) {
      existing.qty += added;
    } else {
      lines.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        unitCost: product.cost,
        qty: added,
        discount: 0,
      });
    }
    set({ lines });
    return added === qty;
  },

  /** Fixe la quantité d'une ligne, dans la limite du stock. */
  setQty: (productId, qty, maxStock) => {
    if (qty <= 0) return get().removeLine(productId);
    const capped = maxStock === undefined ? qty : Math.min(qty, maxStock);
    set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, qty: capped } : l)) });
  },

  removeLine: (productId) =>
    set({ lines: get().lines.filter((l) => l.productId !== productId) }),

  setLineDiscount: (productId, discount) =>
    set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, discount } : l)) }),

  setType: (type) => set({ type }),
  setField: (field, value) => set({ [field]: value } as Partial<CartState>),
  setDiscount: (discount) => set({ discount }),
  setFee: (additionalFee) => set({ additionalFee }),
  clear: () => set({ ...EMPTY }),

  count: () => get().lines.reduce((s, l) => s + l.qty, 0),

  subtotal: () => get().lines.reduce((s, l) => s + l.unitPrice * l.qty - l.discount, 0),

  totals: (taxRate) => {
    const s = get();
    const subtotal = s.subtotal();
    const taxable = Math.max(0, subtotal - s.discount);
    const taxAmount = Math.round((taxable * taxRate) / 100);
    return { subtotal, taxAmount, total: taxable + taxAmount + s.additionalFee };
  },

  /**
   * Encaissement. La vente, la sortie de stock et le journal sont écrits
   * ensemble : si l'un échoue, rien n'est enregistré et le panier reste
   * intact — mieux vaut refaire la saisie qu'avoir un stock faux.
   */
  checkout: async ({ taxRate, paymentMethodId, paidAmount, userId }) => {
    const s = get();
    if (s.lines.length === 0) throw new Error('EMPTY_CART');

    // Dernier verrou avant écriture : le stock a pu changer depuis que
    // l'article a été mis au panier, sur un autre poste ou par un
    // ajustement. Mieux vaut refuser la vente que fausser le stock.
    for (const line of s.lines) {
      const p = await db.products.get(line.productId);
      if (!p) throw new Error('PRODUCT_GONE');
      if (p.stock < line.qty) throw new Error('OUT_OF_STOCK');
    }

    const { subtotal, taxAmount, total } = s.totals(taxRate);
    const ref = await nextRef();
    const ts = now();

    const order: Order = {
      id: uid(),
      ref,
      type: s.type,
      status: 'paid',
      customerName: s.customerName || null,
      tableNumber: s.tableNumber || null,
      lines: s.lines,
      subtotal,
      taxRate,
      taxAmount,
      discount: s.discount,
      additionalFee: s.additionalFee,
      total,
      paymentMethodId,
      paidAmount,
      changeAmount: Math.max(0, paidAmount - total),
      note: s.note || null,
      userId,
      createdAt: ts,
      closedAt: ts,
      updatedAt: ts,
    };

    await db.transaction(
      'rw',
      db.orders, db.products, db.stockMovements, db.auditLogs,
      async () => {
        await db.orders.add(order);
        for (const line of order.lines) {
          await applyStockMovement({
            productId: line.productId,
            delta: -line.qty,
            reason: 'sale',
            orderId: order.id,
            userId,
          });
        }
        await logAudit({
          entity: 'order', entityId: order.id, action: 'create',
          after: { ref, total }, userId,
        });

        // Une remise est une décision commerciale : elle doit se retrouver
        // dans le journal, séparément de la vente, pour qu'on puisse la
        // relire plus tard sans rouvrir chaque ticket.
        if (s.discount > 0) {
          await logAudit({
            entity: 'discount', entityId: order.id, action: 'create',
            after: {
              // Le contenu de la vente, pas sa référence : « #GS2009-008 »
              // n'apprend rien quand on relit le journal.
              name: s.lines.map((l) => `${l.qty} × ${l.name}`).join(', '),
              ref,
              amount: s.discount,
              subtotal,
            },
            userId,
          });
        }
      },
    );

    set({ ...EMPTY });
    return order;
  },
}));
