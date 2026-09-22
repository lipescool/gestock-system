#!/bin/bash
# Installation du service d'impression Gestock sur macOS.
#
# Le service est posé dans la bibliothèque de l'utilisateur et confié à
# launchd, le gestionnaire de services du système : il démarre alors à
# l'ouverture de session et redémarre tout seul s'il s'arrête.
#
# Aucun droit administrateur n'est requis. Pour désinstaller :
#   launchctl unload ~/Library/LaunchAgents/com.gestock.relay.plist
#
# ATTENTION : ce script n'a pas été éprouvé sur un Mac.

set -e

DESTINATION="$HOME/Library/Application Support/Gestock/relay"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/com.gestock.relay.plist"
SOURCE="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  Service d impression Gestock"
echo "  ----------------------------"
echo ""

# --- 1. Node est-il present ? -------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js est absent de ce Mac." >&2
  echo "  Installez-le depuis https://nodejs.org (version LTS), puis relancez." >&2
  exit 1
fi
NODE="$(command -v node)"
echo "  Node.js detecte : $(node -v)"

# --- 2. Copie du service -------------------------------------------------
mkdir -p "$DESTINATION"
cp -R "$SOURCE/src" "$DESTINATION/"
cp "$SOURCE/package.json" "$DESTINATION/"
echo "  Service installe dans $DESTINATION"

# --- 3. L'imprimante thermique ------------------------------------------
# CUPS gere deja les imprimantes du Mac. On verifie simplement qu'il y en
# a une, sans en creer : sur macOS, une imprimante USB branchee est
# declaree automatiquement.
echo ""
if lpstat -p >/dev/null 2>&1; then
  echo "  Imprimantes declarees sur ce Mac :"
  lpstat -p 2>/dev/null | sed 's/^/    /'
else
  echo "  Aucune imprimante declaree."
  echo "  Ouvrez Reglages Systeme > Imprimantes et scanners pour ajouter la votre,"
  echo "  puis choisissez-la dans Gestock."
fi

# --- 4. Demarrage automatique -------------------------------------------
mkdir -p "$AGENTS"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gestock.relay</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DESTINATION/src/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>$DESTINATION/erreurs.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "  Demarrage automatique active"

# --- 5. Verification -----------------------------------------------------
sleep 2
if curl -s --max-time 5 http://127.0.0.1:9110/ping | grep -q gestock-relay; then
  echo ""
  echo "  Le service fonctionne."
  echo "  Ouvrez Gestock, puis Parametres > Impression pour choisir"
  echo "  votre imprimante. Vous n aurez plus jamais a la rechoisir."
  echo ""
  echo "  Note : utilisez Chrome plutot que Safari. Safari refuse qu une"
  echo "  page securisee appelle un service local."
else
  echo ""
  echo "  Le service ne repond pas encore."
  echo "  Consultez $DESTINATION/erreurs.log"
fi
echo ""
