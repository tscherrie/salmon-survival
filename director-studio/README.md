# Director Studio

Lokale Desktop-App für macOS und Windows. Ein KI-Director (Claude Opus 5.5) produziert mit dir Videos, Audio,
Präsentationen, Grafiken und Websites. Die generativen Modelle laufen über fal.ai. Du bearbeitest nichts von Hand:
Du zeigst auf Stellen, sprichst oder schreibst, und der Director führt aus.

Planung und Architektur stehen in [`../docs/director-studio/PLAN.md`](../docs/director-studio/PLAN.md), der
Director-Systemprompt in [`../docs/director-studio/DIRECTOR_SYSTEM_PROMPT.md`](../docs/director-studio/DIRECTOR_SYSTEM_PROMPT.md).

## Als App installieren (macOS / Windows)

Ein Befehl baut die App auf deinem Rechner und installiert sie. Derselbe Befehl mit `--update` (bzw. `-Update`)
holt den neuesten Stand und ersetzt die installierte App; Einstellungen, Keys und Projekte bleiben erhalten.

**Voraussetzungen:** git, Node.js ≥ 22.13 und ffmpeg.
macOS: `xcode-select --install` (git), `brew install node ffmpeg`. Windows: `winget install Git.Git OpenJS.NodeJS.LTS Gyan.FFmpeg`.
Die Skripte prüfen das vorher und nennen fehlende Befehle; Homebrew installieren sie nicht.

**macOS** (Apple Silicon oder Intel, gebaut wird für die Architektur des Macs):

```bash
git clone https://github.com/tscherrie/salmon-survival.git && cd salmon-survival
git checkout claude/zealous-faraday-yswfo1
bash director-studio/scripts/install-mac.sh            # Update: … install-mac.sh --update
```

Die App landet in `/Applications/Director Studio.app` (ohne Schreibrechte dort in `~/Applications`). Start über
Launchpad, Spotlight oder `open -a "Director Studio"`.

**Windows** (PowerShell):

```powershell
git clone https://github.com/tscherrie/salmon-survival.git; cd salmon-survival
git checkout claude/zealous-faraday-yswfo1
powershell -ExecutionPolicy Bypass -File director-studio\scripts\install-win.ps1   # Update: … -Update
```

Die App landet in `%LOCALAPPDATA%\Programs\Director Studio` mit Startmenü-Eintrag (`-DesktopShortcut` legt
zusätzlich eine Desktop-Verknüpfung an). Mit `-Installer` entsteht stattdessen ein NSIS-Installer
(`apps\desktop\release\Director-Studio-Setup-*.exe`), den das Skript für den aktuellen Benutzer ausführt.

**Keys:** Die App fragt beim ersten Start in den **Einstellungen** nach dem Anthropic-API-Key (oder nutzt
`ant auth login`) und dem fal-Key. Sie speichert die Keys verschlüsselt im Datenordner, den Schlüssel dazu verwahrt
der Schlüsselbund des Betriebssystems (macOS-Schlüsselbund bzw. Windows-DPAPI). Keys gehören nie in `.env`-Dateien,
Umgebungsvariablen oder Skripte; die Installationsskripte fragen keine ab.

**Wo liegt was:** Daten unter `~/Library/Application Support/Director Studio` bzw. `%APPDATA%\Director Studio`
(Einstellungen, verschlüsselte Keys, Caches). Beim ersten Rendern lädt die App einmalig die Chromium-Headless-Shell
von Remotion (ca. 100 MB) nach `runtime/` in diesen Ordner. Projekte liegen unter `Dokumente/Director Studio`.
ffmpeg sucht die App selbst (Einstellung `ffmpegPath`, `FFMPEG_PATH`, Homebrew, winget/Chocolatey/Scoop, `PATH`);
fehlt es, steht ein Hinweis mit dem Installationsbefehl im Projekt und unter **Hilfe → Systemprüfung**.

**Gatekeeper (macOS):** Lokal gebaute Apps sind ad hoc signiert und ohne Quarantäne-Markierung, sie starten
normal. Nach einem Update fragt macOS eventuell einmal nach dem Zugriff auf „Director Studio Safe Storage“ und
erneut nach dem Mikrofon; „Immer erlauben“ bzw. „OK“ wählen (die lokale Signatur ändert sich mit jedem Build). Eine
auf einen anderen Mac kopierte App blockiert Gatekeeper („nicht verifizierter Entwickler“): Rechtsklick → Öffnen,
oder `xattr -dr com.apple.quarantine "/Applications/Director Studio.app"`. Für die Weitergabe signiert
`npm run dist:mac` mit einer Developer ID, wenn `CSC_LINK`/`CSC_KEY_PASSWORD` (oder `CSC_NAME`) gesetzt sind, und
notarisiert mit `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

**SmartScreen (Windows):** Der Installer ist unsigniert. Auf dem Rechner, auf dem er gebaut wurde, startet er
ohne Rückfrage. Heruntergeladen oder kopiert warnt SmartScreen („Der Computer wurde durch Windows geschützt“):
„Weitere Informationen“ → „Trotzdem ausführen“. Signieren lässt er sich mit `CSC_LINK`/`CSC_KEY_PASSWORD`.

## Selbst ausprobieren

### Voraussetzungen

- **Node.js ≥ 22.13** und npm
- **ffmpeg und ffprobe** im `PATH`: macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg`
- Für Slides/Grafik-Export und Website-Screenshots ein Chromium: einmalig `npx playwright install chromium`, oder
  `STUDIO_CHROMIUM_PATH=/pfad/zu/chrome` setzen. Video-Renderings lädt Remotion beim ersten Mal selbst.

```bash
git clone https://github.com/tscherrie/salmon-survival.git
cd salmon-survival
git checkout claude/zealous-faraday-yswfo1
cd director-studio
npm install
```

### 1. Klick-Demo im Browser, ohne Keys

```bash
npm run demo
```

Öffne <http://localhost:5199>. Die Oberfläche läuft dann gegen ein simuliertes Backend: Demo-Projekte aller fünf
Kategorien, ein geskripteter Director, Beispielmodelle mit Preisen. So kannst du die Bedienung durchspielen:

1. In der Timeline klicken oder ziehen, um den Abspielkopf zu bewegen. Ein Klick in die schmale Markerleiste
   ganz oben setzt einen Marker, `Enter` setzt einen am Abspielkopf. Jeder Marker landet als nummerierter
   Zeit-Chip im Composer, Spannen schreibst du mit zwei Markern („von ① bis ②“). `Alt`+Klick auf einen Clip
   referenziert den Clip.
2. Assets aus der linken Seitenleiste in den Composer ziehen.
3. Rückfragen und Checkpoints im Director-Panel beantworten.
4. Versionen wiederherstellen.

Es werden keine echten Modelle aufgerufen und keine Kosten verursacht.

### 2. Die echte Desktop-App

```bash
npm run app
```

Das baut Main und Preload, startet den Vite-Dev-Server für die Oberfläche und öffnet Electron. Unter
**Einstellungen** (Zahnrad):

- **Director-Zugang:** Am einfachsten ist ein Anthropic-API-Key. Alternativ `ant auth login` im Terminal, dann
  braucht die App keinen Key, weil sie das OAuth-Profil automatisch nutzt. Wer nur einen fal-Key hat, kann den
  fal-Router als Director-Anbindung nutzen, allerdings mit eingeschränkten Fähigkeiten.
- **fal-Key:** Ohne ihn laufen keine Generierungen (Video, Bild, Stimme, Musik …).
- Keys landen verschlüsselt im Schlüsselbund des Betriebssystems, nicht im Projektordner.

Dann **Neues Projekt** anlegen (Kategorie gern „Noch offen“). Der Director beginnt mit einem Planungsgespräch,
danach folgen Checkpoints mit Budgetfreigabe. Projekte liegen als Ordner `*.dstudio` unter
`Dokumente/Director Studio`.

> Hinweis: Diese Version ist noch nicht gegen die echten Dienste getestet (in der Build-Umgebung waren fal.ai und
> die Anthropic-API nicht erreichbar). Generierungen kosten echtes Geld. Setze die Budgets in den Checkpoints
> anfangs niedrig.

## Entwicklung

| Befehl | Zweck |
|---|---|
| `npm test` | Alle Unit-/Integrationstests (Vitest) |
| `npm run typecheck` | TypeScript-Prüfung des ganzen Monorepos |
| `npm run test:e2e` | Oberfläche im Browser (Playwright, Fake-Backend) |
| `npm run test:electron` | Smoke-Test der echten Electron-App (unter Linux: `xvfb-run -a npm run test:electron`) |
| `npm run build` | Main/Preload (esbuild) und Oberfläche (Vite) nach `apps/desktop/out` |
| `npm run dist` | Installer für diese Plattform (macOS `.dmg`, Windows NSIS-`.exe`) nach `apps/desktop/release` |
| `npm run dist:dir` | Nur die entpackte App (`release/mac-arm64/Director Studio.app`, `release/win-unpacked` …) |
| `npm run dist:mac`, `npm run dist:win` | Wie `dist`, mit ausdrücklicher Plattform (muss die des Build-Rechners sein) |
| `npm run test:packaged` | Smoke-Test der gepackten App inkl. echtem Video-/PDF-Export (`xvfb-run -a` unter Linux) |

**Paketierung:** `dist` baut, stellt die App in `apps/desktop/dist/stage` zusammen (`scripts/stage-app.mjs`) und
ruft electron-builder auf. Die App selbst (Main, Preload, Oberfläche) liegt im `app.asar`; die Laufzeitpakete
(externe Importe des Main-Bündels laut esbuild-Metafile samt Abhängigkeiten, in den Lockfile-Versionen, nur mit den
nativen Binaries des Build-Rechners) liegen daneben in `resources/node_modules`, zusammen mit den Quellen von
`@studio/render` und `@studio/core`, die Remotion zur Laufzeit bündelt. Danach prüft `scripts/verify-app.mjs` mit
dem gepackten Electron, dass sich jeder externe Import aus der App heraus auflösen und laden lässt und die nativen
Helfer starten. Deshalb gilt: Mac-App auf dem Mac bauen, Windows-App unter Windows.

### Struktur

| Paket | Inhalt |
|---|---|
| `packages/core` | Domänenmodell: Referenzen, Composer, Dokumente (Timeline/Deck/Canvas/Site) mit Operationen, Versionen, Budget, Checkpoints, Modelle, Events, `StudioApi` |
| `packages/project` | Projektordner, inhaltsadressierter Speicher, Journale, SQLite-Index |
| `packages/fal` | fal.ai: Katalog, Preise, Schemas, Queue, Storage, Ingest, Transkripte |
| `packages/media` | ffmpeg: Proxies, Frames, Kontaktabzüge, Peaks, Lautheit, Beats, AV-Sync, Audio-Mix |
| `packages/render` | Remotion-Komposition, Komponenten-Compiler, Slides/PPTX, Collagen, Website-Vorschau |
| `packages/director` | Director: Tool-Loop, Anthropic-/fal-Transports, Tools, Gates, Skills, Session |
| `apps/desktop` | Electron (Main, Preload, Backend, Export) und die React-Oberfläche |

### Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `FFMPEG_PATH`, `FFPROBE_PATH` | eigene ffmpeg-Binaries |
| `STUDIO_CHROMIUM_PATH` | Chromium/Headless-Shell für Renderings und Screenshots |
| `STUDIO_USER_DATA` | eigener App-Datenordner (Tests, mehrere Profile) |
| `STUDIO_SKILLS_DIR` | Director-Skills aus einem anderen Ordner laden |
| `STUDIO_RENDERER_URL` | Oberfläche von einem Dev-Server laden |
| `STUDIO_PACKAGED_APP` | Pfad zum Binary der gepackten App für `npm run test:packaged` |

### Noch offen

- Signierung mit Developer ID/Zertifikat und Notarisierung ausprobieren (vorbereitet über `CSC_LINK`, `APPLE_ID` …),
  App-Icon, eigene ffmpeg-Builds unter `apps/desktop/vendor/ffmpeg/<os>-<arch>` (optional, siehe electron-builder.yml)
- Tests gegen die echten Dienste (fal, Anthropic) mit Netzwerkfreigabe
- Lizenzfragen vor einer Weitergabe: Remotion (Firmenlizenz/„Automators“), ffmpeg-Build, Codec-Patente
