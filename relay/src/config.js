/**
 * Réglage retenu du relais : quelle imprimante, quelle largeur.
 *
 * Il est écrit dans le profil de l'utilisateur, pas à côté du
 * programme : sur un poste partagé, chaque session garde son choix, et
 * le dossier d'installation peut être en lecture seule sans que ça
 * gêne.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(process.env.APPDATA || homedir(), 'Gestock');
const FILE = join(DIR, 'relay.json');

const DEFAULTS = { printer: '', width: 58 };

export async function loadConfig() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      printer: typeof parsed.printer === 'string' ? parsed.printer : '',
      width: parsed.width === 80 ? 80 : 58,
    };
  } catch {
    /* Premier démarrage, ou fichier abîmé : on repart des valeurs par
       défaut plutôt que d'empêcher le relais de tourner. */
    return { ...DEFAULTS };
  }
}

export async function saveConfig(cfg) {
  await mkdir(DIR, { recursive: true });
  const clean = {
    printer: String(cfg.printer ?? ''),
    width: cfg.width === 80 ? 80 : 58,
  };
  await writeFile(FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
