# Director Studio: Planungsdokument

> Arbeitstitel **Director Studio**. Das ist eine lokale Desktop-Software für macOS und Windows. Darin produziert ein
> KI-„Director“ (Claude Opus 5.5) zusammen mit dir Videos, Audio, Präsentationen, Grafiken und Websites. Die
> generativen Modelle laufen über fal.ai. Du bearbeitest nichts von Hand: Du zeigst auf Stellen, sprichst oder
> schreibst, und der Director führt aus.
>
> Stand: 2026-10-01 · Status: v1, Grundlage der Implementierung in `director-studio/`

---

## 0. Kurzfassung

- **Eine App, fünf Kategorien:** Video (Musikvideo, Kurzfilm, Social Shorts/Ads, Explainer), Audio-Schnitt,
  Präsentations-Slides, Grafikdesign (Collagen) und Webdesign (Mockup → lauffähige Site).
- **Bedienprinzip:** Die Bühne (Timeline, Folienstreifen, Leinwand oder Web-Vorschau) ist **nur lesbar**. Klicks
  erzeugen **Referenzen**: Zeitpunkt (als Marker), Clip, Folie, Element, Bildregion oder DOM-Knoten. Sie landen als
  Chip im **Composer**. Links liegt die **Asset-Seitenleiste**, rechts neben der Vorschau das **Director-Panel**
  (Gespräch, Plan, Fortschritt, Freigaben). Der Composer schließt bündig an das Panel an, darin stecken kompakt
  die **Modell-Picker** je Modalität. Die Timeline liegt unten in voller Breite.
- **Director:** Claude Opus 5.5 auf Effort `xhigh`, in einem eigenen Tool-Loop (Messages-API-Format) mit
  austauschbarem Transport (§7.1). Die Anmeldung wird der Reihe nach versucht: Login mit Anthropic (OAuth-Profil
  oder API-Key) → optional Claude-Abo über das Agent SDK (nur Eigennutzung) → fal-Router als Fallback.
- **Modelle:** Alle Medienmodelle (Video, Bild, Lipsync, Stimme, Musik, Sound, Werkzeuge) laufen über **fal.ai**.
  Der Katalog kommt live aus der fal-Plattform-API, mit Beschreibung, Preis und Fähigkeiten, die aus dem
  Eingabeschema abgeleitet werden. Den Picker gibt es für jede Modalität: „verbindlich“ oder „Auto“.
  Default-Videomodell ist **h3-max**.
- **Ablauf:** Jedes Projekt beginnt mit einem **Planungsgespräch**. Danach folgen Checkpoints mit Budgetfreigabe:
  Treatment → Style Bible → Storyboard/Entwurf → Produktion → Finishing. Innerhalb eines freigegebenen Budgets
  arbeitet der Director autonom.
- **Local-first:** Ein Projekt ist ein Ordner auf der Festplatte (`*.dstudio`). Er enthält einen
  inhaltsadressierten Asset-Speicher, einen SQLite-Index und unveränderliche Versionen. Lokale Dateien werden nicht
  hochgeladen. Nur was ein Cloud-Modell zwingend braucht, geht temporär in den fal-Storage.
- **Rechnen hybrid:** Leichte Arbeit läuft lokal (ffmpeg, Beats, Lautheit, Proxies, Rendering), schwere ML-Arbeit
  über fal (Stems, Segmentierung, Tiefe, Pose, Upscaling, Transkription).
- **Rendering:** Remotion für Video und codebasierte Animationen. Chromium für Slides, Grafik und Web; es liefert
  Screenshots, PDF und Vorschau. Dazu ffmpeg für Audio und Mastering.

---

## 1. Entscheidungen aus der Klärungsrunde

| Thema | Entscheidung |
|---|---|
| Nutzerkreis | Zuerst Single-User, später mehr. Das Datenmodell ist mandantenfähig vorbereitet. |
| Plattform | **Lokale Desktop-App für macOS und Windows** (kein Webprojekt). |
| Kategorien | Video (Musikvideo, Kurzfilm/Narrativ, Social Shorts/Ads, Explainer/Motion Graphics), Audio-Schnitt, Slides, Grafikdesign/Collage, Webdesign. |
| Webdesign | Erst Mockup (Screens + Style Bible), nach Freigabe lauffähige Site. |
| Autonomie | Budget + Checkpoints: Konzept, Style Bible und Kostenschätzung freigeben, danach autonom innerhalb des Budgets. |
| Modell-Picker | Verbindlich + „Auto“: Ein gewähltes Modell ist bindend, bei „Auto“ wählt der Director pro Aufgabe und begründet die Wahl. |
| Manuelle Edits | **Nirgends.** Nur Referenzieren, Versionen ansehen und wiederherstellen. |
| Sprache | Push-to-Talk-Diktat. Das Transkript ist editierbar, und Klicks während des Sprechens werden an der passenden Wortstelle eingefügt. |
| Director-Ausgabe | Seitenpanel neben der Vorschau. |
| Projektstart | Immer ein klärendes Planungsgespräch im Chat. |
| Formate | 16:9 bis ca. 5 min · 9:16 Shorts ≤ 90 s · 1:1 / 4:5 Feed. Mehrere Formate pro Projekt sind möglich. |
| Vorschau-Browser | Eingebettetes Chromium, zusätzlich „Im Systembrowser öffnen“. |
| Rechnen | Hybrid (lokal leicht, fal schwer). |
| Director-Anbindung | Anthropic per Login (Claude-Login für die Eigennutzung bzw. API-Login/Key), Fallback über fal. |
| Default-Videomodell | `h3-max` (fal) |

---

## 2. Produktprinzipien

1. **Der Director ist der einzige Editor.** Jede Änderung an einem Dokument ist eine Director-Operation. Sie wird
   validiert, versioniert und mit einer Änderungsnotiz versehen.
2. **Zeigen statt beschreiben.** Jede Stelle der Bühne ist referenzierbar. Referenzen sind maschinenlesbar und
   werden aufgelöst: Was liegt dort, welches Bild hat der Nutzer gesehen, welche Wörter fallen dort.
3. **Alles ist ein Asset mit Herkunft.** Jede Generierung, jeder Upload und jedes Analyseergebnis landet als Asset
   im Browser. Dazu gehören Lineage (Eltern/Kinder), Prompt, Parameter, Modell und Kosten.
4. **Transparenz über Kosten und Arbeit.** Das Panel zeigt Plan, Fortschritt, verbrauchtes und freigegebenes Budget
   sowie Rückfragen mit Optionen.
5. **Prüfen vor Behaupten.** Der Director „schaut“ über Tools: Frames, Kontaktabzüge, Screenshots,
   Sync-Messung, Lautheit. Er meldet nichts als fertig, was er nicht geprüft hat.
6. **Local-first & privat.** Dateien bleiben lokal. Uploads zu fal sind minimal, zweckgebunden und werden
   protokolliert.

---

## 3. Kategorien und ihre Bühnen

| Kategorie | Dokumentmodell | Bühne (read-only) | Referenzarten | Hauptausgaben |
|---|---|---|---|---|
| Video | `timeline` (EDL, framegenau) | Multi-Track-Timeline + Monitor (Remotion Player) | Zeit, Spanne (opt. Spur), Clip, Marker | MP4 (H.264/HEVC), je Format; Stems; Untertitel (SRT/VTT) |
| Audio | `timeline` (nur Audiospuren) | Wellenform-Timeline + Transkript-Ansicht | Zeit, Spanne, Clip, Wort | WAV/FLAC/MP3/AAC, Kapitel, Stems |
| Slides | `deck` | Folienstreifen + große Folienansicht | Folie, Element, Region | PDF, PPTX, HTML, PNG je Folie |
| Grafik/Collage | `canvas` (Ebenen) | Leinwand mit Zoom | Element/Ebene, Region | PNG/JPG/WebP, PDF (Druck), SVG |
| Web | `site` (Quellbaum + Seitenkarte) | Live-Vorschau im eingebetteten Chromium, Viewport-Umschalter | DOM-Element (Selektor + Box + Quelle), Region, Seite | Statischer Build (ZIP), optional Deploy |

Musik-, Voice- und SFX-Generierung sind **Modalitäten**, keine eigenen Kategorien. Sie stehen in jeder Kategorie zur
Verfügung, etwa für Voice-over in Slides oder Musik in Webseiten-Hero-Videos.

---

## 4. UI-Layout und Interaktion

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ KOPFZEILE: Projekt · Checkpoints · Budget · Version v23 ▾ · Exportieren            │
├─────────────┬──────────────────────────────────────────┬───────────────────────────┤
│ ASSETS      │ MONITOR                                  │ DIRECTOR (Chat)           │
│ Suche,      │ Player / Folie / Leinwand / Web          │ Gespräch, Plan,           │
│ Typ-Filter, │ Format 16:9 | 9:16 | 1:1 | 4:5           │ Fortschritt,              │
│ Gruppen,    │ Safe Areas, Timecode, Transport          │ Werkzeugschritte          │
│ Karten mit  │ Web: Viewport, „Im Browser öffnen“       │ ── angedockt: ──          │
│ Vorschau    │                                          │ Freigaben, Rückfragen     │
│             ├──────────────────────────────────────────┴───────────────────────────┤
│ Drag →      │ COMPOSER (bündig unter dem Chat, ein Element mit ihm)                │
│ Composer    │ „Mach den Übergang bei [1 00:12:10] weicher, nimm [Mira v3] …“       │
│             │ [+] Marker · Opus 5.5 · h3-max · 6× Auto · [Mikro] [Senden]          │
├─────────────┴──────────────────────────────────────────────────────────────────────┤
│ BÜHNE (volle Breite): Timeline | Folienstreifen | Ebenenliste | Seitenkarte        │
│ ▔▔ Markerleiste, schmal, ganz oben: Klick = Marker setzen ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│ Lineal · Abschnitte/Beats · Spuren V1 V2 T1 A1 A2 A3 (≈95 % der Höhe: Spulen)      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Assets** liegen in einer Seitenleiste links, der **Director-Chat** rechts vom Monitor. Beide Seitenleisten sind
  in der Breite verstellbar und einklappbar; die Breite der Asset-Leiste entspricht der Spurkopf-Spalte der
  Timeline, damit die Spalten übereinander fluchten.
- Der **Composer** sitzt direkt unter Monitor und Chat und schließt bündig an den unteren Rand des Chats an:
  Chat und Composer lesen sich als ein Element („hier spreche ich mit dem Director“).
- Die **Modell-Picker** stecken kompakt in der Werkzeugleiste des Composers (Director-Modell + Effort, die
  verbindlich gesetzten Modelle, Zusammenfassung „n× Auto“). Ein Klick öffnet die volle Liste je Modalität.
- Die **Bühne** (Timeline usw.) nimmt unten die volle Breite ein.
- Gestaltung: dunkle, ruhige „Grading Suite“ (warmer Tungsten-Akzent, Zeitcodes in Mono-Schrift); helles Theme
  als Alternative. Details: `director-studio/apps/desktop/DESIGN.md`.

### 4.1 Bühne: Interaktionen (alle Kategorien)

**Video/Audio-Timeline.** Die Timeline wird nie bearbeitet, sie dient zum Ansehen und Zeigen:

| Geste | Wirkung |
|---|---|
| Klick oder Ziehen in der Hauptfläche (≈95 % der Höhe) | Abspielkopf springen/spulen (framegenau; mit `Shift` Snap auf Beats). Keine Bereichsauswahl. |
| Klick in die **Markerleiste** (schmaler Streifen ganz oben) | Marker an dieser Stelle setzen; sein Zeitpunkt landet als nummerierter Chip im Composer. |
| `Enter` (Fokus nicht im Textfeld) | Marker am Abspielkopf setzen; erscheint ebenso in der Markerleiste und als Chip. |
| Klick auf einen Marker | Abspielkopf springt dorthin. |
| `Alt` + Klick auf einen Clip | Clip als Entität in den Composer. |
| Leertaste, J/K/L, ←/→, Zoom, Scroll | Abspielen und Navigieren. |

- Marker und Composer-Chips sind verknüpft und gleich nummeriert (①, ②, …). Entfernst du einen Chip, verschwindet
  auch sein Marker. Nach dem Senden werden die Marker geleert.
- **Zeitspannen** entstehen aus zwei Markern und Text: „von ① bis ② dunkler“. Der Director liest Spannen aus
  Chips plus Wortlaut.
- Während Push-to-Talk werden Marker-Klicks und `Enter` mit ihrem Zeitpunkt protokolliert und hinter dem gerade
  gesprochenen Wort eingefügt (§15).

**Andere Bühnen:**

| Geste | Slides | Leinwand | Web |
|---|---|---|---|
| Klick | Folie | Element unter Cursor | Element (Picker-Overlay) |
| Ziehen | Region auf der Folie | Region | Region (Screenshot-Ausschnitt) |
| `Alt` + Klick | Element | Ebene | übergeordnete Komponente |
| Navigieren | Blättern | Zoom/Pan | Scrollen, Links folgen, Viewport |

Verschieben, Trimmen und Löschen gibt es nicht. Der Cursor zeigt den Referenzmodus. **Versionen:** Jede
Director-Änderung erzeugt eine neue Version mit Notiz. Du kannst ältere Versionen ansehen. „Wiederherstellen“ legt
eine neue Version als Kopie an. Das ist keine inhaltliche Bearbeitung.

### 4.2 Composer

- Rich-Text mit Chips (`time`, `range`, `clip`, `asset`, `slide`, `element`, `region`, `marker`, `version`).
- Zeit-Chips kommen aus Markern (§4.1); sie tragen die Nummer ihres Markers.
- Drag & Drop aus der Asset-Seitenleiste. Dateien vom Desktop werden **verknüpft** (kein Upload) und erscheinen als
  Asset.
- **Push-to-Talk:** Halten von `Strg/⌘ + Leertaste` oder des Mikrofon-Buttons → Aufnahme → Transkription mit
  Wortzeitstempeln. Timeline-Klicks während der Aufnahme werden mit ihrem Zeitpunkt protokolliert und hinter dem Wort
  eingefügt, das zu diesem Zeitpunkt gerade gesprochen wurde.
- Senden (`Strg/⌘ + Enter`), Stopp/Unterbrechen. Während der Director arbeitet, heißt der Button „Einreihen“:
  die Nachricht wird nach dem laufenden Schritt zugestellt.
- Serialisierung an den Director:
  ```xml
  Mach <ref id="r1" type="range" from="00:12.400" to="00:18.000"/> dunkler, nimm <ref id="r2" type="asset" asset="ast_8f2"/>.
  <ref_context id="r1">V1 shot_07 (ast_31c, h3-max) · T1 „faster“ 12.9–14.2 · A2 Chorus 1 · Beats 12.48 12.96 … [Frames 12.4/15.2/18.0 als Bilder]</ref_context>
  <ref_context id="r2">Bild „Mira – Charakterblatt v3“ · nano-banana-pro · Tags: character, mira [Vorschau als Bild]</ref_context>
  ```

### 4.3 Modell-Picker

- Modalitäten: **Director** (Claude-Modelle; Anbieter je nach Anmeldung), **Text** (LLM für Teilaufgaben, Default
  = Director-Modell), **Bild** (Generierung + Edit), **Video** (T2V/I2V/Referenz), **Lipsync/Avatar**
  (audiogetrieben), **Stimme** (TTS, Voice Design, Klon *mit Einwilligung*), **Musik**, **Sound** (SFX/Foley/V2A),
  **Werkzeuge** (STT, Stems, Upscale, Matting, Segmentierung, Tiefe, Pose, Interpolation, Vektorisierung).
- Jeder Eintrag zeigt Name, Anbieter, Kurzbeschreibung (aus fal), Fähigkeits-Badges (Audio-Eingang,
  Referenzbilder, max. Dauer, native Tonspur, Auflösung) und den **Preis** (Einheitspreis + Einheit) mit
  Beispielrechnung, etwa „5 s 1080p ≈ $0,50“.
- „Auto“ steht oben in der Liste. Die Auswahl gilt pro Projekt (Default pro Nutzer). Jede Änderung geht als
  Kontext-Update an den Director.
- **Durchsetzung:** Das `generate`-Tool lehnt Modelle einer Modalität ab, wenn der Picker dort auf ein anderes
  Modell gesetzt ist.

### 4.4 Asset-Seitenleiste

- Seitenleiste links, verstellbar und einklappbar. Oben Suche und Typ-Filter, darunter Gruppen („Zuletzt
  verwendet“, Szenen/Shots). Dateien vom Desktop lassen sich hineinziehen; sie werden verknüpft, nicht hochgeladen.
- Karten mit Vorschau: Hover-Scrub bei Video, Wellenform bei Audio, Textausschnitt bei Text/Code. Dazu Typ,
  Modell-Badge, Kosten und Status (*im Dokument*, *ungenutzt*, *verworfen*, *Upload/verknüpft*).
- Filter und Volltextsuche über Titel, Tags und Prompts. Gruppierung nach Szene/Shot, Typ, Charakter oder Batch.
- Detail-Drawer: Lineage-Graph, Prompt, Parameter, Modell, Kosten, Verwendungen in Versionen. Aktionen:
  „In Composer“, „Im Finder/Explorer zeigen“.

### 4.5 Director-Panel

- Nachrichtenverlauf mit Fortschrittsnotizen. Tool-Schritte sind kompakt dargestellt und ausklappbar.
- **Checkpoint-Karten:** Inhalt (Treatment-Text, Style-Bible-Assets, Shotliste), beantragtes Budget, Buttons
  *Freigeben* / *Ändern…*.
- **Rückfragen** als Optionen-Karte (wie hier im Chat), dazu Freitext.
- Offene Freigaben, Rückfragen und Checkpoints docken unten im Panel an, direkt über dem Composer. So bleiben sie
  sichtbar, auch wenn der Verlauf weiterscrollt.
- Kostenleiste: verbraucht / reserviert / freigegeben. Aufschlüsselung nach Modellen und Director-Nutzung.

---

## 5. Projektablauf

1. **Neues Projekt:** Kategorie wählen (oder offen lassen), Ordner wählen, optional Material hineinziehen (Song,
   Skript, Footage, Logos, Referenzen).
2. **Planungsgespräch** im Director-Panel: Ziel, Zielgruppe/Plattform, Formate/Länge, Material, Ton, Referenzen,
   Constraints, Budget, Deadline. Der Director fragt in kleinen Runden und gibt Optionen mit Empfehlung vor.
   Ergebnis ist ein `project_brief`.
3. **Checkpoints** (Standard je Kategorie, der Director darf zusammenlegen):

| Kategorie | Checkpoints |
|---|---|
| Video | Treatment → Style Bible (Charaktere, Sets, Typo, Palette) → Storyboard + Animatic → Produktion → Finishing |
| Audio | Konzept/Schnittplan → Rohschnitt → Mix & Master |
| Slides | Storyline/Gliederung → Theme + Beispiel-Folien → Vollständiges Deck → Feinschliff/Export |
| Grafik | Konzept + Moodboard → 2–3 Layout-Entwürfe → Ausarbeitung → Export |
| Web | Sitemap + Inhalte → Mockups (Screens) + Style Bible → Implementierung → QA (Viewports, a11y, Performance) → Export/Deploy |

4. Jeder Checkpoint braucht eine **Budgetfreigabe**. Innerhalb dieses Budgets arbeitet der Director ohne
   Rückfrage; darüber hinaus legt er eine Approval-Karte vor.
5. **Iteration:** Danach steuerst du mit Prompts und Referenzen. Kleine Änderungen brauchen keinen neuen Checkpoint,
   solange sie im Budget bleiben und das Konzept nicht ändern.

---

## 6. Systemarchitektur

```mermaid
flowchart LR
  subgraph Renderer["Electron Renderer (React)"]
    UI[Monitor · Panel · Bühne · Picker · Composer · Assets]
    Player[Remotion Player / Deck / Canvas]
  end
  subgraph Preview["Sandbox-Views (eigene Partition, kein Node)"]
    Web[Web-Vorschau / Code-Komponenten]
  end
  subgraph Main["Electron Main"]
    IPC[IPC-Router (typisiert)]
    Proj[Project Service: Ordner, Index, Versionen]
    Jobs[Job-Queue]
  end
  subgraph Utility["Utility-Prozesse / Sidecars"]
    Dir[Director Service: Claude Agent SDK + Studio-Tools]
    Render[Render Worker: Remotion, Chromium]
    Media[Media Worker: ffmpeg, Analyse]
    Vite[Vite-Dev-Server je Web-Projekt]
  end
  UI <--> IPC
  Player --- UI
  Web --- UI
  IPC <--> Proj
  IPC <--> Jobs
  Jobs <--> Dir
  Jobs <--> Render
  Jobs <--> Media
  Dir -- fal Gateway --> FAL[(fal.ai)]
  Dir -- Agent SDK --> ANT[(Anthropic API)]
  Media -- schwere Modelle --> FAL
```

### 6.1 Prozessmodell

- **Main:** Fenster, typisierter IPC-Router, Projektdienst (Dateisystem, SQLite über `node:sqlite`), Job-Queue
  (persistiert im Projektindex, mit Wiederaufnahme nach Neustart).
- **Renderer:** React-UI. Kein Node-Zugriff; die Preload-API `window.studio` läuft über `contextBridge`, mit
  `contextIsolation` und `sandbox: true`.
- **Utility-Prozesse:** Director (Agent SDK, das seinerseits den Claude-Code-Prozess startet), Render-Worker
  (Remotion `renderStill`/`renderMedia` mit dem gebündelten Chromium) und Media-Worker (ffmpeg/ffprobe als
  Sidecar). So bleibt die UI flüssig.
- **Vorschau-Isolation:** Code, den der Director schreibt (Remotion-Komponenten, Websites), läuft nur in
  `WebContentsView`s mit eigener Session-Partition, ohne Node-Integration, mit CSP und Netzwerkregeln.

### 6.2 Code-Struktur (Monorepo `director-studio/`)

| Paket | Zweck | Laufzeit |
|---|---|---|
| `@studio/core` | Domänenmodell: Referenzen, Composer-Serialisierung, Dokumente (timeline/deck/canvas/site) + Operationen, Versionierung (Interfaces), Budget/Ledger, Checkpoints, Modell-/Picker-Typen, Events. **Rein, ohne I/O.** | Renderer + Node |
| `@studio/project` | Projektordner, inhaltsadressierter Asset-Speicher, SQLite-Index, Versionsspeicher, verknüpfte Dateien | Node |
| `@studio/fal` | Plattform-API (Modelle, Preise, Schätzung), Registry + Fähigkeiten aus OpenAPI, Schema-Validierung, Queue-Runner, Storage-Upload, Ingest, Kostenschätzung | Node |
| `@studio/media` | ffprobe/ffmpeg-Wrapper, Proxies, Frames, Kontaktabzüge, Peaks, Lautheit, Audio-Schnitt, Beat-Erkennung, AV-Sync-Messung | Node |
| `@studio/render` | Remotion-Kompositionen (Timeline → Video), Code-Komponenten-Compiler (esbuild + Import-Allowlist), Deck/Canvas → HTML/SVG/PDF/PPTX, Site-Dev-Server + Screenshots | Node + Renderer |
| `@studio/director` | Director-Session, Provider (Agent SDK, fal-Fallback), Studio-Tools, Gates (Picker/Budget), Kontextblöcke, Systemprompt, gebündelte Skills | Node |
| `@studio/desktop` | Electron Main/Preload/Renderer-UI | Electron |

---

## 7. Director

### 7.1 Laufzeit und Anmeldung

- **Runtime (nach Recherche angepasst):** ein **eigener Tool-Loop** im Format der Anthropic Messages API. Er läuft
  in einem Electron-`utilityProcess`, sodass die UI nie blockiert. Er hat eine `ModelTransport`-Schicht:
  - `anthropic`: `@anthropic-ai/sdk`. Effort, adaptives Thinking, Prompt-Caching, Mid-Conversation-System-Messages,
    serverseitige Websuche und Kompaktierung bleiben erhalten.
  - `fal`: der OpenAI-kompatible LLM-Router von fal. Fehlende Fähigkeiten werden per Probe erkannt und
    ausgeglichen.
  - `agent-sdk` (optional): das Claude Agent SDK. Nötig ist es **nur** für die Anmeldung mit einem Claude-Abo bei
    Eigennutzung. Es bringt ein proprietäres Binary von ca. 230 MB mit und Lizenzauflagen, die ein späteres
    Bezahl- bzw. Mehrnutzermodell einschränken.

  Alle drei Wege nutzen **dieselbe Tool-Registry** (Zod), dieselben Gates und dieselben Ereignisse. Der
  Dateizugriff ist auf `code/` und `site/` im Projektordner begrenzt. Eine Shell gibt es nicht (Windows-tauglich),
  stattdessen typisierte Tools. Die Historie wird nur angehängt (Thinking-Bindung, Caching). Subagenten
  (`delegate`) laufen auf Sonnet 5.5 bzw. Haiku 4.5 für QA und Recherche.
- **Modell/Effort:** `claude-opus-5-5`, Effort `xhigh` als Standard („sehr hohes Reasoning“). `max` gilt für
  Konzept- und Treatment-Schritte, `high` für Routine-Tool-Schleifen. Die Denktiefe ist im Director-Picker
  einstellbar.
- **Anmeldekette (automatisch erkannt, in den Einstellungen überschreibbar):**
  1. **Login mit Anthropic (API):** OAuth-Profil aus `ant auth login`. Das SDK nutzt es automatisch, ohne Key.
     Alternativ ein API-Key aus dem Schlüsselbund. Abgerechnet wird nach API-Nutzung.
  2. **Claude-Abo-Login über das Agent SDK** (optional, nur Eigennutzung). Laut Anthropic-Support (Juni 2026)
     zählt das gegen die Abo-Limits. Anthropic erlaubt Drittprodukten aber ohne Freigabe nicht, anderen Nutzern
     einen claude.ai-Login anzubieten. In Mehrnutzer-Builds ist diese Option deshalb aus.
  3. **fal-Fallback:** Claude über den LLM-Router von fal, mit reduzierten Fähigkeiten. Was fehlt, gleicht die
     Plattform aus: Kompaktierung macht sie per Zusammenfassung, und Websuche/-abruf ist ein eigenes Tool.
- **Provider-Adapter:** Die Studio-Tools sind provider-neutral definiert (Name, Beschreibung, Zod-Schema,
  Handler). Adapter übersetzen sie für das Agent SDK (`tool()` + `createSdkMcpServer`) und für
  OpenAI-kompatible Function-Calls.

### 7.2 Systemprompt

Siehe [`DIRECTOR_SYSTEM_PROMPT.md`](./DIRECTOR_SYSTEM_PROMPT.md). Er ist statisch und cachebar. Projektdaten kommen
als angehängte Kontextblöcke dazu: `project_brief`, `model_selection`, `budget`, `style_bible`, `document_summary`,
`asset_index` und `skills_index`.

### 7.3 Studio-Tools (Director-Werkzeuge)

| Gruppe | Tools |
|---|---|
| Kommunikation | `ask_user` (Fragen mit Optionen, blockiert), `propose_checkpoint` (Inhalt + Budgetantrag → Freigabekarte), `post_update` (wörtliche Nachricht ins Panel) |
| Modelle | `search_models`, `get_model_schema`, `estimate_cost`, `generate` (async, Gates: Picker, Budget, Schema), `await_generations`, `cancel_generation` |
| Assets | `search_assets`, `get_asset` (inkl. Vorschaubild), `update_asset` (Titel/Tags/Beschreibung), `reject_asset`, `create_text_asset`, `import_url` (Web-Referenz mit Quelle) |
| Wahrnehmung & Analyse | `frames` (Zeitpunkte → Bilder), `contact_sheet`, `analyze_audio` (Beats, Tempo, Sections, Lautheit, Peaks; Stems/Wörter über fal), `transcribe`, `check_av_sync`, `extract_rotoscope` (Masken/Pose/Tiefe/Konturen über fal) |
| Dokumente | `get_document` (kompakt oder Ausschnitt), `apply_document_ops` (validiert → neue Version + Notiz), `restore_version` |
| Code & Render | `compile_component` (TSX → geprüftes Bundle), `render_still`, `render_preview`, `screenshot_site` (Viewports, Konsolen-Fehler, a11y), `export` |
| Recherche | Websuche/-abruf (Agent SDK: eingebaut; Fallback: eigenes Tool) |

### 7.4 Kontext- und Kostenstrategie

- Statischer Systemprompt + Tool-Definitionen bilden einen stabilen Präfix, damit das Caching greift.
  Kontext-Updates werden **nur angehängt**, nie editiert. Das gilt sowohl für die Thinking-Block-Bindung von Opus 5.5
  als auch für die Cache-Trefferquote.
- Lange Läufe: Kompaktierung übernimmt das Agent SDK; im Fallback macht es die Plattform mit einer Zusammenfassung.
- Bilder (Frames, Kontaktabzüge) werden pro Prüfschritt angehängt, nicht dauerhaft im Kontext gehalten.

### 7.5 Skills (gebündelt, versioniert)

- **Modell-Skills:** Prompting-Guides je wichtigem Modell (h3-max, weitere Video-, Bild-, Stimm- und
  Musikmodelle) mit Syntax, Stärken/Schwächen, Parameter-Rezepten, Fehlerbildern und Kostentipps.
- **Genre-Skills:** music-video, short-film, social-ads, explainer, audio-edit, slides, collage, web-design.
- **Craft-Skills:** kinetic-typography, code-transitions, rotoscope-overlay, lipsync-workflow,
  character-consistency, reframing, sound-mix-loudness, anti-slop, review-checklist.

---

## 8. fal-Integration

1. **Katalog-Sync:** `GET https://api.fal.ai/v1/models` (Suche/Kategorie/Paginierung, optional mit OpenAPI) und
   `GET https://api.fal.ai/v1/models/pricing`. Das Ergebnis wird lokal gecacht (App-Datenordner) und regelmäßig
   aktualisiert. Die fal-Kategorien werden auf Modalitäten abgebildet.
2. **Fähigkeiten aus dem Schema:** Das Eingabeschema des OpenAPI-Dokuments wird ausgewertet. Daraus ergeben sich
   Audio-Eingang (`audio_url` u. ä.), Referenzbilder (`image_url(s)`), Video-Eingang, Dauer-Optionen,
   Seitenverhältnisse, Auflösung und Seed. Kuratierte Overrides ergänzen das, z. B. `h3-max` als Default.
3. **Parameter setzt der Director:** `get_model_schema` liefert das JSON-Schema. `generate` validiert die Eingabe
   (Ajv) **vor** dem Absenden.
4. **Ausführung:** Queue-API (submit → status → result, mit Abbruch). Lokale Eingabedateien gehen über den
   fal-Storage. Ergebnisse werden **sofort in den Projektspeicher kopiert**, weil fal-URLs nicht dauerhaft sind,
   und als Asset mit Lineage registriert.
5. **Kosten:** Vor dem Absenden eine Schätzung aus Preiseinheit und Eingabe (Sekunden, Bilder, Megapixel, Zeichen,
   Minuten), alternativ über die Schätz-API von fal. Im Ledger wird reserviert und nach Abschluss der Ist-Betrag
   gebucht.
6. **Benötigte Hosts:** `api.fal.ai`, `queue.fal.run`, `fal.run`, `fal.media` und Varianten, `rest.alpha.fal.ai`
   (Storage).

---

## 9. Dokumentmodelle, Referenzen und Versionen

### 9.1 Timeline (Video/Audio)

Die Timeline arbeitet framegenau mit Ganzzahlen. Spuren: `video`, `overlay` (Code-Komponenten), `text`
(Lyrics/Untertitel/Typografie) und `audio` (Rolle `voice`/`music`/`sfx`). Clips verweisen auf Assets oder auf
Code-Komponenten mit Props. Marker gibt es für Beats, Sections, Wörter, Checkpoints und Notizen. Formatvarianten
haben eigene Reframing-Daten pro Clip.

```json
{
  "kind": "timeline", "fps": 30, "width": 1920, "height": 1080, "durationFrames": 5400,
  "formats": [{"id": "16:9", "width": 1920, "height": 1080}, {"id": "9:16", "width": 1080, "height": 1920}],
  "tracks": [
    {"id": "V1", "kind": "video", "clips": [{"id": "shot_07", "assetId": "ast_31c", "start": 372, "in": 0, "duration": 168,
      "transform": {"fit": "cover", "reframe": {"9:16": {"x": 0.62, "y": 0.5}}}}]},
    {"id": "V2", "kind": "overlay", "clips": [{"id": "ov_03", "componentId": "cmp_paper_roto", "start": 372, "duration": 168,
      "props": {"rotoscope": "ast_roto_07"}}]},
    {"id": "T1", "kind": "text", "clips": [{"id": "lyr_12", "text": "faster", "style": "hero", "start": 384, "duration": 40}]},
    {"id": "A1", "kind": "audio", "role": "music", "clips": [{"id": "song", "assetId": "ast_song", "start": 0, "in": 0, "duration": 5400, "gainDb": 0}]}
  ],
  "markers": [{"id": "m1", "frame": 360, "kind": "section", "label": "Chorus 1"}]
}
```

### 9.2 Deck, Canvas, Site

- **Deck:** Theme (Farben, Schriften, Raster) und Folien mit Layout, Elementen (Text, Bild, Form, Video, Diagramm,
  HTML-Block) und Sprechernotizen. Gerendert wird mit Chromium (HTML, 1920×1080). Export als PDF und PNG, PPTX per
  `pptxgenjs`.
- **Canvas:** Größe/Einheit/DPI, Hintergrund und Ebenenbaum (Bild, Text, Form, Gruppe) mit Transformation,
  Mischmodus und Effekten (Papier, Korn, Schatten). Gerendert wird als SVG über Chromium zu PNG/PDF.
- **Site:** Quellbaum unter `site/` (Vite + React + Tailwind als Standard, schlichtes HTML möglich) plus
  Seitenkarte. Elemente tragen beim Build `data-src`-Attribute (Datei:Zeile), damit ein Klick auf die passende
  Quellstelle zurückführt.

### 9.3 Referenzmodell (in `@studio/core`)

Referenzen sind eine Union von `time`, `range`, `clip`, `marker`, `asset`, `slide`, `element`, `region` und
`version`. Jede hat:

- eine stabile Chip-Beschriftung,
- eine Serialisierung als `<ref …/>`,
- eine Auflösung zu Kontext: Inhalt am Ort, Frames bzw. Ausschnitte als Bilder, Wörter, Lineage.

### 9.4 Operationen und Versionen

- Dokumentänderungen laufen ausschließlich über **Operationen**, etwa `insert_clip`, `move_clip`, `trim_clip`,
  `set_clip_props`, `remove_clip`, `add_track`, `add_marker`, `add_slide`, `update_element`, `add_layer` usw.
  Jede Operation ist eine reine Funktion (`apply(doc, op) → doc'`) mit Validierung: Überlappungen auf exklusiven
  Spuren, Grenzen, Referenzen auf existierende Assets.
- Eine Charge von Operationen ergibt eine **unveränderliche Version** (`versions/000123.json` +
  Operationsprotokoll + Notiz + Autor/Lauf). „Wiederherstellen“ erzeugt eine neue Version mit dem alten Inhalt.

---

## 10. Projektordner und Index (local-first)

```
MeinProjekt.dstudio/
  project.json                 # Manifest: Kategorie, Formate, Brief, Picker, Budgets, Checkpoints
  documents/main.json          # aktueller Stand (Spiegel der neuesten Version)
  versions/000001.json …       # unveränderliche Snapshots inkl. ops + Notiz
  assets/store/ab/cd/<sha256>  # inhaltsadressierte Dateien (Generierungen, Importe)
  assets/derived/…             # Proxies, Thumbnails, Peaks, Kontaktabzüge
  code/components/*.tsx        # Director-Code (Remotion-Komponenten)
  site/                        # Web-Projekt (falls Kategorie Web)
  conversation/                # Gesprächsprotokoll (jsonl), Director-Session-IDs
  .studio/index.sqlite         # Assets, Lineage, Generierungen, Ledger, Nachrichten, Jobs
```

- **Verknüpfte Dateien:** Eigene Dateien werden per Pfad und Hash referenziert. Es gibt kein Kopieren und keinen
  Upload. Fehlt eine Datei, löst der Index über den Hash wieder auf; optional lässt sie sich „ins Projekt
  übernehmen“.
- **Uploads zu fal** nur zweckgebunden. Sie werden im Ledger und im Asset-Protokoll vermerkt, damit die Privatsphäre
  nachvollziehbar bleibt.

---

## 11. Rendering, Vorschau und Export

- **Video:** Remotion. In der UI läuft `@remotion/player` mit Proxies. `renderStill` dient der Director-QA,
  `renderMedia` den Vorschauen und Exporten. Chromium ist das von Electron oder eines, das der Render-Worker
  mitbringt. Zum Schluss ein ffmpeg-Lautheitspass (Ziel −14 LUFS integriert, True Peak −1 dBTP; Podcast −16 LUFS).
  Remotion-Lizenz: für Einzelpersonen und kleine Firmen frei, ab einer bestimmten Firmengröße kostenpflichtig.
  Das muss vor einer Weitergabe geprüft werden.
- **Code-Komponenten:** Der Director schreibt TSX. Es wird mit esbuild gebündelt, mit einer Import-Allowlist
  (`react`, `remotion`, Studio-FX-Helfer) und deterministisch (kein `Math.random` ohne Seed, kein `Date`, kein
  Netzwerk). Getestet wird per `render_still` vor der Platzierung.
- **Slides/Canvas:** HTML/SVG → Chromium → PNG/PDF; PPTX über pptxgenjs.
- **Web:** Pro Site läuft ein Vite-Dev-Server mit HMR. Die Vorschau zeigt eine `WebContentsView` mit
  Element-Picker. Screenshots kommen in mehreren Viewports, dazu Konsolenfehler und axe-a11y. Export als
  statischer Build bzw. ZIP; Deploy ist optional.

---

## 12. Medien- und Analyse-Pipeline (hybrid)

| Aufgabe | Lokal | über fal |
|---|---|---|
| Probe, Proxies, Thumbnails, Filmstreifen, Peaks | ffmpeg | — |
| Frames, Kontaktabzüge | ffmpeg | — |
| Lautheit/Normalisierung | ffmpeg `ebur128`/`loudnorm` | — |
| Beats/Tempo/Onsets | JS-Onset-/Tempo-Schätzung | optional genauere Modelle |
| Stems (Vocals/Instrumental) | — | Stem-Separation-Modell |
| Wortzeitstempel (Lyrics/Dialog) | — | STT mit Wortzeitstempeln |
| Masken/Pose/Tiefe/Konturen (Rotoscope) | Konturvereinfachung | Segmentierung, Pose, Tiefe |
| AV-Sync-Prüfung | Kreuzkorrelation (Audio↔Audio; Bewegungsenergie ROI↔Stimm-Hüllkurve) | optional Gesichtslandmarken |

---

## 13. Lip-Sync, Timing und Verifikation

1. Aus den Wortzeitstempeln Phrasen ableiten und die Shotlänge planen: Segment + Handles, innerhalb der
   Modellgrenzen.
2. Das exakte Audio-Segment schneiden (Stimm-Stem oder Mix, je nach Modell) und an ein Modell mit Audio-Eingang
   übergeben, sonst Lipsync-Modell im Nachgang.
3. `check_av_sync`: Versatz in ms + Konfidenz. Bei |Versatz| ≤ 1 Frame platzieren, bis ±6 Frames per Clip-Versatz
   korrigieren, darüber neu generieren (innerhalb des Budgets, mit begrenzten Versuchen).
4. Jede Prüfung wird am Clip als Marker/Notiz vermerkt und ist im Panel sichtbar.

## 14. Rotoscope-Overlay („über das Basis-Footage zeichnen“)

Ablauf: Basis-Shot generieren → `extract_rotoscope` (Masken, Pose, Tiefe, Konturen) → Daten-Assets als
vereinfachte Polygone/Keypoints in JSON → Remotion-Komponente zeichnet den Stil (Papier, Tusche, „Boil“ auf Zweiern
mit Seed) → Basis ausblenden oder mischen → QA per Stills.

## 15. Sprache (Push-to-Talk)

- Aufnahme im Renderer (MediaRecorder) → Datei → Transkription über fal (STT mit Wortzeitstempeln; Deutsch).
- Die Zeitpunkte von Marker-Klicks und `Enter` relativ zum Aufnahmestart werden auf die Wortgrenzen abgebildet (`alignClicksToWords`),
  die Chips an diesen Stellen eingefügt. Das Transkript bleibt editierbar, bevor du sendest.

## 16. Kosten und Budget

- **Ledger:** Schätzung → Reservierung → Ist-Buchung. Quellen: fal-Generierungen, Director-Nutzung (Tokens bzw.
  laut SDK berechnete Kosten) und Uploads/Analysen.
- **Budgets** pro Checkpoint. Das Gate im `generate`-Tool und der Agent-SDK-Hook verweigern Aufrufe ohne Deckung
  und legen eine Approval-Karte vor.
- In der UI: verbraucht / reserviert / freigegeben, pro Projekt und pro Checkpoint.

## 17. Sicherheit, Datenschutz, Recht

- Keys liegen im OS-Schlüsselbund (`safeStorage`), nie im Projektordner. Auch der Renderer bekommt sie nie zu sehen.
- KI-Code läuft nur isoliert in eigener Partition, ohne Node, mit CSP und ohne Netzwerk außer Projekt-Assets.
- Keine Personen-Likeness und keine Stimmklone ohne Einwilligung. Rechte-Hinweise bei Fremdmaterial. Die
  Modell-Lizenzen (kommerzielle Nutzung) stehen im Picker.
- Anthropic-Richtlinie: Claude-Abo-Login nur für Eigennutzung (siehe 7.1). Bei der Weitergabe an andere gilt
  API-Key/Login oder der fal-Fallback.

## 18. Teststrategie

| Ebene | Werkzeug | Inhalt |
|---|---|---|
| Unit | Vitest | core (Referenzen, Composer, Ops, Versionen, Budget, Picker-Gates, Wort-Alignment), fal (Parsing, Fähigkeiten, Schätzung, Runner mit Mock-HTTP), director (Tools mit Fake-Services, Gates, Kontext, Fallback-Loop mit Fake-LLM), project (Ordner, Index, Lineage) |
| Integration | Vitest + echtes ffmpeg/Chromium | media (synthetische Medien), render (Remotion-Still einer Timeline, Deck → PDF/PPTX, Canvas → PNG), Komponenten-Compiler |
| UI | Vitest + Testing Library | Timeline-Klick/Ziehen → Referenz, Composer-Chips, Picker, Asset-Drag |
| E2E | Playwright (Renderer gegen Fake-Backend) + Electron-Smoke-Test unter Xvfb | Projekt anlegen → Planungsgespräch → Referenz → Director-Antwort → Version |

## 19. Umsetzungsphasen

1. **Fundament** (core, project) mit Verträgen und Tests.
2. **Pakete:** fal, media, render, director parallel. Externe Dienste werden in Tests gemockt.
3. **Desktop-App:** UI-Komponenten, IPC, Utility-Prozesse, Einstellungen (Keys/Anmeldung).
4. **E2E und Härtung**, danach groß angelegte Tests mit echten Keys (fal/Anthropic) in einer Umgebung mit
   Netzwerkfreigabe.
5. **Später:** Mehrnutzer (Sync/Teams), Signierung/Notarisierung, Auto-Update, lokale ML-Option (Apple Silicon /
   NVIDIA), Deploy-Integrationen.

## 19a. Ergebnisse der Desktop-Recherche (übernommen)

- **h3-max** ist eine Modellfamilie: `minimax/h3-max/{text-to-video, reference-to-video, extend-video, director, 3d-to-video}`
  sowie `h3-max-turbo`. Die Clips sind 5–15 s lang, die Auflösung liegt laut Quelle bei 768p oder 1080p, und es
  gibt **kein 4:5**. Daraus folgen Pflichtschritte: Konformieren (fps/Auflösung), Upscaling sowie Reframing bzw.
  Outpainting für 4:5. Bei 1080p kostet es ca. $0,16/s, was vor Nutzung zu prüfen ist. Der Picker behandelt die
  Familie als ein Modell.
- **fal:** Webhooks erreichen keine lokale App, deshalb wird die Queue gepollt. Neue Konten haben ca. 2 parallele
  Requests (bis 40 nach Aufladen); weitere Requests werden eingereiht. Die UI zeigt deshalb Warteschlange und ETA.
  Mit `X-Fal-Store-IO: 0` speichert fal keine Payloads, dazu kommen Lifecycle-Header. Preise kommen aus
  `/v1/models/pricing`, Schätzungen aus `/estimate`.
- **Render-Pipeline:** Remotion rendert **nur das Bild** (stumm), ffmpeg mischt das Audio (Ducking, Fades,
  Lautheit) und muxt am Ende. Die Headless-Shell wird auf Electrons Chromium gepinnt.
- **Lizenzen vor Distribution klären:** Das ffmpeg im Remotion-Compositor ist mit GPL und fdk-aac gebaut. Für
  Prompt-to-Video-Apps gilt das Remotion-„Automators“-Modell. Codec-Patente lassen sich über OS-Encoder
  umgehen (VideoToolbox, Media Foundation). HyperFrames (Apache-2.0) ist als Ausweichoption zu beobachten.
- **Sicherheit:** Die Gates (Budget, Upload, Deploy) sind im Code durchgesetzt, nicht im Prompt. Tool-Ergebnisse
  werden als Daten markiert (Schutz vor Prompt-Injection). Keys gelangen nie in die Umgebung von Dev-Server oder
  Worker. Der Dev-Server läuft mit bereinigter Umgebung. Die Vorschau nutzt eine In-Memory-Partition.
- **Journale:** Generierungen werden **vor** dem Absenden als JSONL-Eintrag mit fsync geschrieben. SQLite ist nur
  ein abgeleiteter Index.
- **Offen bzw. später:** Golden-Frame-Tests bei Updates, Telemetrie nur per Opt-in, C2PA-Kennzeichnung (EU AI Act
  Art. 50), DE/EN-i18n, Barrierefreiheit (Referenzen per Tastatur), Offline-Verhalten, Mindest-Hardware.

## 20. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Anthropic-Richtlinien zu Abo-Logins ändern sich | Anmeldekette mit API-Key- und fal-Fallback; Abo-Login nur für Eigennutzung |
| Modellkatalog/-schemata ändern sich | Live-Sync, Schema-Hash, Fähigkeiten aus Schema, versionierte Skills |
| Lip-Sync/Timing schwankt | Audio-Referenzen, Mess-Loop, Clip-Versatz, Retry-Budget, Lipsync-Nachbearbeitung |
| Kosten laufen aus dem Ruder | Checkpoint-Budgets, Gates, Schätzung vor jedem Call, günstige Tests zuerst |
| KI-Code ist unsicher oder bricht das Rendering | Isolation, Import-Allowlist, Determinismus-Regeln, Still-Tests |
| fal-URLs laufen ab | Sofortiger Ingest in den Projektspeicher |
| Remotion-Lizenz bei Weitergabe | Lizenz vor Distribution klären |
| Lange Agent-Läufe brechen ab | Persistente Jobs, Session-Resume, idempotente Tools |
