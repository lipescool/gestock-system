# Installation du service d'impression Gestock.
#
# Trois choses a faire, et rien de plus :
#   1. poser le relais dans le profil de l'utilisateur ;
#   2. declarer l'imprimante thermique aupres de Windows, avec le pilote
#      texte — le seul qui laisse passer l'ESC/POS sans le reinterpreter ;
#   3. le lancer maintenant, et a chaque ouverture de session.
#
# Aucun droit administrateur n'est requis : tout se passe dans le profil.
# Pour desinstaller, lancer desinstaller.ps1.

$ErrorActionPreference = 'Stop'

$Destination = Join-Path $env:LOCALAPPDATA 'Gestock\relay'
$Source      = $PSScriptRoot
$Demarrage   = [Environment]::GetFolderPath('Startup')
$Raccourci   = Join-Path $Demarrage 'Gestock - service impression.lnk'

Write-Host ''
Write-Host '  Service d impression Gestock' -ForegroundColor Cyan
Write-Host '  ----------------------------'
Write-Host ''

# --- 1. Node est-il present ? -------------------------------------------
# Le relais est en JavaScript. Sans Node, rien ne tourne : autant le dire
# tout de suite plutot que d'installer un service qui ne demarrera pas.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '  Node.js est absent de ce poste.' -ForegroundColor Red
  Write-Host '  Installez-le depuis https://nodejs.org (version LTS), puis relancez.'
  Write-Host ''
  Read-Host '  Appuyez sur Entree pour fermer'
  exit 1
}
Write-Host "  Node.js detecte : $(& node -v)"

# --- 2. Copie du relais --------------------------------------------------
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item (Join-Path $Source 'src') -Destination $Destination -Recurse -Force
Copy-Item (Join-Path $Source 'package.json') -Destination $Destination -Force
Write-Host "  Service installe dans $Destination"

# --- 3. L'imprimante thermique ------------------------------------------
# Windows detecte l'imprimante USB mais ne lui cree pas toujours de file
# d'impression. Sans file, impossible de lui envoyer quoi que ce soit.
$pilote = 'Generic / Text Only'
try { Add-PrinterDriver -Name $pilote -ErrorAction Stop } catch { }

$existante = Get-Printer | Where-Object { $_.DriverName -eq $pilote }
if ($existante) {
  Write-Host "  Imprimante a tickets deja declaree : $($existante[0].Name)"
} else {
  # Les imprimantes thermiques se branchent sur un port USB que Windows
  # numerote a la detection. On propose ceux qui n'ont pas encore de file.
  $occupes = (Get-Printer).PortName
  $libres  = (Get-PrinterPort | Where-Object {
    $_.Name -like 'USB*' -and $occupes -notcontains $_.Name
  }).Name

  if (-not $libres) {
    Write-Host '  Aucun port USB libre : branchez l imprimante et rallumez-la,' -ForegroundColor Yellow
    Write-Host '  puis relancez cette installation.'
  } else {
    Write-Host ''
    Write-Host '  Ports USB disponibles :'
    for ($i = 0; $i -lt $libres.Count; $i++) { Write-Host "    [$($i+1)] $($libres[$i])" }
    Write-Host ''
    $choix = Read-Host '  Numero du port de l imprimante (Entree pour passer)'

    if ($choix -match '^\d+$' -and [int]$choix -ge 1 -and [int]$choix -le $libres.Count) {
      $port = $libres[[int]$choix - 1]
      Add-Printer -Name 'Imprimante tickets' -DriverName $pilote -PortName $port
      Write-Host "  Imprimante creee sur $port" -ForegroundColor Green
    } else {
      Write-Host '  Etape passee : a regler depuis Gestock, dans Parametres.'
    }
  }
}

# --- 4. Demarrage automatique -------------------------------------------
# Un commercant qui doit lancer un programme avant d'ouvrir sa caisse
# l'oubliera. Le raccourci reste visible et supprimable par lui.
$vbs = Join-Path $Destination 'demarrer.vbs'
@"
' Lance le relais sans afficher de fenetre noire.
CreateObject("WScript.Shell").Run "node ""$Destination\src\server.js""", 0, False
"@ | Set-Content -Path $vbs -Encoding UTF8

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Raccourci)
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = """$vbs"""
$lnk.WorkingDirectory = $Destination
$lnk.Description = 'Service d impression Gestock'
$lnk.Save()
Write-Host '  Demarrage automatique active'

# --- 5. Demarrage immediat ----------------------------------------------
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*gestock*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process 'wscript.exe' -ArgumentList """$vbs""" -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $ping = Invoke-RestMethod 'http://127.0.0.1:9110/ping' -TimeoutSec 5
  if ($ping.ok) {
    Write-Host ''
    Write-Host '  Le service fonctionne.' -ForegroundColor Green
    Write-Host '  Ouvrez Gestock, puis Parametres > Impression pour choisir'
    Write-Host '  votre imprimante. Vous n aurez plus jamais a la rechoisir.'
  }
} catch {
  Write-Host ''
  Write-Host '  Le service ne repond pas encore.' -ForegroundColor Yellow
  Write-Host '  Redemarrez le poste : il se lancera avec la session.'
}

Write-Host ''
Read-Host '  Appuyez sur Entree pour fermer'
