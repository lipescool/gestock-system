import { useEffect, useState } from 'react';
import { lireCache, ecrireCache } from './cache';

/**
 * Un calcul dont le résultat survit au changement d'écran.
 *
 * `useLiveQuery` de Dexie relit la base dès que le composant se
 * monte : en revenant sur un écran, tout se recalcule et l'affichage
 * repasse par un état vide avant de se remplir. Ici la valeur est
 * conservée hors de React et rendue immédiatement, puis rafraîchie
 * seulement si la version a changé.
 *
 * @param cle      identifie ce calcul — « dashboard:stats », par exemple
 * @param version  ce qui doit changer pour recalculer : un compteur de
 *                 ventes, une période, tout ce dont dépend le résultat
 * @param calcul   la lecture elle-même
 *
 * La version est une chaîne construite par l'appelant. Elle doit
 * contenir tout ce qui influe sur le résultat : en oublier une part
 * ferait afficher des chiffres périmés, ce qui est pire que de
 * recalculer trop souvent.
 */
export function useCachedQuery<T>(
  cle: string,
  version: string,
  calcul: () => Promise<T>,
): T | undefined {
  return useCachedState(cle, version, calcul).valeur;
}

/**
 * Comme `useCachedQuery`, mais dit aussi si le calcul est en cours.
 *
 * Sans cette distinction, un écran ne sait pas différencier « aucune
 * donnée » de « pas encore chargé » : il affiche « 0 entrée » pendant
 * la lecture, puis le vrai nombre. Le commerçant voit le chiffre
 * changer sous ses yeux et doute de ce qu'il lit.
 */
export function useCachedState<T>(
  cle: string,
  version: string,
  calcul: () => Promise<T>,
): { valeur: T | undefined; chargement: boolean } {
  /* La valeur mémorisée sert de premier rendu : l'écran s'affiche
     rempli, sans passer par un état vide. */
  const [valeur, setValeur] = useState<T | undefined>(
    () => lireCache<T>(cle, version),
  );

  /* La version rendue, pour repérer qu'elle a changé sans attendre
     l'effet. Sans cette comparaison, une vente enregistrée pendant
     qu'on regarde l'écran n'y apparaissait qu'après en être sorti et
     revenu : l'affichage gardait la valeur de l'ancienne version. */
  const [versionRendue, setVersionRendue] = useState(version);
  if (versionRendue !== version) {
    setVersionRendue(version);
    const memorisee = lireCache<T>(cle, version);
    // Si le nouveau calcul est déjà en mémoire on l'affiche tout de
    // suite ; sinon on garde l'ancien le temps du recalcul, plutôt
    // que de vider l'écran.
    if (memorisee !== undefined) setValeur(memorisee);
  }

  useEffect(() => {
    const dejaLa = lireCache<T>(cle, version);
    if (dejaLa !== undefined) {
      setValeur(dejaLa);
      return;
    }

    let vivant = true;
    void calcul().then((r) => {
      ecrireCache(cle, version, r);
      // Le composant a pu être démonté entre-temps : écrire dans son
      // état déclencherait un avertissement sans rien afficher.
      if (vivant) setValeur(r);
    });
    return () => { vivant = false; };
    // `calcul` est volontairement absent : la fonction est recréée à
    // chaque rendu, la lister relancerait la lecture en boucle. La
    // version dit tout ce qui doit provoquer un recalcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version]);

  return { valeur, chargement: valeur === undefined };
}
