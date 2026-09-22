/**
 * Écriture d'archives ZIP, sans bibliothèque.
 *
 * Un fichier .xlsx est une archive ZIP contenant des documents XML. Pour
 * en produire un, il faut donc savoir écrire un ZIP — c'est le seul
 * obstacle, et il tient en une centaine de lignes.
 *
 * Les fichiers sont stockés sans compression (méthode 0). Un tableau de
 * quelques milliers de lignes pèse quelques centaines de kilooctets ;
 * embarquer un algorithme de compression pour les réduire coûterait plus
 * cher que le gain.
 */

interface Entry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

/* Table de contrôle CRC-32, calculée une fois au premier appel. */
let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** Somme de contrôle exigée par le format ZIP pour chaque fichier. */
function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Écriture des entiers en petit-boutiste, comme l'exige le format. */
class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  bytes(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }

  u16(n: number): void {
    this.bytes(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.bytes(new Uint8Array([
      n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff,
    ]));
  }

  build(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/**
 * Assemble une archive à partir d'un ensemble de fichiers.
 *
 * @param files  chemin dans l'archive → contenu texte
 */
export function makeZip(files: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const w = new Writer();
  const entries: Entry[] = [];

  // Les dates sont figées : le format MS-DOS ne sert à rien ici, et un
  // horodatage variable rendrait deux exports identiques différents.
  const dosTime = 0;
  const dosDate = 0x2821; // 1er janvier 2000

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const offset = w.length;

    // En-tête local
    w.u32(0x04034b50);
    w.u16(20);          // version minimale
    w.u16(0x0800);      // noms de fichiers en UTF-8
    w.u16(0);           // méthode : stocké, sans compression
    w.u16(dosTime);
    w.u16(dosDate);
    w.u32(crc);
    w.u32(data.length); // taille compressée
    w.u32(data.length); // taille réelle
    w.u16(nameBytes.length);
    w.u16(0);           // pas de champ supplémentaire
    w.bytes(nameBytes);
    w.bytes(data);

    entries.push({ name, data, crc, offset });
  }

  // Répertoire central : la table des matières de l'archive.
  const dirStart = w.length;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    w.u32(0x02014b50);
    w.u16(20);          // version d'écriture
    w.u16(20);          // version minimale de lecture
    w.u16(0x0800);
    w.u16(0);
    w.u16(dosTime);
    w.u16(dosDate);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(nameBytes.length);
    w.u16(0);           // champ supplémentaire
    w.u16(0);           // commentaire
    w.u16(0);           // numéro de disque
    w.u16(0);           // attributs internes
    w.u32(0);           // attributs externes
    w.u32(e.offset);
    w.bytes(nameBytes);
  }

  // La taille du répertoire est relevée avant d'écrire le bloc final :
  // mesurée en cours d'écriture, elle incluait les douze octets déjà
  // posés et l'archive devenait illisible.
  const dirSize = w.length - dirStart;

  // Fin du répertoire central.
  w.u32(0x06054b50);
  w.u16(0);                        // disque courant
  w.u16(0);                        // disque du répertoire
  w.u16(entries.length);
  w.u16(entries.length);
  w.u32(dirSize);
  w.u32(dirStart);
  w.u16(0);                        // commentaire

  return new Blob([w.build() as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
