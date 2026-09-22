# Retire le service d'impression Gestock.
#
# L'imprimante declaree dans Windows n'est pas supprimee : le commercant
# peut vouloir la garder pour d'autres usages. Le script indique
# seulement comment s'en defaire.

$ErrorActionPreference = 'SilentlyContinue'

$Destination = Join-Path $env:LOCALAPPDATA 'Gestock\relay'
$Raccourci   = Join-Path ([Environment]::GetFolderPath('Startup')) 'Gestock - service impression.lnk'

Write-Host ''
Write-Host '  Desinstallation du service d impression Gestock'
Write-Host ''

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*gestock*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host '  Service arrete'

Remove-Item $Raccourci -Force
Write-Host '  Demarrage automatique retire'

Remove-Item $Destination -Recurse -Force
Write-Host '  Fichiers supprimes'

# Le reglage reste : une reinstallation retrouvera l'imprimante choisie.
$reglage = Join-Path $env:APPDATA 'Gestock\relay.json'
if (Test-Path $reglage) {
  Write-Host "  Reglage conserve : $reglage"
}

Write-Host ''
Write-Host '  Termine. L imprimante declaree dans Windows n a pas ete touchee ;'
Write-Host '  pour la retirer : Parametres > Bluetooth et appareils > Imprimantes.'
Write-Host ''
Read-Host '  Appuyez sur Entree pour fermer'
