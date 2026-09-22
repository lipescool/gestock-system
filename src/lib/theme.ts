/**
 * Apparence de l'application.
 *
 * Trois réglages indépendants, posés en attributs sur la racine du
 * document : la palette, le clair ou le sombre, et l'angle des coins.
 * Les feuilles de style font le reste — aucun composant n'a à savoir
 * quelle apparence est active.
 */

/** Palettes proposées. L'ordre est celui de la liste des réglages. */
export const SKINS = [
  { id: 'emeraude', couleur: '#10715a' },
  { id: 'indigo', couleur: '#3b4ea8' },
  { id: 'terre', couleur: '#9c4a1a' },
  { id: 'ocean', couleur: '#0b6e8f' },
  { id: 'prune', couleur: '#7a3572' },
  { id: 'encre', couleur: '#2c3138' },
] as const;

export type SkinId = (typeof SKINS)[number]['id'];
export type ThemeMode = 'auto' | 'light' | 'dark';
export type Corners = 'normal' | 'square' | 'round';

/**
 * Applique l'apparence au document.
 *
 * Toutes les palettes posent leur attribut, l'émeraude comprise :
 * chacune déclare son propre fond, et sans l'attribut l'émeraude
 * gardait le blanc de `global.css` quand les autres se teintaient.
 * Seul le mode « auto » n'en pose pas — il n'y a alors rien à imposer,
 * c'est le réglage du système qui décide.
 */
export function applyTheme(
  skin: SkinId, mode: ThemeMode, corners: Corners,
): void {
  const root = document.documentElement;

  if (skin) root.setAttribute('data-skin', skin);
  else root.removeAttribute('data-skin');

  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');

  if (corners === 'square' || corners === 'round') {
    root.setAttribute('data-corners', corners);
  } else {
    root.removeAttribute('data-corners');
  }
}
