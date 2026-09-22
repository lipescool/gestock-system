Écrit pour : celui qui reprendra l'impression d'étiquettes — vous dans six mois, ou un autre développeur.

# Étiquettes TSPL

Comment Gestock imprime ses étiquettes de rayon, et pourquoi de cette
façon. Le chemin a été long : ce document existe pour qu'on ne le
refasse pas.

---

## Le matériel visé

Les imprimantes d'étiquettes vendues en Afrique de l'Ouest sous des
dizaines de marques : POS-90IV, YJ-9203, « BlueTooth Printer »,
« BLUETOOTH LABEL », Xprinter XP-…

Toutes parlent **TSPL**, pas ESC/POS. Ce sont deux langages
différents :

| | Sert à | Commande |
|---|---|---|
| ESC/POS | tickets de caisse | un rouleau qui défile |
| TSPL | étiquettes | une vignette de taille connue |

Envoyer de l'ESC/POS à une étiqueteuse ne produit **rien** — pas
d'erreur, pas de papier, rien. C'est ce qui a fait croire à une panne
pendant les premiers essais.

## Reconnaître la machine

Un commerçant ne sait pas ce qu'est TSPL et n'a pas à l'apprendre.
Gestock le devine au nom Bluetooth, qui trahit presque toujours la
famille — voir `NOMS_TSPL` dans `src/print/tspl.ts`.

En cas de doute, on suppose ESC/POS : une étiqueteuse qui en reçoit ne
sort rien, tandis qu'une imprimante à tickets qui reçoit du TSPL
crache des pages de charabia. L'erreur coûte moins cher dans un sens
que dans l'autre.

---

## Le texte : ne pas l'écrire en TSPL

C'est le point central, et celui qui a coûté trois tentatives.

La commande `TEXT` pose le texte par son **coin gauche**. Pour le
centrer, il faut connaître sa largeur. Or cette largeur dépend de
chaque lettre : un « I » est plus étroit qu'un « M ».

Estimer « tant de points par caractère » ne marche pas :

- à 12 points, les noms partaient trop à droite ;
- à 16 points, ils partaient trop à gauche ;
- et l'erreur grandissait avec la longueur du mot, si bien que deux
  étiquettes voisines n'étaient pas décalées pareil.

**La solution est de dessiner l'étiquette avant de l'imprimer.** Le
navigateur mesure alors la largeur réelle du texte — `fillText` avec
`textAlign: 'center'` s'en charge seul — et le centrage devient exact
quel que soit le contenu.

L'image part ensuite en `BITMAP`, que ces imprimantes comprennent
aussi bien que les commandes de texte.

C'est la méthode de Warishop, documentée dans son propre fichier :

> « Le point clé reste le même : `TextPainter` mesure la largeur
> réelle. C'est ce qui rend le centrage exact quel que soit le
> texte. »

Voir `src/print/tsplBitmap.ts`.

---

## Les réglages qui ne doivent pas bouger

Éprouvés sur le matériel, pas déduits d'une documentation.

```
DENSITY 15        chaleur de la tête : noir franc sans baver
SPEED 4           au-delà, le tracé s'affadit
REFERENCE 12,0    ces imprimantes n'attaquent pas au bord exact
GAP 2 mm          entre deux planches pré-découpées
GAP 0 mm          sur un rouleau continu (papier ≤ 60 mm)
```

**`REFERENCE 12,0` place correctement les cadres.** Mis à zéro pour
« corriger » un décalage du contenu, il a déplacé toute la planche —
alors que les cadres étaient bons. Le décalage venait du texte, pas de
la feuille.

## Le format `BITMAP`

```
BITMAP 0,0,<largeur_en_octets>,<hauteur_en_points>,0,<données>
```

Trois pièges :

- la largeur est en **octets**, soit les points divisés par huit,
  arrondi au supérieur ;
- **un bit à zéro imprime un point**, un bit à un laisse du blanc —
  l'inverse de l'intuition ;
- sans fond blanc sur la toile, les pixels transparents deviennent
  noirs et l'étiquette sort entièrement sombre.

## La grille

Le format dit combien de vignettes tiennent sur la feuille — voir
`SHEET_FORMATS` dans `src/lib/barcode.ts` :

| Papier | Grille | Vignettes |
|---|---|---|
| 58 × 40 | 1 × 1 | 1 |
| 60 × 40 | 1 × 1 | 1 |
| 80 × 80 | 2 × 3 | 6 |
| 100 × 100 | 2 × 4 | 8 |
| A4 | 4 × 10 | 40 |

Chaque **exemplaire** occupe sa propre cellule : demander trois
étiquettes d'un produit en remplit trois, pas une imprimée trois fois
au même endroit. Au-delà d'une feuille, on enchaîne.

## Les proportions

Réglées à l'œil sur papier, après plusieurs essais :

- **nom** : 10 % de la hauteur de cellule
- **prix** : 11 %
- **code-barres** : 72 % de la place restante

Le code ne prend pas toute la hauteur : c'est sa **largeur** qui
compte pour la douchette, pas sa hauteur. À pleine hauteur il
s'étirait sur toute la vignette pour rien.

Le bloc entier — nom, code, prix — est **mesuré avant d'être tracé**,
puis posé au milieu de la cellule. Sans cela, réduire le code-barres
laissait un blanc en bas et tout remontait vers le haut.

---

## Ce qui a fait perdre du temps

**Chercher avant de mesurer.** Trois corrections du centrage ont été
tentées sur des estimations de largeur, alors qu'une seule impression
d'essai aurait montré que la voie était mauvaise.

**Changer ce qui marchait.** Les cadres étaient bons — c'était dit
explicitement — et `REFERENCE` a quand même été modifié. La correction
a cassé la disposition sans régler le problème.

**Ne pas regarder Warishop plus tôt.** La solution y était, éprouvée
sur le même matériel, avec sa documentation. Trois tentatives auraient
été évitées.

---

## Où se trouve quoi

| Fichier | Rôle |
|---|---|
| `src/print/tspl.ts` | Réglages, reconnaissance du langage, commandes de texte (conservées pour référence) |
| `src/print/tsplBitmap.ts` | **Le rendu réellement utilisé** : dessin puis envoi en image |
| `src/print/service.ts` | Aiguillage entre ESC/POS et TSPL |
| `src/pages/LabelSettings.tsx` | Réglages : imprimante, format, exemplaires |
| `src/lib/barcode.ts` | Formats de planche, codes-barres internes |

## Documentation constructeur

Manuel TSPL complet : `C:\Users\user\Downloads\YJ-9203 Development\`
— **Label Printer Programmer Manual.pdf**
