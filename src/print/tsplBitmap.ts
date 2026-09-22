/**
 * Étiquettes dessinées, puis envoyées en image.
 *
 * ## Pourquoi ne pas écrire le texte en TSPL
 *
 * La commande `TEXT` pose le texte par son coin gauche. Pour le
 * centrer, il faut connaître sa largeur — et cette largeur dépend de
 * chaque lettre : un « I » est plus étroit qu'un « M ». L'estimer à
 * tant de points par caractère décale d'autant plus que le mot est
 * long, et le décalage change d'une étiquette à l'autre.
 *
 * Warishop a résolu cela en dessinant l'étiquette avant de
 * l'imprimer : le navigateur mesure alors la largeur réelle du texte,
 * et le centrage devient exact quel que soit son contenu. C'est cette
 * méthode qui est reprise ici — elle est éprouvée sur le matériel
 * même que vise Gestock.
 *
 * L'image part ensuite en `BITMAP`, que ces imprimantes comprennent
 * aussi bien que les commandes de texte.
 */

import JsBarcode from 'jsbarcode';
import type { EtiquetteTspl, ReglagesTspl } from './tspl';

/** Huit points par millimètre : la résolution de ces imprimantes. */
const POINTS_PAR_MM = 8;

/** Fin de ligne attendue par les commandes TSPL. */
const FIN = String.fromCharCode(13, 10);

/**
 * Dessine une planche et rend la commande d'impression.
 *
 * Tout est tracé sur une seule image de la taille du papier : les
 * cadres, les noms, les codes-barres et les prix. L'imprimante
 * reçoit une image, elle n'a rien à interpréter.
 */
export async function construirePlancheBitmap(
  etiquettes: EtiquetteTspl[],
  r: ReglagesTspl,
  opts: { avecNom?: boolean; avecPrix?: boolean } = {},
): Promise<Uint8Array> {
  const avecNom = opts.avecNom ?? true;
  const avecPrix = opts.avecPrix ?? true;

  /* Chaque exemplaire occupe sa propre cellule : demander trois
     étiquettes d'un produit en remplit trois. */
  const toutes = etiquettes.flatMap((e) =>
    Array.from({ length: Math.max(1, e.exemplaires) }, () => e));

  const colonnes = Math.max(1, r.colonnes);
  const rangees = Math.max(1, r.rangees);
  const parFeuille = colonnes * rangees;

  const largeurPts = r.largeurMm * POINTS_PAR_MM;
  const hauteurPts = r.hauteurMm * POINTS_PAR_MM;

  const marge = r.margeMm * POINTS_PAR_MM;
  const largeurCell = Math.floor(
    (largeurPts - marge * (colonnes + 1)) / colonnes);
  const hauteurCell = Math.floor(
    (hauteurPts - marge * (rangees + 1)) / rangees);

  const morceaux: Uint8Array[] = [];

  for (let debut = 0; debut < toutes.length; debut += parFeuille) {
    const lot = toutes.slice(debut, debut + parFeuille);

    const toile = document.createElement('canvas');
    toile.width = largeurPts;
    toile.height = hauteurPts;
    const ctx = toile.getContext('2d');
    if (!ctx) throw new Error('CANVAS_INDISPONIBLE');

    /* Fond blanc : sans lui, les pixels transparents deviennent noirs
       à la conversion et l'étiquette sort entièrement sombre. */
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, largeurPts, hauteurPts);
    ctx.fillStyle = '#000';

    for (let i = 0; i < lot.length; i++) {
      const col = i % colonnes;
      const rang = Math.floor(i / colonnes);
      const x = marge + col * (largeurCell + marge);
      const y = marge + rang * (hauteurCell + marge);

      /* Un cadre autour de chaque vignette, pour savoir où couper.
         Inutile sur un rouleau, où la découpe est déjà faite. */
      if (parFeuille > 1) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.strokeRect(x + 1, y + 1, largeurCell - 2, hauteurCell - 2);
      }

      dessinerCellule(ctx, lot[i], x, y, largeurCell, hauteurCell,
                      { avecNom, avecPrix });
    }

    morceaux.push(versCommande(ctx, largeurPts, hauteurPts, r));
  }

  const total = morceaux.reduce((s, m) => s + m.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const m of morceaux) {
    out.set(m, at);
    at += m.length;
  }
  return out;
}

/**
 * Trace une vignette : nom, code-barres, prix.
 *
 * Tout est centré sur l'axe de la cellule, avec la largeur mesurée
 * plutôt qu'estimée — c'est ce qui rend l'alignement exact.
 */
function dessinerCellule(
  ctx: CanvasRenderingContext2D,
  e: EtiquetteTspl,
  x0: number,
  y0: number,
  largeur: number,
  hauteur: number,
  opts: { avecNom: boolean; avecPrix: boolean },
): void {
  const centre = x0 + largeur / 2;
  const dispo = largeur - 16;

  /* Les tailles se règlent sur la cellule : une vignette 58 × 40 et
     une case de planche 100 × 100 n'ont pas la même place. Elles
     restent discrètes — sur une étiquette de rayon, c'est le
     code-barres qu'on cherche, le nom et le prix se lisent de près. */
  const tailleNom = Math.max(9, Math.min(15, Math.round(hauteur * 0.10)));
  const taillePrix = Math.max(10, Math.min(16, Math.round(hauteur * 0.11)));

  /* Le bloc est mesuré avant d'être tracé, puis posé au milieu de la
     hauteur. Sans cela, réduire le code-barres laissait un blanc en
     bas et tout le contenu remontait vers le haut de la vignette. */
  const hNom = opts.avecNom && e.nom ? tailleNom + 6 : 0;
  const hPrix = opts.avecPrix && e.prix ? taillePrix + 6 : 0;

  /* Le code ne prend qu'une part de la place restante : à pleine
     hauteur il s'étirait sur toute la vignette, alors que la
     douchette n'a pas besoin de barres si longues — c'est leur
     largeur qui compte pour la lecture, pas leur hauteur. */
  const libre = hauteur - 16 - hNom - hPrix;
  const hCode = Math.max(24, Math.round(libre * 0.72));

  const hBloc = hNom + hCode + hPrix;
  let y = y0 + Math.round((hauteur - hBloc) / 2);

  if (opts.avecNom && e.nom) {
    ctx.font = `600 ${tailleNom}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    /* `fillText` centre lui-même quand l'alignement est « center » :
       il mesure le texte pour nous, et c'est précisément ce qui
       manquait au calcul en TSPL. Le troisième argument borne la
       largeur — un nom trop long est resserré plutôt que débordant. */
    ctx.fillText(e.nom.toUpperCase(), centre, y, dispo);
    y += hNom;
  }

  dessinerCodeBarres(ctx, e.codeBarres, x0 + 8, y, dispo, hCode);
  y += hCode;

  if (opts.avecPrix && e.prix) {
    ctx.font = `700 ${taillePrix}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(e.prix, centre, y, dispo);
  }
}

/**
 * Trace un code-barres Code 128.
 *
 * Il est dessiné dans une image hors écran puis reporté à l'échelle
 * voulue : la bibliothèque produit un SVG, qu'on ne peut pas peindre
 * directement sur une toile.
 */
function dessinerCodeBarres(
  ctx: CanvasRenderingContext2D,
  valeur: string,
  x: number,
  y: number,
  largeur: number,
  hauteur: number,
): void {
  const hors = document.createElement('canvas');

  JsBarcode(hors, valeur, {
    format: 'CODE128',
    /* Un module large de deux points : en dessous, la douchette
       hésite sur les codes de treize chiffres. La mise à l'échelle
       qui suit ramène le tout dans la cellule. */
    width: 2,
    height: Math.max(20, hauteur - 20),
    displayValue: true,
    /* Le numéro se lit à l'œil quand la douchette refuse : il mérite
       d'être lisible, sans manger la hauteur des barres. */
    fontSize: Math.max(11, Math.min(18, Math.round(hauteur * 0.28))),
    font: 'Outfit',
    fontOptions: '',
    textMargin: 1,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  });

  /* Reporté centré, réduit s'il dépasse — jamais agrandi, un
     code-barres étiré perdrait sa lisibilité. */
  const echelle = Math.min(1, largeur / hors.width);
  const w = hors.width * echelle;
  const h = hors.height * echelle;

  ctx.drawImage(hors, x + (largeur - w) / 2, y, w, h);
}

/**
 * Convertit l'image en commande TSPL.
 *
 * `BITMAP` attend un point par bit, huit points par octet, et un bit
 * à zéro pour un point imprimé — l'inverse de l'intuition. La largeur
 * est donnée en octets, d'où l'arrondi au multiple de huit supérieur.
 */
function versCommande(
  ctx: CanvasRenderingContext2D,
  largeur: number,
  hauteur: number,
  r: ReglagesTspl,
): Uint8Array {
  const pixels = ctx.getImageData(0, 0, largeur, hauteur).data;
  const octetsParLigne = Math.ceil(largeur / 8);
  const image = new Uint8Array(octetsParLigne * hauteur);

  for (let y = 0; y < hauteur; y++) {
    for (let xo = 0; xo < octetsParLigne; xo++) {
      let octet = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xo * 8 + bit;
        let sombre = false;

        if (x < largeur) {
          const p = (y * largeur + x) * 4;
          /* Moyenne des trois composantes : le tracé est en noir pur,
             mais le lissage des polices produit des gris. */
          const gris = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
          sombre = gris < 128;
        }

        // Bit à 0 pour un point imprimé, à 1 pour du blanc.
        if (!sombre) octet |= 0x80 >> bit;
      }
      image[y * octetsParLigne + xo] = octet;
    }
  }

  const entete = `SIZE ${r.largeurMm} mm,${r.hauteurMm} mm${FIN}`
    + `GAP ${r.gapMm} mm,0 mm${FIN}`
    + `DIRECTION 1${FIN}`
    + `DENSITY ${r.densite}${FIN}`
    + `SPEED ${r.vitesse}${FIN}`
    + `REFERENCE ${r.referenceX},${r.referenceY}${FIN}`
    + `CLS${FIN}`
    + `BITMAP 0,0,${octetsParLigne},${hauteur},0,`;

  const fin = `${FIN}PRINT 1,1${FIN}`;

  const teteOctets = new TextEncoder().encode(entete);
  const finOctets = new TextEncoder().encode(fin);

  const out = new Uint8Array(teteOctets.length + image.length + finOctets.length);
  out.set(teteOctets, 0);
  out.set(image, teteOctets.length);
  out.set(finOctets, teteOctets.length + image.length);
  return out;
}

/** Étiquette d'essai, pour vérifier le calage du papier. */
export function construireEssaiBitmap(r: ReglagesTspl): Promise<Uint8Array> {
  return construirePlancheBitmap(
    [{
      nom: 'PRODUIT D ESSAI',
      codeBarres: '2003050875886',
      prix: '2 500 FCFA',
      exemplaires: 1,
    }],
    r,
  );
}
