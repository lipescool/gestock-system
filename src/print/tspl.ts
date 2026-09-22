/**
 * Étiquettes TSPL.
 *
 * Les imprimantes d'étiquettes ne parlent pas le même langage que les
 * imprimantes à tickets : ESC/POS commande un rouleau qui défile, TSPL
 * décrit une vignette de taille connue, avec des positions en points.
 * Envoyer de l'ESC/POS à une étiqueteuse ne produit rien.
 *
 * Les réglages qui suivent — densité, vitesse, écart entre vignettes —
 * viennent de Warishop, où ils ont été éprouvés sur les machines mêmes
 * que vise Gestock : POS-90IV, YJ-9203, et les « BlueTooth Printer »
 * vendues sous des dizaines de noms.
 */

/**
 * Fin de ligne attendue par ces imprimantes : retour chariot puis saut
 * de ligne, comme sur un télétype. Un simple saut ne suffit pas, la
 * commande est ignorée sans rien signaler.
 */
const FIN = String.fromCharCode(13, 10);

/** Huit points par millimètre : la résolution de ces imprimantes. */
const POINTS_PAR_MM = 8;

export interface ReglagesTspl {
  /** Taille du papier, en millimètres. */
  largeurMm: number;
  hauteurMm: number;
  /** Grille d'étiquettes sur la feuille. Une planche 100 × 100 en
   *  porte huit ; un rouleau étroit, une seule. */
  colonnes: number;
  rangees: number;
  /** Blanc entre deux cellules, en millimètres. */
  margeMm: number;
  /** Écart entre deux feuilles. Zéro pour un rouleau continu. */
  gapMm: number;
  /** Chaleur de la tête : 15 donne un noir franc sans baver. */
  densite: number;
  /** Vitesse d'entraînement. Au-delà de 4, le tracé s'affadit. */
  vitesse: number;
  /** Décalage du tracé, pour compenser un papier mal centré. */
  referenceX: number;
  referenceY: number;
}

export const REGLAGES_PAR_DEFAUT: ReglagesTspl = {
  largeurMm: 58,
  hauteurMm: 40,
  colonnes: 1,
  rangees: 1,
  margeMm: 2,
  /* Un rouleau étroit est le plus souvent continu ; au-delà, les
     vignettes sont pré-découpées avec deux millimètres entre elles. */
  gapMm: 0,
  densite: 15,
  vitesse: 4,
  /* Douze points de décalage, mesurés sur le matériel : ces
     imprimantes n'attaquent pas le papier au bord exact. La valeur
     vient de Warishop, où elle a été calée sur les mêmes machines —
     elle place correctement les cadres, et ne doit pas bouger. */
  referenceX: 12,
  referenceY: 0,
};

/** Une étiquette à imprimer. */
export interface EtiquetteTspl {
  nom: string;
  codeBarres: string;
  prix: string;
  /** Combien d'exemplaires de celle-ci. */
  exemplaires: number;
}

/**
 * En-tête commun : il décrit le papier avant tout tracé.
 *
 * L'ordre compte — l'imprimante refuse `CLS` avant de connaître la
 * taille de la vignette.
 */
function entete(r: ReglagesTspl): string {
  return `SIZE ${r.largeurMm} mm,${r.hauteurMm} mm${FIN}`
       + `GAP ${r.gapMm} mm,0 mm${FIN}`
       + `DIRECTION 1${FIN}`
       + `DENSITY ${r.densite}${FIN}`
       + `SPEED ${r.vitesse}${FIN}`
       + `REFERENCE ${r.referenceX},${r.referenceY}${FIN}`
       + `CLS${FIN}`;
}

/**
 * Largeur d'un caractère en police 2, en points.
 *
 * Mesurée sur le matériel : la documentation annonce douze, mais ces
 * imprimantes en tracent seize. Un centrage calculé sur la mauvaise
 * valeur décale d'autant plus que le texte est long.
 */
const LARGEUR_CAR = 16;

/** Abscisse d'un texte centré, sans jamais sortir de la cellule. */
function centrer(v: string, centre: number, mini: number): number {
  return Math.max(mini + 4, Math.round(centre - (v.length * LARGEUR_CAR) / 2));
}

/** Protège une chaîne : les guillemets termineraient la commande. */
function texte(v: string): string {
  return v.replace(/["\\]/g, '').trim();
}

/**
 * Trace une vignette dans sa cellule.
 *
 * Les positions sont calculées depuis la taille de la cellule, et non
 * fixées d'avance : la même fonction sert une vignette seule sur un
 * rouleau 58 mm et l'une des huit d'une planche 100 × 100.
 */
function cellule(
  e: EtiquetteTspl,
  x0: number,
  y0: number,
  largeur: number,
  hauteur: number,
  opts: { avecNom?: boolean; avecPrix?: boolean },
): string {
  const avecNom = opts.avecNom ?? true;
  const avecPrix = opts.avecPrix ?? true;

  let corps = '';
  let y = y0 + 8;

  /* Le code-barres est calculé en premier, bien qu'il s'imprime au
     milieu : c'est lui qui fixe l'axe. Le nom et le prix se centrent
     ensuite sur cet axe, et non sur la cellule — sinon les trois
     éléments sont chacun centrés à leur façon et rien ne s'aligne. */
  const modules = e.codeBarres.length * 11 + 35;   // Code 128, marges comprises
  const narrow = Math.max(1, Math.min(3, Math.floor((largeur - 16) / modules)));
  const largeurCode = modules * narrow;

  const xCode = Math.min(
    x0 + largeur - largeurCode - 4,
    Math.max(x0 + 4, Math.round(x0 + (largeur - largeurCode) / 2)),
  );

  /** Axe commun : le milieu réel du code-barres imprimé. */
  const centre = xCode + Math.round(largeurCode / 2);

  /* Le nom en haut, centré dans sa cellule.
     
     `TEXT` pose le texte par son coin gauche : pour le centrer, il
     faut retrancher la moitié de sa largeur — d'où la mesure
     ci-dessous. La police 2 de ces imprimantes fait seize points de
     large par caractère, pas douze : avec la mauvaise valeur, les
     noms partaient de travers, chacun décalé selon sa longueur. */
  if (avecNom && e.nom) {
    const max = Math.floor((largeur - 8) / LARGEUR_CAR);
    const nom = texte(e.nom).slice(0, max);
    corps += `TEXT ${centrer(nom, centre, x0)},${y},"2",0,1,1,"${nom}"${FIN}`;
    y += 28;
  }

  /* Sa hauteur se déduit de ce qui reste, en laissant de quoi écrire
     le prix dessous. */
  const reste = (y0 + hauteur) - y - (avecPrix ? 34 : 8);
  const hCode = Math.max(30, Math.min(80, reste));

  corps += `BARCODE ${xCode},${y},"128",${hCode},1,0,${narrow},${narrow * 2},`
         + `"${texte(e.codeBarres)}"${FIN}`;
  y += hCode + 26;

  /* Le prix en bas, en police 2 comme le nom : en plus gros, il
     mangeait la vignette sans rien apporter — c'est le code-barres
     qu'on scanne, le prix se lit de près. */
  if (avecPrix && e.prix) {
    const prix = texte(e.prix);
    corps += `TEXT ${centrer(prix, centre, x0)},${y},"2",0,1,1,"${prix}"${FIN}`;
  }

  return corps;
}

/**
 * Planche d'étiquettes, remplie cellule par cellule.
 *
 * Le format dit combien de vignettes tiennent sur la feuille : huit
 * sur une planche 100 × 100, une seule sur un rouleau étroit. Quand il
 * y a plus d'étiquettes que de cellules, on enchaîne les feuilles.
 *
 * Tout part en un seul envoi : reconnecter le Bluetooth entre chaque
 * feuille prendrait plusieurs secondes.
 */
export function construirePlanche(
  etiquettes: EtiquetteTspl[],
  r: ReglagesTspl,
  opts: { avecNom?: boolean; avecPrix?: boolean } = {},
): Uint8Array {
  /* Chaque exemplaire occupe sa propre cellule : demander trois
     étiquettes d'un produit en remplit trois, pas une imprimée trois
     fois au même endroit. */
  const toutes = etiquettes.flatMap((e) =>
    Array.from({ length: Math.max(1, e.exemplaires) }, () => e));

  const colonnes = Math.max(1, r.colonnes);
  const rangees = Math.max(1, r.rangees);
  const parFeuille = colonnes * rangees;

  const marge = r.margeMm * POINTS_PAR_MM;
  const largeurCell = Math.floor(
    (r.largeurMm * POINTS_PAR_MM - marge * (colonnes + 1)) / colonnes);
  const hauteurCell = Math.floor(
    (r.hauteurMm * POINTS_PAR_MM - marge * (rangees + 1)) / rangees);

  const feuilles: string[] = [];

  for (let debut = 0; debut < toutes.length; debut += parFeuille) {
    const lot = toutes.slice(debut, debut + parFeuille);
    let corps = '';

    lot.forEach((e, i) => {
      const col = i % colonnes;
      const rang = Math.floor(i / colonnes);
      const x = marge + col * (largeurCell + marge);
      const y = marge + rang * (hauteurCell + marge);

      corps += cellule(e, x, y, largeurCell, hauteurCell, opts);

      /* Un cadre autour de chaque vignette : sur une planche à
         découper, il indique où passer les ciseaux. Inutile sur un
         rouleau, où la découpe est déjà faite. */
      if (parFeuille > 1) {
        corps += `BOX ${x},${y},${x + largeurCell},${y + hauteurCell},2${FIN}`;
      }
    });

    feuilles.push(entete(r) + corps + `PRINT 1,1${FIN}`);
  }

  return encoder(feuilles.join(''));
}

/** Une étiquette, ou plusieurs exemplaires de la même. */
export function construireEtiquette(
  e: EtiquetteTspl,
  r: ReglagesTspl,
  opts: { avecNom?: boolean; avecPrix?: boolean } = {},
): Uint8Array {
  return construirePlanche([e], r, opts);
}

/** Étiquette d'essai, pour vérifier le calage du papier. */
export function construireEssai(r: ReglagesTspl): Uint8Array {
  return construireEtiquette(
    {
      nom: 'PRODUIT D ESSAI',
      codeBarres: '2003050875886',
      prix: '2 500 FCFA',
      exemplaires: 1,
    },
    r,
  );
}

/**
 * Encode en Windows-1252, comme le veulent ces imprimantes.
 *
 * Les caractères typographiques — apostrophe courbe, espace fine,
 * tiret cadratin — n'y existent pas et sortiraient en « ? ». On leur
 * substitue leur équivalent simple.
 */
function encoder(s: string): Uint8Array {
  const propre = s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u202F\u00A0\u2009]/g, ' ')
    .replace(/\u2026/g, '...');

  const out = new Uint8Array(propre.length);
  for (let i = 0; i < propre.length; i++) {
    const c = propre.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f; // « ? » pour ce qui reste hors table
  }
  return out;
}

/* ------------------------------------------------------------------ *
   Reconnaître le langage d'une imprimante

   Un commerçant ne sait pas ce qu'est TSPL, et n'a pas à le savoir :
   c'est l'application qui doit reconnaître la machine et lui parler
   comme il faut.

   Les noms ci-dessous viennent de Warishop, où ils ont été relevés sur
   le matériel réellement vendu en Afrique de l'Ouest. Ces imprimantes
   se vendent sous des dizaines de marques, mais leur nom Bluetooth
   trahit presque toujours la famille.
 * ------------------------------------------------------------------ */

/** Fragments de nom qui désignent une étiqueteuse TSPL. */
const NOMS_TSPL = [
  'LABEL',            // « BLUETOOTH LABEL », « GPRINTER LABEL »
  '90-IV',            // POS-90IV et ses clones
  'YJ-9203',
  'XP-',              // Xprinter, gamme étiquettes
  'ZEBRA',
  'GODEX',
  'TSC ',
  'TSPL',
  'BLUETOOTH PRINTER',
  'ETIQUET',          // certains modèles francisés
];

/**
 * Quel langage parle cette imprimante ?
 *
 * En cas de doute, ESC/POS : une étiqueteuse qui reçoit de l'ESC/POS
 * ne sort rien, tandis qu'une imprimante à tickets qui reçoit du TSPL
 * crache des pages de charabia — l'erreur coûte moins cher dans un
 * sens que dans l'autre.
 */
export function reconnaitreLangage(nom: string): 'escpos' | 'tspl' {
  const majuscules = nom.toUpperCase();
  return NOMS_TSPL.some((p) => majuscules.includes(p)) ? 'tspl' : 'escpos';
}
