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
