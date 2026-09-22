/**
 * Icônes des moyens de paiement.
 *
 * Elles restent volontairement génériques : ce sont des formes de paiement
 * (espèces, mobile, carte, virement), pas des logos de marque. Le commerçant
 * met le nom qu'il veut sur son moyen de paiement — « Orange Money », « Wave »,
 * « Crédit tonton Ali » — et choisit la forme qui lui parle.
 *
 * Tracés Lucide, compilés dans le build : rien n'est chargé depuis internet.
 */

import {
  Banknote, Coins, CreditCard, Smartphone, Landmark, NotebookPen,
  Wallet, QrCode, HandCoins, Receipt, PiggyBank, Gift,
  type LucideIcon,
} from 'lucide-react';

const REGISTRY: Record<string, readonly [LucideIcon, string]> = {
  cash: [Banknote, '#10715a'],
  coins: [Coins, '#c9820a'],
  card: [CreditCard, '#7c4fc4'],
  mobile: [Smartphone, '#d4691a'],
  bank: [Landmark, '#2f6fd0'],
  credit: [NotebookPen, '#8a5a2b'],
  wallet: [Wallet, '#0e8b8b'],
  qr: [QrCode, '#54606d'],
  hand: [HandCoins, '#3f9b3f'],
  cheque: [Receipt, '#2f9fd0'],
  saving: [PiggyBank, '#c2417f'],
  voucher: [Gift, '#d4548f'],
};

/** Ordre d'affichage dans le sélecteur. */
export const PAY_ICONS = Object.keys(REGISTRY);

export function PayIcon({ id, size = 20 }: { id: string; size?: number }) {
  // Les bases créées avant les icônes Lucide contiennent des emoji :
  // on retombe sur « espèces » plutôt que d'afficher un trou.
  const [Cmp, color] = REGISTRY[id] ?? REGISTRY.cash;
  return <Cmp size={size} color={color} strokeWidth={2} aria-hidden="true" />;
}

export const payIconColor = (id: string): string => (REGISTRY[id] ?? REGISTRY.cash)[1];
