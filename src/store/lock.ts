import { create } from 'zustand';

/**
 * Verrou de la caisse.
 *
 * L'état vit à part plutôt que dans le composant racine : le bouton de
 * verrouillage se trouve dans la barre du haut, et faire descendre une
 * fonction depuis la racine jusqu'à lui traverserait toute
 * l'application pour un seul bouton.
 */
interface LockState {
  /** `null` tant qu'on ignore si un code est défini. */
  locked: boolean | null;
  lock: () => void;
  unlock: () => void;
  setLocked: (v: boolean) => void;
}

export const useLock = create<LockState>((set) => ({
  locked: null,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
  setLocked: (v) => set({ locked: v }),
}));
