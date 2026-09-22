/**
 * Clés de licence.
 *
 * ## Ce que ce fichier protège, et ce qu'il ne protège pas
 *
 * Une application web livre son code au poste qui l'exécute. Qui
 * l'obtient peut le lire et le modifier : aucune vérification écrite
 * ici n'est infranchissable, et prétendre le contraire serait faux.
 *
 * Ce qui est visé est plus modeste et plus utile : qu'un commerçant ne
 * puisse pas donner une copie utilisable à son voisin, et que retirer
 * la protection demande un travail dépassant le prix du logiciel.
 *
 * ## Comment
 *
 * Les clés sont tirées au hasard, pas calculées : il n'y a donc aucune
 * règle à deviner dans leur forme. L'application embarque leurs
 * empreintes, jamais les clés elles-mêmes — ouvrir le fichier ne donne
 * pas une liste de licences utilisables.
 *
 * Et la clé ne sert pas qu'à dire oui ou non : son sceau est
 * enregistré et relu ailleurs, à d'autres moments. Retirer la
 * vérification d'entrée ne suffit donc pas.
 */

import { EMPREINTES } from './cles';

/** Signes des clés : ni I, ni O, ni lettres qu'on confond en recopiant. */
const SIGNES = '0123456789ABCDEFGHJKLMNPQRSTUVWXY';

/** Vingt signes, présentés en quatre groupes de cinq. */
const LONGUEUR = 20;


/**
 * Ramène une saisie à sa forme comparable : sans tirets ni espaces.
 *
 * Le préfixe « GS » n'est retiré que s'il est bien un préfixe, c'est
 * à dire si ce qui suit fait la bonne longueur. Le retirer
 * systématiquement amputait les clés dont les deux premiers signes
 * sont justement G et S.
 */
function normaliser(saisie: string): string {
  const brut = saisie.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return brut.length === LONGUEUR + 2 && brut.startsWith('GS')
    ? brut.slice(2)
    : brut;
}

/** Empreinte d'une clé — même calcul que l'outil de génération. */
export async function empreinte(cle: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`gestock-key:GS${normaliser(cle)}`),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Cette clé est-elle valide ?
 *
 * La distinction entre « mal recopiée » et « inventée » n'est pas
 * faite : qui essaie d'en deviner une n'apprend rien de plus qu'un
 * refus.
 */
export async function licenceValide(saisie: string): Promise<boolean> {
  const propre = normaliser(saisie);
  if (propre.length !== LONGUEUR) return false;
  if ([...propre].some((c) => !SIGNES.includes(c))) return false;

  return EMPREINTES.has(await empreinte(saisie));
}

/** Présentation d'une clé, par groupes de cinq. */
export function formater(saisie: string): string {
  const p = normaliser(saisie).slice(0, LONGUEUR);
  return p ? `GS-${(p.match(/.{1,5}/g) ?? []).join('-')}` : '';
}

/**
 * Sceau enregistré avec les données.
 *
 * Seconde ligne de défense : l'application le relit ailleurs, et il
 * ne correspond que si une vraie clé a été saisie. Retirer le
 * contrôle d'entrée laisse donc ce sceau faux.
 */
export async function sceau(cle: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`gestock-seal:${normaliser(cle)}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ *
   Enregistrement de la licence
 * ------------------------------------------------------------------ */

const CLE_STOCKAGE = 'gestock.lic';
const CLE_SCEAU = 'gestock.s';

/**
 * Enregistre la licence après une saisie valide.
 *
 * Deux traces plutôt qu'une : la clé, et son sceau. Elles sont
 * relues séparément, à des moments différents — effacer l'une laisse
 * l'autre en défaut.
 */
export async function enregistrerLicence(cle: string): Promise<void> {
  const propre = normaliser(cle);
  try {
    localStorage.setItem(CLE_STOCKAGE, propre);
    localStorage.setItem(CLE_SCEAU, await sceau(cle));
  } catch {
    /* Stockage refusé — navigation privée, par exemple. L'application
       fonctionne pour cette session, la clé sera redemandée ensuite. */
  }
}

/** Efface la licence enregistrée : le poste redevient à activer. */
export function oublierLicence(): void {
  try {
    localStorage.removeItem(CLE_STOCKAGE);
    localStorage.removeItem(CLE_SCEAU);
    localStorage.removeItem(CLE_ETAT);
  } catch { /* sans conséquence */ }
}

/** La clé enregistrée, telle quelle. */
export function licenceEnregistree(): string {
  try {
    return localStorage.getItem(CLE_STOCKAGE) ?? '';
  } catch {
    return '';
  }
}

/**
 * L'installation est-elle en règle ?
 *
 * Trois conditions : une clé est enregistrée, elle figure parmi les
 * licences émises, et son sceau correspond. Falsifier l'une des trois
 * ne suffit pas.
 */
export async function installationValide(): Promise<boolean> {
  const cle = licenceEnregistree();
  if (!cle) return false;

  let sceauLu = '';
  try {
    sceauLu = localStorage.getItem(CLE_SCEAU) ?? '';
  } catch {
    return false;
  }
  if (sceauLu !== await sceau(cle)) return false;

  return licenceValide(cle);
}

/* ------------------------------------------------------------------ *
   Contrôle auprès du serveur

   L'application ne dépend jamais du réseau pour fonctionner : la clé
   débloque l'installation sur-le-champ. Le serveur sert à repérer
   qu'une même clé tourne sur plusieurs postes, ce qu'aucun contrôle
   local ne peut voir.

   Le contact se fait quand une connexion se présente, pas à un
   moment imposé. Sans réseau, il n'y a ni attente ni blocage.
 * ------------------------------------------------------------------ */

/** Adresse du service de licences. */
const SERVEUR = 'https://licenses.digitauras.store/activer.php';

const CLE_POSTE = 'gestock.p';
const CLE_ETAT = 'gestock.e';
const CLE_DERNIER = 'gestock.d';

/**
 * Empreinte de cette installation.
 *
 * Tirée au hasard à la première ouverture, puis conservée. Elle ne
 * dit rien de la personne ni de la machine : elle sert seulement à
 * distinguer deux installations d'une même clé.
 */
export function empreintePoste(): string {
  try {
    const connue = localStorage.getItem(CLE_POSTE);
    if (connue && connue.length === 32) return connue;

    const octets = crypto.getRandomValues(new Uint8Array(16));
    const neuve = [...octets].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(CLE_POSTE, neuve);
    return neuve;
  } catch {
    /* Stockage refusé : une empreinte de session, qui changera au
       prochain démarrage. Le poste apparaîtra plusieurs fois côté
       serveur, ce qui vaut mieux que de bloquer. */
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export type EtatLicence = 'ok' | 'prise' | 'inconnue' | 'revoquee' | 'inconnu';

/** Dernier verdict connu du serveur. « inconnu » tant qu'il n'a pas répondu. */
export function etatConnu(): EtatLicence {
  try {
    const v = localStorage.getItem(CLE_ETAT);
    return v === 'ok' || v === 'prise' || v === 'inconnue' || v === 'revoquee'
      ? v : 'inconnu';
  } catch {
    return 'inconnu';
  }
}

/**
 * Signale la clé au serveur, si une connexion le permet.
 *
 * N'échoue jamais bruyamment : sans réseau, la fonction rend
 * l'ancien verdict et l'application continue. C'est ce qui garantit
 * qu'une caisse ne s'arrête pas parce qu'internet est coupé.
 */
export async function controlerAupresDuServeur(
  boutique = '',
): Promise<EtatLicence> {
  const cle = licenceEnregistree();
  if (!cle) return 'inconnu';

  try {
    const res = await fetch(SERVEUR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cle, poste: empreintePoste(), boutique }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return etatConnu();

    const corps = await res.json();
    const etat: EtatLicence =
      corps?.etat === 'ok' || corps?.etat === 'prise'
      || corps?.etat === 'inconnue' || corps?.etat === 'revoquee'
        ? corps.etat : 'inconnu';

    // Une panne du serveur ne doit pas effacer un verdict favorable.
    if (etat === 'inconnu') return etatConnu();

    try {
      localStorage.setItem(CLE_ETAT, etat);
      localStorage.setItem(CLE_DERNIER, String(Date.now()));
    } catch { /* sans conséquence */ }

    return etat;
  } catch {
    // Hors ligne, serveur muet, délai dépassé : on garde le verdict
    // précédent et on réessaiera.
    return etatConnu();
  }
}
