import { db } from '../db';
import type { Order, Uid } from '../db/schema';

export type Period =
  | 'today' | 'yesterday'
  | 'week' | 'lastWeek'
  | 'month' | 'year' | 'custom';

export interface Range { from: number; to: number }

/** Bornes d'une période. La semaine commence le lundi. */
export function rangeOf(period: Period, ref = new Date()): Range {
  const from = new Date(ref);
  from.setHours(0, 0, 0, 0);

  const to = new Date(ref);
  to.setHours(23, 59, 59, 999);

  /** Lundi de la semaine contenant cette date. */
  const toMonday = (d: Date) => {
    const dow = (d.getDay() + 6) % 7;  // lundi = 0
    d.setDate(d.getDate() - dow);
    return d;
  };

  switch (period) {
    case 'today':
      break;

    // Les périodes révolues ont aussi leur borne de fin décalée : « hier »
    // se termine hier soir, pas ce soir. Sans cela, elles engloberaient la
    // journée en cours et ne serviraient à rien.
    case 'yesterday':
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      to.setHours(23, 59, 59, 999);
      break;

    case 'week':
      toMonday(from);
      break;

    case 'lastWeek': {
      toMonday(from);
      from.setDate(from.getDate() - 7);
      // Dimanche soir de cette semaine-là.
      to.setTime(from.getTime());
      to.setDate(to.getDate() + 6);
      to.setHours(23, 59, 59, 999);
      break;
    }

    case 'month':
      from.setDate(1);
      break;

    case 'year':
      from.setMonth(0, 1);
      break;

    case 'custom':
      break;
  }

  return { from: from.getTime(), to: to.getTime() };
}

export interface Summary {
  revenue: number;       // chiffre d'affaires encaissé
  cost: number;          // coût des marchandises vendues
  profit: number;        // marge brute moins les dépenses
  grossMargin: number;   // revenue - cost
  expenses: number;
  /** Remises accordées : de l'argent que la boutique a choisi de ne pas
   *  encaisser. Sans ce chiffre, on ne voit pas ce qu'elles coûtent. */
  discounts: number;
  discountCount: number;
  ordersCount: number;
  itemsSold: number;
  avgBasket: number;
  byPaymentMethod: Record<Uid, { count: number; amount: number }>;
  byHour: number[];      // 24 cases, chiffre d'affaires par heure
}

/** Chiffres d'une période. Les ventes annulées et remboursées sont exclues. */
export async function summarize(range: Range): Promise<Summary> {
  const orders = await db.orders
    .where('createdAt').between(range.from, range.to, true, true)
    .filter((o) => o.status === 'paid')
    .toArray();

  const expenseRows = await db.expenses
    .where('spentAt').between(range.from, range.to, true, true)
    .toArray();

  const byPaymentMethod: Summary['byPaymentMethod'] = {};
  const byHour = new Array(24).fill(0);

  let revenue = 0;
  let cost = 0;
  let itemsSold = 0;
  let discounts = 0;
  let discountCount = 0;

  for (const o of orders) {
    revenue += o.total;

    // Remise globale, plus celles posées ligne par ligne.
    const lineDiscounts = o.lines.reduce((sum, l) => sum + l.discount, 0);
    const given = o.discount + lineDiscounts;
    if (given > 0) { discounts += given; discountCount += 1; }

    byHour[new Date(o.createdAt).getHours()] += o.total;
    for (const l of o.lines) {
      cost += l.unitCost * l.qty;
      itemsSold += l.qty;
    }
    if (o.paymentMethodId) {
      const slot = byPaymentMethod[o.paymentMethodId] ?? { count: 0, amount: 0 };
      slot.count += 1;
      slot.amount += o.total;
      byPaymentMethod[o.paymentMethodId] = slot;
    }
  }

  const expenses = expenseRows.reduce((s, e) => s + e.amount, 0);
  const grossMargin = revenue - cost;

  return {
    revenue,
    cost,
    grossMargin,
    profit: grossMargin - expenses,
    expenses,
    discounts,
    discountCount,
    ordersCount: orders.length,
    itemsSold,
    avgBasket: orders.length ? Math.round(revenue / orders.length) : 0,
    byPaymentMethod,
    byHour,
  };
}

export interface TopProduct {
  productId: Uid;
  name: string;
  qty: number;
  revenue: number;
}

export async function topProducts(range: Range, limit = 10): Promise<TopProduct[]> {
  const orders = await db.orders
    .where('createdAt').between(range.from, range.to, true, true)
    .filter((o) => o.status === 'paid')
    .toArray();

  // Un produit archivé a bien été vendu : il reste dans le classement,
  // sinon le chiffre d'affaires ne correspondrait plus à la somme des
  // lignes affichées.
  const map = new Map<Uid, TopProduct>();
  for (const o of orders) {
    for (const l of o.lines) {
      const cur = map.get(l.productId) ?? { productId: l.productId, name: l.name, qty: 0, revenue: 0 };
      cur.qty += l.qty;
      cur.revenue += l.unitPrice * l.qty - l.discount;
      map.set(l.productId, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/** Série pour un graphique : un point par jour (ou par heure sur un jour). */
export async function series(range: Range): Promise<{ label: string; value: number }[]> {
  const orders = await db.orders
    .where('createdAt').between(range.from, range.to, true, true)
    .filter((o) => o.status === 'paid')
    .toArray();

  const oneDay = 24 * 3600 * 1000;
  const byHour = range.to - range.from <= oneDay;
  const buckets = new Map<string, number>();

  for (const o of orders) {
    const d = new Date(o.createdAt);
    const key = byHour
      ? `${String(d.getHours()).padStart(2, '0')}h`
      : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) ?? 0) + o.total);
  }

  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

/** Ventes récentes, pour le bandeau du haut de la caisse. */
export async function recentOrders(limit = 8): Promise<Order[]> {
  return db.orders.orderBy('createdAt').reverse().limit(limit).toArray();
}
