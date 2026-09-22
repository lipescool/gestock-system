import { db, uid, now } from './index';
import { TRANSLATIONS, LANGS } from '../i18n/seed';
import { logAudit } from './audit';

/**
 * Premier lancement : on charge les traductions et les listes de référence.
 * Aucune donnée commerciale n'est créée — c'est l'assistant de configuration
 * qui s'en charge, avec les réponses du commerçant.
 */
/* Le mode strict de React déclenche les effets deux fois : sans ce
   verrou, deux amorçages partaient en parallèle, tous deux trouvaient
   la base vide, et tous deux inséraient la totalité des traductions. */
let enCours: Promise<void> | null = null;

export function seedIfEmpty(): Promise<void> {
  enCours ??= amorcer().finally(() => { enCours = null; });
  return enCours;
}

async function amorcer(): Promise<void> {
  const already = await db.translations.count();

  // Base déjà installée : on ne réinitialise rien, mais les clés ajoutées
  // depuis doivent arriver, sinon l'écran affiche « set.receipt » au lieu
  // du texte. On complète sans toucher aux traductions modifiées à la main.
  if (already > 0) {
    await dedupliquerTraductions();
    await syncNewTranslations();

    /* Le bas de ticket est arrivé après coup : les boutiques déjà
       installées l'ont vide. On le renseigne une fois, sans écraser
       celui qui aurait été saisi entre-temps. */
    const actuel = await db.settings.get('receiptFooter');
    if (actuel === undefined || actuel.value === '') {
      const merci = TRANSLATIONS.find((r) => r.key === 'set.footerHint');
      if (merci) await db.settings.put({ key: 'receiptFooter', value: merci.fr });
    }
    return;
  }

  await db.transaction('rw', db.translations, db.paymentMethods, db.expenseCategories, async () => {
    // Traductions : une ligne par langue et par clé.
    const rows = TRANSLATIONS.flatMap((row) =>
      LANGS.map((lang) => ({
        lang: lang.code,
        key: row.key,
        value: row[lang.code as 'fr' | 'en'],
      })),
    );
    await db.translations.bulkAdd(rows);

    // Un seul moyen de paiement au départ : les espèces, le seul dont on est
    // sûr qu'il sert dans toutes les boutiques. Le commerçant ajoute les
    // siens avec leurs propres noms — Orange Money, Wave, ou ce qu'il veut.
    await db.paymentMethods.add({
      id: uid(),
      name: 'Espèces',
      icon: 'cash',
      opensDrawer: true,
      requiresRef: false,
      enabled: true,
      position: 0,
      updatedAt: now(),
    });

    const expenseCats = [
      'Achat marchandise', 'Loyer', 'Électricité', 'Eau', 'Transport',
      'Salaires', 'Téléphone / Internet', 'Entretien', 'Taxes', 'Divers',
    ];
    await db.expenseCategories.bulkAdd(
      expenseCats.map((name) => ({ id: uid(), name, updatedAt: now() })),
    );
  });

  /* Le bas de ticket part avec un message plutôt qu'à vide : un reçu
     sans remerciement fait négligé, et le commerçant qui n'y pense pas
     n'a rien à faire pour en avoir un. Il reste modifiable, et le texte
     vient des traductions : rien n'est écrit en dur. */
  const merci = TRANSLATIONS.find((r) => r.key === 'set.footerHint');
  if (merci) {
    await db.settings.put({ key: 'receiptFooter', value: merci.fr });
  }

  await logAudit({ entity: 'system', entityId: 'db', action: 'seed' });
}

/**
 * Met les traductions à jour depuis le code.
 *
 * Les clés nouvelles sont ajoutées, et celles dont le texte a changé
 * dans une nouvelle version sont mises à jour — sauf si le commerçant
 * les a lui-même reformulées depuis les réglages. On distingue les deux
 * grâce à `customized`, posé à true quand une traduction est modifiée
 * à la main.
 */
/**
 * Retire les traductions en double.
 *
 * Un défaut d'amorçage a pu insérer deux fois le même libellé. La
 * synchronisation indexe par clé : elle n'en voyait qu'un exemplaire,
 * ne détectait pas la duplication, et la laissait s'installer.
 */
async function dedupliquerTraductions(): Promise<void> {
  const rows = await db.translations.toArray();

  /* Une ligne retouchée par le commerçant l'emporte sur les autres :
     c'est la seule qui porte un texte qu'il a voulu. À défaut, on garde
     la première venue, elles sont identiques. */
  const gardees = new Map<string, number>();
  for (const r of rows) {
    if (r.id === undefined) continue;
    const cle = `${r.lang}|${r.key}`;
    const dejaGardee = gardees.get(cle);
    if (dejaGardee === undefined) { gardees.set(cle, r.id); continue; }
    if (r.customized) gardees.set(cle, r.id);
  }

  const aGarder = new Set(gardees.values());
  const enTrop = rows
    .filter((r) => r.id !== undefined && !aGarder.has(r.id))
    .map((r) => r.id!);

  if (enTrop.length) await db.translations.bulkDelete(enTrop);
}

async function syncNewTranslations(): Promise<void> {
  const existing = await db.translations.toArray();
  const byKey = new Map(existing.map((r) => [`${r.lang}|${r.key}`, r]));

  const toAdd: { lang: string; key: string; value: string }[] = [];
  const toUpdate: { id: number; value: string }[] = [];

  for (const row of TRANSLATIONS) {
    for (const lang of LANGS) {
      const code = lang.code;
      const fresh = row[code as 'fr' | 'en'];
      const current = byKey.get(`${code}|${row.key}`);

      if (!current) {
        toAdd.push({ lang: code, key: row.key, value: fresh });
      } else if (current.value !== fresh && !current.customized && current.id) {
        // Le libellé a changé dans le code et personne ne l'a retouché :
        // la version du code fait foi, sinon les corrections de formulation
        // n'atteindraient jamais les installations existantes.
        toUpdate.push({ id: current.id, value: fresh });
      }
    }
  }

  /* Un libellé retiré du code doit disparaître des installations
     existantes. Sans cela, un texte supprimé continue de s'afficher
     chez ceux qui avaient déjà l'application : il ne reste que dans
     leur base, et plus personne ne sait d'où il vient. */
  const vivantes = new Set(TRANSLATIONS.map((r) => r.key));
  const obsoletes = existing
    .filter((r) => !vivantes.has(r.key) && r.id !== undefined)
    .map((r) => r.id!);

  if (toAdd.length) await db.translations.bulkAdd(toAdd);
  for (const u of toUpdate) await db.translations.update(u.id, { value: u.value });
  if (obsoletes.length) await db.translations.bulkDelete(obsoletes);
}
