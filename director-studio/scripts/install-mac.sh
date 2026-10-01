#!/usr/bin/env bash
# Director Studio auf dem Mac bauen und installieren. Idempotent: erneut ausführen = aktualisieren.
#
#   bash director-studio/scripts/install-mac.sh            # baut den aktuellen Stand und installiert ihn
#   bash director-studio/scripts/install-mac.sh --update   # vorher „git pull --ff-only“
#
# Ablauf: Voraussetzungen prüfen (git, Xcode Command Line Tools, Node.js ≥ 22.13, ffmpeg) → npm ci → npm run build →
# entpackte App für die Architektur dieses Macs (dist.mjs --dir, ad hoc signiert) → nach /Applications (oder
# ~/Applications) kopieren.
# Homebrew wird NICHT installiert; fehlende Werkzeuge nennt das Skript mit dem passenden brew-Befehl.
# API-Keys fragt das Skript nie ab: Die App fragt in ihren Einstellungen danach und legt sie verschlüsselt
# (Schlüssel im macOS-Schlüsselbund) im Datenordner ab.
set -euo pipefail

APP_NAME="Director Studio"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$ROOT/apps/desktop/build/entitlements.mac.adhoc.plist"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[31m✘ %s\033[0m\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
}

UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "Unbekannte Option: $arg (siehe --help)" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "Dieses Skript ist für macOS. Unter Windows: scripts/install-win.ps1"

# Aus Finder/Dock oder einer frischen Shell fehlen die Homebrew-Ordner manchmal im PATH. Nur hinten anhängen: Ein
# vom Nutzer gewähltes Node (nvm, fnm, volta …) weiter vorn im PATH hat Vorrang.
for dir in /opt/homebrew/bin /usr/local/bin; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$PATH:$dir"; fi
done
export PATH

# ───────────── 1. Voraussetzungen ─────────────
step "Voraussetzungen prüfen"
missing=()
# Xcode Command Line Tools: git und install_name_tool (die Paketierung stellt damit die Bibliotheksnamen des
# Remotion-Compositors auf @loader_path um, siehe apps/desktop/scripts/macho.mjs). Ohne sie ist /usr/bin/git nur ein
# Platzhalter, der den Installationsdialog öffnet.
if xcrun --find install_name_tool >/dev/null 2>&1; then
  echo "  Xcode Command Line Tools: $(xcode-select -p 2>/dev/null || echo vorhanden)"
else
  missing+=("Xcode Command Line Tools fehlen:   xcode-select --install   (danach das Skript erneut starten)")
fi
if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
  echo "  git:     $(git --version | awk '{print $3}')"
else
  missing+=("git fehlt:      xcode-select --install   (oder: brew install git)")
fi
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node')"
  if node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
    echo "  Node.js: $NODE_VERSION"
  else
    missing+=("Node.js $NODE_VERSION ist zu alt (nötig ≥ 22.13):   brew upgrade node   (oder: brew install node)")
  fi
else
  missing+=("Node.js fehlt:  brew install node   (oder Installer von https://nodejs.org, Version ≥ 22.13)")
fi

FFMPEG=""
for dir in /opt/homebrew/bin /usr/local/bin /opt/local/bin; do
  if [[ -x "$dir/ffmpeg" && -x "$dir/ffprobe" ]]; then
    FFMPEG="$dir/ffmpeg"
    break
  fi
done
if [[ -z "$FFMPEG" ]] && command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then FFMPEG="$(command -v ffmpeg)"; fi
if [[ -n "$FFMPEG" ]]; then
  echo "  ffmpeg:  $FFMPEG"
else
  if command -v brew >/dev/null 2>&1; then
    FFMPEG_HINT="brew install ffmpeg"
  else
    FFMPEG_HINT="Homebrew installieren (Anleitung: https://brew.sh), danach: brew install ffmpeg"
  fi
  warn "ffmpeg/ffprobe fehlen – Vorschaubilder, Ton und Video-Export brauchen sie. Installieren mit:"
  echo "      $FFMPEG_HINT"
  echo "    Der Build läuft trotzdem weiter; die App zeigt den Hinweis ebenfalls."
fi

if ((${#missing[@]} > 0)); then
  for line in "${missing[@]}"; do warn "$line"; done
  die "Bitte die fehlenden Voraussetzungen installieren und das Skript erneut starten."
fi

# Architektur: Die nativen Pakete (Remotion, esbuild, Claude-Code-Binary) installiert npm für die Architektur von Node.
ARCH="$(node -p 'process.arch')"
HW_ARCH="$(uname -m)"
if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
  warn "Das Terminal läuft unter Rosetta (x86_64) – die App wird für Intel gebaut. Für Apple Silicon ein natives Terminal und ein arm64-Node verwenden."
fi
case "$ARCH" in
  arm64 | x64) echo "  Architektur: $ARCH (Hardware: $HW_ARCH)" ;;
  *) die "Nicht unterstützte Architektur: $ARCH" ;;
esac

# ───────────── 2. Quelltext aktualisieren (optional) ─────────────
if ((UPDATE)); then
  step "Quelltext aktualisieren (git pull --ff-only)"
  git -C "$ROOT" pull --ff-only
fi

# ───────────── 3. Abhängigkeiten und Build ─────────────
cd "$ROOT"
step "Abhängigkeiten installieren (npm ci)"
npm ci --no-audit --no-fund

step "Oberfläche und Hauptprozess bauen (npm run build)"
npm run build

step "App paketieren ($ARCH, entpackt)"
node apps/desktop/scripts/dist.mjs --dir --skip-build

case "$ARCH" in
  arm64) BUILT="$ROOT/apps/desktop/release/mac-arm64/$APP_NAME.app" ;;
  x64) BUILT="$ROOT/apps/desktop/release/mac/$APP_NAME.app" ;;
esac
[[ -d "$BUILT" ]] || die "Gebaute App nicht gefunden: $BUILT"

# ───────────── 4. Signatur prüfen (ad hoc nachsignieren, falls nötig) ─────────────
step "Signatur prüfen"
if codesign --verify --deep --strict "$BUILT" 2>/dev/null; then
  echo "  $(codesign -dv "$BUILT" 2>&1 | grep -E '^(Signature|TeamIdentifier|Runtime)' | tr '\n' ' ')"
else
  warn "Signatur ungültig oder fehlt – signiere ad hoc (Hardened Runtime, Entitlements aus build/entitlements.mac.adhoc.plist)."
  codesign --force --deep --sign - --options runtime --entitlements "$ENTITLEMENTS" "$BUILT" || die "Ad-hoc-Signierung fehlgeschlagen (codesign)."
  codesign --verify --deep --strict "$BUILT" || die "Ad-hoc-Signierung fehlgeschlagen (Prüfung)."
fi

# ───────────── 5. Installieren ─────────────
if [[ -w /Applications ]]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
  warn "/Applications ist nicht beschreibbar – installiere nach $DEST_DIR"
  mkdir -p "$DEST_DIR"
fi
DEST="$DEST_DIR/$APP_NAME.app"
step "Installieren nach $DEST"

if pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
  echo "  $APP_NAME läuft – wird beendet …"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 && die "$APP_NAME läuft noch – bitte beenden und das Skript erneut starten."
fi

TMP_DEST="$DEST_DIR/.$APP_NAME.app.installing"
rm -rf "$TMP_DEST"
ditto "$BUILT" "$TMP_DEST"
rm -rf "$DEST"
mv "$TMP_DEST" "$DEST"
# Lokal gebaut: keine Quarantäne (Gatekeeper fragt sonst beim ersten Start nach).
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f "$DEST" >/dev/null 2>&1 || true

if [[ "$DEST_DIR" == "$HOME/Applications" && -d "/Applications/$APP_NAME.app" ]]; then
  warn "Unter /Applications liegt noch eine ältere Version – bitte von Hand löschen, damit Spotlight die neue findet."
fi

# ───────────── 6. Fertig ─────────────
step "Fertig"
bold "  $APP_NAME ist installiert: $DEST"
# Deutsche Anführungszeichen im Text sind gewollt.
# shellcheck disable=SC1111
cat <<EOF

  Starten:      open -a "$APP_NAME"   (oder über Launchpad/Spotlight)
  Aktualisieren: bash "$SCRIPT_DIR/install-mac.sh" --update

  Beim ersten Start: Unter Einstellungen (Zahnrad) den Anthropic-API-Key (oder „ant auth login“) und den
  fal-Key eintragen. Die App speichert sie verschlüsselt; der Schlüssel liegt im macOS-Schlüsselbund.
  Nach einem Update fragt macOS evtl. einmal nach dem Zugriff auf „$APP_NAME Safe Storage“ und erneut nach
  dem Mikrofon (Push-to-Talk) – „Immer erlauben“ bzw. „OK“ wählen (die lokale Signatur ändert sich je Build).

  Datenordner:  ~/Library/Application Support/$APP_NAME   (Einstellungen, verschlüsselte Keys, Caches,
                runtime/ mit der beim ersten Rendern geladenen Chromium-Headless-Shell)
  Projekte:     ~/Documents/$APP_NAME   (änderbar in den Einstellungen)
EOF
if [[ -z "$FFMPEG" ]]; then
  echo
  warn "ffmpeg fehlt noch: $FFMPEG_HINT – danach $APP_NAME neu starten."
fi
