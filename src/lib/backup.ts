import { db, uid, now } from '../db';
import { logAudit } from '../db/audit';

const FORMAT_VERSION = 1;

interface BackupFile {
  format: number;
  app: 'gestock';
  createdAt: number;
  tables: Record<string, unknown[]>;
}

const TABLES = [
  'settings', 'translations', 'categories', 'products', 'orders',
  'paymentMethods', 'expenseCategories', 'expenses',
  'stockMovements', 'auditLogs', 'users',
] as const;

/** Somme de contrôle : détecte un fichier tronqué ou modifié à la main. */
async function checksum(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function exportBackup(): Promise<{ json: string; checksum: string }> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    tables[name] = await (db as never as Record<string, { toArray(): Promise<unknown[]> }>)[name].toArray();
  }
  const payload: BackupFile = { format: FORMAT_VERSION, app: 'gestock', createdAt: now(), tables };
  const json = JSON.stringify(payload);
  return { json, checksum: await checksum(json) };
}

/** Déclenche le téléchargement du fichier et journalise l'opération. */
export async function downloadBackup(kind: 'auto' | 'manual', shopName = 'gestock'): Promise<void> {
  const { json, checksum: sum } = await exportBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const slug = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gestock';
  const name = `${slug}-${stamp}.gestock.json`;

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);

  const id = uid();
  await db.backups.add({ id, kind, size: blob.size, checksum: sum, createdAt: now() });
  await logAudit({ entity: 'backup', entityId: id, action: kind, after: { name, size: blob.size } });
}

export interface RestoreResult { tables: Record<string, number>; createdAt: number }

/**
 * Restauration. La base est vidée puis réécrite dans une seule transaction :
 * un échec en cours de route laisse les données d'origine en place.
 */
export async function importBackup(json: string): Promise<RestoreResult> {
  const parsed = JSON.parse(json) as BackupFile;
  if (parsed.app !== 'gestock') throw new Error('NOT_A_GESTOCK_BACKUP');
  if (parsed.format > FORMAT_VERSION) throw new Error('BACKUP_TOO_RECENT');

  const counts: Record<string, number> = {};

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLES) {
      const rows = parsed.tables[name];
      if (!Array.isArray(rows)) continue;
      const table = (db as never as Record<string, {
        clear(): Promise<void>; bulkAdd(r: unknown[]): Promise<unknown>;
      }>)[name];
      await table.clear();
      if (rows.length) await table.bulkAdd(rows);
      counts[name] = rows.length;
    }
  });

  await logAudit({ entity: 'backup', entityId: 'restore', action: 'restore', after: counts });
  return { tables: counts, createdAt: parsed.createdAt };
}

/* -------------------------------------------------------------------------
   Sauvegarde automatique à heure fixe.
   Un navigateur ne peut pas se réveiller seul quand l'onglet est fermé :
   la sauvegarde part dès que l'application est ouverte après l'heure prévue,
   et une seule fois par jour. C'est la limite honnête du support navigateur.
   ------------------------------------------------------------------------- */

const LAST_KEY = 'gestock.lastAutoBackup';

export function shouldRunAutoBackup(timeHHmm: string, ref = new Date()): boolean {
  const [h, m] = timeHHmm.split(':').map(Number);
  const due = new Date(ref);
  due.setHours(h ?? 22, m ?? 0, 0, 0);
  if (ref < due) return false;

  const last = localStorage.getItem(LAST_KEY);
  return last !== ref.toDateString();
}

export function markAutoBackupDone(ref = new Date()): void {
  localStorage.setItem(LAST_KEY, ref.toDateString());
}

/** Vérifie l'échéance toutes les cinq minutes tant que l'application tourne. */
export function startAutoBackupWatcher(
  getConfig: () => { enabled: boolean; time: string; shopName: string },
): () => void {
  const tick = async () => {
    const { enabled, time, shopName } = getConfig();
    if (!enabled || !shouldRunAutoBackup(time)) return;
    try {
      await downloadBackup('auto', shopName);
      markAutoBackupDone();
    } catch {
      // Le navigateur a pu refuser le téléchargement (onglet en arrière-plan).
      // On réessaiera au prochain passage plutôt que d'interrompre la caisse.
    }
  };

  void tick();
  const id = window.setInterval(tick, 5 * 60 * 1000);
  return () => window.clearInterval(id);
}
