/**
 * Mémoire des calculs déjà faits.
 *
 * Les chiffres du tableau de bord et de la caisse se recalculaient à
 * chaque passage sur l'écran, même sans une vente de plus : le
 * composant est recréé à la navigation, son état repart à zéro, et
 * tout est relu. Sur un catalogue fourni, l'écran apparaît vide une
 * fraction de seconde avant de se remplir — c'est ce clignotement que
 * le commerçant voit à chaque aller-retour.
 *
 * Le cache vit hors de React, donc il survit au démontage des écrans.
 * Il n'est pas écrit sur le disque : ces valeurs se recalculent en
 * quelques millisecondes, les garder d'une session à l'autre
 * risquerait d'afficher des chiffres périmés au démarrage.
 */

interface Entree<T> {
  valeur: T;
  /** Empreinte de l'état de la base au moment du calcul. */
  version: string;
}

const memoire = new Map<string, Entree<unknown>>();

/**
 * Renvoie la valeur mémorisée si elle correspond encore à cette
 * version, sinon `undefined`.
 */
export function lireCache<T>(cle: string, version: string): T | undefined {
  const e = memoire.get(cle);
  return e && e.version === version ? (e.valeur as T) : undefined;
}

export function ecrireCache<T>(cle: string, version: string, valeur: T): void {
  memoire.set(cle, { valeur, version });
}

/**
 * Vide la mémoire.
 *
 * Appelé après une restauration de sauvegarde ou un effacement des
 * données : la base entière a changé, et les versions calculées à
 * partir de compteurs ne le verraient pas forcément.
 */
export function viderCache(): void {
  memoire.clear();
}
