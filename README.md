Écrit pour : un développeur qui reprend le projet, ou vous dans six mois.

# Gestock

Caisse et gestion de boutique, conçue pour fonctionner **sans
connexion**. Tout vit sur le poste du commerçant : le catalogue, les
ventes, le stock, les dépenses, les sauvegardes.

Destinée aux commerces d'Afrique de l'Ouest — francs CFA, français et
anglais, imprimantes thermiques.

---

## Démarrer

```bash
npm install
npm run dev
```

L'application s'ouvre sur `localhost:5173`. Au premier lancement elle
demande une clé de licence : voir plus bas.

```bash
npm run build      # produit dist/
```

## Ce qu'il y a dedans

| Dossier | Contenu |
|---|---|
| `src/pages/` | Les écrans : caisse, stock, dépenses, historique, réglages |
| `src/db/` | Le schéma des données et leur amorçage |
| `src/print/` | Impression : ESC/POS, Bluetooth, USB, réseau, navigateur |
| `src/lib/` | Codes-barres, exports, licences, thèmes, sons |
| `relay/` | Service d'impression installé sur le poste |
| `serveur/` | Service de licences, en PHP |
| `licences/` | Outil de génération des clés — **non publié** |

## Choix qui surprennent

**Rien n'est écrit en dur dans l'interface.** Chaque libellé passe par
une table de traductions, en base. Un commerçant peut reformuler ce
qu'il voit, et sa version survit aux mises à jour.

**Les montants sont des entiers**, en plus petite unité. Le franc CFA
n'a pas de centimes, mais l'application gère aussi les devises qui en
ont — et les nombres à virgule se trompent sur l'argent.

**Les écrans n'affichent rien tant que leurs données ne sont pas
prêtes.** Un compteur qui passe de zéro à sa vraie valeur donne
l'impression que l'application se corrige. Voir `useCachedQuery`.

**Les classes CSS sont préfixées par écran** — `pos-`, `hist-`,
`lic-`. Des noms génériques partagés ont causé plusieurs défauts
difficiles à trouver, où un écran modifiait l'apparence d'un autre.

## Impression

Quatre chemins, dans l'ordre de préférence :

1. **Service local** (`relay/`) — un petit programme sur le poste.
   Seul chemin où le commerçant ne rechoisit jamais son imprimante.
2. **Bluetooth** du navigateur — redemande l'appareil à chaque
   session, c'est une règle de Chrome.
3. **Réseau** — imprimante avec une adresse IP, via le service.
4. **Dialogue du navigateur** — fonctionne partout, un clic par
   ticket. C'est le recours.

Le service se construit ainsi :

```bash
cd relay
node build/service.mjs        # pour essayer
```

L'exécutable autonome se refait avec `--experimental-sea-config`,
voir `relay/build/sea-config.json`.

## Licences

Les clés sont tirées au hasard, pas calculées. L'application embarque
leurs **empreintes**, jamais les clés — ouvrir le code ne donne pas de
licence utilisable.

```bash
cd licences
node generer.mjs 2000
```

Cela produit deux choses : la liste à vendre, et `src/lib/cles.ts`
que l'application embarque.

**Régénérer invalide toutes les clés déjà vendues.**

Le serveur (`serveur/`) repère qu'une même clé tourne sur plusieurs
postes et permet de la couper. Voir `serveur/INSTALLATION.md`.

### Ce que la protection fait, et ne fait pas

Elle empêche un commerçant de donner une copie utilisable à son
voisin. Elle n'empêche pas quelqu'un qui sait programmer de retirer
le contrôle : une application web livre son code au poste qui
l'exécute, et aucune serrure écrite dedans n'y résiste.

C'est assumé. Ce qui protège un logiciel à ce prix, c'est le service
et les mises à jour, pas la serrure.

## Fichiers absents du dépôt

Ils portent des secrets, et sont exclus par `.gitignore` :

| Fichier | Comment le retrouver |
|---|---|
| `serveur/config.php` | Copier `config.exemple.php`, renseigner |
| `serveur/admin.php` | Copier `admin.exemple.php`, choisir un mot de passe |
| `src/lib/cles.ts` | `cd licences && node generer.mjs 2000` |
| `licences/` | L'outil et les clés vendues, à garder hors ligne |
| `relay/build/` | 82 Mo d'exécutable, reconstruit à la demande |

---

© Gestock. Tous droits réservés.
