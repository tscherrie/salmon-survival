# Director Studio · Richtung A „Grading Suite“

> Designrichtung für das neue Layout (Assets links · Monitor · Director rechts · Composer darunter · Timeline in voller
> Breite). Mockups: `start.html`, `video.html`, `slides.html`, `web.html`, `panel.html` (eine gemeinsame `studio.css`,
> keine Build-Stufe nötig). Screenshots: `shots/`. Der Generator in `_src/` erzeugt HTML und CSS reproduzierbar
> (`node _src/build.mjs`).

---

## 1. Idee

**Der Raum ist dunkel, das Bild ist die Lichtquelle.** In einer Grading-Suite verschwindet die Umgebung. Wände,
Konsole und Licht sind neutral, damit das Auge nur dem Bild glaubt. Director Studio übernimmt dieses Prinzip:

1. **Drei Helligkeitsstufen statt Dekoration.** *Rahmen* (Kopfzeile, Asset-Leiste, Timeline: `--base`), *Werkbank*
   (Gespräch und Composer: `--panel`) und *Bildraum* (Monitor: `--well`, fast schwarz). Hierarchie entsteht aus
   Luminanz und Haarlinien. Schatten bekommen nur schwebende Elemente.
2. **Zwei Farbtemperaturen, zwei Bedeutungen.**
   - **Tungsten (3200 K, `--accent` #F0A458)** heißt *jetzt / live / aktiv*: Abspielkopf, Timecode-Anzeige, laufende
     Arbeit, aktueller Checkpoint, die eine Primäraktion pro Kontext. Das ist sparsam: auf einem Screen gibt es selten
     mehr als fünf Tungsten-Stellen.
   - **Daylight (5600 K, `--ref` #9DBDD8)** heißt *worauf du zeigst*: Marker, Composer-Chips, referenzierte Assets und
     Zeitangaben im Chat, Element-Auswahl im Monitor. Was du anfasst, ist blau. Was läuft, ist warm.

   Daylight ist keine zweite Akzentfarbe, sondern eine semantische Farbe. Sie trägt das Kernprinzip „Zeigen statt
   beschreiben“ und ist bewusst entsättigt. Es gibt keine Verläufe.
3. **Das Gespräch umarmt das Bild.** Chat und Composer teilen sich eine Fläche (`--panel`) und bilden ein umgedrehtes
   „L“ um die untere rechte Ecke des Monitors. Diese Ecke ist der einzige große Radius im Layout (14 px). Zwischen
   Chat und Composer gibt es keine Trennlinie. So liest sich das Gespräch als ein Element: Hier redest du mit dem
   Director, von der ersten Nachricht bis zum Senden-Knopf. Die Asset-Leiste gehört tonal zum Rahmen (`--base`), wie
   Kopfzeile und Timeline. Material und Schnitt bilden so den Rahmen, das Gespräch die Werkbank, das Bild den
   Mittelpunkt.
4. **Typografie wie ein Messgerät.** Fließtext in einer ruhigen, leicht schmal laufenden Grotesk. Alles Messbare
   (Timecodes, Preise, Dauern, Spur-IDs) steht in einer feinen Monospace mit festen Ziffernbreiten, damit Zahlen beim
   Abspielen nicht springen.

Bewusst vermieden werden: Verläufe in der UI, Glas-Effekte, Glow, Emoji, zentrierte Layouts, gleichförmige Karten mit
Schatten, Creme/Terrakotta-Serifen und Neon auf Schwarz. Farbe kommt ausschließlich aus den Medien. Die UI selbst ist
neutral-warmes Grau.

---

## 2. Layout und Informationsarchitektur

```
┌──────────┬────────────────────────────────┬──────────────┐  Kopfzeile 44 px (--base)
│ ASSETS   │ MONITOR (--well)               │ DIRECTOR     │
│ --base   │ Meta-Zeile · Bild · Transport  │ --panel      │
│ 272 px   │                         ╭──────┘ 368 px       │
│          ├─────────────────────────┴─────────────────────┤  ← keine Linie zwischen Chat und Composer
│          │ COMPOSER (--panel, gleiche Fläche wie Chat)    │
├──────────┴───────────────────────────────────────────────┤
│ BÜHNE: Timeline / Folien / Seiten  (--base, volle Breite) │  284 px (Video), 206–214 px (Folien/Seiten)
└──────────────────────────────────────────────────────────┘
```

| Breakpoint | Assets | Director | Bühne | Spurhöhen V1/V2/T1/A1/A2/A3 |
|---|---|---|---|---|
| ≤ 1360 px Breite (z. B. 1280×800) | 240 | 328 | 256 | 38/18/18/28/32/20 (bei Höhe ≤ 820) |
| 1440×900 (Referenz) | 272 | 368 | 284 | 44/21/21/34/40/23 |
| ≥ 1800 px (1920×1080+) | 304 | 420 | 302 | 52/22/22/38/44/24 |

- **Größe ändern:** Jede Kante zwischen den Bereichen ist ein Splitter. Sichtbar ist eine 1-px-Haarlinie, die
  Trefferfläche ist 7 px breit. Beim Hover wird die Linie 2 px breit in `--line-3`, der Cursor wird `col-resize`, ein
  Doppelklick setzt die Breite zurück. Grenzen: Assets 220–400 px, Director 300–520 px, Bühne 160 px bis 50 % der
  Fensterhöhe. Der Monitor bekommt immer den Rest.
- **Einklappen:** Das Icon rechts im Seitenleisten-Kopf (`side-left` / `side-right`) klappt auf eine 40-px-Schiene ein.
  Die Asset-Schiene zeigt das Typ-Icon und die Anzahl, die Director-Schiene den Status-Punkt und ungelesene Nachrichten.
  Kürzel: `⌘1` Assets, `⌘2` Director, `⌘3` Bühne, `⌘0` Monitor maximieren (alles ein). Unter 1200 px Breite klappt die
  Asset-Leiste automatisch ein.
- **Bühne je Kategorie:** Video/Audio zeigen die Timeline, Slides den Folienstreifen mit Abschnittslabels, Grafik die
  Ebenenliste (gleiches Raster wie der Folienstreifen) und Web die Seitenkarten mit QA-Status. Die Bühnen-Leiste hat
  immer dieselbe Anatomie: Icon, Titel, Version/Format, Kurz-Hinweis und rechts die Werkzeuge.

---

## 3. Tokens

### 3.1 Farben

| Token | Dunkel (Standard) | Hell | Verwendung |
|---|---|---|---|
| `--well` | `#09090A` | `#161618` | Bildraum hinter Medien. Bleibt auch im hellen Theme dunkel (`.always-dark`). |
| `--base` | `#0F0F10` | `#E6E5E2` | Rahmen: Kopfzeile, Asset-Leiste, Bühne |
| `--panel` | `#141415` | `#F1F0ED` | Werkbank: Director und Composer |
| `--raised` | `#1A1A1C` | `#FFFFFF` | Eingabefelder, Karten, Popover |
| `--hover` / `--active` | `#212123` / `#29292C` | `#E7E6E2` / `#DCDBD7` | Zustände |
| `--sunken` | `#0B0B0C` | `#DDDCD8` | Markerleiste, Segment-Hintergrund |
| `--line` / `--line-2` / `--line-3` | `#232325` / `#2D2D30` / `#3B3B3F` | `#D9D7D2` / `#CDCBC6` / `#B6B4AE` | Haarlinien, Ränder von Controls, Ticks |
| `--text` / `--text-2` / `--text-3` | `#ECE9E4` / `#A9A59E` / `#8B8780` | `#1A1A1B` / `#4F4D49` / `#67645F` | Primär, sekundär, Meta |
| `--text-4` | `#5C5954` | `#A3A09A` | nur dekorativ (Trennpunkte, Bar-Ticks), nie für Information |
| `--accent` | `#F0A458` | `#E0923F` | Tungsten-Flächen: Primärknopf, Abspielkopf-Kappe, Fortschritt |
| `--accent-text` | `#F3B06C` | `#874709` | Tungsten als Schrift (Timecode, „zur Freigabe“) |
| `--accent-line` | `#F0A458` | `#B9630F` | Abspielkopf-Linie, Fokusring |
| `--on-accent` | `#1A1006` | `#1A1006` | Schrift auf Tungsten (in beiden Themes dunkel) |
| `--ref` / `--ref-text` / `--on-ref` | `#9DBDD8` / `#B4CDE2` / `#0B1620` | `#2F6690` / `#255680` / `#FFFFFF` | Daylight: Marker, Chips, Referenzen |
| `--pick` | `#5FA8EE` | `#5FA8EE` | Auswahlrahmen auf Inhalten im Monitor (muss auf hellen *und* dunklen Medien stehen) |
| `--ok` / `--warn` / `--danger` | `#7EBF8E` / `#E0C070` / `#E8705F` | `#2A7044` / `#7A5D0C` / `#A93A2B` | Status |
| `--trk-video` / `-overlay` / `-text` / `-audio` | `#A7AEB4` / `#C79C86` / `#CFC6B8` / `#8FB8A0` | `#5E666D` / `#9A5F45` / `#6F675B` / `#3F7A5A` | Spurfarben (Kennstreifen, Clip-Tönung, Wellenform) |

Weiche Varianten (`--accent-soft` 13 % bzw. 16 %, `--ref-soft` 13 % bzw. 10 %) entstehen als Alpha über der jeweiligen
Fläche. Für die Spurfarben gilt: Alle Audiospuren teilen sich **einen** Salbeiton. Video zeigt Bilder, Text ist grau,
Overlay tonfarben. Wenige Farben, eindeutige Lesart.

### 3.2 Kontrast (WCAG 2.2, berechnet mit `_src/contrast.py` direkt aus `studio.src.css`)

| Paar | Zweck | Dunkel | Ratio | Hell | Ratio |
|---|---|---|---|---|---|
| `--text` auf `--base` | Fließtext | #ECE9E4 / #0F0F10 | **15.82** | #1A1A1B / #E6E5E2 | **13.81** |
| `--text` auf `--panel` | Fließtext | #ECE9E4 / #141415 | **15.20** | #1A1A1B / #F1F0ED | **15.26** |
| `--text` auf `--raised` | Fließtext | #ECE9E4 / #1A1A1C | **14.35** | #1A1A1B / #FFFFFF | **17.39** |
| `--text-2` auf `--panel` | Fließtext | #A9A59E / #141415 | **7.51** | #4F4D49 / #F1F0ED | **7.40** |
| `--text-2` auf `--raised` | Fließtext | #A9A59E / #1A1A1C | **7.09** | #4F4D49 / #FFFFFF | **8.43** |
| `--text-3` auf `--base` | Meta | #8B8780 / #0F0F10 | **5.36** | #67645F / #E6E5E2 | **4.68** |
| `--text-3` auf `--panel` | Meta | #8B8780 / #141415 | **5.15** | #67645F / #F1F0ED | **5.17** |
| `--text-3` auf `--raised` | Meta | #8B8780 / #1A1A1C | **4.86** | #67645F / #FFFFFF | **5.89** |
| `--accent-text` auf `--panel` | Text | #F3B06C / #141415 | **9.85** | #874709 / #F1F0ED | **6.28** |
| `--accent-text` auf `--base` | Text | #F3B06C / #0F0F10 | **10.25** | #874709 / #E6E5E2 | **5.68** |
| `--accent-text` auf `--accent-soft` | Status-Pill | über `--base` | **8.32** | über `--base` | **5.11** |
| `--on-accent` auf `--accent` | Knopfbeschriftung | #1A1006 / #F0A458 | **9.06** | #1A1006 / #E0923F | **7.45** |
| `--ref-text` auf `--raised` | Chip-Text | #B4CDE2 / #1A1A1C | **10.57** | #255680 / #FFFFFF | **7.72** |
| `--ref-text` auf `--ref-soft` | Chip-Text im Chip | | **8.19** | | **6.71** |
| `--on-ref` auf `--ref` | Markernummer | #0B1620 / #9DBDD8 | **9.31** | #FFFFFF / #2F6690 | **6.13** |
| `--ok` / `--danger` / `--warn` auf `--panel` | Statustext | | **8.53 / 6.06 / 10.47** | | **5.27 / 5.54 / 5.42** |
| `--accent-line` auf `--base` | Abspielkopf, Fokus (UI ≥ 3:1) | #F0A458 / #0F0F10 | **9.27** | #B9630F / #E6E5E2 | **3.43** |
| `--ref` auf `--base` | Marker-Tag (UI ≥ 3:1) | #9DBDD8 / #0F0F10 | **9.77** | #2F6690 / #E6E5E2 | **4.87** |
| `--text-3` / `--accent-text` / `--text` auf `--well` | Monitor-Chrome | | **5.57 / 10.65 / 16.44** | (gleich, Monitor ist immer dunkel) | |
| Pick-Tag `#07121C` auf `--pick` | Auswahl-Label | | **7.48** | | **7.48** |

Alle Textpaare liegen bei mindestens 4,5:1, alle informationstragenden Grafikobjekte (Abspielkopf, Marker, Fokusring,
Auswahl) bei mindestens 3:1. Haarlinien (`--line`, ca. 1,2–1,6:1) und Ticks sind bewusst leise. Kein Control wird *nur*
über seinen Rand erkannt, immer auch über Füllung, Icon oder Beschriftung (WCAG 1.4.11). Für Bedarf an mehr Kontrast
hebt `@media (prefers-contrast: more)` (bzw. die Einstellung „Erhöhter Kontrast“) Linien auf ≥ 3:1 und `--text-3` auf
das Niveau von `--text-2`.

### 3.3 Typografie

**Schriften (offline, im App-Paket mitgeliefert, beide SIL Open Font License 1.1):**

| Rolle | Familie | Dateien | Warum |
|---|---|---|---|
| UI und Fließtext | **Instrument Sans** (variabel, `wght` 400–700, `wdth` 75–100) | `fonts/InstrumentSans-Variable.woff2` (57 KB) + `-ext` (19 KB) | Ruhige, leicht schmal laufende Grotesk mit eigenem Charakter (nicht Inter/SF). Die `wdth`-Achse liefert die schmale Titelschrift für Burn-ins und Labels ohne zweite Familie. Hat `tnum`. Volle deutsche Abdeckung inkl. „“ und ß. |
| Timecodes, Preise, IDs | **IBM Plex Mono** 400/500/600 | `fonts/IBMPlexMono-*.woff2` (je ca. 15 KB) | Feine, technische Monospace mit klarer 0/O- und 1/l/I-Unterscheidung. Feste Ziffernbreiten, damit Zahlen beim Abspielen nicht springen. |

Lizenztexte liegen in `fonts/OFL-*.txt`. Fallback-Stacks: `-apple-system, "SF Pro Text", "Segoe UI Variable Text",
system-ui` bzw. `"SF Mono", ui-monospace, "Cascadia Mono", Consolas`. `font-display: block`, weil die Fonts lokal
liegen und es deshalb kein Aufblitzen gibt.

| Stufe | Größe / Zeile | Gewicht | Einsatz |
|---|---|---|---|
| Display | 28 / 1.15, −0.02 em | 600 | Startbildschirm-Frage |
| Feature-Titel | 30 / 1.05, −0.025 em | 600 | Projektname im Start-Feature |
| Titel | 15 / 1.3 | 600 | Dialogtitel, Bereichstitel |
| Kartentitel | 13.5 / 1.35 | 600 | Checkpoint-, Rückfrage- und Genehmigungskarte |
| Panel-Titel | 13 / 1 | 600 | „Assets“, „Director“, „Timeline“ |
| Fließtext | 13 / 1.58 | 400 | Chat |
| Composer | 13.5 / 26 px | 400 | Eingabe; die Zeilenhöhe nimmt 22-px-Chips auf |
| UI | 12 / 1 | 500 | Knöpfe, Tabs, Spurnamen (11.5) |
| Meta | 11–11.5 / 1.3 | 400 | Zeitstempel, Hinweise, Modell · Preis |
| Overline | 10.5 / 14, +0.08 em, VERSALIEN | 600 | Gruppenköpfe, Karten-Kicker (sparsam) |
| Mikro-Label | 9.5, +0.09 em, VERSALIEN | 600 | Abschnitte in der Timeline (INTRO, REFRAIN 1) |
| TC groß | Plex Mono 15 / 1 | 500 | Transport-Timecode (Tungsten) |
| TC klein | Plex Mono 10–11.5 | 400–500 | Lineal, Chips, Preise, Dauern, Spur-IDs |

**Zahlen und Timecode:** Monospace (feste Ziffernbreiten) überall dort, wo Zahlen sich ändern oder untereinander stehen.
In Instrument Sans wird `font-variant-numeric: tabular-nums` gesetzt, wenn Zahlen im Fließtext ausgerichtet werden
müssen (KPI-Folien). Formate: Transport `HH:MM:SS:FF` (SMPTE, fps aus dem Projekt; Drop-Frame bei 29,97 mit `;` vor den
Frames), Chips und Chat `MM:SS:FF`, Lineal `MM:SS` (mit Zoom: Frames). Preise `$0.80` wie in der App,
Schätzungen mit `≈`.

### 3.4 Abstände, Raster, Radien, Kanten

- **Raster:** 4-px-Basis. Skala 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32 · 40. Panel-Innenabstand
  14–16 px, Karten 12 px, Gruppenabstand im Chat 14 px.
- **Feste Höhen:** Kopfzeile 44, Seitenleisten-Kopf 42, Bühnen-Leiste 34, Transport 46, Knöpfe 28 (klein 24, groß 36),
  Chips 22, Markerleiste 15, Lineal 24, Abschnitte 21.
- **Radien:** 2 (Marker-Tag, Clip-Labels) · 3 (Clips) · 4 (Chips, kleine Knöpfe) · 6 (Controls) · 8 (Karten) · 10
  (Composer, Popover) · 12 (Dialoge, Startkarten) · **14 (Monitor-Ecke unten rechts, die „L“-Signatur)**. Pillenformen
  nur für Status-Badges.
- **Kanten statt Schatten:** Flächen trennen sich über Luminanz und 1-px-Haarlinien. Genau **ein** Schatten-Token
  `--shadow-pop` für Schwebendes (Popover, Dialog, Toast, Marker-Tooltip). Ausnahme: das Monitorbild bekommt einen
  großen weichen Schatten in den `--well`, damit es „leuchtet“.

### 3.5 Ikonografie

Eigenes Set (`_src/icons.mjs`), 16-px-Raster, 1,5-px-Kontur, runde Enden und Ecken, geometrisch, ohne Füllungen. Gefüllt
sind nur Transport-Glyphen (Play, Pause, Stopp), weil sie sich als Hardware-Tasten lesen. Größen: 16 in der Kopfzeile
und im Transport, 13–15 in Controls, 11–12 in Chips und Badges. Farbe ist `currentColor`, meist `--text-2` bzw. `--text-3`.
Icons stehen nie allein für unbekannte Funktionen: Jeder Icon-Knopf hat einen Tooltip mit Kürzel und ein
`aria-label`. Modalitäts-Icons: Director = Klappe, Text = T, Bild = Rahmen, Video = Filmstreifen, Lipsync = Lippen,
Stimme = Kopf mit Wellen, Musik = Note, Sound = Lautsprecher mit Impuls, Werkzeuge = Schlüssel. Keine Emoji, keine
„KI-Funken“. Die **Bildmarke** besteht aus Sucherklammern und einem Tungsten-Tally-Punkt („zeigen“ + „aufnehmen“).

### 3.6 Bewegung

| Token | Dauer | Kurve | Einsatz |
|---|---|---|---|
| `--t-fast` | 120 ms | `cubic-bezier(.2,0,0,1)` | Hover, Press, Farbwechsel |
| `--t-med` | 180 ms | gleich | Popover/Toast rein (Opazität + 4 px Weg), Chip einsetzen |
| `--t-slow` | 240 ms | gleich | Seitenleisten ein- und ausklappen, Bühnenhöhe |
| Ausgang | 120 ms | `ease-in` | alles, was verschwindet |

- Der **Abspielkopf wird nie animiert** (bildgenau, folgt dem Player). Ein Sprung durch einen Marker-Klick ist ein Schnitt,
  keine Fahrt.
- Live-Signale sind ruhig: Der Streaming-Cursor blinkt mit 1,05 s im Schritt, der Live-Punkt atmet nur über die
  Opazität (1,6 s), der Fortschrittsbalken ist linear.
- Neuer Marker: Der Tag „setzt sich“ (Skalierung 0,6 → 1, 180 ms), gleichzeitig blendet der Chip im Composer ein. So
  ist die Verbindung sichtbar.
- **`prefers-reduced-motion`:** keine Wege, kein Blinken, kein Atmen, keine Spinner-Rotation (ersetzt durch eine
  statische Ellipse plus Fortschrittsbalken). Opazitätswechsel bleiben bei 1 ms.

---

## 4. Komponenten

### 4.1 Kopfzeile (44 px, `--base`)
- **Links:** Zurück zu den Projekten (Chevron + Bildmarke), dann Projekttitel (13.5/600) und Kategorie (12, `--text-3`).
- **Checkpoint-Stepper:** erledigt = Kreis mit Häkchen in `--ok`, aktuell = gefüllter Tungsten-Kreis mit Nummer plus
  fettem Label plus Status-Pill („zur Freigabe“, „in Arbeit“) in `--accent-soft`, offen = Ring mit Nummer in `--text-3`.
  Die Verbinder sind 16-px-Haarlinien. **Wird es eng, klappt der Stepper schrittweise ein:** erst die Labels der
  erledigten Schritte (nur noch ✓, Label im Tooltip), dann die Labels der offenen Schritte. Das aktuelle Label bleibt
  immer stehen. Ein Klick auf einen Schritt öffnet dessen Karte im Director-Verlauf.
- **Rechts:** Budget-Meter (92 × 4 px; verbraucht = `--text-2` massiv, reserviert = schraffiert, frei = `--line-2`;
  ab 85 % färbt sich „verbraucht“ in `--warn`) mit `$6.84 / $20.00` in Mono. Ein Klick öffnet das Budget-Popover mit
  Legende und Aufschlüsselung nach Modellen und Director. Danach folgen Versionen `v4 ▾` (ansehen, vergleichen,
  wiederherstellen mit Bestätigungsdialog), **Exportieren**, Theme und Einstellungen. Das Wort „Budget“ verschwindet
  unter 1600 px.

### 4.2 Monitor (`.always-dark`)
- **Meta-Zeile** oben im `--well` (11.5, `--text-3`): Was ist zu sehen (Shot/Folie/Seite), Spur, Version; rechts Proxy
  oder Auflösung und Format. Sie ist kein eigener Balken und kostet keinen Platz.
- **Bild:** zentriert und eingepasst (`min(100cqw, 100cqh·16/9)`), 1 px Lichtkante, großer weicher Schatten. Overlays
  (Safe Areas, Auswahl) liegen nur auf dem Bild.
- **Transport** (46 px, unter dem Bild statt im Bild): links der Timecode in Tungsten (er *ist* der Wert des
  Abspielkopfs) und die Gesamtdauer in `--text-3`, mittig An den Anfang, Bild zurück, **Play** (34 × 30, gefüllte
  Fläche), Bild vor, Ans Ende, rechts Format-Segmente (16:9 | 9:16 …), Safe Areas, Lautstärke, Vollbild. J/K/L,
  Leertaste und ←/→ wirken bildweise.
- **Slides:** Transport wird zur Folien-Navigation (‹ 3 / 8 ›), Modus-Segment *Element wählen | Region ziehen*, Notizen.
  **Web:** Viewport-Segment (Mobil 390 · Tablet 834 · Desktop 1440), Modus-Segment, URL in Mono, Neu laden, *Im Browser
  öffnen*.
- **Auswahl auf Inhalten** (`--pick`): 1,5 px Rahmen plus 4 px weicher Halo, oben links ein Mono-Tag mit Selektor und
  Maß (`h1.hero-title 612 × 148`). Hover = gestrichelt. Ein Klick fügt die Referenz als Chip ein und zeigt einen Toast mit
  *Rückgängig*.

### 4.3 Director-Panel (rechts, `--panel`, fließt in den Composer)
- **Kopf (42 px):** „Director“, Status (*Bereit* = grüner Punkt · *arbeitet* = atmender Tungsten-Punkt · *wartet auf
  dich / Freigabe* = Tungsten-Ring · *Fehler* = `--danger`), rechts **Stopp** (nur beim Arbeiten, rot umrandet), ⋯
  (Verlauf, Kosten, Kontext) und Einklappen.
- **Verlauf** (`role="log"`), unten verankert, oben ein 28-px-Verlauf als Scroll-Hinweis:
  - *Du:* Block in `--raised` mit Haarlinie, Radius 8. Chips darin sind statisch (ohne ×), ein Klick springt zur
    Stelle.
  - *Director:* reiner Text ohne Blase, Listen mit Mono-Ziffern, Zeitangaben als Daylight-`tcl`-Links (Klick =
    Abspielkopf springt).
  - *Streaming:* Meta „schreibt …“ und Tungsten-Cursor am Textende, `aria-busy`.
  - *Werkzeug-Gruppe:* eingeklappt eine Zeile „5 Werkzeugschritte · letzte Aktion · Dauer“, aufgeklappt eine Liste aus
    Status-Icon, Tool-Name in Mono, Zusammenfassung und Dauer. Laufende Schritte haben einen Spinner. Aufeinanderfolgende
    Schritte werden zu einer Gruppe zusammengefasst.
  - *System:* zentrierte Zeile zwischen Haarlinien („✓ Style Bible freigegeben · $6.00“).
  - *Fehler:* Karte mit Rand in `--danger` 35 %, Ursache, Hinweis auf (keine) Kosten, *Erneut versuchen* und *Anderes
    Modell …*.
- **Karten** (`--raised`, Radius 8, Rand `--line-2`, Innenabstand 12):
  - **Rückfrage:** Overline, Frage als Kartentitel, Optionen als Radiozeilen (Label 12.5/500 + Beschreibung 11.5) mit
    Tungsten-Auswahl, Badge „Empfohlen“, letzte Option „Andere …“ öffnet ein Freitextfeld. Aktionen: *Antworten*
    (primär), *Später*. Mehrfachauswahl verwendet dieselbe Zeile mit Checkbox.
  - **Checkpoint-Freigabe:** „Checkpoint 3 von 5“ + Pill *zur Freigabe*, Titel, Zusammenfassung, bis zu 4 Beleg-Thumbs
    (Klick = Referenz), darunter abgesetzt der Budgetblock: Betrag als editierbares Mono-Feld, Aufschlüsselung je
    Modalität, Meter „Danach $6.84 / $34.00“. Aktionen: **Freigeben · $14.00**, *Ändern …* (öffnet Feedbackfeld),
    *Details*.
  - **Genehmigung:** Warn-Icon, „Genehmigung · Budget“, Titel, ein Satz mit Mono-Betrag, *Genehmigen · $3.20* /
    *Ablehnen*.
- **Job-Ablage** (unten im Panel, über dem Composer, mit Haarlinie in Inhaltsbreite): laufende Generierungen mit Spinner,
  Modell, Dauer, verstrichener Zeit, Schätzung und 2-px-Tungsten-Fortschritt; fertige Jobs mit ✓ und Kosten, sie
  verschwinden nach 10 s.

### 4.4 Composer (unter Monitor und Chat, gleiche Fläche wie der Chat)
- Eingabebox `--raised`, Radius 10, Innenabstand 9/14, Zeilenhöhe 26. Platzhalter: „Antworten oder neue Anweisung …“.
- **Chips (Daylight):** 22 px, Radius 4, `--ref-soft` + 1-px-`--ref-line`, Inhalt je Art:
  - *Marker:* Nummern-Kästchen (`--ref`, Mono 10/600) + `MM:SS:FF` in Mono + ×
  - *Asset:* 22×16-Thumb + Titel + ×
  - *Folie / Element / Region / Seite:* Typ-Icon + Label + ×
  - Interaktionen: Hover auf den Chip hebt das Gegenstück hervor (Marker, Asset-Karte, Monitor-Auswahl). Ein Klick
    springt dorthin. × oder Backspace entfernt den Chip und den Marker.
- **Werkzeugleiste:** links `+` (Asset oder Datei einfügen), Hinweis „3 Marker · Enter setzt einen am Abspielkopf“; rechts
  die **Modell-Zusammenfassung**, dann das Mikrofon (Halten bzw. `⌘/Strg + Leertaste`, während der Aufnahme rot mit
  Pegel) und **Senden ⌘↵**. Während der Director arbeitet, steht im Hinweis „wird eingereiht“.

### 4.5 Modell-Picker: Zusammenfassung im Composer plus Popover

**Entscheidung:** Die bisherige Leiste über die ganze Breite (9 Dropdowns plus Denktiefe) entfällt. Im Composer steht eine
Zusammenfassung: verbundene Modelle explizit (`Opus 5.5 · sehr hoch | h3-max | nano-banana`), alle anderen als
`6 × Auto`. **Begründung:**
1. Die Modellwahl ist ein Parameter der Anweisung, die du gerade abschickst. Sie gehört neben *Senden*, wo du über
   Kosten und Qualität entscheidest, und nicht in den Chat-Kopf, der Laufzustand und Stopp anzeigt.
2. Die Wahl wird pro Projekt selten geändert. Eine dauerhafte Leiste mit 9 Controls kostet bei jeder Bildschirmgröße
   eine Zeile, kostet Ruhe und lenkt vom Bild ab.
3. Die Zusammenfassung zeigt genau das, was verbindlich ist (also vom `generate`-Gate durchgesetzt wird). „Auto“ ist der
   Normalfall und braucht keinen Platz.

**Popover** (öffnet nach oben, `⌘M`, rechtsbündig zur Zusammenfassung):
- **Ebene 1 · Modalitäten** (352 px): neun Zeilen aus Icon, Modalität, Auswahl (verbunden = `--text`/500, Auto =
  `--text-3`) und Einheitspreis in Mono. Die Director-Zeile enthält die Denktiefe („sehr hoch“) als Auswahl. Oben
  „Katalog aktualisieren“, unten die Erklärung zu verbindlich vs. Auto.
- **Ebene 2 · Modelle der Modalität** (links daneben): Suche mit Anzahl, oben „Auto“ mit Erklärung, dann je Modell Name,
  Anbieter, „Empfohlen“, **Einheitspreis**, ✓ bei Auswahl, Kurzbeschreibung aus fal, Fähigkeits-Badges (Referenzbilder,
  Edit, 4K, max. Dauer, native Tonspur) und eine Beispielrechnung („4 Bilder ≈ $0.16“). Veraltete Modelle bekommen
  einen Warnhinweis.
- Tastatur: ↑/↓ zwischen Zeilen, → bzw. Enter öffnet Ebene 2, Tippen sucht, Enter wählt, Esc geht eine Ebene zurück.

### 4.6 Timeline (Bühne Video/Audio)
- **Kopfspalte** 164 px: Kennstreifen in Spurfarbe (2 × 14), Spur-ID in Mono (`V1`), Name. In der Linealzeile steht der
  Timecode des Abspielkopfs in Tungsten, in der Abschnittszeile „120 BPM“. Mute/Solo zum Abhören erscheinen erst beim
  Hover.
- **Markerleiste** (15 px, ganz oben, `--sunken`, ca. 5 % der Bühnenhöhe): Cursor `crosshair`. Beim Hover erscheinen
  ein Geister-Tag „+“ und ein Tooltip *Marker setzen · 00:47:15 · Klick*. **Klick = Marker** (mit Beat-Raster rastet er
  auf den nächsten Schlag, `Shift` hebt das Raster vorübergehend auf). Marker-Tag: 12 px hoch, `--ref` mit Mono-Nummer,
  darunter eine gestrichelte Daylight-Linie durch alle Spuren. Nummern werden in Reihenfolge des Setzens vergeben und
  nicht umnummeriert, solange der Chip existiert.
- **Lineal** (24 px): Mono-Labels alle 5 s (je nach Zoom 1/5/10/30 s), Schlag-Ticks 4 px (`--line-3`), Takt-Ticks 8 px
  (`--text-4`).
- **Abschnitte** (21 px): Mikro-Labels INTRO · STROPHE 1 · REFRAIN 1 · BRIDGE · OUTRO. Der Abschnitt unter dem
  Abspielkopf wird `--text` mit leichtem Verlauf in `--hover`. Abschnittsgrenzen laufen als Haarlinie durch alle Spuren.
- **Spuren:** V1 als Filmstreifen (Kacheln mit 1-px-Fugen, oben eine Abdunklung für das Label `01 Stadt bei Nacht`),
  V2 Overlay tonfarben getönt, T1 Text grau getönt, A1–A3 Salbei-Wellenformen über die volle Clip-Höhe mit gefülltem
  Label-Stück oben links (lesbar über der Welle).
- **Hauptfläche (die übrigen ca. 95 %) = Scrubben:** Klick oder Ziehen setzt bzw. führt den Abspielkopf. Spannen werden
  nicht mehr gezogen. `Alt + Klick` auf einen Clip referenziert ihn als Clip-Chip.
- **Abspielkopf:** 1 px `--accent-line` über die volle Höhe, Kappe 12 × 15 im Lineal.
- **Tastatur:** `Enter` setzt einen Marker am Abspielkopf (wenn kein Textfeld fokussiert ist). Im Composer übernimmt
  `⌥ Enter` diese Rolle. ←/→ bewegt bildweise, `Shift` + ←/→ springt um einen Schlag, `[`/`]` zum vorigen/nächsten
  Marker, `Entf` auf fokussiertem Marker löscht Marker und Chip.
- **Bühnen-Leiste:** „Timeline · v4 · 25 fps“, Kurz-Hinweis (Klick: Abspielkopf · Markerleiste: Marker setzen · Enter;
  er verschwindet nach dreimaliger Nutzung und bleibt im Tooltip), rechts Beat-Raster (Toggle mit LED), Zoom,
  Einpassen, Einklappen.

### 4.7 Asset-Leiste (links)
- **Kopf:** „Assets 24“, `+` (Importieren / Verknüpfen), Einklappen.
- **Werkzeuge in zwei Zeilen statt vier:** Suchfeld (Titel, Tags, Prompts) mit Filter-Knopf darin. Der Knopf öffnet
  Status, Quelle, Modell und Sortierung; aktive Filter erscheinen als entfernbare Pills unter den Tabs, und ein Tungsten-
  Punkt am Knopf zeigt „Filter aktiv“. Darunter die Typ-Tabs (je Kategorie: Alle · Bild · Video · Audio · Text bzw.
  Daten/Code/Schrift) und der Gruppieren-Knopf (Zuletzt verwendet · Szene · Typ · Charakter · Batch).
- **Gruppen** mit Overline und Anzahl, **2-spaltiges Raster** (bei 304 px weiterhin 2, darunter auf Wunsch Liste).
- **Karte:** Thumb 16:10, Radius 5. Unten links Typ-Icon, unten rechts Dauer, oben rechts der **Verwendungsort**
  (`V1`, `A2`, `F3`, `Hero`). Der Ort ersetzt den abstrakten Status „im Dokument“ durch das, was man wirklich wissen
  will. Ohne Ort heißt das: ungenutzt. Darunter Titel (12/500, max. 2 Zeilen) und Mono-Meta „Modell · Preis“ bzw.
  „verknüpft · 48 kHz“. *Im Composer* referenzierte Assets bekommen einen Daylight-Rahmen und das Tag „Composer“.
  Varianten: Video mit Hover-Scrub, Audio als Wellenform, Text und Code als Ausschnitt mit Ausblendung, Schrift als
  Specimen.
- **Ablagezone** unten: „Dateien hierher ziehen – sie werden verknüpft, nicht hochgeladen.“ (Local-first wird
  sichtbar.) Ein Klick auf eine Karte öffnet die Detailansicht (Lineage, Prompt, Parameter, Kosten, Verwendungen).
  Ziehen in den Composer oder `⌘↵` auf der Karte fügt einen Chip ein.

### 4.8 Folienstreifen, Seitenkarten
Gleiches Raster wie die Timeline-Anatomie: eine Abschnittszeile (EINSTIEG · MARKT · PLAN) über Folien-Thumbs (158 px,
16:9). Die aktuelle Folie hat einen 2-px-Tungsten-Rahmen, referenzierte Folien einen Daylight-Rahmen plus Tag `F3`.
Seiten (Web): 200-px-Karten mit Seitenvorschau, Titel, Route in Mono und QA-Zeile (✓ „Mobil, Kontrast ok“ ·
⚠ „1 Hinweis · Alt-Text“ · ◷ „noch nicht geprüft“). Ein Klick referenziert, ein Doppelklick öffnet die Seite im
Monitor. Die alten „Seite referenzieren“-Knöpfe entfallen.

### 4.9 Dialoge, Toasts, Popover
- **Dialog:** 420 px, Radius 12, `--raised`, `--shadow-pop`, Scrim `rgba(0,0,0,.55)`. Titel 15/600, Text 12.5
  `--text-2`. Aktionen rechtsbündig: sekundär links, primär rechts. Bestätigende Dialoge nennen die Folge („Keine
  Version geht verloren“). Esc bricht ab, der Fokus wird gefangen und kehrt danach an den Auslöser zurück.
- **Toast:** unten mittig über dem Monitor bzw. der Bühne, Radius 8, Icon in der Bedeutungsfarbe (Daylight für
  Referenz, Tungsten für Marker, Rot für Fehler), Text, *Rückgängig*. 4 s sichtbar, bei Hover pausiert,
  `role="status"`. Höchstens zwei gleichzeitig, gestapelt.
- **Popover:** Radius 10, `--raised`, `--shadow-pop`, Kopf 12.5/600 mit Haarlinie. Öffnen 180 ms.

### 4.10 Startbildschirm
Zwei Zonen. **Links** (400 px, `--panel`): „Was produzieren wir heute?“, *Neues Projekt ⌘N* (primär), *Projekt öffnen …
⌘O*, „Neu aus Kategorie“ (5 Zeilen mit Icon, Name und Beispielen) und unten der Systemstatus (Director-Anbindung,
fal.ai mit *Schlüssel hinterlegen*). **Rechts:** „Zuletzt geöffnet“ mit Suche und Raster/Liste. Das zuletzt bearbeitete
Projekt steht als Feature mit großem Standbild (Timecode-Tag), Mini-Checkpoint-Leiste, „Der Director wartet auf deine
Freigabe: …“, Budget und *Öffnen*. Darunter vier Projektkarten mit echter Vorschau (Folie, Plakat, Website,
Wellenform) und eine kompakte Liste „Weitere Projekte“. Medien zuerst, Text zurückhaltend.

---

## 5. Was sich gegenüber der aktuellen UI ändert

| Heute | Neu | Warum |
|---|---|---|
| Asset-Browser in voller Breite ganz unten, oft abgeschnitten | **Linke Seitenleiste** (Struktur wie der Chat) | Material bleibt sichtbar, ohne Höhe zu kosten. Der Monitor gewinnt ca. 30 % Fläche. |
| Modell-Picker-Leiste (9 Dropdowns + Denktiefe) in voller Breite | **Zusammenfassung im Composer + Popover in 2 Ebenen** | Eine Zeile weniger, Preis und Wahl dort, wo gesendet wird (§4.5) |
| Composer als eigene Zeile zwischen Leisten | **Composer verschmilzt mit dem Chat** (ein „L“ um die Monitor-Ecke) | Ein Gesprächselement, klare Leserichtung |
| 4 Filter-Selects + Typ-Chips + 2 Knöpfe im Asset-Kopf | Suche mit Filter-Knopf, Typ-Tabs, Gruppieren-Icon; aktive Filter als Pills | Schrittweise Offenlegung: 2 Zeilen statt 2–3 voller Zeilen |
| Status-Badges „im Dokument / ungenutzt“ auf Karten | **Verwendungsort-Tag** (`V1`, `A2`, `F3`) | Konkreter, weniger Text |
| Playback-Controls über dem Bild | **Transport unter dem Bild**, Timecode in Tungsten | Das Bild bleibt sauber, Werte lesbar |
| Spannen durch Ziehen, Hinweiszeile „Klick: Zeitpunkt · Ziehen: Spanne · Alt+Klick · Shift …“ | **Markerleiste + Enter**, Scrubben in der Hauptfläche, verkürzter Hinweis, der nach Nutzung verschwindet | Weniger Modi, eindeutige Geste je Zone |
| Budget doppelt (Kopfzeile und Panel-Fuß) | **Nur Kopfzeile**, mit Popover zur Aufschlüsselung | Keine Redundanz |
| Generierungs-Warteschlange im Panel-Fuß (`details`) | **Job-Ablage** über dem Composer mit Fortschritt und Kosten | Laufende Arbeit sichtbar, wo man auf sie wartet |
| Stopp neben Senden im Composer | **Stopp im Director-Kopf** neben dem Status | Stopp gehört zum Laufzustand, Senden zum Schreiben |
| Werkzeugschritte einzeln als Zeilen | **eine eingeklappte Gruppe** pro Folge | Ruhiger Verlauf |
| Checkpoint-Leiste aus Nummernkreisen | Beschrifteter Stepper mit Status-Pill, der bei Platzmangel schrittweise einklappt | Fortschritt ohne Rätsel |
| „Seite referenzieren“-Knöpfe in der Seitenliste | Seitenkarten mit Vorschau; Klick = Referenz, QA-Zeile | Weniger Knöpfe, mehr Information |
| Startbildschirm als Textliste | Medienorientiert: Feature + Vorschau-Karten + Kategorie-Einstieg | Erster Eindruck für die Medienbranche |
| Kategorie-/Phasen-Badges in der Kopfzeile | Kategorie als ruhiger Text, Phase steckt im Stepper | Weniger Badges |

Alle Funktionen bleiben erreichbar: Versionen, Export, Formate, Safe Areas, Viewports, Element- und Region-Modus,
Push-to-Talk, Einreihen, Stopp, alle 9 Modalitäten mit Preis, Denktiefe, Katalog-Aktualisierung, Import und
Verknüpfen, Filter, Gruppierung, Detailansicht, Rückfrage mit Freitext, Checkpoint mit editierbarem Budget,
Genehmigungen, Budget-Aufschlüsselung, Theme und Einstellungen.

---

## 6. Barrierefreiheit

- **Kontrast:** siehe §3.2. Text ≥ 4,5:1 in beiden Themes, informationstragende Grafik ≥ 3:1, dazu ein Modus für
  erhöhten Kontrast.
- **Farbe nie allein:** Marker tragen Nummern, Chips Icon und Label, Status steht immer auch als Text („zur Freigabe“,
  „arbeitet“), Spuren haben IDs, QA-Zeilen Icon und Text, der Verwendungsort ist Text.
- **Fokus:** 2-px-Ring in `--accent-line` mit 2 px Abstand, nur bei `:focus-visible`. Die Tab-Reihenfolge folgt der
  Leserichtung: Kopfzeile → Assets → Monitor → Director → Composer → Bühne. `F6` springt zwischen den Regionen
  (`<header>`, `<aside aria-label>`, `<section aria-label>`).
- **Tastatur vollständig:** Timeline (`role="application"` mit Beschreibung): Pfeile, Shift für Schläge, Enter für
  Marker, `[`/`]`, Entf. Marker sind Buttons („Marker 2 bei 00:24:00, Taste Entf entfernt“). Chips sind Buttons mit
  Entfernen per Backspace. Popover und Listen haben `aria-activedescendant`. Dialoge fangen den Fokus.
- **Screenreader:** Der Director-Verlauf ist `role="log"` mit `aria-live="polite"`, eine Streaming-Nachricht hat
  `aria-busy`, bis sie fertig ist (es wird nicht jedes Token angesagt). Jobs und Toasts sind `role="status"`, Fehler
  `role="alert"`. Der Stepper ist eine `<ol>` mit `aria-current="step"`.
- **Zielgrößen:** Mindestens 24 × 24 px (WCAG 2.2 AA). Die Markerleiste ist sichtbar 15 px hoch, die Trefferfläche ragt
  aber 5 px ins Lineal. Marker-Tags haben eine 24-px-Trefferzone. Für alles gibt es Tastatur-Alternativen.
- **Bewegung:** Für `prefers-reduced-motion` siehe §3.6. Keine automatisch startenden Animationen außer dem Live-Status.
- **Skalierung:** Die UI-Skala in den Einstellungen (90–125 %) skaliert alle px-Tokens. Die Layout-Breakpoints
  reagieren, ohne dass etwas abgeschnitten wird. Bei 1280×800 ist alles sichtbar (`shots/workspace-video-1280.png`).
- **Sprache:** `lang="de"`, typografische Anführungszeichen „…“, Zahlen und Preise wie in der App.

---

## 7. Dateien

| Datei | Inhalt |
|---|---|
| `start.html` · `video.html` · `slides.html` · `web.html` · `panel.html` | Statische Mockups; `?theme=light` schaltet das helle Theme |
| `studio.css` | Das komplette Token- und Komponentensystem plus generierte Platzhalterbilder (SVG-Data-URIs) |
| `fonts/` | Instrument Sans (variabel) und IBM Plex Mono als woff2 sowie OFL-Lizenzen |
| `shots/start.png`, `workspace-video.png`, `workspace-slides.png` (Picker-Popover offen), `workspace-web.png`, `director-panel-detail.png`, `workspace-video-light.png`, `workspace-video-1280.png`, `workspace-video-1920.png` | Screenshots (1440×900, sofern nicht anders benannt) |
| `_src/` | Generator (`build.mjs`, `parts.mjs`, `screens*.mjs`, `scenes.mjs`, `icons.mjs`, `studio.src.css`), `shoot.cjs` (Playwright) und `contrast.py` |

Neu erzeugen: `node _src/build.mjs`. Screenshots: im Ordner `director-studio/` mit
`NODE_PATH=$PWD/node_modules node <pfad>/_src/shoot.cjs '[{"file":"<abs>/video.html","out":"<abs>/shots/x.png"}]'`.
