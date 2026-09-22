// Devises proposées au commerçant. `decimals` dit combien de chiffres après
// la virgule : le franc CFA n'en a aucun, l'euro en a deux. Les montants sont
// stockés en unités mineures (centimes) pour éviter les erreurs de virgule
// flottante, sauf pour les devises à 0 décimale où l'unité mineure = l'unité.

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
  /** true = 1 500 F, false = F 1 500 */
  symbolAfter: boolean;
}

export const CURRENCIES: Currency[] = [
  { code: 'XOF', symbol: 'FCFA', name: 'Franc CFA (UEMOA)', decimals: 0, symbolAfter: true },
  { code: 'XAF', symbol: 'FCFA', name: 'Franc CFA (CEMAC)', decimals: 0, symbolAfter: true },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2, symbolAfter: true },
  { code: 'USD', symbol: '$', name: 'Dollar américain', decimals: 2, symbolAfter: false },
  { code: 'MAD', symbol: 'DH', name: 'Dirham marocain', decimals: 2, symbolAfter: true },
  { code: 'DZD', symbol: 'DA', name: 'Dinar algérien', decimals: 2, symbolAfter: true },
  { code: 'TND', symbol: 'DT', name: 'Dinar tunisien', decimals: 3, symbolAfter: true },
  { code: 'NGN', symbol: '₦', name: 'Naira nigérian', decimals: 2, symbolAfter: false },
  { code: 'GHS', symbol: 'GH₵', name: 'Cedi ghanéen', decimals: 2, symbolAfter: false },
  { code: 'KES', symbol: 'KSh', name: 'Shilling kényan', decimals: 2, symbolAfter: false },
  { code: 'ZAR', symbol: 'R', name: 'Rand sud-africain', decimals: 2, symbolAfter: false },
  { code: 'CDF', symbol: 'FC', name: 'Franc congolais', decimals: 2, symbolAfter: true },
  { code: 'GNF', symbol: 'FG', name: 'Franc guinéen', decimals: 0, symbolAfter: true },
  { code: 'GBP', symbol: '£', name: 'Livre sterling', decimals: 2, symbolAfter: false },
  { code: 'CAD', symbol: '$', name: 'Dollar canadien', decimals: 2, symbolAfter: true },
];

export const DEFAULT_CURRENCY = 'XOF';

export const findCurrency = (code: string): Currency =>
  CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];

/**
 * Met en forme un montant stocké en unités mineures.
 * L'espace avant le symbole est une espace insécable étroite.
 */
export function formatMoney(minor: number, currency: Currency, locale = 'fr'): string {
  const value = currency.decimals === 0 ? minor : minor / 10 ** currency.decimals;
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(value);

  // Intl produit une espace insécable étroite (U+202F) comme séparateur de
  // milliers en français. Elle est invisible à l'écran mais n'existe pas
  // dans la table de caractères des imprimantes thermiques. On la remplace
  // par une espace insécable ordinaire, qui, elle, passe partout.
  const clean = body.replace(/[  ]/g, ' ');

  return currency.symbolAfter
    ? `${clean} ${currency.symbol}`
    : `${currency.symbol} ${clean}`;
}

/**
 * Convertit une saisie utilisateur en unités mineures, ou renvoie `null`
 * si la saisie n'est pas un montant valide.
 *
 * Le `null` est important : en filtrant simplement les caractères non
 * numériques, « 2000FFF » devenait 2000 sans rien signaler, et une faute
 * de frappe passait en base comme un prix correct.
 *
 * Les espaces de séparation des milliers sont tolérés, la virgule comme le
 * point font office de séparateur décimal.
 */
export function parseMoney(input: string, currency: Currency): number | null {
  const raw = input
    .replace(/[\s   ]/g, '')
    .replace(',', '.');

  if (raw === '') return null;

  // Un montant, et rien d'autre : chiffres, un point décimal facultatif.
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 10 ** currency.decimals);
}

/** Variante tolérante, pour l'affichage en cours de frappe. */
export function parseMoneyOr(input: string, currency: Currency, fallback = 0): number {
  return parseMoney(input, currency) ?? fallback;
}
