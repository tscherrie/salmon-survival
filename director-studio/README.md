# Director Studio

Lokale Desktop-App für macOS und Windows. Ein KI-Director (Claude Opus 5.5) produziert mit dir Videos, Audio,
Präsentationen, Grafiken und Websites. Die generativen Modelle laufen über fal.ai. Du bearbeitest nichts von Hand:
Du zeigst auf Stellen, sprichst oder schreibst, und der Director führt aus.

Planung und Architektur stehen in [`../docs/director-studio/PLAN.md`](../docs/director-studio/PLAN.md), der
Director-Systemprompt in [`../docs/director-studio/DIRECTOR_SYSTEM_PROMPT.md`](../docs/director-studio/DIRECTOR_SYSTEM_PROMPT.md).

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

1. In die Timeline klicken oder ziehen, dann sendet der Composer die Referenz mit.
2. Assets in den Composer ziehen.
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

### Noch offen

- Installer (`.dmg`/`.exe`) mit Signierung/Notarisierung (Konfiguration liegt in `apps/desktop/electron-builder.yml`)
- Tests gegen die echten Dienste (fal, Anthropic) mit Netzwerkfreigabe
- Lizenzfragen vor einer Weitergabe: Remotion (Firmenlizenz/„Automators“), ffmpeg-Build, Codec-Patente
