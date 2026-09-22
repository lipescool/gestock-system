/**
 * Icônes de l'interface.
 *
 * Les tracés viennent de Lucide, installé comme paquet npm : ils sont
 * compilés dans le build, jamais chargés depuis internet. L'application
 * reste utilisable hors ligne dès le premier lancement.
 *
 * Chaque icône a une couleur propre, qui sert de repère constant : le vert
 * pour l'argent qui entre, le rouge pour ce qui sort ou se supprime, le
 * bleu pour le stock. La couleur porte du sens, elle ne décore pas.
 */

import type { CSSProperties } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Wallet, History as HistoryIcon, Settings2,
  Trash2, Pencil, Plus, Minus, Check, X, Search,
  Printer, Barcode, Tag, Download, Upload, MonitorDown,
  ReceiptText, Clock, CreditCard, Banknote, Percent,
  ArrowUp, ArrowDown, ChevronDown, SlidersHorizontal, ImageIcon, User, Store,
  TriangleAlert, Bluetooth, Wifi, Save, RotateCcw, Languages, Coins,
  Volume2, Layers, FileText, TrendingUp, TrendingDown, CircleAlert,
  type LucideIcon,
  Lock,
  Eye,
  EyeOff,
  Delete,
  Palette,
} from 'lucide-react';

/* Palette : une famille d'action garde sa teinte dans toute l'application. */
export const TONE = {
  green: '#10715a',
  blue: '#2f6fd0',
  violet: '#7c4fc4',
  amber: '#c9820a',
  red: '#c22a2a',
  slate: '#54606d',
  teal: '#0e8b8b',
  pink: '#c2417f',
} as const;

const REGISTRY = {
  // Navigation
  dashboard: [LayoutDashboard, TONE.violet],
  register: [ShoppingCart, TONE.green],
  stock: [Package, TONE.blue],
  expenses: [Wallet, TONE.amber],
  history: [HistoryIcon, TONE.teal],
  settings: [Settings2, TONE.slate],

  // Actions
  trash: [Trash2, TONE.red],
  edit: [Pencil, TONE.blue],
  plus: [Plus, TONE.green],
  minus: [Minus, TONE.slate],
  check: [Check, TONE.green],
  close: [X, TONE.slate],
  search: [Search, TONE.slate],
  save: [Save, TONE.green],
  restore: [RotateCcw, TONE.amber],

  // Impression et étiquettes
  print: [Printer, TONE.violet],
  barcode: [Barcode, TONE.slate],
  tag: [Tag, TONE.pink],
  receipt: [ReceiptText, TONE.green],
  bluetooth: [Bluetooth, TONE.blue],
  wifi: [Wifi, TONE.teal],

  // Données
  download: [Download, TONE.blue],
  upload: [Upload, TONE.amber],
  install: [MonitorDown, TONE.green],
  file: [FileText, TONE.slate],

  // Commerce
  box: [Package, TONE.blue],
  clock: [Clock, TONE.teal],
  card: [CreditCard, TONE.violet],
  cash: [Banknote, TONE.green],
  percent: [Percent, TONE.amber],
  coins: [Coins, TONE.amber],
  shop: [Store, TONE.green],
  lock: [Lock, TONE.slate],
  eye: [Eye, TONE.slate],
  backspace: [Delete, TONE.slate],
  palette: [Palette, TONE.pink],
  eyeOff: [EyeOff, TONE.slate],
  layers: [Layers, TONE.violet],

  // Indicateurs
  up: [ArrowUp, TONE.green],
  down: [ArrowDown, TONE.red],
  trendUp: [TrendingUp, TONE.green],
  trendDown: [TrendingDown, TONE.red],
  warn: [TriangleAlert, TONE.amber],
  alert: [CircleAlert, TONE.red],

  // Divers
  chevron: [ChevronDown, TONE.slate],
  filter: [SlidersHorizontal, TONE.slate],
  image: [ImageIcon, TONE.blue],
  user: [User, TONE.slate],
  language: [Languages, TONE.violet],
  sound: [Volume2, TONE.teal],
} satisfies Record<string, readonly [LucideIcon, string]>;

export type IconName = keyof typeof REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  /** Force une couleur au lieu de celle attribuée à l'icône. */
  color?: string;
  /** Reprend la couleur du texte parent : nécessaire sur un fond coloré. */
  inherit?: boolean;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon(
  { name, size = 18, color, inherit, strokeWidth = 2, style, className }: IconProps,
) {
  const [Cmp, tone] = REGISTRY[name];
  return (
    <Cmp
      size={size}
      color={inherit ? 'currentColor' : (color ?? tone)}
      strokeWidth={strokeWidth}
      style={style}
      className={className}
      aria-hidden="true"
    />
  );
}

export const iconColor = (name: IconName): string => REGISTRY[name][1];
