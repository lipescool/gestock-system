/**
 * Code d'accès de la caisse.
 *
 * Le code protège la caisse d'un curieux, pas d'un attaquant : la base
 * est sur le poste, qui l'ouvre peut la lire. L'empreinte évite
 * simplement qu'un code se lise en clair dans une sauvegarde ou par
 * dessus l'épaule.
 */

import { db } from '../db';
import type { User } from '../db/schema';

/** Le code n'est jamais stocké en clair, même sur une base locale. */
export async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`gestock:${pin}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cherche l'utilisateur dont le code correspond.
 *
 * On compare à tous les comptes plutôt qu'à un seul : le commerçant
 * n'a pas à dire qui il est avant de composer, son code l'identifie.
 */
export async function findUserByPin(pin: string): Promise<User | null> {
  const empreinte = await hashPin(pin);
  const users = await db.users.filter((u) => u.active).toArray();
  return users.find((u) => u.pinHash === empreinte) ?? null;
}

/** La caisse est-elle protégée ? Sans code défini, elle s'ouvre seule. */
export async function pinRequired(): Promise<boolean> {
  const users = await db.users.filter((u) => u.active).toArray();
  return users.some((u) => u.pinHash);
}

/* ------------------------------------------------------------------ *
   Récupération d'un code oublié.

   Sans serveur ni adresse électronique, il n'y a pas de lien de
   réinitialisation à envoyer. Une question choisie par le commerçant
   est la seule issue qui ne dépende de rien d'extérieur.

   La protection en sort affaiblie — une réponse devinable ouvre la
   caisse — mais le risque réel ici est l'oubli, pas l'intrusion :
   qui a le poste entre les mains peut de toute façon lire la base.
   Mieux vaut une protection dont on sort qu'une qui enferme.
 * ------------------------------------------------------------------ */

/** La réponse est comparée sans tenir compte de la casse ni des
 *  espaces : « Awa » et « awa  » sont la même réponse. */
function normaliser(reponse: string): string {
  return reponse.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function hashAnswer(reponse: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`gestock-recovery:${normaliser(reponse)}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** La question posée au commerçant, s'il en a défini une. */
export async function recoveryQuestion(): Promise<string | null> {
  const users = await db.users.filter((u) => u.active).toArray();
  const avec = users.find((u) => u.pinHash && u.recoveryQuestion && u.recoveryHash);
  return avec?.recoveryQuestion ?? null;
}

/**
 * Vérifie la réponse et, si elle est juste, efface le code.
 *
 * Le code est retiré de tous les comptes : en laisser un suffirait à
 * garder la caisse fermée. Le commerçant en choisit un nouveau
 * ensuite, dans les réglages.
 */
export async function recoverWithAnswer(reponse: string): Promise<boolean> {
  const empreinte = await hashAnswer(reponse);
  const users = await db.users.filter((u) => u.active).toArray();
  const cible = users.find((u) => u.recoveryHash === empreinte);
  if (!cible) return false;

  for (const u of users.filter((x) => x.pinHash)) {
    await db.users.update(u.id, { pinHash: null, updatedAt: Date.now() });
  }
  clearFailures();
  return true;
}

/* ------------------------------------------------------------------ *
   Temporisation après plusieurs échecs.

   Sans elle, on peut essayer les dix mille codes à quatre chiffres en
   quelques minutes. Le délai croît avec les tentatives, et reste
   enregistré : fermer l'application ne le remet pas à zéro.
 * ------------------------------------------------------------------ */

const CLE_ECHECS = 'gestock.pinFails';
const CLE_JUSQUA = 'gestock.pinLockedUntil';

/** Nombre d'essais avant la première attente. */
const AVANT_BLOCAGE = 3;

/** Millisecondes restant avant de pouvoir réessayer. */
export function lockRemaining(): number {
  try {
    const jusqua = Number(localStorage.getItem(CLE_JUSQUA) ?? 0);
    return Math.max(0, jusqua - Date.now());
  } catch {
    // Navigation privée ou stockage refusé : on n'empêche pas d'entrer.
    return 0;
  }
}

export function recordFailure(): number {
  try {
    const n = Number(localStorage.getItem(CLE_ECHECS) ?? 0) + 1;
    localStorage.setItem(CLE_ECHECS, String(n));

    if (n >= AVANT_BLOCAGE) {
      // 5 s, 15 s, 45 s… plafonné à cinq minutes : assez long pour
      // décourager, assez court pour qu'une faute de frappe ne bloque
      // pas la caisse un jour de marché.
      const attente = Math.min(5000 * 3 ** (n - AVANT_BLOCAGE), 300_000);
      localStorage.setItem(CLE_JUSQUA, String(Date.now() + attente));
      return attente;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function clearFailures(): void {
  try {
    localStorage.removeItem(CLE_ECHECS);
    localStorage.removeItem(CLE_JUSQUA);
  } catch { /* sans conséquence */ }
}
