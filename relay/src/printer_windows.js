/**
 * Accès aux imprimantes Windows.
 *
 * Node ne sait pas imprimer : il faut passer par le gestionnaire
 * d'impression du système. PowerShell sert de pont, en compilant à la
 * volée le peu de code C# nécessaire (voir windows.cs). C'est moins
 * direct qu'une bibliothèque compilée, mais ça n'impose au commerçant
 * aucune installation et ça marche sur tout Windows depuis 7.
 */

import { spawn } from 'node:child_process';

/**
 * Pont vers le gestionnaire d'impression de Windows, écrit ici plutôt
 * que dans un fichier voisin : le service est distribué en un seul
 * exécutable, où il n'y a plus de fichier à lire à côté.
 */
const PONT_CSHARP = String.raw`
// Pont vers le gestionnaire d'impression de Windows.
//
// L'impression thermique exige d'envoyer les octets ESC/POS tels quels.
// Toute autre voie — un pilote graphique, une conversion en image — les
// réinterpréterait et l'imprimante recevrait autre chose que ce qu'on a
// construit. Le type de données « RAW » est la seule qui les laisse
// passer intacts.
//
// Ce fichier est compilé à la volée par PowerShell : il n'y a donc rien
// à installer sur le poste du commerçant.

using System;
using System.Runtime.InteropServices;

public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr h);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr h, int level,
    [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr h);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr h);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr h);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr buf, int n, out int written);

  /// Envoie les octets à la file nommée. Renvoie une chaîne commençant
  /// par « OK » en cas de succès, sinon la cause de l'échec : le relais
  /// la transmet telle quelle à Gestock, qui l'affiche au commerçant.
  public static string Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      return "ERR_OPEN:" + Marshal.GetLastWin32Error();

    DOCINFO di = new DOCINFO();
    di.pDocName = "Gestock";
    di.pDataType = "RAW";

    if (!StartDocPrinter(h, 1, di)) {
      int e = Marshal.GetLastWin32Error();
      ClosePrinter(h);
      return "ERR_STARTDOC:" + e;
    }

    StartPagePrinter(h);

    IntPtr buf = Marshal.AllocCoTaskMem(data.Length);
    Marshal.Copy(data, 0, buf, data.Length);
    int written;
    bool ok = WritePrinter(h, buf, data.Length, out written);
    int err = Marshal.GetLastWin32Error();
    Marshal.FreeCoTaskMem(buf);

    EndPagePrinter(h);
    EndDocPrinter(h);
    ClosePrinter(h);

    return ok ? ("OK:" + written) : ("ERR_WRITE:" + err);
  }
}

`;

/** Exécute un script PowerShell et rend sa sortie. */
function powershell(script, input = null) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', '-',
    ], { windowsHide: true });

    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => { out += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { err += d.toString('utf8'); });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0 && !out) reject(new Error(err.trim() || `PS_EXIT_${code}`));
      else resolve(out.trim());
    });

    ps.stdin.write(script);
    if (input) ps.stdin.write(`\n${input}\n`);
    ps.stdin.end();
  });
}

/**
 * Liste les imprimantes du poste.
 *
 * Celles dont le pilote est « Generic / Text Only » sont signalées :
 * ce sont les seules qui laissent passer l'ESC/POS sans le
 * réinterpréter, donc les seules utilisables pour un ticket.
 */
export async function listPrinters() {
  const out = await powershell(`
    Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus |
      ConvertTo-Json -Compress -Depth 3
  `);
  if (!out) return [];

  const parsed = JSON.parse(out);
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((p) => ({
    name: p.Name,
    driver: p.DriverName,
    port: p.PortName,
    /* Le pilote texte est le marqueur d'une imprimante à tickets
       correctement installée. */
    raw: /generic \/ text only/i.test(p.DriverName ?? ''),
  }));
}

/**
 * Le ticket est-il vraiment sorti ?
 *
 * Windows accepte un travail même quand l'imprimante est éteinte ou
 * débranchée : il le garde en file et l'imprimera au rallumage. Le
 * relais recevrait « envoyé » et le commerçant laisserait partir son
 * client sans reçu. On regarde donc la file juste après.
 */
async function verifierSortie(printerName) {
  const safeName = String(printerName).replace(/'/g, "''");
  try {
    const out = await powershell(`
      $ErrorActionPreference = 'SilentlyContinue'
      $p = Get-Printer -Name '${safeName}'
      $jobs = @(Get-PrintJob -PrinterName '${safeName}')
      [pscustomobject]@{
        etat = "$($p.PrinterStatus)"
        enAttente = $jobs.Count
        bloque = @($jobs | Where-Object {
          "$($_.JobStatus)" -match 'Error|Offline|PaperOut|Paused'
        }).Count
      } | ConvertTo-Json -Compress
    `);

    if (!out) return null;
    const r = JSON.parse(out);

    /* Un travail encore en file une seconde après l'envoi n'a pas
       atteint l'imprimante. Sur une file saine, il disparaît aussitôt. */
    if (r.bloque > 0) return 'PRINTER_ERROR';
    if (r.enAttente > 0) return 'PRINTER_OFFLINE';
    if (/Offline|Error|PaperOut/i.test(r.etat)) return 'PRINTER_OFFLINE';
    return null;
  } catch {
    // La vérification n'est qu'un supplément : si elle échoue, on ne
    // transforme pas une impression réussie en erreur.
    return null;
  }
}

/**
 * Envoie les octets bruts à une file d'impression.
 *
 * Les octets transitent en base64 : le passage par l'entrée standard de
 * PowerShell abîmerait des séquences ESC/POS, qui contiennent des
 * octets nuls et des caractères de contrôle.
 */
export async function sendRaw(printerName, data) {
  const code = PONT_CSHARP;
  const b64 = Buffer.from(data).toString('base64');

  /* Le nom d'imprimante est inséré dans le script : on double les
     apostrophes pour qu'un nom en contenant une ne casse pas la
     chaîne PowerShell. */
  const safeName = String(printerName).replace(/'/g, "''");

  const script = `
    $ErrorActionPreference = 'Stop'
    $src = @'
${code}
'@
    try { Add-Type -TypeDefinition $src -Language CSharp } catch { }
    $octets = [Convert]::FromBase64String('${b64}')
    [RawPrint]::Send('${safeName}', $octets)
  `;

  try {
    const result = await powershell(script);
    if (!result.startsWith('OK:')) {
      return { ok: false, error: result || 'UNKNOWN' };
    }

    /* Le gestionnaire d'impression a pris le travail ; reste à savoir
       s'il l'a transmis. Une seconde suffit : sur une imprimante
       allumée, la file se vide immédiatement. */
    await new Promise((r) => setTimeout(r, 1000));
    const souci = await verifierSortie(printerName);
    if (souci) return { ok: false, error: souci };

    return { ok: true, bytes: Number(result.slice(3)) || data.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'SPAWN_FAILED' };
  }
}
