/**
 * Modèle du fichier des empreintes de licences.
 *
 * Le vrai `cles.ts` n'est pas publié : il contient de quoi
 * reconnaître les 2000 clés vendues. Pour reconstruire une
 * installation :
 *
 *     cd licences
 *     node generer.mjs 2000
 *
 * Cela produit `src/lib/cles.ts` et la liste à charger sur le
 * serveur. Attention : régénérer invalide toutes les clés déjà
 * vendues.
 */

export const EMPREINTES: ReadonlySet<string> = new Set([
  // Les empreintes sont ajoutées ici par l'outil de génération.
]);
