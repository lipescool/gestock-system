/**
 * Accès aux imprimantes sur macOS et Linux.
 *
 * Les deux systèmes partagent CUPS, le même gestionnaire d'impression :
 * `lpstat` énumère les files, `lp` leur envoie un travail. C'est plus
 * direct que sous Windows, où il faut passer par un pont vers l'API du
 * système.
 *
 * Le type de données « raw » est ici aussi la clé : sans lui, CUPS
 * convertirait l'ESC/POS en PostScript et l'imprimante recevrait autre
 * chose que ce qu'on a construit.
 *
 * ATTENTION : ce fichier n'a pas été éprouvé sur un Mac. Il suit la
 * documentation de CUPS et l'usage courant de `lp`, mais le premier
 * poste qui s'en servira le mettra à l'épreuve pour de bon.
 */

import { spawn } from 'node:child_process';

/** Exécute une commande et rend sa sortie standard. */
function run(cmd, args, input = null) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);

    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'CUPS_ABSENT' : e.message)));
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim() || `EXIT_${code}`));
      else resolve(out);
    });

    if (input) {
      p.stdin.write(input);
      p.stdin.end();
    } else {
      p.stdin.end();
    }
  });
}

/**
 * Imprimantes déclarées dans CUPS.
 *
 * `lpstat -l -p` décrit chaque file sur plusieurs lignes ; seule la
 * première porte le nom, les suivantes son état et sa description.
 */
export async function listPrinters() {
  let brut;
  try {
    brut = await run('lpstat', ['-l', '-p']);
  } catch (e) {
    // Aucune imprimante installée fait sortir lpstat en erreur : c'est
    // une liste vide, pas une panne.
    if (e.message === 'CUPS_ABSENT') throw e;
    return [];
  }

  const sorties = [];
  let courante = null;

  for (const ligne of brut.split('\n')) {
    const entete = ligne.match(/^(?:printer|imprimante)\s+(\S+)/i);
    if (entete) {
      if (courante) sorties.push(courante);
      courante = { name: entete[1], driver: '', port: '', raw: false };
      continue;
    }
    // La description porte le modèle : c'est elle qui trahit une
    // imprimante à tickets.
    const desc = ligne.match(/^\s+Description:\s*(.+)$/i);
    if (desc && courante) courante.driver = desc[1].trim();
    const conn = ligne.match(/^\s+Connection:\s*(.+)$/i);
    if (conn && courante) courante.port = conn[1].trim();
  }
  if (courante) sorties.push(courante);

  /* Sous Windows, le pilote « Generic / Text Only » signale une file
     capable d'ESC/POS. CUPS n'a pas d'équivalent aussi net : on repère
     les pilotes bruts et les modèles thermiques les plus répandus, en
     sachant que la liste restera incomplète. */
  const THERMIQUE = /raw|generic|text|thermal|pos[-\s]?\d|receipt|ticket|escpos|esc\/pos/i;

  return sorties.map((p) => ({
    ...p,
    raw: THERMIQUE.test(p.driver) || THERMIQUE.test(p.name),
  }));
}

/**
 * Envoie les octets bruts à une file CUPS.
 *
 * L'option `-o raw` est indispensable : sans elle, CUPS interprète le
 * contenu et le convertit. `-o document-format=application/vnd.cups-raw`
 * dit la même chose aux versions qui ignorent la forme courte.
 */
export async function sendRaw(printerName, data) {
  try {
    const sortie = await run('lp', [
      '-d', String(printerName),
      '-o', 'raw',
      '-o', 'document-format=application/vnd.cups-raw',
      '-t', 'Gestock',
    ], Buffer.from(data));

    /* `lp` rend « request id is FILE-123 (1 file(s)) » : la présence
       d'un identifiant est la seule confirmation qu'il donne. */
    const accepte = /request id is/i.test(sortie);
    return accepte
      ? { ok: true, bytes: data.length }
      : { ok: false, error: sortie.trim() || 'LP_NO_JOB_ID' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'LP_FAILED';
    return { ok: false, error: msg === 'CUPS_ABSENT' ? 'CUPS_ABSENT' : msg };
  }
}
