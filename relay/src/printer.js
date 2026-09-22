/**
 * Choix du chemin d'impression selon le système.
 *
 * Windows passe par un pont vers son gestionnaire d'impression ; macOS
 * et Linux par CUPS, qu'ils partagent. Le serveur ne voit que les deux
 * fonctions ci-dessous et ignore laquelle des deux implémentations
 * travaille pour lui.
 *
 * Le module est chargé à la demande : importer le code Windows sur un
 * Mac ne casserait rien, mais autant ne pas le lire du tout.
 */

const WINDOWS = process.platform === 'win32';

const backend = WINDOWS
  ? await import('./printer_windows.js')
  : await import('./printer_unix.js');

/** Imprimantes déclarées sur le poste. */
export const listPrinters = backend.listPrinters;

/** Envoie des octets ESC/POS à l'une d'elles. */
export const sendRaw = backend.sendRaw;

/** Nom du système, pour que l'application adapte ce qu'elle explique. */
export const platform = WINDOWS ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
