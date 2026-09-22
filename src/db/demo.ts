import { db, uid, now } from './index';
import { applyStockMovement, logAudit } from './audit';
import { generateInternalBarcode } from '../lib/barcode';
import type { Category, Product } from './schema';

/**
 * Jeu de démonstration — outil de développement, pas fonctionnalité client.
 *
 * Un commerçant qui achète Gestock ne doit pas trouver de bouton « ajouter
 * des produits fictifs » dans ses réglages : il risquerait de polluer son
 * vrai catalogue. Ces fonctions ne sont donc exposées qu'en console, et
 * seulement pendant le développement.
 *
 * Depuis la console du navigateur :
 *     gestock.demo()    ajoute le catalogue
 *     gestock.clear()   vide produits et catégories
 *
 * Les prix sont en francs CFA, arrondis comme dans une boutique réelle.
 * Ce sont des unités mineures, donc « 4000 » vaut 40,00 € en euros.
 */

interface Seed {
  cat: { name: string; icon: string };
  items: [name: string, price: number, cost: number, stock: number, unit: string][];
}

const CATALOG: Seed[] = [
  {
    cat: { name: 'BOISSONS', icon: 'drink' },
    items: [
      ['COCA-COLA 33CL', 500, 350, 48, 'bouteille'],
      ['FANTA ORANGE 33CL', 500, 350, 36, 'bouteille'],
      ['SPRITE 33CL', 500, 350, 30, 'bouteille'],
      ['EAU MINERALE 1,5L', 400, 250, 60, 'bouteille'],
      ['EAU MINERALE 50CL', 200, 120, 96, 'bouteille'],
      ['JUS DE BISSAP 50CL', 750, 450, 24, 'bouteille'],
      ['JUS DE GINGEMBRE 50CL', 750, 450, 18, 'bouteille'],
      ['MALTA GUINNESS', 800, 600, 30, 'bouteille'],
      ['CAFE TOUBA SACHET', 200, 120, 80, 'sachet'],
      ['THE LIPTON BOITE 25', 1500, 1100, 14, 'boite'],
    ],
  },
  {
    cat: { name: 'ALIMENTATION', icon: 'cereal' },
    items: [
      ['RIZ PARFUME 5KG', 4500, 3800, 25, 'sac'],
      ['RIZ BRISE 25KG', 17000, 15000, 8, 'sac'],
      ['HUILE DINOR 1L', 1800, 1500, 40, 'bouteille'],
      ['HUILE DE PALME 1L', 1200, 900, 26, 'bouteille'],
      ['SUCRE EN POUDRE 1KG', 900, 700, 35, 'paquet'],
      ['SEL FIN 1KG', 300, 180, 50, 'paquet'],
      ['LAIT CONCENTRE', 650, 480, 48, 'boite'],
      ['LAIT EN POUDRE 400G', 2800, 2200, 16, 'boite'],
      ['TOMATE CONCENTREE', 350, 240, 72, 'boite'],
      ['SPAGHETTI 500G', 600, 420, 44, 'paquet'],
      ['CUBE MAGGI BOITE', 1200, 950, 18, 'boite'],
      ['FARINE DE BLE 1KG', 800, 600, 30, 'paquet'],
      ['HARICOT SEC 1KG', 1100, 850, 22, 'paquet'],
      ['SARDINE EN BOITE', 700, 500, 54, 'boite'],
      ['MAYONNAISE 250G', 1400, 1000, 20, 'pot'],
    ],
  },
  {
    cat: { name: 'BEAUTE', icon: 'beauty' },
    items: [
      ['POMMADE ECLAIRCISSANTE', 4000, 2800, 12, 'pot'],
      ['SAVON DE MARSEILLE', 500, 320, 60, 'piece'],
      ['SAVON NOIR 200G', 900, 600, 34, 'piece'],
      ['GEL DOUCHE 250ML', 2500, 1800, 18, 'flacon'],
      ['DEODORANT SPRAY', 3000, 2100, 15, 'flacon'],
      ['HUILE DE COCO 100ML', 2000, 1300, 22, 'flacon'],
      ['BEURRE DE KARITE 200G', 2500, 1600, 16, 'pot'],
      ['CREME HYDRATANTE', 3500, 2400, 14, 'pot'],
      ['PARFUM FEMME 50ML', 12000, 8000, 6, 'flacon'],
      ['VERNIS A ONGLES', 1500, 800, 24, 'flacon'],
    ],
  },
  {
    cat: { name: 'HYGIENE', icon: 'clean' },
    items: [
      ['PAPIER HYGIENIQUE X4', 1500, 1100, 30, 'paquet'],
      ['DENTIFRICE 75ML', 1200, 850, 26, 'tube'],
      ['BROSSE A DENTS', 700, 400, 40, 'piece'],
      ['JAVEL 1L', 800, 550, 28, 'bouteille'],
      ['LESSIVE POUDRE 1KG', 1600, 1200, 20, 'paquet'],
      ['LIQUIDE VAISSELLE', 1300, 900, 24, 'bouteille'],
      ['SERVIETTES HYGIENIQUES', 1800, 1300, 22, 'paquet'],
      ['COUCHES BEBE LOT', 6500, 5200, 10, 'paquet'],
      ['COTON-TIGES', 500, 280, 36, 'boite'],
      ['DESODORISANT', 2200, 1500, 14, 'aerosol'],
    ],
  },
  {
    cat: { name: 'TELEPHONIE', icon: 'phone' },
    items: [
      ['CHARGEUR USB-C', 3500, 2000, 14, 'piece'],
      ['CHARGEUR MICRO-USB', 2500, 1400, 18, 'piece'],
      ['ECOUTEURS FILAIRES', 2500, 1400, 20, 'piece'],
      ['ECOUTEURS BLUETOOTH', 15000, 10000, 5, 'piece'],
      ['CABLE USB 1M', 1500, 800, 25, 'piece'],
      ['POWERBANK 10000MAH', 12000, 8500, 6, 'piece'],
      ['COQUE TELEPHONE', 2000, 900, 30, 'piece'],
      ['VERRE TREMPE', 1500, 600, 34, 'piece'],
      ['CARTE MEMOIRE 32GO', 6000, 4200, 8, 'piece'],
    ],
  },
  {
    cat: { name: 'PAPETERIE', icon: 'book' },
    items: [
      ['CAHIER 100 PAGES', 500, 320, 80, 'piece'],
      ['CAHIER 200 PAGES', 900, 600, 45, 'piece'],
      ['STYLO BIC BLEU', 150, 80, 150, 'piece'],
      ['STYLO BIC ROUGE', 150, 80, 90, 'piece'],
      ['RAME PAPIER A4', 4000, 3200, 10, 'rame'],
      ['CRAYON HB', 100, 50, 120, 'piece'],
      ['GOMME', 100, 40, 90, 'piece'],
      ['REGLE 30CM', 300, 150, 50, 'piece'],
      ['CALCULATRICE', 3500, 2200, 8, 'piece'],
      ['CARTABLE ECOLIER', 8000, 5500, 6, 'piece'],
    ],
  },
  {
    cat: { name: 'QUINCAILLERIE', icon: 'build' },
    items: [
      ['AMPOULE LED 9W', 1200, 750, 35, 'piece'],
      ['AMPOULE LED 15W', 1800, 1200, 20, 'piece'],
      ['PILE AA LOT DE 4', 1000, 600, 40, 'lot'],
      ['PILE AAA LOT DE 4', 1000, 600, 32, 'lot'],
      ['RALLONGE 3M', 2500, 1700, 12, 'piece'],
      ['CADENAS MOYEN', 1800, 1100, 16, 'piece'],
      ['RUBAN ADHESIF', 600, 350, 30, 'rouleau'],
      ['MARTEAU', 3500, 2300, 7, 'piece'],
      ['JEU DE TOURNEVIS', 4000, 2600, 9, 'jeu'],
      ['CLOUS 1KG', 1500, 1000, 15, 'paquet'],
    ],
  },
  {
    cat: { name: 'VETEMENTS', icon: 'clothes' },
    items: [
      ['T-SHIRT COTON', 4000, 2200, 24, 'piece'],
      ['CHEMISE HOMME', 9000, 5500, 12, 'piece'],
      ['PAGNE WAX 6 YARDS', 15000, 10000, 10, 'piece'],
      ['ROBE FEMME', 12000, 7500, 8, 'piece'],
      ['PANTALON JEAN', 10000, 6500, 14, 'piece'],
      ['CHAUSSETTES LOT 3', 1500, 800, 30, 'lot'],
      ['CASQUETTE', 3000, 1600, 18, 'piece'],
      ['SANDALES', 5500, 3200, 16, 'paire'],
    ],
  },
  {
    cat: { name: 'PHARMACIE', icon: 'health' },
    items: [
      ['PARACETAMOL 500MG', 500, 280, 60, 'plaquette'],
      ['ALCOOL 70 250ML', 800, 500, 30, 'flacon'],
      ['COMPRESSES STERILES', 600, 350, 40, 'sachet'],
      ['PANSEMENTS BOITE', 1200, 750, 25, 'boite'],
      ['SERUM PHYSIOLOGIQUE', 700, 400, 28, 'flacon'],
      ['THERMOMETRE', 3500, 2200, 8, 'piece'],
      ['MASQUES BOITE 50', 2500, 1600, 12, 'boite'],
    ],
  },
  {
    cat: { name: 'MAISON', icon: 'home' },
    items: [
      ['SEAU PLASTIQUE 20L', 2500, 1600, 15, 'piece'],
      ['BASSINE PLASTIQUE', 1800, 1100, 18, 'piece'],
      ['BALAI', 1500, 900, 20, 'piece'],
      ['SERPILLIERE', 1200, 700, 22, 'piece'],
      ['ASSIETTES LOT 6', 4500, 3000, 10, 'lot'],
      ['VERRES LOT 6', 3500, 2200, 12, 'lot'],
      ['MARMITE 5L', 8000, 5500, 6, 'piece'],
      ['NATTE', 3000, 1900, 14, 'piece'],
    ],
  },
];

export async function hasDemoData(): Promise<boolean> {
  return (await db.products.count()) > 0;
}

/** Ajoute le catalogue de démonstration. Les données existantes restent. */
export async function loadDemoData(): Promise<{ categories: number; products: number }> {
  const existingCats = await db.categories.count();
  let position = existingCats;

  let catCount = 0;
  let prodCount = 0;

  for (const block of CATALOG) {
    // Une catégorie déjà présente est réutilisée : relancer la démonstration
    // ne doit pas créer « BOISSONS » en double.
    const all = await db.categories.toArray();
    let cat = all.find((c) => c.name === block.cat.name);

    if (!cat) {
      cat = {
        id: uid(),
        name: block.cat.name,
        icon: block.cat.icon,
        position: position++,
        archived: false,
        updatedAt: now(),
      } satisfies Category;
      await db.categories.add(cat);
      catCount += 1;
    }

    for (const [name, price, cost, stock, unit] of block.items) {
      const already = await db.products.filter((p) => p.name === name).first();
      if (already) continue;

      const id = uid();
      const row: Product = {
        id,
        name,
        categoryId: cat.id,
        barcode: generateInternalBarcode(),
        sku: null,
        price,
        cost,
        stock: 0,
        stockAlert: Math.max(3, Math.round(stock * 0.15)),
        unit,
        image: null,
        tags: [],
        archived: false,
        updatedAt: now(),
      };
      await db.products.add(row);

      // Le stock entre par un mouvement, comme n'importe quelle livraison :
      // le journal reste cohérent avec la quantité affichée.
      await applyStockMovement({
        productId: id, delta: stock, reason: 'initial',
        note: 'Données de démonstration',
      });

      prodCount += 1;
    }
  }

  await logAudit({
    entity: 'system', entityId: 'demo', action: 'create',
    after: { name: 'Démonstration', categories: catCount, products: prodCount },
  });

  return { categories: catCount, products: prodCount };
}

/**
 * Efface produits, catégories et mouvements de stock.
 * Les ventes déjà encaissées sont conservées : les supprimer fausserait
 * la comptabilité, et ce n'est pas ce que demande « retirer le catalogue ».
 */
export async function clearCatalog(): Promise<void> {
  await db.transaction('rw', db.products, db.categories, db.stockMovements, db.auditLogs,
    async () => {
      await db.stockMovements.clear();
      await db.products.clear();
      await db.categories.clear();
    });
  await logAudit({ entity: 'system', entityId: 'demo', action: 'delete' });
}


/**
 * Expose les outils en console, uniquement en développement.
 * `import.meta.env.DEV` vaut false dans le build livré au client : le code
 * de ce bloc est alors retiré à la compilation, il ne part même pas dans
 * le fichier final.
 */
export function exposeDevTools(): void {
  if (!import.meta.env.DEV) return;

  (window as unknown as Record<string, unknown>).gestock = {
    demo: async () => {
      const r = await loadDemoData();
      console.info(`Gestock : ${r.products} produits, ${r.categories} catégories ajoutés.`);
      console.info('Rechargez la page pour les voir.');
      return r;
    },
    clear: async () => {
      await clearCatalog();
      console.info('Gestock : catalogue vidé. Les ventes sont conservées.');
      console.info('Rechargez la page.');
    },
  };

  console.info(
    '%cGestock%c  gestock.demo() pour charger le catalogue de test, gestock.clear() pour le vider.',
    'background:#10715a;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700',
    'color:#4a5058',
  );
}
