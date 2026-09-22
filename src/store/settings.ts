import { create } from 'zustand';
import { db } from '../db';
import { findCurrency, formatMoney, DEFAULT_CURRENCY, type Currency } from '../i18n/currencies';
import { setSoundEnabled } from '../lib/sound';
import { applyTheme, type SkinId, type ThemeMode, type Corners } from '../lib/theme';
import { logAudit } from '../db/audit';

/** Réglages exposés à toute l'application. */
export interface AppSettings {
  shopName: string;
  lang: string;
  currency: string;
  taxRate: number;
  taxName: string;
  showProductImages: boolean;
  autoBackupEnabled: boolean;
  autoBackupTime: string;   // 'HH:mm'
  printTransport: 'relay' | 'bluetooth' | 'usb' | 'network' | 'browser';
  /* --- Étiquettes de produits --- */
  /** Format de planche : une clé de SHEET_FORMATS. */
  labelFormat: string;
  /** Imprimante visée : celle des tickets, ou une autre. */
  labelPrinter: string;
  /** Combien d'étiquettes par produit, par défaut. */
  labelCopies: number;
  /** Ce qui figure sur l'étiquette, en plus du code-barres. */
  labelShowName: boolean;
  labelShowPrice: boolean;

  /** Apparence : palette, clair ou sombre, angle des coins. */
  skin: SkinId;
  themeMode: ThemeMode;
  corners: Corners;
  printWidth: 58 | 80;
  printerAddress: string;   // ip:port pour le transport réseau
  receiptFooter: string;
  soundEnabled: boolean;
  discountEnabled: boolean;
  maxDiscountPercent: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  shopName: 'Gestock',
  lang: 'fr',
  currency: DEFAULT_CURRENCY,
  taxRate: 0,
  taxName: 'TVA',
  showProductImages: true,
  autoBackupEnabled: true,
  autoBackupTime: '22:00',
  printTransport: 'bluetooth',
  labelFormat: '58x40',
  labelPrinter: '',
  labelCopies: 1,
  labelShowName: true,
  labelShowPrice: true,

  skin: 'emeraude',
  themeMode: 'auto',
  corners: 'normal',
  printWidth: 58,
  printerAddress: '',
  receiptFooter: '',
  soundEnabled: true,
  discountEnabled: false,
  maxDiscountPercent: 50,
};

/**
 * Réglages dont le changement est inscrit au journal.
 *
 * On y met ce qui change la lecture des chiffres ou le fonctionnement de
 * la caisse, pas ce qui relève du confort : afficher les images ou couper
 * les sons ne mérite pas une ligne d'historique.
 */
const AUDITED = new Set([
  'currency', 'taxRate', 'taxName', 'shopName',
  'discountEnabled', 'maxDiscountPercent',
  'printTransport', 'printWidth', 'autoBackupEnabled', 'autoBackupTime',
]);

interface SettingsState {
  settings: AppSettings;
  dict: Record<string, string>;
  ready: boolean;
  /** Dernier réglage enregistré, pour en accuser réception à l'écran. */
  savedKey: string | null;
  savedAt: number;
  load: () => Promise<void>;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  setLang: (lang: string) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  money: (minor: number) => string;
  currencyInfo: () => Currency;
}

async function loadDict(lang: string): Promise<Record<string, string>> {
  const rows = await db.translations.where('lang').equals(lang).toArray();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  dict: {},
  ready: false,
  savedKey: null,
  savedAt: 0,

  load: async () => {
    const rows = await db.settings.toArray();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const settings = { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
    const dict = await loadDict(settings.lang);
    setSoundEnabled(settings.soundEnabled);
    /* L'apparence est appliquée avant le premier rendu : posée
       après, l'écran apparaîtrait une fraction de seconde dans les
       couleurs par défaut. */
    applyTheme(settings.skin, settings.themeMode, settings.corners);

    set({ settings, dict, ready: true });
  },

  set: async (key, value) => {
    const previous = get().settings[key];
    await db.settings.put({ key: key as string, value });
    if (key === 'soundEnabled') setSoundEnabled(value as boolean);

    /* L'apparence s'applique aussitôt : attendre un rechargement pour
       voir sa couleur donnerait l'impression que le choix n'a pas
       été pris en compte. */
    if (key === 'skin' || key === 'themeMode' || key === 'corners') {
      const s = { ...get().settings, [key]: value };
      applyTheme(s.skin, s.themeMode, s.corners);
    }
    set({ settings: { ...get().settings, [key]: value } });

    /* Le réglage est écrit aussitôt, sans bouton « enregistrer » : le
       commerçant n'avait donc aucun moyen de savoir si sa saisie avait
       été prise en compte. On signale la clé touchée, et l'écran peut
       le montrer. */
    set({ savedKey: key as string, savedAt: Date.now() });

    // Changer de devise ou de taux de taxe modifie la lecture de toute la
    // comptabilité : un montant relu six mois plus tard n'a pas le même
    // sens selon le réglage en vigueur ce jour-là. Le journal garde donc
    // l'ancienne et la nouvelle valeur. Les réglages purement visuels,
    // eux, n'encombrent pas l'historique.
    if (previous !== value && AUDITED.has(key as string)) {
      await logAudit({
        entity: 'setting',
        entityId: key as string,
        action: 'update',
        before: { name: key as string, value: previous },
        after: { name: key as string, value },
      });
    }
  },

  setLang: async (lang) => {
    const previous = get().settings.lang;
    await db.settings.put({ key: 'lang', value: lang });
    const dict = await loadDict(lang);
    set({ settings: { ...get().settings, lang }, dict });
    document.documentElement.lang = lang;

    if (previous !== lang) {
      await logAudit({
        entity: 'setting', entityId: 'lang', action: 'update',
        before: { name: 'lang', value: previous },
        after: { name: 'lang', value: lang },
      });
    }
  },

  // Si une clé manque, on renvoie la clé elle-même : le trou est visible
  // à l'écran plutôt que masqué par un texte en dur.
  t: (key, vars) => {
    let out = get().dict[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  },

  money: (minor) => {
    const { settings } = get();
    return formatMoney(minor, findCurrency(settings.currency), settings.lang);
  },

  currencyInfo: () => findCurrency(get().settings.currency),
}));


/* -------------------------------------------------------------------------
   Accès ciblés au store.

   `useSettings()` sans argument abonne le composant à l'état entier : il se
   redessine dès que n'importe quelle valeur change, même sans rapport avec
   ce qu'il affiche. Ces sélecteurs ne s'abonnent qu'à ce dont on a besoin.

   Les fonctions `t`, `money` et `currencyInfo` sont définies une fois pour
   toutes à la création du store : leur référence ne change jamais, elles
   peuvent donc être extraites sans provoquer de rendu.
   ------------------------------------------------------------------------- */

/** Traduction, monnaie et devise : trois fonctions de référence stable. */
export const useT = () => useSettings((s) => s.t);
export const useMoney = () => useSettings((s) => s.money);
/* La langue seule : l'accord des unités en a besoin, et s'abonner au
   store entier pour une chaîne redessinerait toutes les cartes. */
export const useLang = () => useSettings((s) => s.settings.lang);
export const useCurrency = () => useSettings((s) => s.currencyInfo);

/** Un seul réglage à la fois, comparé par valeur. */
export function useSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return useSettings((s) => s.settings[key]);
}
