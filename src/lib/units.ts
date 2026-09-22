/**
 * Accord de l'unité avec la quantité.
 *
 * L'unité est saisie par le commerçant — « pièce », « sachet », « kg »,
 * « carton » — et rien ne dit comment elle se met au pluriel. On ne peut
 * donc pas s'en remettre à une table de mots : il faut une règle, et
 * elle diffère d'une langue à l'autre.
 */

/** Unités qui ne prennent pas de marque de pluriel. */
const INVARIABLES = new Set([
  // Symboles et abréviations : « 5 kg », jamais « 5 kgs ».
  'kg', 'g', 'mg', 'l', 'ml', 'cl', 'm', 'cm', 'mm', 'm2', 'm3',
  'oz', 'lb', 'pcs', 'pc', 'u',
]);

/**
 * Met une unité au pluriel quand la quantité l'exige.
 *
 * @param qty   la quantité affichée à côté
 * @param unit  l'unité telle que le commerçant l'a saisie
 * @param lang  la langue de la boutique
 *
 * Les règles couvertes sont celles du français et de l'anglais, les deux
 * langues livrées. Une langue ajoutée plus tard sans règle propre laisse
 * l'unité inchangée : mieux vaut un pluriel manquant qu'un pluriel faux.
 */
export function plural(qty: number, unit: string, lang: string): string {
  const mot = unit.trim();
  if (!mot) return '';

  // En français, seul « plus d'un » prend la marque : zéro et un
  // restent au singulier. En anglais, zéro prend le pluriel.
  const base = lang.startsWith('fr') ? Math.abs(qty) >= 2 : Math.abs(qty) !== 1;
  if (!base) return mot;

  const bas = mot.toLowerCase();
  if (INVARIABLES.has(bas)) return mot;

  // Déjà au pluriel : le commerçant a pu écrire « pièces » lui-même.
  if (bas.endsWith('s') || bas.endsWith('x') || bas.endsWith('z')) return mot;

  if (lang.startsWith('fr')) {
    // « bocal » → « bocaux », « cadeau » → « cadeaux ».
    if (bas.endsWith('al')) return `${mot.slice(0, -2)}${mot[mot.length - 2] === 'A' ? 'AUX' : 'aux'}`;
    if (/(au|eu)$/.test(bas)) return `${mot}x`;
    return `${mot}s`;
  }

  if (lang.startsWith('en')) {
    // « box » → « boxes », « berry » → « berries ».
    if (/(ch|sh)$/.test(bas)) return `${mot}es`;
    if (/[^aeiou]y$/.test(bas)) return `${mot.slice(0, -1)}ies`;
    return `${mot}s`;
  }

  return mot;
}

/** Quantité suivie de son unité accordée : « 76 pièces », « 1 pièce ». */
export function withUnit(qty: number, unit: string, lang: string): string {
  return `${qty} ${plural(qty, unit, lang)}`.trim();
}
