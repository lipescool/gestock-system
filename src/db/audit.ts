import { db, uid, now } from './index';
import type { StockReason, Uid } from './schema';

/**
 * Journal d'audit. Chaque écriture métier passe par ici : rien n'est modifié
 * en base sans qu'une ligne s'ajoute. Le journal n'est jamais réécrit, on
 * n'y fait qu'ajouter — c'est ce qui rend l'historique fiable.
 */
export async function logAudit(params: {
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  userId?: Uid | null;
}): Promise<void> {
  await db.auditLogs.add({
    id: uid(),
    entity: params.entity,
    entityId: params.entityId,
    action: params.action,
    before: params.before ?? null,
    after: params.after ?? null,
    userId: params.userId ?? null,
    createdAt: now(),
  });
}

/**
 * Applique un mouvement de stock et l'enregistre.
 * Le stock du produit et le journal bougent dans la même transaction :
 * les deux réussissent ou aucun des deux.
 */
export async function applyStockMovement(params: {
  productId: Uid;
  delta: number;
  reason: StockReason;
  orderId?: Uid | null;
  note?: string | null;
  userId?: Uid | null;
}): Promise<number> {
  return db.transaction('rw', db.products, db.stockMovements, db.auditLogs, async () => {
    const product = await db.products.get(params.productId);
    if (!product) throw new Error(`Produit introuvable : ${params.productId}`);

    const stockAfter = product.stock + params.delta;
    await db.products.update(params.productId, { stock: stockAfter, updatedAt: now() });

    await db.stockMovements.add({
      id: uid(),
      productId: params.productId,
      delta: params.delta,
      stockAfter,
      reason: params.reason,
      orderId: params.orderId ?? null,
      note: params.note ?? null,
      userId: params.userId ?? null,
      createdAt: now(),
    });

    await logAudit({
      entity: 'stock',
      entityId: params.productId,
      action: params.reason,
      before: { name: product.name, stock: product.stock },
      after: { name: product.name, stock: stockAfter },
      userId: params.userId ?? null,
    });

    return stockAfter;
  });
}
