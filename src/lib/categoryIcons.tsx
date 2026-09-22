/**
 * Icônes de catégories de produits.
 *
 * Tracés issus de Lucide, compilés dans le build : aucune requête réseau,
 * l'application fonctionne hors ligne dès le premier lancement. Un emoji
 * aurait changé de dessin selon le système — ici l'image est la même
 * partout.
 *
 * Le jeu couvre plusieurs métiers, pas seulement l'alimentation : boutique,
 * vêtements, électronique, pharmacie, quincaillerie, cosmétique, auto.
 */

import {
  LayoutGrid, Package, ShoppingBag, Tag, Star,
  UtensilsCrossed, CupSoda, Wine, Coffee, Croissant, Apple, Beef, Wheat, Cookie,
  Shirt, Footprints, Watch, Gem, Sparkles,
  Smartphone, Laptop, Plug, Wrench, House, SprayCan,
  Pill, Baby, NotebookPen, Dumbbell, PawPrint, Car, Fuel, Gift,
  Hammer, Flower2, Cigarette, Battery, Scissors, Bike,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryIcon {
  id: string;
  label: string;
  Cmp: LucideIcon;
  /** Couleur propre à la catégorie : elle sert de repère visuel rapide. */
  color: string;
}

const C = {
  slate: '#54606d', blue: '#2f6fd0', violet: '#7c4fc4', pink: '#c2417f',
  amber: '#c9820a', orange: '#d4691a', teal: '#0e8b8b', sky: '#2f9fd0',
  brown: '#8a5a2b', green: '#3f9b3f', red: '#c22a2a', rose: '#d4548f',
  forest: '#10715a', gold: '#b8891f',
};

export const CATEGORY_ICONS: CategoryIcon[] = [
  // Général
  { id: 'all', label: 'Tout', Cmp: LayoutGrid, color: C.slate },
  { id: 'box', label: 'Divers', Cmp: Package, color: C.blue },
  { id: 'bag', label: 'Sac', Cmp: ShoppingBag, color: C.violet },
  { id: 'tag', label: 'Promotion', Cmp: Tag, color: C.pink },
  { id: 'star', label: 'Vedette', Cmp: Star, color: C.amber },

  // Alimentation
  { id: 'food', label: 'Plats', Cmp: UtensilsCrossed, color: C.orange },
  { id: 'drink', label: 'Boissons', Cmp: CupSoda, color: C.teal },
  { id: 'bottle', label: 'Alcools', Cmp: Wine, color: C.sky },
  { id: 'coffee', label: 'Café', Cmp: Coffee, color: C.brown },
  { id: 'bread', label: 'Boulangerie', Cmp: Croissant, color: C.amber },
  { id: 'fruit', label: 'Fruits et légumes', Cmp: Apple, color: C.green },
  { id: 'meat', label: 'Viandes', Cmp: Beef, color: C.pink },
  { id: 'cereal', label: 'Céréales', Cmp: Wheat, color: C.gold },
  { id: 'snack', label: 'Snacks', Cmp: Cookie, color: C.orange },

  // Boutique
  { id: 'clothes', label: 'Vêtements', Cmp: Shirt, color: C.violet },
  { id: 'shoe', label: 'Chaussures', Cmp: Footprints, color: C.slate },
  { id: 'watch', label: 'Montres', Cmp: Watch, color: C.blue },
  { id: 'jewel', label: 'Bijoux', Cmp: Gem, color: C.pink },
  { id: 'beauty', label: 'Cosmétique', Cmp: Sparkles, color: C.rose },
  { id: 'hair', label: 'Coiffure', Cmp: Scissors, color: C.violet },

  // Technique et maison
  { id: 'phone', label: 'Téléphonie', Cmp: Smartphone, color: C.blue },
  { id: 'tech', label: 'Informatique', Cmp: Laptop, color: C.teal },
  { id: 'plug', label: 'Électricité', Cmp: Plug, color: C.amber },
  { id: 'battery', label: 'Piles', Cmp: Battery, color: C.green },
  { id: 'tool', label: 'Outils', Cmp: Wrench, color: C.slate },
  { id: 'build', label: 'Quincaillerie', Cmp: Hammer, color: C.brown },
  { id: 'home', label: 'Maison', Cmp: House, color: C.forest },
  { id: 'clean', label: 'Entretien', Cmp: SprayCan, color: C.sky },

  // Santé, loisirs, divers
  { id: 'health', label: 'Pharmacie', Cmp: Pill, color: C.red },
  { id: 'baby', label: 'Enfants', Cmp: Baby, color: C.rose },
  { id: 'book', label: 'Papeterie', Cmp: NotebookPen, color: C.violet },
  { id: 'sport', label: 'Sport', Cmp: Dumbbell, color: C.green },
  { id: 'pet', label: 'Animaux', Cmp: PawPrint, color: C.brown },
  { id: 'flower', label: 'Fleurs', Cmp: Flower2, color: C.rose },
  { id: 'car', label: 'Auto', Cmp: Car, color: C.slate },
  { id: 'bike', label: 'Deux-roues', Cmp: Bike, color: C.teal },
  { id: 'fuel', label: 'Carburant', Cmp: Fuel, color: C.red },
  { id: 'tobacco', label: 'Tabac', Cmp: Cigarette, color: C.brown },
  { id: 'gift', label: 'Cadeaux', Cmp: Gift, color: C.pink },
];

export const DEFAULT_ICON = 'box';

export const findIcon = (id: string): CategoryIcon =>
  CATEGORY_ICONS.find((i) => i.id === id) ?? CATEGORY_ICONS[1];

export const categoryColor = (id: string): string => findIcon(id).color;

/** Rend l'icône d'une catégorie. `inherit` la force à la couleur du parent. */
export function CategoryIconSvg(
  { id, size = 22, strokeWidth = 2, inherit = false }:
  { id: string; size?: number; strokeWidth?: number; inherit?: boolean },
) {
  const { Cmp, color } = findIcon(id);
  return (
    <Cmp size={size} strokeWidth={strokeWidth}
         color={inherit ? 'currentColor' : color} aria-hidden="true" />
  );
}
