# Gestock — gestion de boutique hors ligne

Application de caisse et de gestion de stock qui fonctionne **sans internet**,
sur MacBook, PC Windows, Android et iPhone. Les données ne quittent jamais
l'appareil.

---

## Démarrer

```bash
npm install
npm run dev      # développement, http://localhost:5173
npm run build    # production, dossier dist/
npm run preview  # vérifier le build
```

Le dossier `dist/` se pose tel quel sur n'importe quel hébergement statique,
ou même sur une clé USB : les chemins sont relatifs (`base: './'`).

---

## Ce qui est en place

### Socle

| Élément | Emplacement |
|---|---|
| Schéma de la base | `src/db/schema.ts` |
| Base IndexedDB (Dexie) | `src/db/index.ts` |
| Journal d'audit et mouvements de stock | `src/db/audit.ts` |
| Données de départ | `src/db/seed.ts` |
| Traductions FR/EN | `src/i18n/seed.ts` |
| Devises et mise en forme | `src/i18n/currencies.ts` |
| Réglages et fonction `t()` | `src/store/settings.ts` |
| Panier et encaissement | `src/store/cart.ts` |
| Rapports par période | `src/lib/reports.ts` |
| Sauvegarde et restauration | `src/lib/backup.ts` |
| Codes-barres et étiquettes | `src/lib/barcode.ts` |

### Impression

Trois transports derrière une seule interface (`src/print/`) :

| Transport | Fonctionne sur | Ne fonctionne pas sur |
|---|---|---|
| **Bluetooth** (Web Bluetooth) | Chrome, Edge — Android, Windows, macOS | Safari, iPhone, iPad |
| **Réseau Wi-Fi** (port 9100) | Tout, y compris iPhone | — (relais requis) |
| **Imprimante système** (dialogue) | Tout, AirPrint inclus | — |

Largeurs gérées : **58 mm** et **80 mm**.

Le relais réseau est un petit programme Node fourni dans `relay/` :

```bash
node relay/relay.js          # port 7777 par défaut
node relay/relay.js 8080     # autre port
```

Il affiche au démarrage l'adresse à saisir dans Gestock. Un navigateur ne peut
pas ouvrir de socket TCP ; ce relais fait le pont vers le port 9100 de
l'imprimante. Il ne se connecte jamais à internet.

Les valeurs TSPL pour les étiquettes reprennent celles validées sur matériel
dans `warishop/IMPRESSION_ETIQUETTES.md` (8 points/mm à 200 dpi, densité 15).

---

## Fonctionnalités

- **Première configuration** — assistant en 6 étapes : langue, boutique,
  devise, compte propriétaire avec code PIN, moyens de paiement, impression.
- **Caisse** — catégories, recherche, douchette code-barres, remises,
  sur place / à emporter / livraison, encaissement avec rendu de monnaie.
- **Bandeau de totaux** — chiffre d'affaires, ventes, panier moyen, dépenses
  et bénéfice, par jour / semaine / mois / année.
- **Stock** — produits, prix d'achat et de vente, seuils d'alerte, ajustements
  motivés, génération de codes-barres internes, planches d'étiquettes.
- **Dépenses** — catégories, moyens de paiement, filtrage par période.
- **Historique** — trois vues distinctes : tickets de vente, mouvements de
  stock, journal d'activité. Chacune a sa couleur et sa mise en forme.
- **Paramètres** — langue, devise, taxe, affichage des images, moyens de
  paiement, impression, sauvegarde.
- **Multilingue** — français et anglais. Aucune chaîne n'est écrite en dur :
  tout passe par `t()` et la table `translations`.
- **Devises** — 15 devises, dont XOF, XAF, MAD, NGN, GHS. Le nombre de
  décimales est respecté (le franc CFA n'en a pas).

---

## Affichage des produits sans image

Dans Paramètres → Affichage, l'interrupteur « Afficher les images des
produits » change la disposition du catalogue :

- **Activé** : vignettes au format 4/3, nom en 14 px sous l'image.
- **Désactivé** : cartes pleines, nom en **19 px gras** sur trois lignes,
  et davantage de colonnes. Le nom devient le repère visuel à la place de
  l'image.

C'est géré par `.grid.with-img` et `.grid.no-img` dans `src/pages/pos.css`.

---

## Sauvegarde

- **Manuelle** : bouton dans Paramètres → Sauvegarde. Télécharge un fichier
  `.gestock.json` avec une somme de contrôle.
- **Automatique** : à l'heure choisie. L'application vérifie l'échéance
  toutes les cinq minutes tant qu'elle est ouverte.

**Limite à connaître** : un navigateur ne peut pas se réveiller seul quand
l'onglet est fermé. Si l'application est fermée à l'heure prévue, la
sauvegarde part **à la prochaine ouverture**, une fois par jour. Pour une
écriture vraiment silencieuse dans un dossier choisi, il faudra passer par
la File System Access API (Chrome/Edge uniquement).

La restauration remplace toutes les données dans une seule transaction :
en cas d'échec, les données d'origine restent en place.

---

## Journal d'activité

Tout passe par `logAudit()` et `applyStockMovement()` : création, modification,
suppression, vente, ajustement, sauvegarde. Le journal ne fait qu'**ajouter** —
aucune ligne n'est jamais réécrite ni supprimée. Le stock et son journal
bougent dans la même transaction : les deux réussissent, ou aucun des deux.

---

## Ce qui reste à faire

1. **Verrouillage par licence** — à cadrer ensemble. L'approche retenue sera
   probablement une clé signée liée à l'empreinte de la machine, vérifiable
   hors ligne.
2. **Écran de connexion par PIN** — le compte est créé à l'installation, mais
   l'application ne demande pas encore le code au démarrage.
3. **Gestion des catégories de produits** — la table existe et la caisse les
   affiche ; il manque l'écran pour les créer et les ordonner.
4. **Remboursements** — le statut existe dans le schéma, l'écran reste à faire.
5. **Plusieurs utilisateurs** — rôles définis (propriétaire, gérant, caissier),
   écran de gestion à construire.
6. **Export PDF / Excel** des rapports.

---

## Choix techniques

**React + Vite + IndexedDB (Dexie)**, sans serveur ni API. Le service worker
met tout en cache à l'installation : dès la deuxième ouverture, l'application
démarre sans réseau.

Le routeur utilise `HashRouter` plutôt que `BrowserRouter` pour qu'un
rafraîchissement fonctionne sans configuration serveur, y compris depuis un
fichier local.

Les montants sont stockés en **unités mineures** (entiers) et non en nombres
décimaux : une addition de centimes en virgule flottante finit toujours par
produire un écart d'un centime.

La police **Outfit** est embarquée dans `public/fonts/`, en cinq graisses.
Aucune requête vers Google Fonts : l'application doit démarrer hors ligne
dès le premier lancement.
