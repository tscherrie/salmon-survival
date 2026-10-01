# Director Studio · Verbindliche Design-Spezifikation „Grading Suite“ (v1)

> **Status:** verbindlich für die Umsetzung im Renderer `director-studio/apps/desktop/src/renderer`
> (React + **eine** CSS-Datei `styles/app.css`).
> **Grundlage:** Siegerrichtung A „Grading Suite“ (`docs/director-studio/design/a-cinematic/DESIGN.md`, Mockups und Screens dort). Diese
> Spezifikation behebt jede Schwäche, die die drei Jurys genannt haben, und übernimmt die passenden Ideen aus B
> (Editorial) und C (Instrument). Wo diese Spezifikation und `a-cinematic/DESIGN.md` voneinander abweichen, gilt **diese
> Spezifikation**. Was hier nicht geregelt ist, gilt so, wie es in A steht.
> **Referenzbilder:** `docs/director-studio/design/final-shots/` (siehe §18). Sie zeigen den Zielcharakter, enthalten aber noch die
> Schwächen, die hier korrigiert werden: zu viel Tungsten, die Composer-Box, die Hinweisprosa in der Timeline und den
> Marker-Tooltip über dem Lineal.
> **Fertige Font-Dateien:** `apps/desktop/src/renderer/assets/fonts/` (geprüft, siehe §4.2).
> **UI-Sprache:** Deutsch. Alle sichtbaren Texte kommen aus `i18n.ts` (de + en).

---

## 0. Kurzfassung der Entscheidungen

1. **Layout (vom Nutzer festgelegt):** Assets als linke Seitenleiste · Monitor · Director-Chat als rechte Seitenleiste ·
   **Composer direkt darunter**, über Monitor und Chat in voller Breite · Bühne/Timeline darunter über die ganze
   Fensterbreite. Chat und Composer teilen sich eine Fläche (`--panel`) und bilden ein umgedrehtes „L“ um die einzige
   große Rundung des Layouts: die untere rechte Ecke des Monitors (14 px).
2. **Durchgehendes Spaltenraster (aus C):** Die linke Kopfzeilen-Zone, die Asset-Leiste und die Index-Spalte der
   Timeline haben **dieselbe Breite**. So läuft eine senkrechte Fuge von oben bis unten durch das Fenster. Die
   Kopfzeilen-Zonen stehen über ihren Spalten (Projekt über Assets, Stepper über Monitor, Budget und Aktionen über dem
   Chat).
3. **Farbsemantik, streng:** *Tungsten* (`--accent`) heißt „jetzt/live/tu es“ und darf **höchstens dreimal** auf einem
   Bildschirm vorkommen (§6). *Daylight* (`--ref`) heißt „worauf du zeigst“: Marker, Chips, Referenzen, Auswahl im
   Monitor (hier wird das frühere `--pick` mit `--ref` zusammengelegt). Der **Fokus** hat ein eigenes neutrales Token
   (`--focus`).
4. **Composer ohne innere Box (aus B):** Der Text steht direkt auf `--panel`. Die Eingabezone wird nur beim Fokus leicht
   angehoben (`--panel-hi`).
5. **Offene Entscheidungen werden angedockt (aus B und C):** Checkpoint, Genehmigung und Rückfrage docken unten in der
   Director-Spalte direkt über dem Composer an und scrollen nie weg. Bei wenig Höhe werden sie zu einer 36-px-Zeile.
6. **Senden und Einreihen (aus B):** Während der Director arbeitet oder eine Entscheidung offen ist, ist der Knopf
   neutral. Tungsten-Primär ist er nur, wenn wirklich *Senden* die nächste Aktion ist.
7. **Timeline:** oben eine **Markerleiste** (16 px; ein Klick setzt einen Marker), darunter Scrubben über die übrigen
   ca. 95 %. `Enter` setzt einen Marker am Abspielkopf. **Marker sind die Zeitpunkt-Chips im Composer** und haben eine
   einzige Datenquelle: die Composer-Segmente. Es gibt keine Spannen mehr per Ziehen. Die Index-Spalte (aus C) zeigt
   den großen Timecode und die Zeilenlegende. Die dauerhafte Hinweiszeile entfällt; an ihre Stelle tritt ein
   einmaliger Hinweis direkt in der Markerleiste.
8. **Nummerierte Referenzen überall (aus B):** Jede Bühnen-Referenz (Zeit, Clip, Abschnitt, Folie, Element, Region,
   Seite) trägt im Chip, auf der Bühne und im Monitor **dieselbe Nummer**. Asset-Chips haben keine Nummer. Fährt man
   über ein Gegenstück, werden beide Seiten hervorgehoben.
9. **Modellwahl:** Eine Zusammenfassung steht in der Composer-Werkzeugleiste. Das Popover ist höchstens 400 px breit,
   und **Ebene 2 ersetzt Ebene 1 an derselben Stelle**, statt daneben über dem Monitor aufzugehen.
10. **Schriften offline:** *Instrument Sans* (variabel, OFL 1.1) und *IBM Plex Mono* 400/500/600 (OFL 1.1), jeweils als
    **vollständige** Upstream-woff2 ohne Google-Subset. Tastenkürzel werden plattformabhängig dargestellt (§4.4), weil
    keine der beiden Schriften ⌘ ⌥ ⇧ ↵ enthält.

---

## 1. Was gegenüber A geändert wird (Jury-Schwäche → Korrektur)

| Schwäche (Jury) | Korrektur in dieser Spezifikation |
|---|---|
| Tungsten ist überall (Stepper-Kreis, Pill, Timecode, Fortschritt, Senden, Abspielkopf, Radio, Tooltip) | Hartes Tungsten-Budget (§6). Stepper aktuell = invertierter `--text`-Kreis. Timecode = `--text`. Fortschritt und Spinner = `--text-2`. Radio = `--text`. Status-Pills neutral. |
| Der Composer ist eine Box im Panel (`--raised`, Radius 10), mit leerer Zone unter dem Text | Keine innere Box. Der Text steht auf `--panel`. Bei `:focus-within` wird die Textzone `--panel-hi` mit Radius 8. Die Höhe richtet sich nach dem Inhalt (mind. 2, höchstens 8 Zeilen). (§7.7) |
| Dauerhafte Hinweisprosa im Timeline-Kopf | Entfällt. Stattdessen ein einmaliger Hinweis *in* der Markerleiste, solange noch kein Marker gesetzt wurde (§8.6), sowie Tooltips mit Kürzeln. |
| Der Marker-Tooltip verdeckt das Lineal | Der Geister-Marker zeigt seinen Timecode **in** der Markerleiste neben dem Tag (kein schwebender Kasten). |
| V2/T1 als graue Umriss-Pillen; alle Audiospuren in einem Salbeiton | Clips sind getönte Flächen mit einer 2-px-Kante in Spurfarbe. Text-Clips zeigen den Text schmal gesetzt (`wdth 80`). Audio unterscheidet Stimme (Salbei), Musik (Ocker) und SFX/Atmo (Rosé-Taupe), alle gedämpft. (§3.1, §7.10) |
| Keycap im Senden-Knopf, Mono-Tag „Composer“ auf der Asset-Karte, Mono-Meta überall | Keine Keycaps in Knöpfen; Kürzel stehen nur im Tooltip. Ein referenziertes Asset bekommt einen Daylight-Ring statt eines Tags. Meta-Zeilen in der UI-Schrift, nur Zahlen in Mono. |
| Die Ablagezone kostet dauerhaft Platz; bei 240 px sind die Asset-Titel abgeschnitten | 32-px-Fußzeile; eine Drop-Fläche erscheint nur beim Ziehen. Unter 264 px Breite wird automatisch eine Liste angezeigt (§7.3). |
| Das Picker-Popover der Ebene 2 ist ca. 740 px breit und deckt den Monitor ab | Maximal 400 px. Ebene 2 ersetzt Ebene 1 an Ort und Stelle und hat einen Zurück-Kopf (§7.8). |
| Es gibt keine angedockte Entscheidung; die Checkpoint-Karte scrollt weg | `DecisionDock` über dem Composer, kompakt als 36-px-Zeile (§7.6.3). |
| Rohe Tool-Namen (`frames.extract`) | Klartext („Frames geprüft“). Rohnamen nur, wenn im ⋯-Menü „Technische Details“ eingeschaltet ist (§7.6.2). |
| Zwei verschiedene Blautöne (`--ref` und `--pick`) | Ein Daylight. Auf Medien `--ref-media` mit dunklem Halo (§3.1). |
| Fokusring = Tungsten, unsichtbar auf dem Primärknopf | `--focus` ist neutral hell (dunkles Theme) bzw. fast schwarz (helles Theme) mit 2 px Abstand (§13). |
| Monitor zu klein (ca. 620 px bei 1440) | Der Transport ersetzt die Meta-Zeile (keine eigene Zeile mehr). Die Bühnenhöhe richtet sich nach dem Inhalt. Ergebnis: Bildfläche ca. **775 × 436** bei 1440×900, ca. **633 × 356** bei 1280×800, ca. **1035 × 582** bei 1920×1080 (§2.4). |
| Folien- und Web-Bühne haben bei 900 px leere Fläche | Die Bühnenhöhe richtet sich nach dem Inhalt der Kategorie (§2.3). |
| `studio.css` ist 156 KB groß, mit Data-URI-Platzhaltern und 52 Schatten | Nur Tokens und Komponenten kommen in `app.css`. **Ein** Schatten-Token für Schwebendes plus `--shadow-media`. Keine Data-URIs. |
| Die Fonts waren Google-Subsets ohne ⌘ ≈ ✓ | Vollständige Upstream-Dateien. ≈ und ✓ sind in Plex Mono enthalten; Tastensymbole werden nach Plattform dargestellt (§4.4). |

---

## 2. Layout und Raster

### 2.1 Struktur

```
┌───────────────┬───────────────────────────────────────┬──────────────────┐ 44  Kopfzeile (--base)
│ ‹ ◫ Projekt   │ ✓ Treatment — ✓ Style — ③ Storyboard … │ $6.84/$20 v4 ⤓ ◐ ⚙│     Zonen = Spalten darunter
├───────────────┼───────────────────────────────┬───────┴──────────────────┤
│ ASSETS        │ MONITOR (.always-dark, --well) │ DIRECTOR (--panel)       │
│ --base        │                               │ Kopf 42 · Verlauf        │
│ var(--side-l) │  [ Bild ]                     │ Job-Zeile 32             │
│               │ TC · Meta · ⏮ ◀ ▶ ▶ ⏭ · 16:9 ⛶╮│ DecisionDock             │
│               ├───────────────────────────────╯─────────────────────────┤ ← keine Linie Chat|Composer
│               │ COMPOSER (--panel, gleiche Fläche wie Director)          │
├───────────────┼─────────────────────────────────────────────────────────┤
│ INDEX (=Breite│ BÜHNE: Markerleiste 16 · Lineal 22 · Abschnitte 20 · Spuren │ --stage-h
│ der Assets)   │ (--base, volle Breite)                                    │
└───────────────┴─────────────────────────────────────────────────────────┘
```

### 2.2 CSS-Grid (verbindlich)

```css
.workspace {
  display: grid; height: 100vh; overflow: hidden; background: var(--base);
  grid-template-columns: var(--side-l) minmax(0, 1fr);
  grid-template-rows: var(--hdr-h) minmax(0, 1fr) var(--stage-h);
  grid-template-areas: "header header" "assets center" "stage stage";
}
.ws-center {                       /* Monitor + Director + Composer: eine Werkbank */
  grid-area: center; position: relative; min-height: 0; background: var(--panel);
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--side-r);
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas: "monitor director" "composer composer";
}
.monitor  { grid-area: monitor; border-bottom-right-radius: 14px; background: var(--well); }
.director { grid-area: director; }
.composer { grid-area: composer; }
.assets   { grid-area: assets; border-right: 1px solid var(--line); }
.stage    { grid-area: stage; border-top: 1px solid var(--line); }
.app-header { grid-area: header; border-bottom: 1px solid var(--line); }
```

- `--side-l` ist die Breite der Asset-Leiste (eingeklappt `--rail-w` = 40 px). `--side-r` ist die Director-Breite
  (eingeklappt 40 px). Beide setzt `Workspace.tsx` als Inline-Style aus dem Layout-Zustand (§10).
- **Splitter liegen über den Kanten, nicht im Raster.** Sie nehmen keinen Platz ein. Eine `position: absolute`-Leiste ist
  7 px breit und sitzt mittig auf der Kante; `::after` zeichnet die sichtbare Haarlinie (1 px `--line`, bei Hover oder
  Ziehen 2 px `--line-3`). Es gibt drei Splitter:
  1. Assets ↔ Mitte (senkrecht, von der Kopfzeile bis zur Bühne),
  2. Monitor ↔ Director (senkrecht, **nur** in der oberen Zeile, nicht neben dem Composer),
  3. Bühne (waagerecht, an der Oberkante der Bühne, volle Breite).
  Ein Doppelklick setzt die Breite auf den Standardwert des Breakpoints zurück (`null`). Wird über das Minimum hinaus um
  mehr als 48 px weitergezogen, klappt die Leiste auf die Schiene ein.
- **Monitor-Ecke:** Nur die Ecke unten rechts hat einen Radius (14 px). Da `.ws-center` `--panel` ist, sieht man dort die
  Werkbank. Zwischen Director und Composer gibt es keine Linie.
- **Index-Spalte der Bühne:** `--index-w: var(--side-l)`. Ist die Asset-Leiste eingeklappt, gilt `--index-w: 168px`;
  nur in diesem Fall ist die Fuge unterbrochen. Die Kopfzeile verwendet dieselben Spalten (§7.2).

### 2.3 Breakpoints und Standardmaße

| | ≤ 1360 px Breite | 1361–1799 (Referenz 1440×900) | ≥ 1800 (1920×1080) |
|---|---|---|---|
| `--side-l` (Assets und Index) | 240 | 272 | 304 |
| `--side-r` (Director) | 328 | 368 | 420 |
| Spurhöhen V1/V2/T1/A·Stimme/A·Musik/A·SFX | 34/18/18/26/30/20 *(bei Höhe ≤ 820)*, sonst wie Referenz | 40/20/20/30/34/22 | 48/22/22/36/40/24 |
| Audio-Projekt (nur Audio-Spuren) | 48 je Spur | 56 | 64 |

- **Bühnenhöhe `--stage-h`:** Standard = Inhaltshöhe, höchstens 40 % der Fensterhöhe:
  - Video/Audio: Leiste 32 + Markerleiste 16 + Lineal 22 + Abschnitte 20 (nur wenn Abschnitts-Marker existieren) +
    Summe der Spurhöhen + 8 px Luft. Wird es zu hoch, scrollt die Spurfläche senkrecht, Index und Lineal bleiben stehen.
  - Folien: 32 + 12 + Thumb-Höhe (148 px breit, im Seitenverhältnis des Decks) + 22 (Label) + 12, also ca. 161 px bei
    16:9.
  - Grafik (Ebenen): 32 + min(Anzahl Ebenen × 28, 196) + 12.
  - Web: 32 + 12 + 125 (Vorschau 200 × 125) + 40 (Titel und Pfad) + 12, also 221 px.
  - Grenzen beim Ziehen: 120 px bis 50 % der Fensterhöhe. Eine selbst gezogene Höhe wird **pro Kategorie** gespeichert
    (§10). Eingeklappt: nur die 32-px-Leiste.
- **Grenzen der Seitenleisten:** Assets 200–400 px, Director 300–520 px. Der Monitor ist nie schmaler als 420 px; ein
  Splitter, der das unterschreiten würde, bleibt stehen.
- **Automatik:** Unter 1200 px Fensterbreite klappt die Asset-Leiste ein, solange der Nutzer sie nicht ausdrücklich
  geöffnet hat. Unter 760 px Fensterhöhe klappt die Bühne auf die Leiste ein. Empfohlenes `minWidth`/`minHeight` des
  `BrowserWindow`: 1180 × 720.

### 2.4 Rechenprobe der Monitorgröße (Video, 16:9)

| Fenster | Monitorspalte (B × H) | Bildbereich (B − 24; H − Transport 44 − Rand 12) | Bild |
|---|---|---|---|
| 1280×800 | 712 × 412 (Bühne 244 kompakt, Composer ca. 100) | 688 × 356 | **633 × 356** |
| 1440×900 | 800 × 492 (Bühne 264, Composer ca. 100) | 776 × 436 | **775 × 436** (A: ca. 620 breit) |
| 1920×1080 | 1196 × 638 (Bühne 290, Composer ca. 108) | 1172 × 582 | **1035 × 582** |

Die Bühnenhöhen ergeben sich aus der Formel in §2.3 (6 Spuren: V1, V2, T1, A1–A3, mit Abschnittszeile).

### 2.5 Fokusmodus

`⌘0` bzw. `Strg+0` (Monitor maximieren) klappt beide Seitenleisten auf Schienen und die Bühne auf ihre Leiste ein. Der
Composer bleibt sichtbar. Ein zweites `⌘0` stellt den vorherigen Zustand wieder her. Der Fokusmodus wird nicht
gespeichert.

---

## 3. Tokens (`styles/app.css`, Abschnitt 1, ersetzt die alten Tokens vollständig)

### 3.1 Farb-Tokens: zum Einfügen

Das Theme wird künftig **in JS aufgelöst**: `applyThemeMode('system')` setzt `data-theme` per `matchMedia` auf `dark`
bzw. `light`, setzt zusätzlich `data-theme-mode="system"` und hört auf Änderungen. Deshalb gibt es genau **einen**
Light-Block. Die Änderung betrifft `lib/theme.ts`.

```css
/* Dunkel (Standard) – und immer im Monitor (.always-dark) */
:root, .always-dark {
  color-scheme: dark;
  /* Flächen: Bildraum < Rahmen < Werkbank < Erhaben */
  --well:#09090A;  --base:#0F0F10;  --panel:#141415;  --panel-hi:#18181A;  --raised:#1A1A1C;
  --hover:#222224; --active:#2A2A2D; --sunken:#0B0B0C;
  --line:#242426;  --line-2:#2E2E31; --line-3:#3D3D41;
  --text:#ECE9E4;  --text-2:#AAA69F; --text-3:#8C8881; --text-4:#5C5954;   /* text-4: nur dekorativ */
  /* Tungsten 3200 K – jetzt/live/tu es (Budget §6) */
  --accent:#F0A458; --accent-hi:#F5B677; --accent-text:#F3B06C; --accent-line:#F0A458; --on-accent:#1A1006;
  --accent-soft: rgb(240 164 88 / .13);
  /* Daylight 5600 K – worauf du zeigst */
  --ref:#9DBDD8; --ref-text:#B4CDE2; --on-ref:#0B1620;
  --ref-soft: rgb(157 189 216 / .13); --ref-line: rgb(157 189 216 / .38);
  --ref-media:#A9CBEA; --ref-media-halo: rgb(0 0 0 / .6);            /* Auswahl auf Bildinhalten */
  --focus:#F2EFEA;
  /* Status */
  --ok:#7EBF8E; --warn:#E0C070; --danger:#E8705F;
  --ok-soft: rgb(126 191 142 / .12); --warn-soft: rgb(224 192 112 / .12); --danger-soft: rgb(232 112 95 / .12);
  /* Spuren (gedämpft, alle unterhalb der Sättigung von Daylight; nie blau) */
  --trk-video:#A7AEB4; --trk-overlay:#B9B2A6; --trk-text:#CFC6B8;
  --trk-voice:#8FB8A0;  /* voice, vocals */  --trk-music:#C4AC72;  /* music */  --trk-sfx:#C29790; /* sfx, ambience */
  /* Elevation */
  --shadow-pop: 0 0 0 1px rgb(0 0 0 / .55), 0 18px 40px -12px rgb(0 0 0 / .7), 0 2px 8px rgb(0 0 0 / .35);
  --shadow-media: 0 30px 80px -24px rgb(0 0 0 / .85);
  --img-edge: rgb(255 255 255 / .07);
  --media-chip: rgb(9 9 10 / .72);      /* Etiketten auf Bildern: Typ, Dauer, Verwendung */
  --scrim: rgb(0 0 0 / .55);
}

/* Hell – der Monitor (.always-dark) bleibt dunkel */
:root[data-theme='light'] {
  color-scheme: light;
  --well:#161618;  --base:#E3E2DE;  --panel:#F2F1EE;  --panel-hi:#F7F6F4;  --raised:#FFFFFF;
  --hover:#E9E8E4; --active:#DEDDD8; --sunken:#D9D8D3;
  --line:#D3D1CC;  --line-2:#C6C4BE; --line-3:#ADABA4;
  --text:#1A1A1B;  --text-2:#4B4945; --text-3:#615E59; --text-4:#A3A09A;
  --accent:#E0923F; --accent-hi:#E89E4F; --accent-text:#874709; --accent-line:#B05A0A; --on-accent:#1A1006;
  --accent-soft: rgb(224 146 63 / .16);
  --ref:#2F6690; --ref-text:#255680; --on-ref:#FFFFFF;
  --ref-soft: rgb(47 102 144 / .10); --ref-line: rgb(47 102 144 / .40);
  --focus:#1A1A1B;
  --ok:#2A7044; --warn:#7A5D0C; --danger:#A93A2B;
  --ok-soft: rgb(42 112 68 / .10); --warn-soft: rgb(122 93 12 / .10); --danger-soft: rgb(169 58 43 / .10);
  --trk-video:#5E666D; --trk-overlay:#6E675C; --trk-text:#6F675B;
  --trk-voice:#3F7A5A; --trk-music:#7A631C; --trk-sfx:#9A4F45;
  --shadow-pop: 0 0 0 1px rgb(20 20 22 / .10), 0 18px 40px -14px rgb(20 20 22 / .28), 0 2px 6px rgb(20 20 22 / .08);
  --img-edge: rgb(0 0 0 / .10);
}

/* Erhöhter Kontrast: System oder Einstellung */
@media (prefers-contrast: more) { :root:not([data-contrast='normal']) { --line:#6A6A70; --line-2:#6A6A70; --line-3:#7A7A80; --text-3:var(--text-2); --text-4:var(--text-3); } }
:root[data-contrast='more'] { --line:#6A6A70; --line-2:#6A6A70; --line-3:#7A7A80; --text-3:var(--text-2); --text-4:var(--text-3); }
:root[data-theme='light'][data-contrast='more'] { --line:#77756F; --line-2:#77756F; --line-3:#6A6863; }
@media (prefers-contrast: more) { :root[data-theme='light']:not([data-contrast='normal']) { --line:#77756F; --line-2:#77756F; --line-3:#6A6863; } }
```

**Kaskadenregel:** `.always-dark` deklariert die dunklen Werte **am Element selbst** und überschreibt damit die vom
hellen `:root` geerbten Werte, unabhängig von der Spezifität. `.always-dark` tragen: `.monitor` (inklusive Transport),
die Asset-Detail-Vorschau, Video-Kacheln in den Asset-Karten, der Clip-Filmstreifen V1 und der Vollbild-Player.

**Abgeleitete Flächen (mit `color-mix`, Electron/Chromium 140):**
- Clip-Tönung: `color-mix(in srgb, var(--trk-x) 14%, var(--base))` (dunkel) bzw. 18 % (hell); Kante 2 px `var(--trk-x)`.
- Wellenform: `var(--trk-x)` mit 75 % Deckkraft.

### 3.2 Kontrast (WCAG 2.2, berechnet mit `docs/director-studio/design/contrast.py`, Alpha-Werte über die angegebene Fläche verrechnet)

| Paar | Zweck | Dunkel | Hell |
|---|---|---|---|
| `--text` / `--base` · `--panel` · `--raised` · `--hover` | Fließtext | 15.82 · 15.20 · 14.35 · 13.12 | 13.42 · 15.40 · 17.39 · 14.18 |
| `--text-2` / `--base` · `--panel` · `--raised` · `--hover` | Sekundärtext | 7.90 · 7.60 · 7.17 · 6.55 | 6.93 · 7.95 · 8.98 · 7.33 |
| `--text-3` / `--base` · `--panel` · `--raised` · `--hover` | Meta | 5.43 · 5.22 · 4.93 · **4.50** | 4.98 · 5.71 · 6.45 · 5.26 |
| `--text-3` / `--sunken` | Markerleisten-Hinweis | 5.58 | 4.52 |
| `--text-3` · `--text` / `--well` | Monitor-Chrome (in beiden Themes dunkel) | 5.64 · 16.44 | gleich |
| `--accent-text` / `--base` · `--panel` · `--raised` | Tungsten als Schrift | 10.25 · 9.85 · 9.30 | 5.52 · 6.33 · 7.15 |
| `--accent-text` / `--accent-soft` über `--base` | Tungsten-Pill | 8.29 | 4.97 |
| `--on-accent` / `--accent` · `--accent-hi` | Primärknopf, Ruhe und Hover | 9.06 · 10.57 | 7.45 · 8.42 |
| `--ref-text` / `--base` · `--panel` · `--raised` | Chip- und Link-Text | 11.65 · 11.20 · 10.57 | 5.95 · 6.83 · 7.72 |
| `--ref-text` / `--ref-soft` über `--panel` | Text im Chip | 8.79 | 5.97 |
| `--on-ref` / `--ref` | Nummern-Kästchen | 9.31 | 6.13 |
| `--ref` / `--base` · `--sunken` | Marker-Tag (UI ≥ 3:1) | 9.77 · 10.03 | 4.73 · 4.30 |
| `--on-ref` / `--ref-media` | Auswahl-Label im Monitor | 10.80 | gleich |
| `--ref-media` / `--well` | Auswahlrahmen auf dunklem Bild | 11.77 | gleich |
| `--accent-line` / `--base` | Abspielkopf (UI ≥ 3:1) | 9.27 | 3.76 |
| `--focus` / `--base` · `--panel` · `--raised` | Fokusring (UI ≥ 3:1) | 16.70 · 16.05 · 15.15 | 13.42 · 15.40 · 17.39 |
| `--ok` · `--warn` · `--danger` / `--panel` | Statustext | 8.53 · 10.47 · 6.06 | 5.31 · 5.47 · 5.59 |
| `--ok` · `--warn` · `--danger` / `--raised` | Status auf Karten | 8.05 · 9.88 · 5.72 | 6.00 · 6.18 · 6.31 |
| Spurfarben / `--base` | Kennstreifen, Wellen (UI ≥ 3:1) | 7.41–11.33 | 3.91–4.53 |
| Erhöhter Kontrast: `--line` / `--base` · `--panel` | Haarlinien | 3.57 · 3.43 | 3.55 · 4.08 |

Regeln:
- Text ist überall ≥ 4,5:1. Informationstragende Grafik (Abspielkopf, Marker, Fokus, Auswahl, Spur-Kennungen) ist
  ≥ 3:1.
- Haarlinien sind bewusst leise (`--line` ca. 1,3:1). Ein Bedienelement wird deshalb **nie nur** an seinem Rand erkannt,
  sondern immer auch an Füllung, Icon oder Beschriftung.
- Gegen helle Medien hat `--ref-media` allein nur 1,69:1. Deshalb bekommt jede Auswahl im Monitor zusätzlich einen
  dunklen Außenrand (`--ref-media-halo`). Damit ist mindestens eine der beiden Kanten auf jedem Bild ≥ 3:1.
- Deaktivierte Elemente sind von den Kontrastanforderungen ausgenommen und haben `opacity: .45`.

### 3.3 Maße, Abstände, Radien

```css
:root {
  /* Abstände: 4-px-Raster */
  --sp-0_5:2px; --sp-1:4px; --sp-1_5:6px; --sp-2:8px; --sp-2_5:10px; --sp-3:12px; --sp-3_5:14px; --sp-4:16px;
  --sp-5:20px; --sp-6:24px; --sp-7:28px; --sp-8:32px; --sp-10:40px;
  /* Feste Höhen */
  --hdr-h:44px; --side-hdr-h:42px; --bar-h:32px; --transport-h:44px; --rail-w:40px;
  --ctl-h:28px; --ctl-h-sm:24px; --ctl-h-lg:36px; --chip-h:22px;
  --strip-h:16px; --ruler-h:22px; --sections-h:20px; --dock-row-h:36px; --job-row-h:32px;
  /* Radien */
  --r-xs:2px;  /* Marker-Tag, Label-Reiter */   --r-sm:4px;  /* Chips, kleine Knöpfe, Thumbs */
  --r-md:6px;  /* Controls */                   --r-lg:8px;  /* Karten, Dock, Textzone bei Fokus */
  --r-xl:10px; /* Popover */                    --r-2xl:12px;/* Dialoge, Startkarten */
  --r-monitor:14px; /* NUR untere rechte Monitor-Ecke (L-Signatur) */
  /* Bewegung */
  --ease: cubic-bezier(.2, 0, 0, 1); --ease-exit: cubic-bezier(.4, 0, 1, 1);
  --t-fast:120ms; --t-med:180ms; --t-slow:240ms;
}
```

- Innenabstände: Panels 16 (Assets 12), Karten und Dock 12, Gruppenabstand im Verlauf 14, Composer 12/16/10.
- Pillen-Radius (9 px) **nur** für Status-Badges.
- Schatten: `--shadow-pop` nur für Popover, Dialog, Toast, Kontextmenü und das angehobene Dock-Sheet; `--shadow-media`
  nur für das Monitorbild. Sonst keine Schatten. Das sind zwei Schatten-Tokens insgesamt.

---

## 4. Typografie

### 4.1 Familien und Stufen

| Rolle | Familie | Achsen und Gewichte |
|---|---|---|
| UI, Fließtext, Titel | **Instrument Sans** (variabel) | `wght` 400–700, `wdth` 75–100 (schmale Stufe für Text-Clips und Burn-ins: `font-stretch: 80%`) |
| Timecodes, Preise, Dauern, IDs, Spur-IDs, Selektoren | **IBM Plex Mono** | 400 · 500 · 600 |

```css
:root {
  --font-ui: "Instrument Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  --font-keys: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; /* Tastensymbole */
}
body { font: 400 13px/1.5 var(--font-ui); font-optical-sizing: auto; -webkit-font-smoothing: antialiased; }
.mono, .tc, .price { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: 0; }
```

| Stufe | Größe/Zeile | Gewicht | Einsatz |
|---|---|---|---|
| Display | 28/1.15, −0.02 em | 600 | Frage auf dem Startbildschirm |
| Feature | 26/1.1, −0.02 em | 600 | Projekt-Feature auf dem Start |
| Titel | 15/1.3 | 600 | Dialogtitel |
| Kartentitel | 13.5/1.35 | 600 | Dock und Karten |
| Panel-Titel | 13/1 | 600 | „Assets“, „Director“, „Timeline“ |
| Fließtext | 13/1.58 | 400 | Verlauf |
| Composer | 13.5/24px | 400 | Eingabe (die Zeilenhöhe nimmt 22-px-Chips auf) |
| UI | 12/1 | 500 | Knöpfe, Tabs, Spurnamen |
| Meta | 11.5/1.35 | 400 | Zeitstempel, Modell, Hinweise |
| Klein | 11/1.3 | 400 | Karten-Meta, Asset-Meta |
| Overline | 10.5/14, +0.08 em, Versalien | 600 | Gruppenköpfe, Kicker (sparsam) |
| Mikro-Label | **10**/12, +0.08 em, Versalien | 600 | Abschnitte (INTRO, REFRAIN 1), Index-Legende |
| TC groß | Plex Mono 18/1 | 500 | Index-Spalte der Bühne |
| TC Transport | Plex Mono 15/1 | 500 | Transport |
| TC klein | Plex Mono 10–11.5 | 400–500 | Lineal, Chips, Preise, Dauern |

**Mindestgröße 10 px**, auch in Mono. Mono erscheint nur dort, wo es um Zahlen, IDs oder Code geht, nie für ganze
Meta-Sätze. Beispiel: „h3-max · `$0.80`“ (Modell in UI-Schrift, Preis in Mono).

### 4.2 Offline bündeln (verbindlich): Dateien, Version, Lizenz, Quelle

Ziel: `src/renderer/assets/fonts/` (neuer Ordner; Vite löst `url()` relativ zur CSS-Datei auf und fingerprintet die
Dateien). Die CSP erlaubt bereits `font-src 'self'`. **Die Dateien liegen fertig in
`apps/desktop/src/renderer/assets/fonts/`.** Sie können von dort kopiert oder neu geladen werden:

| Datei im Repo | Quelle (Commit fest, über raw.githubusercontent.com erreichbar) | Größe | SHA-256 |
|---|---|---|---|
| `InstrumentSans-Variable.woff2` | `https://raw.githubusercontent.com/Instrument/instrument-sans/7fa22308a3d0c94ee2b3cd537a1196b65db34a3e/fonts/webfonts/InstrumentSans%5Bwdth%2Cwght%5D.woff2` (Version 1.000, 343 Glyphen, Achsen `wdth` 75–100, `wght` 400–700) | 88 784 B | `aa72922aafcc0dc18f36ec1d805b0212057dabe8b9d5b8b57f67035aea1b826d` |
| `OFL-InstrumentSans.txt` | `…/instrument-sans/7fa22308a3d0c94ee2b3cd537a1196b65db34a3e/OFL.txt` | 4 403 B | `9e27a72ed30eb49a08678f6a5d6ed98ec7ba5368f541637ee0683ec9134ef966` |
| `IBMPlexMono-Regular.woff2` | `https://raw.githubusercontent.com/IBM/plex/763c36ef9117782905ae010056dfbe8fd2653a25/packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2` (Paket `@ibm/plex-mono` 2.5.0, Font-Version 2.005, 1049 Glyphen) | 49 248 B | `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350` |
| `IBMPlexMono-Medium.woff2` | gleicher Pfad, `IBMPlexMono-Medium.woff2` | 50 400 B | `33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25` |
| `IBMPlexMono-SemiBold.woff2` | gleicher Pfad, `IBMPlexMono-SemiBold.woff2` | 50 600 B | `6a825b4824c01cbb401e829e5a066a1818411bcb3538b5a5792c5ca9b82343c3` |
| `OFL-IBMPlexMono.txt` | `…/IBM/plex/763c36ef…/packages/plex-mono/LICENSE.txt` | 4 456 B | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |

Lizenz: beide **SIL Open Font License 1.1**. Die Lizenztexte werden mitgeliefert: Sie liegen im Ordner und zusätzlich
als Eintrag in `extraResources` bzw. in den Third-Party-Hinweisen von electron-builder. „Plex“ ist ein Reserved Font
Name; da die Datei unverändert und ohne Umbenennung ausgeliefert wird, ist das zulässig. **Nicht subsetten**, sonst
greifen die RFN-Regeln. Insgesamt sind es ca. 239 KB, was für eine Desktop-App unkritisch ist.

```css
@font-face { font-family:"Instrument Sans"; src:url("../assets/fonts/InstrumentSans-Variable.woff2") format("woff2");
  font-weight:400 700; font-stretch:75% 100%; font-style:normal; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../assets/fonts/IBMPlexMono-Regular.woff2") format("woff2"); font-weight:400; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../assets/fonts/IBMPlexMono-Medium.woff2") format("woff2"); font-weight:500; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../assets/fonts/IBMPlexMono-SemiBold.woff2") format("woff2"); font-weight:600; font-display:block; }
```

`font-display: block` ist richtig, weil die Fonts lokal liegen und es kein Aufblitzen gibt. Damit es kein unsichtbares
Erstbild gibt, werden in `main.tsx` vor `createRoot().render` alle vier Fonts mit `await document.fonts.load(...)`
vorgeladen; ein Timeout von 300 ms dient als Fallback.

### 4.3 Abgedeckte Zeichen (geprüft mit fontTools)

- Instrument Sans (vollständig): deutsche Umlaute, ß, ẞ, „ “ ‚ ‘, – —, …, ×, €, ·, ← → ↑ ↓ und das geschützte
  Leerzeichen U+00A0. **Es fehlen:** ≈ ✓ ⌘ ⌥ ⇧ ↵ ⏎ ▾ sowie das schmale geschützte Leerzeichen U+202F.
- Plex Mono (vollständig): zusätzlich ≈, ✓ und U+202F. **Es fehlen:** ⌘ ⌥ ⇧ ↵ ⏎ ⌫ ▾.
- Folgen:
  - `≈` steht nur in Mono-Preisen („≈ $0.16“).
  - `✓` und `▾` werden **nie** als Zeichen gesetzt, sondern immer als SVG-Icon (`check`, `chevronDown`).

### 4.4 Tastenkürzel-Darstellung (`components/common/Kbd.tsx`, neu)

`<Kbd keys={['mod','Enter']} />` wird je nach Plattform dargestellt (`navigator.userAgentData?.platform`, Fallback
`navigator.platform`):

| Taste | macOS (Schrift `--font-keys`, also SF, das die Symbole enthält) | Windows (Text) |
|---|---|---|
| `mod` | ⌘ | Strg |
| `alt` | ⌥ | Alt |
| `shift` | ⇧ | Umschalt |
| `Enter` | ↵ | Enter |
| `Backspace` / `Delete` | ⌫ / Entf | Rücktaste / Entf |

Keycaps stehen **nur in Tooltips, Menüs und im Kürzel-Überblick**, nie in Knöpfen. Stil: 10.5 px, Höhe 16, Rand
`--line-2`, Radius 2, `--text-3`. Tooltips enthalten den Klartext plus Kbd, zum Beispiel „Senden · ⌘↵“. Die
Hilfsfunktion `formatShortcut(keys): string` liefert dieselbe Ausgabe als Text für `title` und `aria-keyshortcuts`.

---

## 5. Ikonografie, Bewegung

- **Icons:** `components/common/Icon.tsx` bleibt die Grundlage (24er-viewBox, Kontur 1.5, runde Enden, `currentColor`).
  - Neu hinzu kommen: `sideLeft`, `sideRight` (Seitenleiste ein/aus), `more` (⋯), `filter`, `grid`, `list`,
    `group`, `prev`, `next` (Marker), `skipBack`, `skipFwd`, `frameBack`, `frameFwd`, `safeArea`, `volume`,
    `fullscreen`, `eyeOff`, `magnet` (Beat-Raster), `info`, `pin`, `clock`.
  - **Bildmarke:** Sucherklammern plus Tally-Punkt (aus A). Der Punkt ist `--text`, nicht Tungsten; Tungsten wird erst
    beim Laufen des Directors (`run-running`) gezeigt.
  - Größen: 16 in Kopfzeile und Transport, 14 in Controls, 12 in Chips und Badges.
  - Gefüllt sind nur Play, Pause, Stopp und Record.
- **Keine Emoji** in der UI. `refLabel()` aus Core enthält Emoji (⏱ 🎬 📎 🗂 🚩). Der Renderer darf dessen Ausgabe
  **nicht anzeigen**, sondern verwendet `refChipParts()` (§9.1).
- **Bewegung:** Tokens wie in §3.3.
  - Hover und Press: 120 ms.
  - Popover, Toast und Chip einsetzen: 180 ms (Deckkraft plus 4 px Weg).
  - Seitenleisten und Bühne ein- und ausklappen: 240 ms. Der Inhalt wird dabei nicht animiert; nur die Rasterspur bewegt
    sich über eine `transition` auf `grid-template-columns`/`-rows`.
  - Verschwinden: 120 ms `--ease-exit`.
  - **Marker „setzt sich“:** Der Tag skaliert von 0,6 auf 1 (180 ms); im selben Frame blendet der Chip ein. So ist die
    Verbindung sichtbar.
  - **Verknüpfungs-Blitz:** Ein Ring `--ref` blendet über 600 ms von 100 auf 0 % Deckkraft aus.
  - Der Abspielkopf wird **nie** animiert.
  - Der Live-Punkt „atmet“ über die Deckkraft (1,6 s).
  - Der Streaming-Cursor blinkt mit 1,05 s im Schritt (`steps(1)`).
  - `prefers-reduced-motion`: keine Wege, kein Atmen, kein Blinken. Spinner werden zu einem statischen Ring plus Text.
    Übergänge dauern 1 ms.

---

## 6. Farbsemantik: harte Regeln

**Tungsten-Budget: höchstens drei Stellen gleichzeitig.**

| # | Stelle | Wann |
|---|---|---|
| 1 | Abspielkopf (1-px-Linie plus Kappe) | Immer bei Timeline-Kategorien. Folien und Web haben keinen Abspielkopf. |
| 2 | **Genau ein** Primärknopf im sichtbaren Kontext | Reihenfolge: offener Dialog → Primärknopf im **DecisionDock** bzw. *Prüfen* in der Dock-Zeile → *Senden* (nur wenn der Composer Inhalt hat, der Director bereit ist und keine Entscheidung offen ist). Alle anderen Primärknöpfe werden in diesem Moment als `secondary` dargestellt. |
| 3 | Live-Punkt „arbeitet“ im Director-Kopf (atmend) | Nur während `runState === 'running'` |

**Nicht** in Tungsten: Stepper (aktuell = `--text`-Kreis, invertiert), Status-Pill „zur Freigabe“ (neutral, Rand
`--line-3`), Timecodes, Fortschrittsbalken und Spinner (`--text-2`), Radio und Checkbox (`--text`), Beat-Raster-LED
(`--text`), Filter-aktiv-Punkt (`--text`), aktuelle Folie (2 px `--text`), Tooltips, Tab-Unterstriche (`--text`) sowie
die Bildmarke im Ruhezustand.

**Daylight** (`--ref*`) ausschließlich für Zeigen und Referenzieren: Marker, Chips, Daylight-Rahmen um referenzierte
Assets, Folien, Seiten und Clips, Nummern-Badges, Timecode-Links im Chat, Auswahl im Monitor (`--ref-media`), den
Geister-Marker und den Verknüpfungs-Blitz. Status wie „Bereit“ ist **nicht** Daylight, sondern `--ok`.

**Fokus** ist `--focus` und hat weder Tungsten noch Daylight.

**Rot** (`--danger`): Stopp, Fehler, Aufnahme läuft (Mikrofon-Knopf gefüllt), Budget überschritten.

---

## 7. Komponenten, abgebildet auf die Dateien

> Konvention: Die Klassen bleiben BEM-artig flach wie heute. Die in §15 genannten Test-Hooks (Klassen, Rollen,
> `data-*`) bleiben erhalten.

### 7.1 `components/workspace/Workspace.tsx` (umbauen)

- Neues Markup:
  ```
  .workspace[style=--side-l,--side-r,--stage-h]
    Header
    AssetBrowser              (area assets)
    .ws-center
      Monitor                 (area monitor, .always-dark)
      DirectorPanel           (area director)
      Composer                (area composer)
      Splitter Monitor|Director
    Stage                     (area stage)
    Splitter Assets|Mitte, Splitter Bühne
  ```
  `ModelPickerBar` **entfällt** als eigene Zeile und wird zur Zusammenfassung im Composer (§7.8).
- Der Layout-Zustand kommt aus dem neuen Hook `lib/layout.ts` (`useWorkspaceLayout()`, §10). Er berechnet die Standards
  je Breakpoint über `matchMedia` und ein `resize`-Ereignis und speichert nur Abweichungen des Nutzers.
- Globale Kürzel: `usePlaybackShortcuts` wird zu `useWorkspaceShortcuts` erweitert (Tabelle §8.5 und §13.4). Die Regel,
  dass Kürzel in Eingabefeldern nicht greifen (`isEditableTarget`), bleibt.
- `F6` / `Umschalt+F6`: Fokus springt zyklisch durch die Regionen Kopfzeile → Assets → Monitor → Director → Composer →
  Bühne. Jede Region ist ein Landmark mit `aria-label` und `tabIndex=-1` als Sprungziel.

### 7.2 `components/workspace/Header.tsx`

- **Raster:** `grid-template-columns: var(--side-l) minmax(0,1fr) max-content`. Die rechte Zone hat
  `min-width: var(--side-r)`.
  - **Linke Zone** (bündig mit der Asset-Leiste, Innenabstand 12): Knopf „Projekte“ (Chevron + Bildmarke 16 px,
    `aria-label="Projekte"`, Tooltip „Zu den Projekten“), danach der Projekttitel `h1` (13.5/600, einzeilig, kürzt mit
    Ellipse) und die Kategorie als ruhiger Text (12, `--text-3`). Die Kategorie behält die Klasse `badge-category`, wird
    aber nicht als Badge gestaltet. Das **Phasen-Badge entfällt**, weil die Phase im Stepper steckt.
  - **Mittlere Zone** (bündig mit der linken Monitorkante, Innenabstand 16): **Checkpoint-Stepper**.
    - Erledigt: 16-px-Kreis, Rand `--ok`, Häkchen-Icon `--ok`, Label `--text-2`.
    - Aktuell: 16-px-Kreis gefüllt `--text`, Ziffer in `--base` (Mono 10/600), Label 12.5/600 `--text`, dazu der
      Status als neutrale Pill (18 px, Rand `--line-3`, Text 11/500 `--text-2`): „zur Freigabe“ (proposed), „in Arbeit“
      (in_progress).
    - Offen: Ring `--line-3`, Ziffer und Label `--text-3`.
    - Verbinder: 12-px-Haarlinie `--line-3`.
    - **Schrittweises Einklappen** (ResizeObserver auf der Zone): Stufe 0 alle Labels → Stufe 1 Labels erledigter
      Schritte weg → Stufe 2 Labels offener Schritte weg → Stufe 3 nur der aktuelle Schritt plus „3/5“. Ausgeblendete
      Labels stehen im Tooltip.
    - Ein Klick auf einen Schritt öffnet bzw. fokussiert dessen Entscheidung im Dock oder scrollt den Verlauf zur
      Systemzeile dieses Checkpoints.
    - `<ol aria-label="Checkpoints">`, `aria-current="step"`. Die Klassen `step step-${status}` bleiben (Test-Hook
      `.step-approved`).
  - **Rechte Zone** (bündig mit der Director-Spalte, rechts 12):
    - Budget-Meter: 64 × 4, Radius 2; verbraucht `--text-2`, reserviert schraffiert in `--text-3`, frei `--line-2`. Ab
      85 % wird „verbraucht“ `--warn`, bei Überschreitung `--danger`.
    - Daneben `$6.84 / $20.00` (Mono 11.5; Ausgegebenes `--text`, Gesamtbetrag `--text-3`). Ein Klick öffnet das
      **Budget-Popover** mit `BudgetMeter detailed` (bestehende Komponente) und der Aufschlüsselung nach Quelle.
    - Danach: Versionen `v4 ▾` (Ghost-Knopf, bestehendes Popover; beim Ansehen einer alten Version `v2 · Ansicht` in
      `--warn`), **Exportieren** (secondary), Theme (Icon), Einstellungen (Icon).
    - Einklappreihenfolge bei weniger als 360 px: (1) „Exportieren“ wird zum reinen Icon, (2) der Meter-Balken
      verschwindet (der Betrag bleibt), (3) „/ $20.00“ verschwindet (bleibt im Tooltip).
- Höhe 44, Hintergrund `--base`, Unterkante 1 px `--line`.

### 7.3 `components/assets/AssetBrowser.tsx`, `AssetCard.tsx`, `AssetDrawer.tsx`, `lib/assets.ts`

**Container:** `<section className="assets" aria-label="Asset-Browser">` bleibt (Test-Hook Region). Hintergrund
`--base`, also tonal Rahmen wie Kopfzeile und Bühne. Aufbau:

1. **Kopf** (42 px, Innenabstand 12/8): „Assets“ (13/600) und Anzahl (`--text-3`, Mono 11), rechts `+` als Menü
   („Dateien importieren …“ → `importFiles('import')`, „Dateien verknüpfen …“ → `importFiles('link')`), dann
   Einklappen (`sideLeft`, Tooltip „Assets ausblenden · ⌘1“).
2. **Suche** (30 px, `--raised`, Rand `--line`, Radius 6): Lupe, Eingabe (Platzhalter „Titel, Tags, Prompts“), am rechten
   Rand innen der **Filter-Knopf** (24 px).
   - Der Knopf öffnet das Filter-Popover mit Status (Alle · Verwendet · Ungenutzt · Verworfen · Verknüpft), Quelle,
     Modell und Sortierung (Neueste · Typ · Kosten). Das sind die bestehenden Zustände aus `AssetBrowser`.
   - Ist ein Filter aktiv, zeigt der Knopf einen 5-px-Punkt `--text`, und **unter den Tabs** erscheinen entfernbare
     Filter-Pills (neutral, 20 px, × am Ende).
3. **Typ-Tabs** (28 px): „Alle“ plus nur die vorhandenen Typen (Bild · Video · Audio · Text · Daten · Code · Schrift).
   Ab sechs Typen kommen die übrigen in „Mehr ▾“. Aktiver Tab: Text `--text` und 2-px-Unterstrich `--text`; inaktiv
   `--text-3`. Rechts in der Zeile: **Ansicht** (`grid`/`list`) und **Gruppieren** (Menü: Verwendung · Typ · Keine).
   Die Tabs ersetzen die heutigen `filter-chip`-Mehrfachfilter und filtern nur einen Typ, weil das einfacher ist.
4. **Liste** (scrollt): Gruppen mit Overline und Anzahl.
   - Standard-Gruppierung **„Verwendung“**: *Im Composer* · *In Verwendung* · *Ungenutzt* · *Verworfen* (letztere
     standardmäßig eingeklappt).
   - Raster mit 2 Spalten, wenn die Leiste ≥ 264 px breit ist, sonst eine Liste. „Ansicht“ kann das überschreiben.
5. **Fußzeile** (32 px, Haarlinie oben): Link-Icon plus „Dateien hierher ziehen – sie werden verknüpft, nicht
   hochgeladen.“ (11, `--text-3`, einzeilig mit Ellipse, voller Text im Tooltip).
   - Beim Ziehen von Dateien über das Fenster bekommt die Leiste ein Overlay: inset 8, gestrichelter Rand `--ref-line`,
     `--ref-soft`, Text „Loslassen zum Verknüpfen“.

**Asset-Karte (Raster):**
- Thumb 16:10, Radius 4, `--img-edge`.
- Etiketten auf dem Bild, jeweils in `--media-chip` (Mono 10/600, Höhe 16, Radius 2, Text `#ECE9E4`):
  - unten links ein Typ-Icon-Chip,
  - unten rechts die Dauer,
  - oben rechts der **Verwendungsort**: `V1`, `A2`, `F3`, `/about`; höchstens zwei, danach `+1`.
- Darunter der Titel (12/500, 2 Zeilen, `--text`) und die Meta-Zeile (11, UI-Schrift `--text-3`): „h3-max · `$0.80`“
  bzw. „verknüpft · 48 kHz“.
- Zustände:
  - **Im Composer referenziert**: 1,5 px Ring `--ref` (ohne Tag).
  - Ausgewählt (Detail offen): 1,5 px `--text`.
  - Verworfen: Bild zu 45 % deckend, Meta „verworfen“.
  - Verknüpft, Datei fehlt: Warn-Icon und „Datei fehlt · Neu zuordnen“ (Klick → `relinkAsset`).
  - Hover: Hintergrund `--hover` (Inset −4) und oben links der Knopf „In den Composer“ (24 px, `media-chip`,
    Plus-Icon).
- Varianten: Video mit Hover-Scrub (bestehend; Scrub-Linie `--text`), Audio als Wellenform in `--trk-*` nach Rolle bzw.
  Musik, Text und Code als Ausschnitt in Plex Mono 10.5 auf `--raised`, Schrift als Specimen „Aa“.
- **Listenzeile:** 48 px; Thumb 64 × 40; Titel einzeilig; Meta; Verwendungsorte rechts.
- `data-asset-id` bleibt (Test-Hook).
- **Interaktion:** Klick öffnet die Detailansicht. „In den Composer“, Ziehen in den Composer oder `mod+Enter` auf der
  fokussierten Karte fügt einen Asset-Chip ein (Duplikate siehe §9.3).

**Detailansicht (`AssetDrawer.tsx`):** keine Schublade innerhalb der schmalen Leiste mehr, sondern ein Overlay-Panel.
- 360 px breit, Höhe der Mittelzone, links an der Assets-Kante (`left: var(--side-l)`), Hintergrund `--raised`,
  `--shadow-pop`.
- Fährt 240 ms herein (8 px Weg plus Deckkraft) und schließt mit Esc oder per Klick daneben.
- Inhalt wie heute (Lineage, Prompt, Parameter, Kosten, Verwendungen, Aktionen). Die Vorschau oben ist `.always-dark`.

**`lib/assets.ts`, neu:** `assetUsage(doc: StudioDocument | null, assetId: string): string[]`
- Timeline: IDs der Spuren mit Clips, deren `clip.assetId === assetId`.
- Deck: `F{n}` für Folien, deren Element oder Hintergrund das Asset verwendet.
- Canvas: Ebenennamen.
- Site: Pfade der Seiten, deren `mockups` das Asset enthalten.
- Die bisherige `assetUiStatus` bleibt für die Filter.

### 7.4 Monitor: `Monitor.tsx`, `VideoMonitor.tsx`, `DocMonitors.tsx`, `WebMonitor.tsx`, `PointerOverlay.tsx`

- `<section className="monitor always-dark" aria-label="Monitor">`, Hintergrund `--well`, untere rechte Ecke
  `--r-monitor`.
- **Banner für alte Versionen** (wandert aus `Stage.tsx` hierher): 28 px oben im Monitor, `--sunken` und
  `--warn`-Icon: „Du siehst v2 (nur ansehen)“ plus *Zur aktuellen Version*. Die Klassen `version-banner` und
  `is-viewing-old` bleiben.
- **Bildbereich:** Innenabstand 12 oben und seitlich. Das Bild wird zentriert eingepasst; dazu `--img-edge` (1 px inset)
  und `--shadow-media`. Overlays (Safe Areas, Auswahl) liegen nur auf dem Bild. Die Safe Areas sind 1 px
  `rgb(255 255 255 / .35)` gestrichelt.
- **Transport** (`.transport`, 44 px, unter dem Bild, **ersetzt die obere `monitor-toolbar`**):
  - **Links:** TC in Plex Mono 15/500 `--text`; die Frames (`:12`) in `--text-3`. Dann „/ 00:01:00:00“ (12,
    `--text-3`). Dann die Meta (11.5, `--text-3`, kürzt mit Ellipse) aus dem Clip unter dem Abspielkopf auf V1:
    „Shot 04 – Lichter · V1 · v4“.
  - **Mitte** (absolut auf die Monitorbreite zentriert): *Vorheriger Marker* · *Bild zurück* · **Play/Pause** (34 × 30,
    gefüllte Glyphe auf `--hover`, Radius 6) · *Bild vor* · *Nächster Marker*. Gibt es keine Marker, springen die
    äußeren Knöpfe an Anfang bzw. Ende (Tooltip „An den Anfang · Pos1“).
  - **Rechts:** Format-Segment (16:9 | 9:16 …; nur bei mehr als einem Format), Safe Areas (Toggle-Icon), Ton aus/an,
    Proxy-Badge (`badge warn`, wenn nötig), Vollbild.
  - Bei weniger als 640 px Monitorbreite wandern Format und Safe Areas in ein ⋯-Menü.
- **Audio-Projekt:** Statt eines Bildes zeigt der Bildbereich die Mix-Wellenform über die volle Breite (`--trk-music`,
  60 %) mit Abspielkopf; der Transport bleibt gleich.
- **Folien (`DeckMonitor`):** Die Leiste (44 px) wird unten gleich aufgebaut: links `‹ 3 / 8 ›` (Mono) und der
  Folientitel (`--text-3`); rechts das Modus-Segment *Element* | *Region* (ersetzt die Hinweiszeile), Notizen-Toggle
  und Einpassen.
- **Leinwand (`CanvasMonitor`):** links Zoom − 100 % + und Einpassen; rechts das Modus-Segment *Element* | *Region*.
- **Web (`WebMonitor`):** links das Viewport-Segment *Mobil 390* · *Tablet 820* · *Desktop 1440* (Werte aus `VIEWPORTS`);
  mittig das Modus-Segment *Ansehen* | *Element* | *Region* (ersetzt die beiden Toggles `pickMode`/`regionMode`);
  rechts die Seitenauswahl bzw. der Pfad (Mono), *Neu laden* und *Im Browser öffnen* (Icon). Status
  „Vorschau startet …“ bzw. Fehler wie heute, aber im neuen Leerstil (§11).
- **Auswahl auf Inhalten (`PointerOverlay.tsx`):**
  - Hover: 1 px gestrichelt `--ref-media` plus 1 px Außenrand `--ref-media-halo`.
  - Referenziert: 1,5 px durchgezogen `--ref-media`, 1 px Halo, und **oben links ein Tag**: Nummern-Kästchen (wie im
    Chip) plus Label (Mono 10.5, Hintergrund `--ref-media`, Text `--on-ref`), etwa „② h1.hero-title · 612 × 148“.
  - Ein Klick fügt den Chip ein und zeigt einen Toast „Referenz ② hinzugefügt“ mit *Rückgängig*.
  - Region ziehen: Rahmen wie „referenziert“ mit 10 % `--ref-media` gefüllt.
- Ein Hinweis zum Zeigen erscheint **einmalig** (§8.6, Schlüssel `monitorPointing`) als Zeile in der Monitorleiste:
  „Klick: Element · Ziehen: Region“. Danach steht er nur noch im Tooltip des Modus-Segments.

### 7.5 `components/stage/Stage.tsx` (Gehäuse der Bühne)

- Hintergrund `--base`. Raster aus Leiste (32 px) und Körper. Der Körper hat die Spalten
  `var(--index-w) minmax(0,1fr)`. Die Index-Spalte hat rechts 1 px `--line`.
- **Bühnen-Leiste** (32 px, Haarlinie unten):
  - In der Index-Zone: Icon (16), Titel (13/600: „Timeline“, „Folien“, „Ebenen“, „Seiten“), Meta (`--text-3`):
    „v4 · 25 fps“ bzw. „v2 · 8 Folien“.
  - Rechts die Werkzeuge der Kategorie (Timeline: Beat-Raster, Zoom −, Einpassen, Zoom +), dann Einklappen (Tooltip
    „Bühne ausblenden · ⌘3“).
  - **Keine Hinweisprosa.**
  - Eingeklappt zeigt die Leiste bei Timeline-Kategorien zusätzlich den TC (Mono 12) neben dem Titel.
- Leer- und Planungszustände wie heute (`stage-empty`, `stage-planning` mit `data-testid`) im Leerstil (§11).
- `<section aria-label="Bühne (nur lesbar)">` bleibt (Test-Hook).

### 7.6 Director: `DirectorPanel.tsx`, `Cards.tsx`, neu `DecisionDock.tsx`, neu `JobTray.tsx`

`<aside className="director" aria-label="Director">` (Test-Hook complementary), Hintergrund `--panel`, keine Linie zum
Composer. Vertikaler Aufbau: Kopf · Verlauf (scrollt) · JobTray · DecisionDock. Darunter folgt im Raster der Composer.

#### 7.6.1 Kopf (42 px, Innenabstand 16/8)
- „Director“ (13/600).
- Status (11.5, `--text-2`, `role="status"`):
  - *Bereit*: 6-px-Punkt `--ok`
  - *arbeitet*: 7-px-Punkt `--accent`, atmend (Tungsten #3)
  - *wartet auf dich*: Ring `--text-2`
  - *Fehler*: Punkt `--danger`; der Tooltip enthält `runError`
  - *unterbrochen*: Ring `--text-3`
- Rechts: **Stopp** (nur bei `running`; `btn sm danger`, Stopp-Icon), ⋯-Menü und Einklappen (`sideRight`, „Director
  ausblenden · ⌘2“).
  - ⋯-Menü: *Technische Details anzeigen* (Toggle, gespeichert) und *Kosten …* (öffnet das Budget-Popover der
    Kopfzeile).
- Eingeklappte Schiene (40 px): Status-Punkt, die Zahl der ungelesenen Director-Nachrichten (neutrales Badge) und, falls
  vorhanden, ein Badge für eine offene Entscheidung (gefüllt `--text`, Text `--base`, z. B. „1“). Ein Klick klappt die
  Spalte auf.

#### 7.6.2 Verlauf (`role="log"`, `aria-live="polite"`)
- Innenabstand 16, Gruppenabstand 14. Er ist unten verankert und bleibt unten, solange man nicht mehr als 80 px nach
  oben gescrollt hat; das ist das bestehende Verhalten. Wird nach oben gescrollt, erscheint ein Knopf „Neueste ↓“
  (24 px, schwebend, `--raised`, `--shadow-pop`).
- **Kopfzeile je Nachricht:** Autor (11.5/600 `--text-2`) und Uhrzeit (11.5 `--text-3`). Folgen mehrere Nachrichten
  desselben Autors innerhalb von 2 Minuten, entfällt die Kopfzeile.
- **Du** (`.msg-user`): Block auf `--raised`, 1 px `--line`, Radius 8, Innenabstand 8/12, Text 13/1.58. Chips darin sind
  statisch (ohne ×). Ein Klick führt `revealRef` aus (§9.4).
- **Director** (`.msg-director`): Text ohne Blase, 13/1.58 `--text`.
  - Listen mit Mono-Ziffern in `--text-3`.
  - **Timecode-Links** (`.tc-link`): Inline-Chip, Mono 11.5, `--ref-soft`, `--ref-text`, Radius 3, Innenabstand 0/4. Der
    Inhalt wird **im Anzeigeformat** dargestellt (§9.2: aus `00:24.000` wird `00:24:00`). `aria-label`: „Zu 00:24:00
    springen“.
- **Streaming:** Meta „schreibt …“ und ein 2-px-Cursor `--text` am Textende (nicht Tungsten). Es gilt `aria-busy`.
- **Fortschrittsnotizen:** 12 `--text-3`, mit 1 px linker Linie `--line-2` und Innenabstand links 8.
- **Werkzeuggruppe** (`details.tools`):
  - Eingeklappt eine Zeile: Chevron, „5 Schritte“ (12/500 `--text-2`), dahinter die Zusammenfassung in `--text-3`
    („Frames geprüft, Beat-Raster, Testshot“, kürzt mit Ellipse), rechts die Dauer (Mono 11 `--text-3`).
  - Aufgeklappt Zeilen aus Status-Icon (Häkchen `--ok`, Spinner `--text-2`, ✕ `--danger`), **Klartext-Label** und
    Dauer.
  - Labels:
    1. `activity.summary`, wenn vorhanden.
    2. sonst `t('tool.<name>')` mit neuen i18n-Schlüsseln, z. B. `tool.frames.extract` = „Frames geprüft“,
       `tool.analyze.beats` = „Beat-Raster erkannt“, `tool.generate` = „Generiert“, `tool.timeline.apply` =
       „Timeline geändert“.
    3. sonst ein vermenschlichter Name (Punkte und Unterstriche werden zu Leerzeichen, erster Buchstabe groß).
  - Rohnamen (Mono 11 `--text-3`) erscheinen nur, wenn „Technische Details“ eingeschaltet ist.
- **Systemzeile:** linksbündig, Icon plus Text (11.5 `--text-3`) zwischen zwei Haarlinien `--line`, etwa „Häkchen ·
  Style Bible freigegeben · `$6.00`“. Erledigte Checkpoints und Genehmigungen erscheinen **nur** als Systemzeile.
- **Fehlerkarte** (`role="alert"`):
  - `--raised`, Rand `--danger` 35 %, Radius 8.
  - Kicker „GENERIERUNG FEHLGESCHLAGEN“ (Overline `--danger`) und Uhrzeit.
  - Satz mit Ursache und „Es wurden keine Kosten berechnet“ bzw. die angefallenen Kosten.
  - Aktionen: *Erneut versuchen*, *Anderes Modell …* (öffnet die Modellwahl auf der passenden Ebene 2).
- **Leer:** Ein Absatz in `--text-2` („Erzähl dem Director, was du vorhast. Er beginnt mit einem kurzen
  Planungsgespräch.“), darunter je Kategorie 2–3 Beispielzeilen (12 `--text-3`). Ein Klick setzt den Text in den
  Composer und fokussiert ihn.

#### 7.6.3 `DecisionDock.tsx` (neu): angedockte Entscheidung

- **Quelle:**
  1. `question`, dann
  2. `approvals[]`, dann
  3. `checkpoints.filter(status==='proposed')`.
  Gibt es mehrere, zeigt der Dock-Kopf „1 von 3 offenen Entscheidungen“ mit ‹ ›.
- **Lage:** in der Director-Spalte ganz unten, direkt über dem Composer; Außenabstand 0/12/12, `--raised`, 1 px
  `--line-2`, Radius 8, Innenabstand 12. Es gilt `max-height: 55 %` der Spalte, der Inhalt scrollt.
- **Inhalt** (die bestehenden Card-Komponenten aus `Cards.tsx` werden kompakt gestaltet und wiederverwendet; die
  Aria-Namen bleiben gleich):
  - **Checkpoint** (`article`, `aria-label="Checkpoint zur Freigabe: {Titel}"`):
    - Kicker „CHECKPOINT 3 VON 5“ und die neutrale Pill „zur Freigabe“.
    - Titel (13.5/600) und Zusammenfassung (12.5 `--text-2`, höchstens 3 Zeilen, dann *Mehr*).
    - Bis zu 4 Belege als 56 × 32-Thumbs (Klick = Asset-Chip).
    - Budgetzeile: „Budget für „Produktion““ und ein Mono-Geldfeld (96 px, `aria-label="Beantragtes Budget (USD)"`).
    - Aufklappbar *Aufschlüsselung ▾*: Zeilen je Modalität und der Meter „Danach `$6.84 / $34.00`“.
    - Aktionen: **Freigeben · `$14.00`** (Primär; `aria-label="Freigeben (Budget $14.00)"` wie heute), *Ändern …*
      (öffnet das Feedback-Feld).
  - **Genehmigung** (`article`): Warn-Icon, Kicker „GENEHMIGUNG · BUDGET“, Titel, ein Satz mit Mono-Betrag,
    **Genehmigen · `$3.20`** und *Ablehnen*.
  - **Rückfrage** (`form aria-label="Rückfrage"`):
    - Frage als Kartentitel.
    - Optionen als Radiozeilen (32 px; Auswahl als `--text`-Punkt, Label 12.5/500, Beschreibung 11.5 `--text-3`,
      neutrales Badge „Empfohlen“).
    - „Andere …“ öffnet ein Freitextfeld.
    - Aktionen: **Antworten** (Primär) und *Später*.
- **Kompaktmodus:** automatisch, wenn die Director-Spalte weniger als 420 px hoch ist, oder nach *Später*. Dann zeigt
  das Dock eine 36-px-Zeile: Icon, „Checkpoint 3 wartet auf Freigabe“ (12.5/500, kürzt mit Ellipse), Betrag (Mono) und
  **Prüfen** (Primär).
  - *Prüfen* öffnet das Dock als **Sheet** nach oben über den Verlauf (gleiche Breite, `--shadow-pop`, höchstens 70 %
    der Spalte, Esc schließt).
  - Nach *Später* bleibt das Dock kompakt, bis eine neue Entscheidung kommt.
- Im Verlauf erscheint an der Stelle des Ereignisses eine Systemzeile „Checkpoint 3 vorgelegt · unten angeheftet“. Es
  gibt keine Doppelkarte.
- **Tungsten:** Der Primärknopf des Docks bzw. *Prüfen* ist der einzige Primärknopf. *Senden* ist dann secondary (§6).
- Bei einer neuen Entscheidung: `announce('Neue Entscheidung: …')`. Der Fokus wird nicht verschoben.

#### 7.6.4 `JobTray.tsx` (neu, ersetzt `GenerationQueue` und den Budget-Fuß)

- Eine Zeile (32 px), nur wenn Jobs laufen oder in den letzten 10 s fertig wurden. Innenabstand 0/16, Haarlinie oben
  `--line` auf Inhaltsbreite.
- Inhalt: Spinner `--text-2`, Zweck (12 `--text`, kürzt mit Ellipse), „h3-max · 8 s“ (`--text-3`), verstrichene Zeit
  (Mono), „≈ `$0.80`“ (Mono `--text-3`). Gibt es weitere Jobs, folgt `+2` (Knopf → Popover nach oben mit allen Jobs).
- Fortschritt: 2-px-Linie am unteren Rand in `--text-2`. Gibt es eine Schätzung, ist sie bestimmt; sonst ist die Linie
  statisch auf 0 %, **ohne Laufanimation**.
- Fertig: Häkchen `--ok` und Kosten; nach 10 s blendet die Zeile in 180 ms aus. Fehlgeschlagen: ✕ `--danger`; die
  Zeile bleibt, bis sie geschlossen wird. Die Details stehen in der Fehlerkarte im Verlauf.
- `role="status"`, `aria-label="Generierungen"`.
- Der bisherige `director-footer` mit `budget-details` **entfällt** (das Budget steht nur noch in der Kopfzeile).

### 7.7 Composer: `Composer.tsx`, `ComposerEditor.tsx`, `editorDom.ts`

`<section className="composer" aria-label="Nachricht an den Director">`, Hintergrund `--panel`, Innenabstand 12/16/10,
**keine** Oberkante zum Director. Unter dem Monitor grenzt der Composer an die Monitor-Unterkante (Luminanzsprung, keine
Linie).

1. **Warteschlange** (nur wenn `queue.length > 0`): bis zu 3 Zeilen à 28 px über dem Text.
   - Inhalt: Icon `queue`, der Text (über `displayText()`, §9.1, ohne Emoji; kürzt mit Ellipse), *Jetzt senden*
     (deaktiviert, solange `running`) und ×.
   - Die Kopfzeile „2 in Warteschlange“ steht in 11 `--text-3`.
2. **Textzone** (`data-testid="composer-editor"`, `role="textbox"`, `aria-multiline`):
   - 13.5/24 px. Mindestens 2 Zeilen (48 px), höchstens 8 Zeilen (192 px), dann scrollt sie.
   - **Keine Box.** Bei `:focus-within` bekommt die Zone den Hintergrund `--panel-hi`, Radius 8 und Innenabstand 6/8
     (der Text springt nicht, weil im Ruhezustand ein transparentes Gegen-Padding gilt).
   - Platzhalter (`--text-3`): „Antworten oder neue Anweisung … Zeige auf Bühne oder Monitor, um Stellen zu
     referenzieren.“ Bei Folien heißt es entsprechend „… auf Folien“, bei Web „… auf Seiten oder Elemente“.
3. **Werkzeugleiste** (32 px, Abstand oben 6):
   - **Links:**
     - `+` (Menü: „Asset einfügen …“ fokussiert die Asset-Suche; „Datei einfügen …“ → `importFiles('link')` und
       fügt Chips ein).
     - **Positionsknopf** je Kategorie: Video/Audio *Marker* (Icon `marker`, Text „Marker“, bei mehr als 0 Markern
       zusätzlich die Anzahl in Mono `--text-3`; Klick = Marker am Abspielkopf; Tooltip „Marker am Abspielkopf · Enter
       (außerhalb von Textfeldern) · ⌥Enter hier“). Folien *Folie* (aktuelle Folie referenzieren), Web *Seite*
       (aktuelle Seite referenzieren). Bei Grafik gibt es keinen solchen Knopf.
   - **Rechts:**
     - **Modell-Zusammenfassung** (§7.8).
     - **Mikrofon** (28 × 28, Ghost; während der Aufnahme gefüllt `--danger` mit weißem Icon).
     - **Senden/Einreihen** (§7.7.1).
   - Während der Aufnahme ersetzt die Aufnahmeanzeige den linken Teil: roter Punkt, „Aufnahme“, Zeit (Mono), ein
     Pegel 48 × 4 in `--text-2` und „2 Klicks“. Beim Transkribieren: Spinner und „Wird transkribiert …“.

#### 7.7.1 Senden-Zustände

| Zustand | Label | Stil | Aktiv |
|---|---|---|---|
| Composer leer | Senden | secondary | nein |
| Inhalt, Director bereit, keine Entscheidung offen | **Senden** | **primary (Tungsten)** | ja |
| Inhalt, Director arbeitet | Einreihen | secondary | ja |
| Inhalt, Entscheidung offen | Senden | secondary | ja |

Tooltip: „Senden · ⌘↵“ bzw. „Einreihen · ⌘↵ (wird nach dem aktuellen Lauf gesendet)“. Ohne Keycap im Knopf. Der
Accessible Name ist exakt „Senden“ bzw. „Einreihen“ (Test-Hook). Stopp steht **nicht** mehr im Composer (nur im
Director-Kopf).

#### 7.7.2 Chips (`editorDom.createChip`, statische Chips im Verlauf)

- 22 px hoch, Radius 4, `--ref-soft`, Rand innen 1 px `--ref-line`, Text `--ref-text` 12/500. Innenabstand 0/5/0/3.
- Aufbau: `[Nummer] [Icon oder Thumb] Label [×]`.
  - **Nummern-Kästchen:** 16 × 16 (Mindestbreite), Radius 3, `--ref`, `--on-ref`, Mono 10/600. Es gibt sie bei allen
    Bühnen-Referenzen, nicht bei Assets und Versionen.
  - Zeit: Nummer und `MM:SS:FF` in Mono 11.5; Frames in 70 % Deckkraft. Kein Icon.
  - Clip: Nummer, Filmstreifen-Icon und Clipname.
  - Abschnitts- bzw. Dokument-Marker: Nummer, Marker-Icon und Label.
  - Folie: Nummer, Folien-Icon, „Folie 3“.
  - Element: Nummer, Cursor-Icon, „Folie 3 · Balkendiagramm“ bzw. `h1 „Guten Morgen“`.
  - Region: Nummer, Region-Icon und Kurzlabel.
  - Seite: Nummer, Web-Icon und Pfad (Mono).
  - Asset: Thumb 22 × 16 (Radius 2) oder Typ-Icon, dann der Titel.
  - Spanne (alt, wird nicht mehr erzeugt): Nummer und `MM:SS:FF–MM:SS:FF`.
- × ist 14 px groß, hat `--ref-text` mit 55 % Deckkraft (bei Hover 100 %) und `aria-label="Referenz entfernen: …"`.
- Die Klassen `chip chip-${kind}` bleiben (Test-Hooks `.chip`, `.chip-time`, `.chip-slide`). Neu sind
  `data-ref-key="<refKey>"` und `data-ref-n`.
- **Verknüpfung:** `.is-linked` (bei Hover über das Gegenstück) zeigt einen Ring von 1,5 px `--ref`. `.is-flash` zeigt den
  Blitz aus §5.
- `title` enthält `refChipTitle` (ohne Emoji).

#### 7.7.3 Tasten im Composer

| Taste | Wirkung |
|---|---|
| `mod+Enter` | Senden bzw. Einreihen (bestehend) |
| `Enter` / `Umschalt+Enter` | Zeilenumbruch (bestehend) |
| **`Alt+Enter`** | **Position referenzieren**: Video/Audio → Marker am Abspielkopf; Folien → aktuelle Folie; Web → aktuelle Seite. Der Chip landet am Caret. |
| `mod+M` | Modell-Popover öffnen |
| `Backspace` / `Entf` an einem Chip | Chip entfernen; bei einem Zeit-Chip verschwindet auch der Marker (bestehend, über die Store-Aktion `removeComposerSegment`) |
| `mod+Umschalt+Leertaste` halten | Push-to-Talk (bestehend) |

`ComposerEditor` darf `store.setState` nicht mehr direkt aufrufen, sondern nur noch Aktionen wie `setComposer` und
`removeComposerSegment`. Das ist nötig, damit die Nummernvergabe (§9.3) an einer einzigen Stelle läuft.

### 7.8 Modellwahl: `components/picker/ModelPicker.tsx` (ersetzt `ModelPickerBar.tsx`)

**Entscheidung und Begründung:** Die Zusammenfassung steht in der Composer-Werkzeugleiste, links von Mikrofon und
Senden, weil die Modellwahl ein Parameter der Anweisung ist, die man gerade abschickt (Kosten und Qualität entscheidet
man beim Senden). Der Director-Kopf trägt Laufzustand und Stopp; dort würde die Modellwahl mit dem Laufzustand
konkurrieren. Die Wahl ändert sich pro Projekt selten. Deshalb ist die Zusammenfassung leise (Ghost) und zeigt nur, was
verbindlich ist. „Auto“ ist der Normalfall und wird nur gezählt.

- **`ModelSummary`** (Ghost-Knopf, 28 px, `aria-haspopup="dialog"`, Tooltip „Modelle · ⌘M“):
  - Inhalt: „Opus 5.5 · sehr hoch“, dann jede gebundene Modalität mit Icon (12) und Kurzname, getrennt durch 1 px
    `--line-2`, dann „+6 Auto“ in `--text-3` und ein Chevron.
  - Die Breite wird gemessen. Reicht der Platz nicht, wird daraus „Modelle · 3 gebunden ▾“.
- **`ModelPickerPanel`** (Inhalt des Popovers; als Export auch einzeln renderbar, wichtig für Tests): Popover nach oben,
  rechtsbündig an der Zusammenfassung, **Breite 400 px**, Radius 10, `--raised`, `--shadow-pop`.
  - **Ebene 1 · Modalitäten:**
    - Kopf: „Modelle für dieses Projekt“ (12.5/600) und rechts das Aktualisieren-Icon (`aria-label="Modellkatalog
      aktualisieren"`).
    - Neun Zeilen à 36 px als `button`. Der Accessible Name entspricht dem heutigen Trigger, etwa „Video: h3-max,
      $0.16 / s“ bzw. „Bild: Auto“. Jede Zeile hat Icon, Modalität (12/500), Auswahl (gebunden `--text`/500; Auto
      `--text-3`), Einheitspreis (Mono 11 `--text-3`) und einen Chevron rechts.
    - In der **Director-Zeile** steht die Denktiefe als kompaktes natives `<select aria-label="Denktiefe">` (72 px,
      Werte Niedrig, Mittel, Hoch, Sehr hoch, Max).
    - Fuß: Info-Icon und „Gebundene Modelle sind verbindlich. Bei Auto wählt der Director und begründet die Wahl.“ (11
      `--text-3`).
  - **Ebene 2 · Modelle einer Modalität** (ersetzt Ebene 1 **an derselben Stelle**; 180 ms Überblendung plus 8 px Weg):
    - Kopf: Zurück-Knopf „‹ Video“, darunter die Suche (`type=search`, `aria-label="Modelle durchsuchen"`, fokussiert)
      mit der Anzahl rechts (Mono).
    - Liste: `role="listbox"`, `aria-label=<Modalität>`, Höhe höchstens min(60vh, 520 px).
    - Erste Option „Auto“ mit Erklärung.
    - Jedes Modell (`role="option"`):
      - Kopfzeile: Name (12.5/600), Anbieter (`--text-3`), Badge „Empfohlen“ (neutral), Badge „Beta“, rechts der
        Einheitspreis (Mono) und ein Häkchen, wenn gewählt.
      - Beschreibung: 2 Zeilen 11.5 `--text-2`.
      - Fußzeile: Fähigkeits-Badges (`capabilityBadges`, neutral umrandet, 18 px), rechts die Beispielrechnung
        (`exampleCost`, Mono `--text-3`).
      - Veraltete Modelle: `--warn`-Zeile „Veraltet“.
    - Nach der Wahl springt das Popover zurück auf **Ebene 1** und bleibt offen. Erst Esc oder ein Klick daneben
      schließt es.
  - **Tastatur:** ↑/↓ wechseln die Zeile, → bzw. Enter öffnen Ebene 2, ← bzw. Esc gehen auf Ebene 1 zurück, in Ebene 2
    sucht man durch Tippen und wählt mit Enter. Es gilt `aria-activedescendant` (bestehende Logik).
- Die Datei `ModelPickerBar.tsx` wird gelöscht. `capabilityBadges` zieht nach `ModelPicker.tsx` um (Export bleibt).
  `test/picker.test.tsx` rendert `<ModelPickerPanel />` statt `<ModelPickerBar />`; die übrigen Zusicherungen bleiben
  gültig.

### 7.9 Timeline: `TimelineStage.tsx`, neu `MarkerStrip.tsx`, neu `TimelineIndex.tsx`, `lib/timelineGeometry.ts`

**Senkrechte Anatomie** (von oben, im Inhalt, horizontal scrollend):

| Zeile | Höhe | Inhalt | Geste |
|---|---|---|---|
| Markerleiste | 16 (`--strip-h`) | `--sunken`; Nutzer-Marker; Geister-Marker | **Klick = Marker setzen** (§8) |
| Lineal | 22 | Mono-Labels 10 `--text-3` (m:ss; beim Zoomen m:ss:ff); Takt-Ticks 8 px `--line-3`, Schlag-Ticks 4 px `--line-3` 60 %; Dokument-Marker (qa/note/checkpoint) als 7-px-Rauten an der Unterkante | Scrubben |
| Abschnitte | 20 (nur wenn Abschnitts-Marker existieren) | Mikro-Labels 10/600 Versalien `--text-3` plus Startzeit „· 0:24“ in Mono 10 (entfällt, wenn der Platz kleiner als Label + 40 px ist). Der Abschnitt unter dem Abspielkopf wird `--text` auf `--hover` (fest, ohne Verlauf) dargestellt. | Scrubben; **Alt+Klick auf ein Label = Abschnitt referenzieren** |
| Spuren | §2.3 | Clips | Scrubben; **Alt+Klick auf einen Clip = Clip referenzieren** |

- **Raster:** Abschnittsgrenzen als 1-px-`--line-3`-Linie durch alle Spuren. Takte (Downbeats) `--line`, Schläge
  `--line` mit 50 %. Schläge werden ausgedünnt, wenn sie weniger als 4 px auseinanderliegen (bestehend).
- **Clips:**
  - V1 (video): Filmstreifen aus Kacheln mit 1-px-Fugen (`.always-dark`). Das Label steht in einem **festen Reiter**
    oben links (`--media-chip`, 10.5/500, Nummer `01` in Mono `--text-3`, dann der Name). Kein Verlauf.
  - V2 (overlay): Fläche aus der Spurtönung, linke Kante 2 px `--trk-overlay`, Mini-Thumb 16 px, falls visuell, und
    Name 11/500.
  - T1 (text): Tönung aus `--trk-text`, linke Kante 2 px, der **Text des Clips** in Instrument Sans mit
    `font-stretch: 80%` 11/500 `--text`.
  - Audio: Tönung nach Rolle (voice/vocals → `--trk-voice`, music → `--trk-music`, sfx/ambience → `--trk-sfx`,
    ohne Rolle → `--trk-voice`); die Wellenform über die volle Höhe mit 75 % Deckkraft; Label-Reiter oben links
    (`--panel` mit 85 %, 10.5).
  - Radius 3, Abstand 1 px zur Spurkante.
  - **Referenziert:** 1,5 px `--ref`-Ring und ein Nummern-Badge an der linken Oberkante.
  - Stumm geschaltete Spur: Clips mit 45 % Deckkraft. Versteckte Spur: schraffiert `--line`.
- **Abspielkopf:** 1 px `--accent-line` von der Oberkante der Markerleiste bis unten. Kappe 11 × 14 (Fünfeck nach unten)
  im Lineal in `--accent`. Die Kappe ist greifbar (Cursor `grab`).
- **Index-Spalte (`TimelineIndex.tsx`)**, Breite `--index-w`, Hintergrund `--base`:
  - Oberer Block, deckungsgleich mit Markerleiste + Lineal + Abschnitte (16 + 22 + 20 px):
    - **Zeile Markerleiste:** links die Legende „MARKER“ (Mikro-Label `--text-3`) und die Anzahl (Mono 10); rechts
      `‹` `›` (20 × 16, Ghost; Tooltip „Vorheriger Marker · [“ bzw. „Nächster Marker · ]“).
    - **Zeilen Lineal + Abschnitte (42 px):** links der **große TC** des Abspielkopfs (Plex Mono 18/500 `--text`; die
      Frames `:12` in `--text-3`; `aria-live="off"`); rechts übereinander die Legenden „ZEIT“ und „ABSCHNITTE ·
      120 BPM“ (Mikro-Label `--text-3`), jeweils auf der Höhe ihrer Zeile. Gibt es keine Abschnittszeile, steht der TC in
      der 22-px-Zeile mit Größe 15.
  - **Spurköpfe** (Höhe wie die Spur): Kennstreifen 3 × 14 in Spurfarbe (Radius 1), Spur-ID (Mono 11 `--text-2`), Name
    (12 `--text`, kürzt mit Ellipse), rechts Icons nur bei Dokumentzustand (stumm, versteckt). **Kein** Mute/Solo zum
    Abhören.
  - Aktive Spur (Tastatur ↑/↓): `--hover`. Spurköpfe scrollen senkrecht synchron mit den Spuren.
- **Leiste rechts:**
  - **Beat-Raster** als Toggle mit LED (`--text`; Tooltip „Beat-Raster · B“). Ist es eingeschaltet, rasten Marker auf
    Schläge ein; `Umschalt` kehrt das um. Nur sichtbar, wenn es Beat-Marker gibt.
  - Zoom − / Einpassen / Zoom +. Es gibt **keinen** Schieberegler.
  - `mod+Mausrad` zoomt (bestehend).
- **Entfernen:** die Spannen-Auswahl (`selection`, `DRAG_THRESHOLD_PX`-Spannenlogik und `.tl-selection`). Die
  Spannen-Referenz bleibt im Core erhalten; die UI erzeugt sie nicht mehr.

### 7.10 Andere Bühnen: `DocStages.tsx`

- **Index-Spalte je Kategorie** (gleiche Anatomie aus großem Readout und Legende):
  - Folien: Readout „3 / 8“ (Mono 18), darunter der Titel der aktuellen Folie (12 `--text-2`, 2 Zeilen) und „2
    ausgeblendet“, falls vorhanden.
  - Grafik: „12 Ebenen“ und „1080 × 1350“ (Mono).
  - Web: „4 Seiten“, Phase „Mockup“ bzw. „Code“ und das Framework.
  - *QA-Checklisten erscheinen erst, wenn das Site-Schema QA-Daten liefert* (§16).
- **Folienstreifen:**
  - Thumbs 148 px breit, Abstand 10, Innenabstand 12, horizontal scrollend. Label darunter: Nummer (Mono 10.5
    `--text-3`) und Titel (11.5 `--text-2`, kürzt mit Ellipse).
  - **Aktuelle Folie:** Rand 2 px `--text` mit 2 px Abstand (nicht Tungsten).
  - **Referenziert:** 1,5 px `--ref` und ein Nummern-Badge oben rechts.
  - Ausgeblendet: 40 % Deckkraft und das Icon `eyeOff`.
  - **Klick = Folie anzeigen und referenzieren** (bestehend; neu mit Duplikatschutz §9.3).
  - Abschnittsköpfe nur, wenn Folien mit `layout === 'section'` existieren (Mikro-Label über der Gruppe).
- **Ebenenliste:** Zeilen à 28 px als Baum; Typ-Icon, Name, Meta; referenziert mit Daylight-Badge. Klick referenziert
  (bestehend).
- **Seitenkarten:**
  - Karte 200 px breit, Vorschau 200 × 125 (Mockup bzw. Platzhalter, `.always-dark`), Titel 12/500, Pfad Mono 11
    `--text-3`.
  - Aktuelle Seite: 2 px `--text`. Referenziert: `--ref` plus Nummer.
  - **Klick = Seite im Monitor zeigen und referenzieren.** Die Knöpfe „Seite referenzieren“ entfallen. Die Klasse
    `page-row` wird zu `page-card`; Tests anpassen, falls sie verwendet wird.

### 7.11 Dialoge, Toasts, Popover (`Dialog.tsx`, `Toasts.tsx`, `Popover.tsx`)

- **Dialog:**
  - 420 px breit (Einstellungen 560), Radius 12, `--raised`, `--shadow-pop`, Scrim `--scrim`.
  - Titel 15/600, Text 12.5 `--text-2`.
  - Aktionen rechtsbündig: secondary links, primary rechts.
  - Bestätigungsdialoge nennen die Folge („Keine Version geht verloren“).
  - Esc bricht ab; der Fokus wird im Dialog gehalten und kehrt danach zum Auslöser zurück (bestehend).
- **Toast:**
  - Unten links in der Mittelzone (`left: calc(var(--side-l) + 16px)`, `bottom: 16px` über der Bühne), damit Monitor
    und Senden frei bleiben.
  - Radius 8, `--raised`, `--shadow-pop`.
  - Icon in der Bedeutungsfarbe: Referenz `--ref`, Erfolg `--ok`, Fehler `--danger`. Marker-Toasts gibt es keine, weil
    der Chip das Feedback ist.
  - *Rückgängig*, wo es sinnvoll ist.
  - info und success: 4 s, bei Hover pausiert, `role="status"`. **Fehler bleiben**, bis sie geschlossen werden
    (`role="alert"`).
  - Höchstens drei, gestapelt.
- **Popover:** Radius 10, `--raised`, `--shadow-pop`, Kopf 12.5/600 mit Haarlinie, Öffnen in 180 ms. Das bestehende
  `overlays`-Zählen, das die native Web-Vorschau verdeckt, bleibt.
- **Tooltip** (neu, `components/common/Tooltip.tsx`, ersetzt `title=` an Icon-Knöpfen):
  - 400 ms Verzögerung, danach 0 ms beim Wechsel zwischen Tooltips.
  - `--text` als Hintergrund und `--base` als Text (invertiert), 11.5, Radius 4, Innenabstand 4/8, optional mit Kbd.
  - `aria-describedby`.

### 7.12 Startbildschirm: `StartScreen.tsx`, `AuthStatusPanel.tsx`, `NewProjectDialog.tsx`

Der Aufbau folgt A (`final-shots/08-start.png`): zwei Zonen.
- **Links** (400 px, `--panel`):
  - „Was produzieren wir heute?“ (Display).
  - **Neues Projekt** (primary lg, Tooltip „⌘N“) und *Projekt öffnen …*
  - „Neu aus Kategorie“: 5 Zeilen mit Icon, Name und Beispielen in `--text-3`.
  - Unten der Systemstatus (`AuthStatusPanel`): Director-Anbindung und fal.ai, Status als Text plus Punkt
    (`--ok`/`--warn`), *Schlüssel hinterlegen*.
- **Rechts** (`--base`):
  - „Zuletzt geöffnet“ (Test-Hook Heading) mit Suche und Raster/Liste.
  - Das **Feature** (zuletzt bearbeitetes Projekt) zeigt groß das Standbild, eine Mini-Checkpoint-Leiste mit Kosten je
    Schritt, Budget und *Öffnen*.
  - Darunter Projektkarten mit Vorschau und eine Liste „Weitere Projekte“.
- **Datenlage:** `RecentProject` hat heute nur `path`, `title`, `category` und `updatedAt`. Für Feature und Karten wird es
  um optionale Felder erweitert: `poster?` (Asset-URL über `studio-asset:`), `checkpoint?: {index,total,title,status}`
  und `budget?: {spentUsd, approvedUsd}`. Das ist eine Änderung in Main bzw. `@studio/project` (P3).
  - **Ohne diese Daten** zeigt die Karte eine ruhige Kategorie-Kachel: `--raised`, das Kategorie-Icon 24 in `--text-3`
    und einen Titel. Es werden keine Daten erfunden.
- Die Badge für den Fake-Modus bleibt (`badge warn`).

### 7.13 Einstellungen (`SettingsDialog.tsx`)

Neue Gruppe „Darstellung“:
- Theme: Dunkel · Hell · System (ersetzt nicht den Header-Toggle).
- **Erhöhter Kontrast**: Systemstandard · An · Aus; gesetzt wird `data-contrast`.
- **Technische Details im Verlauf** (Toggle).
- **Hinweise zurücksetzen** (Knopf; setzt §8.6 zurück).

---

## 8. Timeline: Spezifikation der Markerleiste (verbindlich)

### 8.1 Datenmodell: eine Datenquelle

- **Ein Nutzer-Marker ist ein `time`-Ref im Composer.** Es gibt **keinen** separaten Marker-Speicher und **keine**
  Änderung am Dokument (die Bühne bleibt nur lesend).
- Abgeleitet (Selektor in `state/selectors.ts`, neu):
  ```ts
  export interface UserMarker { key: string; frame: number; n: number; pending: boolean }
  export function selectUserMarkers(s: StudioData): UserMarker[] {
    const fromComposer = s.composer.flatMap(seg => seg.type === 'ref' && seg.ref.kind === 'time'
      ? [{ key: refKey(seg.ref), frame: seg.ref.frame, n: s.refNumbers[refKey(seg.ref)]!, pending: false }] : []);
    const fromVoice = s.voice.recording ? s.voice.clicks.flatMap(c => c.ref.kind === 'time'
      ? [{ key: refKey(c.ref), frame: c.ref.frame, n: 0, pending: true }] : []) : [];
    return dedupeByKey([...fromComposer, ...fromVoice]).sort((a, b) => a.frame - b.frame);
  }
  ```
- Folgen daraus:
  - Wird ein Chip entfernt (×, Backspace, Text ausschneiden, Undo), verschwindet der Marker ohne zusätzlichen Code.
  - Nach *Senden* ist der Composer leer, also ist auch die Leiste leer. Die gesendeten Chips liegen als statische Chips
    in der Nachricht; ein Klick darauf springt zur Stelle.
  - Eingereihte Nachrichten erzeugen keine Marker.

### 8.2 Nummern

Es gelten die Nummernregeln aus §9.3: Die Nummer bleibt, solange der Chip existiert. Ein neuer Marker bekommt die
**kleinste freie Nummer**. Mehrere Chips mit demselben Frame teilen sich eine Nummer. Ein Marker, der während der
Aufnahme gesetzt wird, ist „schwebend“ (`pending`): Tag mit Umriss, ohne Nummer. Die Nummer bekommt er, sobald die
Transkription die Chips einsetzt.

### 8.3 Visuelles

- **Marker-Tag:** 16 × 13 px, Radius 2, `--ref`, Nummer Mono 10/600 `--on-ref`, horizontal **zentriert** auf
  `frameToX(frame)`. Bei zweistelligen Nummern ist er 20 px breit.
- Dazu eine **Linie**: 1 px `--ref` gestrichelt (3/3) mit 55 % Deckkraft, von der Unterkante der Leiste durch Lineal,
  Abschnitte und alle Spuren.
- Zustände:
  - Hover bzw. `.is-linked` (Chip-Hover): Linie durchgezogen 100 %, Tag mit 2-px-Ring `--ref-line`.
  - Fokus: `--focus`-Ring.
  - Schwebend: Tag als Umriss (1 px `--ref`, transparent), ohne Nummer, Linie 30 %.
  - Neu gesetzt: Animation „setzt sich“ (§5).
- **Geister-Marker** (Pointer über einem leeren Stück der Leiste):
  - Tag als Umriss (`--ref-line`) mit `+`-Glyphe an der (ggf. eingerasteten) Position.
  - Rechts daneben **in der Leiste** der Timecode des Ziels (Mono 10.5 `--ref-text`, Hintergrund `--sunken`), etwa
    `00:47:15`. Mit Beat-Raster folgt ein kleines Magnet-Icon (10 px).
  - Läuft der Text rechts über den Rand, steht er links vom Tag.
  - Es gibt **keinen** schwebenden Tooltip-Kasten; das Lineal bleibt frei.
  - Über einem bestehenden Marker wird kein Geister-Marker gezeigt.
- **Cursor:** in der Leiste `copy` (Plus-Pfeil), über Markern `pointer`, in der Scrub-Zone `default`, über der
  Abspielkopf-Kappe `grab` bzw. beim Ziehen `grabbing`.
- **Nähe:** Liegen zwei Marker näher als 18 px beieinander, wird der spätere 6 px höher gesetzt und überlappt den
  früheren um die Hälfte. Bei mehr als drei Markern innerhalb von 18 px steht ein Sammel-Tag „4“ mit gestricheltem Rand;
  ein Klick zoomt auf diesen Bereich.

### 8.4 Gesten (Zonen)

| Zone | Geste | Wirkung |
|---|---|---|
| Markerleiste (16 px plus Trefferzone 4 px nach unten ins Lineal, wo keine Labels stehen) | Klick auf freie Fläche | `actions.addMarkerAt(frame)`. Ist das Beat-Raster an, rastet der Marker auf den nächsten Schlag innerhalb von 12 px ein; `Umschalt` kehrt das Einrasten um. **Der Abspielkopf bewegt sich nicht**, damit Marker auch während der Wiedergabe gesetzt werden können. Der Chip landet am gespeicherten Caret des Composers (`state.caret`), sonst am Ende. Der Fokus bleibt, wo er war. |
| | Klick auf einen Marker | **Abspielkopf springt** (`requestSeek(frame)`, harter Schnitt, keine Fahrt). Der Marker bekommt den Fokus, der zugehörige Chip den Blitz. |
| | Rechtsklick auf einen Marker | Kontextmenü: *Hierhin springen* · *Marker entfernen* (Entf) |
| | Ziehen | **Ohne Funktion.** Marker lassen sich nicht verschieben, und es gibt keine Spannen. Wer einen Marker verschieben will, entfernt ihn und setzt ihn neu. |
| Lineal, Abschnitte, Spuren (ca. 95 % der Höhe) | Klick | Abspielkopf springt an diese Stelle (mit Beat-Raster eingerastet). Läuft die Wiedergabe, geht sie weiter. |
| | Ziehen | Scrubben: Die Wiedergabe pausiert, der Abspielkopf folgt dem Pointer framegenau, das Bild wird mitgezogen. Am Rand (24 px) scrollt die Ansicht automatisch mit. Nach dem Loslassen bleibt die Wiedergabe pausiert. |
| | Alt+Klick auf einen Clip | Clip-Referenz (nummerierter Chip, Ring auf dem Clip) |
| | Alt+Klick auf ein Abschnitts-Label oder eine Dokument-Raute | Referenz auf den Dokument-Marker |
| | Klick auf ein Abschnitts-Label oder eine Dokument-Raute | Abspielkopf springt dorthin (es wird **keine** Referenz mehr eingefügt) |
| Kappe des Abspielkopfs | Ziehen | wie Scrubben |

Die Hilfsfunktionen in `lib/timelineGeometry.ts` bleiben: `frameAt`, `snapToBeat`, `xToFrame`. Hinzu kommen
`markerStripHit(y)` und `layoutMarkerTags(markers, pps)` (Versatz bei Nähe).

### 8.5 Tastatur

Global gilt: kein Textfeld fokussiert, eine Timeline-Kategorie ist geöffnet, kein Modifier außer den genannten.

| Taste | Wirkung |
|---|---|
| **Enter** | Marker am Abspielkopf (`addMarkerAt(playhead)`, ohne Einrasten) |
| **Alt+Enter** | dasselbe, funktioniert auch im Composer |
| Umschalt+Enter (Timeline fokussiert) | Clip unter dem Abspielkopf auf der aktiven Spur referenzieren (**ersetzt das bisherige Alt+Enter**) |
| `[` / `]` | Abspielkopf zum vorigen bzw. nächsten Nutzer-Marker; am Ende passiert nichts, und es folgt die Ansage „Kein weiterer Marker“ |
| `Alt+[` / `Alt+]` | zum vorigen bzw. nächsten Abschnittsbeginn |
| Leertaste · J / K / L · ← / → · Pos1 / Ende | bestehend (Wiedergabe, Shuttle, Frame, Anfang/Ende) |
| Umschalt+← / → | zum vorigen bzw. nächsten Schlag, wenn es Beats gibt, sonst ±1 s |
| B | Beat-Raster an/aus |
| + / − | Zoom (bestehend); `mod+0` ist für den Fokusmodus reserviert, Einpassen liegt auf `Umschalt+Z` |
| ↑ / ↓ (Timeline fokussiert) | aktive Spur (bestehend) |
| **Tab** in die Markerleiste | Fokus auf den ersten Marker (Roving-Tabindex). Danach bewegen ← / → den Fokus zwischen Markern (der Abspielkopf bleibt stehen), **Enter** bzw. Leertaste springen dorthin, **Entf** bzw. Backspace entfernen Marker und Chip (der Fokus geht zum Nachbarn), Esc kehrt zur Timeline zurück |

### 8.6 Einmaliger Hinweis (statt der dauerhaften Hinweiszeile)

- Bedingung: Timeline-Kategorie, die Leiste ist leer, und `coach.markerStrip` ist nicht `done`.
- Dann steht **in der Markerleiste** linksbündig ab x = 8 (10.5 `--text-3`): „Klick hier setzt einen Marker · Enter
  setzt einen am Abspielkopf“.
- Der Text verschwindet, sobald der Pointer die Leiste betritt (der Geister-Marker übernimmt) oder ein Marker existiert.
- Nach dem **ersten** gesetzten Marker überhaupt gilt `coach.markerStrip = 'done'`; der Wert wird gespeichert.
- Dasselbe Muster gilt für `coach.monitorPointing` (§7.4) und `coach.altReference` („Alt+Klick auf einen Clip
  referenziert ihn“). Dieser Hinweis erscheint als einmaliger Toast nach dem dritten Klick in die Spuren ohne Alt.
- „Hinweise zurücksetzen“ in den Einstellungen löscht alle drei.

### 8.7 Store-Aktionen (`state/store.ts`)

```ts
addMarkerAt(frame: number): void          // clamp 0..durationFrames; insertRef({kind:'time', frame}) mit Dedupe (§9.3); Marker-Settle-Nonce
removeRefByKey(key: string): void         // entfernt alle Chips mit diesem Key (Marker-Entf, Kontextmenü)
removeComposerSegment(index: number, caret: number): void  // ersetzt das direkte setState im Editor
jumpToMarker(direction: -1 | 1): void     // [ / ]
revealRef(ref: Ref): void                 // §9.4
setHoveredRef(key: string | null): void   // Verknüpfungs-Hover in beide Richtungen
flashRef(key: string): void               // setzt { key, nonce } für 600 ms
```

Neue Felder in `StudioData`:
- `refNumbers: Record<string, number>`
- `hoveredRefKey: string | null`
- `flash: { key: string; nonce: number } | null`
- `lastMarkerKey: string | null` (für die Settle-Animation)

Alle Schreibzugriffe auf `composer` laufen über die interne Funktion `writeComposer(segments, caret, opts)`. Sie
berechnet `refNumbers` neu (§9.3) und erhöht `composerRevision`. Das betrifft `setComposer`, `insertRef`,
`insertSegments`, `removeComposerSegment`, `send` (`{}`) und `loadSnapshot` sowie `closeProject` (Rücksetzen).

### 8.8 Barrierefreiheit der Timeline

- Die Spurfläche ist `role="group"` mit `aria-roledescription="Timeline"` und
  `aria-label="Timeline, nur lesbar. Enter setzt Marker am Abspielkopf. Klammern springen zwischen Markern."`.
- Die Markerleiste ist `role="toolbar"` mit `aria-label="Marker"`.
- Jeder Marker ist ein `button` mit
  `aria-label="Marker 2 bei 00:00:24:00. Enter springt dorthin, Entf entfernt."` und `aria-keyshortcuts`.
- Ansagen über `announce`: „Marker 3 bei 00:47:15 gesetzt“, „Marker 2 entfernt“, „Marker 2 ist bereits gesetzt“.
- Der Geister-Marker ist `aria-hidden`.
- Die Trefferhöhe von 20 px (16 + 4) liegt unter 24 px. Sie ist nach WCAG 2.5.8 trotzdem zulässig, weil das Ziel eine
  durchgehende Fläche ist und es eine gleichwertige Tastaturfunktion gibt (Enter). Marker-Tags haben eine Trefferzone
  von 24 × 20.

---

## 9. Referenzen: Beschriftung, Format, Nummern, Verknüpfung

### 9.1 `lib/labels.ts`: `refChipParts()` statt Emoji

```ts
export interface ChipParts { icon: IconName | null; thumbAssetId?: string; text: string; mono?: boolean; secondary?: string }
export function refChipParts(ref: Ref, ctx: RefLabelContext): ChipParts
export function displayText(segments: ComposerSegment[], ctx: RefLabelContext): string  // Warteschlange, Ansagen; ohne Emoji
```

- `refChipLabel` und `refChipTitle` werden auf `refChipParts` umgestellt (Text ohne Emoji).
- `refLabel` aus Core wird im Renderer **nicht mehr** angezeigt (der Director bekommt weiterhin seine Darstellung aus
  Core).

### 9.2 Anzeigeformat für Zeit (`lib/timecode.ts`, neu)

```ts
export function tcParts(frame: number, fps: number, style: 'smpte' | 'short' | 'ruler'): { head: string; frames: string }
// smpte:  HH:MM:SS:FF          – Transport, Index-Readout
// short:  MM:SS:FF (HH: ab 1 h) – Chips, Marker-Labels, Chat-Links, Toaster, Aria
// ruler:  m:ss bzw. m:ss:ff wenn pps*1/fps >= 8 px
export function formatTc(frame: number, fps: number, style): string   // head + frames
```

- Die Frames (`:FF`) werden immer in `--text-3` bzw. mit 70 % Deckkraft dargestellt.
- Bei nicht ganzzahligem fps (29.97, 59.94) gilt Drop-Frame mit `;` vor den Frames.
- Das Core-Format `mm:ss.mmm` bleibt das Datenformat für den Director. Der Renderer konvertiert nur für die Anzeige.
- `.tc-link` im Chat parst `mm:ss.mmm` (bestehend über `parseTimecode`) und zeigt `formatTc(secondsToFrames(s, fps),
  fps, 'short')`.
- **Geld:** unverändert `formatUsd` aus Core (`$6.84`). Die Begründung steht in §16.

### 9.3 Nummernvergabe und Duplikate (`lib/refNumbers.ts`, neu)

```ts
export function refKey(ref: Ref): string        // 'time:372' | 'clip:c12' | 'marker:m3' | 'slide:s3' | 'element:<stableStringify>' | 'region:<…>' | 'page:<id>' | 'asset:<id>' …
export function isNumbered(ref: Ref): boolean   // alle außer 'asset' und 'version'
export function reconcileRefNumbers(prev: Record<string, number>, segments: readonly ComposerSegment[]): Record<string, number>
// 1) behalte prev[key] für alle noch vorhandenen nummerierten Keys
// 2) für neue Keys (in Reihenfolge des Auftretens) vergib die kleinste freie positive Ganzzahl
// 3) verwerfe Keys, die nicht mehr vorkommen
```

- **Duplikate:** `insertRef` prüft, ob der Key schon im Composer steht. Wenn ja, wird **nichts eingefügt**. Stattdessen
  gibt es `flashRef(key)` und die Ansage „Marker 2 ist bereits im Composer“ bzw. „Folie 3 ist bereits referenziert“.
  Das gilt auch für Assets.
- Ausnahme: Während einer Sprachaufnahme wird nicht geprüft, weil die Klicks an Wörter gebunden sind. Doppelte Keys
  teilen sich dann eine Nummer.
- Unit-Tests in `test/lib.test.tsx` decken ab:
  - Lücken werden wiederverwendet.
  - Die Nummer bleibt stabil, wenn Text umgestellt wird.
  - Gleiche Frames teilen sich eine Nummer.
  - Senden setzt zurück.

### 9.4 Verknüpfung in beide Richtungen

- **Hover:**
  - Chip → `setHoveredRef(key)` → auf der Bühne bzw. im Monitor bekommt das Element mit `data-ref-key === key` die
    Klasse `.is-linked`.
  - Umgekehrt setzt das Bühnen-Element den Key, und `ComposerEditor` schaltet per Effekt `.is-linked` an den passenden
    Chips (`querySelectorAll('[data-ref-key="…"]')`). Das gilt auch für statische Chips im Verlauf.
- **Klick auf einen Chip** (im Editor ohne das ×, im Verlauf, in der Warteschlange) → `revealRef(ref)`:
  - time und marker: Abspielkopf springen lassen
  - clip: zum Clip-Anfang springen und die Spur aktivieren
  - slide: `selectSlide`
  - page: `selectPage`
  - element und region: Folie bzw. Seite wählen und die Auswahl im Monitor blitzen lassen
  - asset: Asset-Leiste öffnen, die Karte in den sichtbaren Bereich scrollen und blitzen lassen
- Jeder Sprung wird angesagt.

---

## 10. Informationsarchitektur: Standards, Einklappen, gespeicherter Zustand

| Zustand | Standard | Gespeichert unter (`localStorage`, alle Zugriffe in try/catch) |
|---|---|---|
| Breite Assets, Breite Director | nach Breakpoint (§2.3) | `director-studio.layout.v2` → `{assetsW, chatW}` (`null` bedeutet Breakpoint-Standard). Der alte Schlüssel `director-studio.layout` wird ignoriert und gelöscht. |
| Bühnenhöhe | Inhaltshöhe je Kategorie | `layout.v2.stageH[category]` |
| Assets, Director, Bühne eingeklappt | aus (Ausnahme: Automatik unter 1200 px bzw. 760 px) | `layout.v2.{assetsCollapsed, chatCollapsed, stageCollapsed}` |
| Fokusmodus (`mod+0`) | aus | nicht gespeichert |
| Asset-Ansicht | `auto` (Raster ab 264 px, sonst Liste) | `director-studio.assets.view` |
| Asset-Gruppierung | `usage` | `director-studio.assets.groupBy` |
| Asset-Typ-Tab, Suche, Filter | Alle, leer, keine | nicht gespeichert (Sitzung) |
| Beat-Raster | an, wenn Beats existieren | `director-studio.timeline.beatGrid` |
| Timeline-Zoom | Einpassen | nicht gespeichert |
| Technische Details im Verlauf | aus | `director-studio.director.techDetails` |
| Zuletzt geöffnete Modalität im Picker | keine (Ebene 1) | nicht gespeichert |
| Hinweise (§8.6) | offen | `director-studio.coach` → `{markerStrip, monitorPointing, altReference}` |
| Theme | dunkel | `director-studio.theme` (bestehend) |
| Erhöhter Kontrast | System | `director-studio.contrast` (`system` / `more` / `normal`) |
| Dock kompakt nach „Später“ | – | nicht gespeichert; gilt bis zur nächsten neuen Entscheidung |

**Was standardmäßig eingeklappt ist (schrittweise Offenlegung):**
- Werkzeuggruppen
- die Gruppe „Verworfen“ in den Assets
- die Aufschlüsselung im Dock
- Asset-Filter (hinter dem Filter-Knopf)
- die Modellwahl (Zusammenfassung → Popover)
- die Budget-Aufschlüsselung (Popover)
- Versionen (Popover)
- Format und Safe Areas bei schmalem Monitor (⋯)
- Labels erledigter und offener Stepper-Schritte bei Platzmangel

Erreichbar bleibt alles: Versionen ansehen, vergleichen und wiederherstellen · Export je Ziel und Format · Formate ·
Safe Areas · Viewports · Element- und Region-Modus · Push-to-Talk · Einreihen und Jetzt senden · Stopp · alle 9
Modalitäten mit Preis · Denktiefe · Katalog aktualisieren · Import und Verknüpfen · Filter, Sortierung, Gruppierung ·
Detailansicht mit Lineage und Neu-Zuordnen · Rückfrage mit Freitext · Checkpoint mit editierbarem Budget und Feedback ·
Genehmigungen · Budget-Aufschlüsselung · Theme · Kontrast · Einstellungen.

---

## 11. Zustände (gilt für alle Bedienelemente)

| Zustand | Ghost / Icon | secondary | primary (Tungsten) | Chip | Asset-Karte, Thumb, Clip |
|---|---|---|---|---|---|
| Ruhe | transparent, Icon `--text-2` | `--raised`, 1 px `--line-2`, Text `--text` | `--accent`, `--on-accent`, 600 | `--ref-soft` mit Ring `--ref-line` | – |
| Hover | `--hover`, Icon `--text` | `--hover` | `--accent-hi` | × deckend | Hintergrund `--hover`, Aktion sichtbar |
| Gedrückt | `--active` | `--active` | `--accent` mit `filter: brightness(.94)` | – | – |
| Fokus (`:focus-visible`) | 2 px `--focus`, Abstand 2 px | gleich | gleich | gleich | gleich |
| An (Toggle/Segment) | `--hover` und Text `--text`; Segment: `--active` (dunkel) bzw. `--raised` mit Rand (hell) | – | – | – | – |
| Deaktiviert | Deckkraft .45, kein Hover, `cursor: default`, `aria-disabled` bzw. `disabled` | gleich | gleich, **ohne** Tungsten: es wird zu secondary | – | – |
| Lädt | Spinner 12 px `--text-2` statt Icon; das Label bleibt; `aria-busy` | gleich | Spinner `--on-accent` | – | Statischer Platzhalter `--raised` (ohne Schimmer) |
| Fehler | – | Rand `--danger` 40 %, Text `--danger` (z. B. Stopp) | – | – | Ring `--danger`, Hinweistext |
| Verknüpft/referenziert | – | – | – | `.is-linked`: Ring 1,5 `--ref` | Ring 1,5 `--ref` plus Nummer |
| Ausgewählt | – | – | – | – | Ring 1,5 `--text` |

**Leerzustände (gleiches Muster):** Icon 20 `--text-3` · Titel 13/600 `--text-2` · ein Satz 12 `--text-3` · höchstens
eine Aktion (secondary). Linksbündig in einer Spalte, die auf 360 px begrenzt und im Bereich zentriert ist (nicht der
ganze Bildschirm zentriert).
- Monitor: „Noch nichts zu sehen“ / „Der Director legt das erste Material in die Timeline.“
- Assets: „Noch keine Assets“ / „Der Director legt hier alles ab, was er erzeugt. Eigene Dateien: hierher ziehen.“
- Timeline: „Leere Timeline“
- Director: §7.6.2
- Suche ohne Treffer: „Keine Treffer für „xyz““ und *Filter zurücksetzen*

**Fehler:**
- Toast, der bleibt (§7.11).
- Fehlerkarte im Verlauf (§7.6.2).
- Fehler der Monitor-Vorschau im Leerstil mit `--danger`-Icon und *Neu laden*.
- Felder: Rand `--danger` und eine Zeile in 11.5 `--danger` darunter (`aria-describedby`, `aria-invalid`).

---

## 12. Bewegung: Zusammenfassung

Siehe §5. Pflicht: Alle Übergänge verwenden die Tokens, und es gibt keine Werte außerhalb der Skala.
Ein- und Ausklappen läuft über `transition: grid-template-columns var(--t-slow) var(--ease)` auf `.workspace` bzw.
`.ws-center`. Bei `prefers-reduced-motion` gilt 1 ms.

---

## 13. Barrierefreiheit

1. **Kontrast:** §3.2. Dazu der Modus für erhöhten Kontrast (System und Einstellung).
2. **Farbe nie allein:** Marker tragen Nummern, Chips Icon und Label, der Status steht immer auch als Text, Spuren haben
   IDs, der Verwendungsort ist Text, und das Budget steht als Betrag neben dem Meter.
3. **Fokus:** `--focus`, 2 px, Abstand 2 px, nur bei `:focus-visible`. Der Monitor (`.always-dark`) bekommt automatisch
   den hellen Ring.
4. **Tastatur:**
   - Die Tab-Reihenfolge folgt der Leserichtung: Kopfzeile → Assets → Monitor → Director → Composer → Bühne.
   - `F6` springt zwischen Regionen.
   - Globale Kürzel:

     | Kürzel | Wirkung |
     |---|---|
     | `mod+1` | Assets ein/aus |
     | `mod+2` | Director ein/aus |
     | `mod+3` | Bühne ein/aus |
     | `mod+0` | Fokusmodus |
     | `mod+M` | Modelle |
     | `mod+K` | Asset-Suche fokussieren |
     | `mod+Enter` | Senden |
     | `mod+N` / `mod+O` | Neues Projekt / Projekt öffnen (Start) |
     | `?` | Kürzel-Übersicht (Dialog mit Kbd) |

   - Dazu die Timeline-Kürzel aus §8.5.
   - Popover und Listen verwenden `aria-activedescendant`; Dialoge halten den Fokus.
5. **Screenreader:**
   - Der Verlauf ist `role="log"` (polite), Streaming-Nachrichten haben `aria-busy`.
   - Dock, Jobs und Toasts sind `role="status"`; Fehler sind `role="alert"`.
   - Der Stepper ist eine `<ol>` mit `aria-current`.
   - Marker sind Buttons mit Zeit und Aktionen (§8.8).
   - Die bestehende `announce`-Region bleibt.
6. **Zielgrößen:** mindestens 24 × 24 (WCAG 2.2 AA); die Ausnahme der Markerleiste ist in §8.8 begründet.
7. **Bewegung:** §5. Keine automatischen Animationen außer dem Live-Punkt; bei `reduced-motion` ist er statisch.
8. **Sprache:** `lang="de"` (bestehend). Typografische Anführungszeichen „…“. Das geschützte Leerzeichen U+00A0 steht
   zwischen Zahl und Einheit („8 s“, „48 kHz“).

---

## 14. i18n: neue und geänderte Schlüssel

Jeweils de und en pflegen. Die deutsche Fassung ist verbindlich:

| Schlüssel | Deutsch |
|---|---|
| `assets.label` | „Asset-Browser“ (bleibt) |
| `assets.title` | „Assets“ |
| `assets.dropFooter` | „Dateien hierher ziehen – sie werden verknüpft, nicht hochgeladen.“ |
| `assets.dropRelease` | „Loslassen zum Verknüpfen“ |
| `assets.filter` | „Filter“ |
| `assets.view.grid` / `.list` | „Raster“ / „Liste“ |
| `assets.group.usage` / `.kind` / `.none` | „Verwendung“ / „Typ“ / „Keine“ |
| `assets.group.inComposer` / `.used` / `.unused` / `.rejected` | „Im Composer“ / „In Verwendung“ / „Ungenutzt“ / „Verworfen“ |
| `assets.toComposer` | „In den Composer“ |
| `assets.missingRelink` | „Datei fehlt · Neu zuordnen“ |
| `layout.hideAssets` / `.hideDirector` / `.hideStage` / `.focusMode` | „Assets ausblenden“ / „Director ausblenden“ / „Bühne ausblenden“ / „Monitor maximieren“ |
| `stage.markers` | „Marker“ |
| `stage.markerStripCoach` | „Klick hier setzt einen Marker · Enter setzt einen am Abspielkopf“ |
| `stage.markerAria` | „Marker {n} bei {time}. Enter springt dorthin, Entf entfernt.“ |
| `stage.markerSet` / `.markerRemoved` / `.markerExists` / `.noMoreMarkers` | „Marker {n} bei {time} gesetzt“ / „Marker {n} entfernt“ / „Marker {n} ist bereits gesetzt“ / „Kein weiterer Marker“ |
| `stage.prevMarker` / `.nextMarker` | „Vorheriger Marker“ / „Nächster Marker“ |
| `stage.sectionAria` | „Abschnitt {label} bei {time}. Alt+Klick referenziert.“ |
| `stage.legend.time` / `.sections` | „Zeit“ / „Abschnitte“ |
| `stage.beatGrid` | „Beat-Raster“ |
| `stage.ariaTimeline` | „Timeline, nur lesbar. Enter setzt Marker am Abspielkopf. Klammern springen zwischen Markern.“ |
| `stage.hint` | **entfällt** |
| `composer.placeholder` | „Antworten oder neue Anweisung … Zeige auf Bühne oder Monitor, um Stellen zu referenzieren.“ |
| `composer.marker` / `.slide` / `.page` | „Marker“ / „Folie“ / „Seite“ |
| `composer.markerTip` | „Marker am Abspielkopf · Enter (außerhalb von Textfeldern) · ⌥Enter hier“; unter Windows „Alt+Enter“ über `formatShortcut` |
| `composer.queueTip` | „Wird nach dem aktuellen Lauf gesendet“ |
| `composer.hint` | **entfällt** (steht in den Tooltips) |
| `picker.summaryBound` | „Modelle · {count} gebunden“ |
| `picker.autoCount` | „+{count} Auto“ |
| `picker.heading` | „Modelle für dieses Projekt“ |
| `picker.back` | „Zurück“ |
| `picker.footnote` | „Gebundene Modelle sind verbindlich. Bei Auto wählt der Director und begründet die Wahl.“ |
| `director.status.waiting` | „wartet auf dich“ |
| `director.techDetails` | „Technische Details anzeigen“ |
| `director.steps` | „{count} Schritte“ |
| `director.newest` | „Neueste“ |
| `dock.pending` | „{n} von {total} offenen Entscheidungen“ |
| `dock.compact.checkpoint` | „Checkpoint {n} wartet auf Freigabe“ |
| `dock.compact.approval` | „Genehmigung wartet“ |
| `dock.compact.question` | „Rückfrage wartet“ |
| `dock.review` | „Prüfen“ |
| `dock.later` | „Später“ |
| `dock.breakdown` | „Aufschlüsselung“ |
| `dock.pinnedNote` | „{title} vorgelegt · unten angeheftet“ |
| `tool.<name>` | Klartext je Werkzeug, siehe §7.6.2 |
| `jobs.label` | „Generierungen“ |
| `jobs.more` | „+{count}“ |
| `settings.contrast` | „Erhöhter Kontrast“ |
| `settings.resetHints` | „Hinweise zurücksetzen“ |
| `settings.techDetails` | „Technische Details im Verlauf“ |
| `shortcuts.title` | „Tastenkürzel“ |

---

## 15. Test-Vertrag (Hooks bleiben, oder der Test wird im selben Commit angepasst)

**Bleiben unverändert:**
- `data-testid`: `timeline`, `composer-editor`, `stage-planning`
- `[data-lane-track]`, `[data-asset-id]`, `.version-row[data-version]`, `.step-approved`, `.badge-category`
- `.chip`, `.chip-time`, `.chip-slide`, `.msg-user`, `.msg-director`
- Rollen und Namen:
  - complementary „Director“
  - region „Asset-Browser“
  - region „Bühne (nur lesbar)“
  - button „Senden“ (exact)
  - form „Rückfrage“
  - article /Checkpoint zur Freigabe: …/
  - Label „Beantragtes Budget (USD)“
  - button „Freigeben (Budget $…)“
  - button „Versionen: v4“
  - button „Projekte“
  - heading „Zuletzt geöffnet“
  - die Dialog-Rollen

**Anpassen:**
- `test/timeline.test.tsx`:
  - Die Spannen-Tests (Ziehen in V1 und im Lineal) werden **ersetzt** durch: Klick in die Markerleiste erzeugt
    `{kind:'time', frame}`; Klick in einer Spur setzt nur den Abspielkopf; Ziehen in einer Spur erzeugt keinen Chip.
  - „Marker Refrain 1 bei …“: Klick springt; Alt+Klick erzeugt den `marker`-Ref.
  - `Alt+Enter` (Clip) wird zu `Umschalt+Enter`; `Alt+Enter` setzt jetzt einen Marker.
- `test/picker.test.tsx`: rendert `ModelPickerPanel`. Nach der Auswahl kehrt die Liste zu Ebene 1 zurück, das Popover
  bleibt offen.
- `test/composer.test.tsx` und `voice.test.tsx`: Erwartungen an Chip-Texte ohne Emoji. Duplikatschutz.
  `removeComposerSegment`.
- `test/director.test.tsx`: Karten erscheinen im Dock, nicht im Verlauf. Kein `director-footer`/`budget-details`. Stopp
  steht nicht im Composer.
- `test/assets.test.tsx`: Status-Selects liegen im Filter-Popover (vorher öffnen); Typ-Tabs statt
  `filter-chip`-Toggles.
- e2e `studio.spec.ts`: Seiten-Referenz per Klick auf die Karte; Screenshot-Pfade bleiben.
- **Neu:** `test/markers.test.tsx` deckt ab:
  - Nummern (kleinste freie)
  - Chip entfernen entfernt den Marker
  - Klick auf einen Marker setzt den Abspielkopf
  - Enter am Abspielkopf
  - `[`/`]`
  - Duplikat am selben Frame
  - Entf auf einem fokussierten Marker
  - Hover-Verknüpfung (Klasse `.is-linked`)
- **Neu:** `test/layout.test.tsx` deckt ab: Breakpoint-Standards, Einklappen, Gespeichertes wird gelesen und
  geschrieben, `mod+1/2/3/0`.

---

## 16. Geprüfte, aber nicht übernommene Ideen (mit Grund)

| Idee | Entscheidung |
|---|---|
| Geld im deutschen Format „8,40 $“ (B) | **Zurückgestellt.** `formatUsd` aus Core wird von Budget-Gate, Director-Prompts, Modellpreisen und Tests gemeinsam genutzt. Ein abweichendes UI-Format würde Chat (Director schreibt `$6.00`) und UI uneinheitlich machen. Als Folgeaufgabe gehört es in Core: ein Locale-Formatter für alle Ausgaben. |
| Kostenschätzung neben Senden „ca. $0,90“ (C) | **Abgelehnt.** Vor der Planung des Directors gibt es keine ehrliche Schätzung. Die Kosten erscheinen dort, wo sie feststehen: Job-Zeile (≈ je Job), Dock (beantragtes Budget), Genehmigung. Eine erfundene Zahl schadet dem Vertrauen ins Budget. |
| Serifenstimme für den Director und Serifentitel (B) | **Abgelehnt.** Zwei Schriftfamilien, die Nähe zur verbotenen Editorial-Optik und mehr Gewicht durch die Schriftdateien. |
| Mute/Solo in den Spurköpfen, LUFS-Meter, Clip-Zähler (C) | **Abgelehnt.** Es gibt keinen Abhör-Mixer im nur lesenden Player, also wäre die Funktion vorgetäuscht. Außerdem gegen die Kritik „zu voll“. |
| QA-Checkliste in der Web-Index-Spalte (C) | **Zurückgestellt.** Das Site-Schema enthält keine QA-Daten. Sie wird erst gezeigt, wenn Daten da sind. |
| Asset-Gruppierung nach Szene, Charakter oder Batch (A) | **Zurückgestellt.** Dafür gibt es keine Felder. Angeboten werden Verwendung, Typ und Keine. |
| Zoom-Schieberegler in der Timeline (A) | **Entfernt.** − / Einpassen / + und `mod+Mausrad` reichen. |
| Marker ziehen bzw. verschieben | **Nicht in v1.** Vorgabe ist „keine Spannen per Ziehen“; Marker bleiben einfach und eindeutig. |
| Dauerhafte, abschaltbare Hinweis-Statuszeile unter der Timeline (C) | **Ersetzt** durch den einmaligen Hinweis in der Leiste (§8.6). Er kostet keine Zeile. |
| Getrennter Denktiefe-Schalter in der Composer-Leiste (B) | **Abgelehnt.** Die Denktiefe steht in der Director-Zeile des Popovers und in der Zusammenfassung („Opus 5.5 · sehr hoch“). |
| Gleichförmige Module mit 4-px-Fugen auf schwarzem Chassis (C) | **Abgelehnt.** Die Hierarchie entsteht über Luminanz, nicht über Kästen. |

---

## 17. Priorisierte Umsetzungs-Checkliste

Jeder Punkt gilt erst als erledigt, wenn `npm test` für desktop und core grün ist, `tsc` keine Fehler meldet und die
genannten Abnahmekriterien erfüllt sind. Die Reihenfolge ist verbindlich, weil spätere Punkte auf früheren aufbauen.

### P0: Fundament
1. **Fonts:**
   - Dateien aus `apps/desktop/src/renderer/assets/fonts/` nach `src/renderer/assets/fonts/` kopieren.
   - `@font-face` anlegen (§4.2), das Vorladen in `main.tsx` ergänzen und die Lizenzdateien ins Paket aufnehmen.
   - *Abnahme:* Ein Build ohne Netzwerk zeigt Instrument Sans und Plex Mono; Prüfung in den DevTools unter
     „Rendered Fonts“.
2. **Tokens:**
   - Abschnitt 1 von `app.css` durch §3.1 und §3.3 ersetzen, die alten Token-Namen vollständig migrieren (`--bg*`,
     `--border*`, `--text-muted`, `--accent-bg` …), `prefers-contrast` übernehmen.
   - `lib/theme.ts` löst `system` in JS auf und setzt `data-contrast`.
   - *Abnahme:* Ein `grep` findet keine alten Tokens mehr. Hell, dunkel und System schalten live um.
3. **Layout-Raster:**
   - `Workspace.tsx` nach §2.2, `lib/layout.ts` (Breakpoints, Grenzen, Speichern nach §10).
   - `Splitter.tsx` mit Overlay-Positionierung, Doppelklick zum Zurücksetzen, Einklappen per Ziehen und `onReset`.
   - Schienen zum Einklappen sowie `mod+0/1/2/3`.
   - `ModelPickerBar` aus dem Layout entfernen.
   - *Abnahme:* Screenshots bei 1280×800, 1440×900 und 1920×1080 zeigen die Struktur aus §2.1. Die Monitorbilder
     erreichen mindestens die Werte aus §2.4 (±4 %). Es gibt keine horizontale Scrollleiste. Das L ist sichtbar: die
     14-px-Ecke und keine Linie zwischen Director und Composer.
4. **Basis-Controls** in `app.css`: `.btn` (ghost, secondary, primary, danger; Größen sm, md, lg), `.ibtn`, `.seg`,
   `.toggle`, `.field`, `.badge`, `.chip`, `.kbd`, `.spin`, `.live`, Fokus, Scrollbars. Neu: `Kbd.tsx`, `Tooltip.tsx`.
   *Abnahme:* Die Zustandsmatrix aus §11 lässt sich in einer Story bzw. im Fake-Modus prüfen.

### P1: Kerninteraktion
5. **Referenz-Infrastruktur:**
   - `lib/refNumbers.ts`, `lib/timecode.ts`, `refChipParts` und `displayText` in `labels.ts`.
   - Store: `writeComposer`, `refNumbers`, Duplikatschutz, `removeComposerSegment`, `revealRef`, `setHoveredRef`,
     `flashRef`.
   - `ComposerEditor` ohne direktes `setState`.
   - *Abnahme:* Unit-Tests aus §9.3 grün; keine Emoji in der UI (Test: Chip-Texte ohne Codepoints > U+1F000 und ohne
     ⏱).
6. **Timeline-Markerleiste:**
   - `MarkerStrip.tsx`, `TimelineIndex.tsx`; Umbau von `TimelineStage.tsx` (Spannen entfernen, Zonen und Gesten nach
     §8.4, Tastatur nach §8.5, Clip-Stile nach §7.9, Abschnittszeile mit Alt+Klick).
   - *Abnahme:* Alle Punkte von `test/markers.test.tsx`. Ein manueller Durchlauf während der Wiedergabe: Marker setzen,
     ohne dass der Abspielkopf springt; Enter am Abspielkopf; Chip × entfernt den Marker; Klick auf einen Marker springt
     ohne Animation.
7. **Composer-Verschmelzung:**
   - Textzone ohne Box, Werkzeugleiste, Positionsknopf, Senden-Zustände nach §7.7.1, Aufnahmezeile, Warteschlange.
   - Stopp entfernen.
   - *Abnahme:* Bei leerem Composer gibt es kein Tungsten im Composer. Arbeitet der Director, heißt der Knopf
     „Einreihen“ und ist secondary.
8. **Modellwahl:**
   - `ModelPicker.tsx` (Zusammenfassung plus Panel mit zwei Ebenen an derselben Stelle, 400 px, `mod+M`).
   - `picker.test.tsx` anpassen.
   - *Abnahme:* Das Popover verdeckt maximal 400 px des Monitors; alle neun Modalitäten, die Preise, die Denktiefe und
     Aktualisieren sind erreichbar.

### P2: Director, Assets, Kopfzeile, Monitor
9. **DecisionDock und JobTray:**
   - Karten kompakt, Dock-Logik inklusive Kompaktmodus und Sheet, Systemzeilen im Verlauf, Klartext-Werkzeugschritte
     mit Schalter für technische Details, Tungsten-Regel.
   - `director-footer` entfernen.
   - *Abnahme:* Bei 1280×800 mit offenem Checkpoint ist die Dock-Zeile sichtbar, ohne zu scrollen. Ein Tungsten-Zähler
     (Dev-Overlay oder Test) findet höchstens drei Elemente.
10. **Asset-Leiste:** §7.3 komplett, mit `assetUsage`, Detail-Overlay und Drag-Overlay. *Abnahme:* Bei 240 px keine
    abgeschnittenen Titel (Liste); bei 272 px zwei Spalten; Filter erreichbar; `data-asset-id` vorhanden.
11. **Kopfzeile:** Zonenraster, Stepper-Einklappstufen, Budget-Popover, Einklappreihenfolge rechts. *Abnahme:* Bei
    1280 px läuft nichts über, und das aktuelle Stepper-Label ist immer sichtbar.
12. **Monitor-Transport:** Transport unter dem Bild, Meta im Transport, Marker-Sprungknöpfe, Leisten für Folien, Leinwand
    und Web mit Modus-Segmenten, Auswahl-Tags mit Nummern (`PointerOverlay`), Versions-Banner im Monitor. *Abnahme:*
    Auswahlrahmen auf einem weißen und einem schwarzen Testbild sind sichtbar (Halo).
13. **Andere Bühnen:** Index-Spalten, Folien- und Seitenkarten nach §7.10, inhaltsbasierte Bühnenhöhe.

### P3: Feinschliff
14. Startbildschirm nach §7.12, inklusive optionaler `RecentProject`-Felder in Main bzw. Project. Ohne Daten erscheint
    die ruhige Kategorie-Kachel.
15. Einstellungen: Kontrast, Hinweise zurücksetzen, technische Details. Kürzel-Übersicht mit `?`.
16. Bewegung: Settle-Animation, Blitz, Atmen, `reduced-motion`-Prüfung.
17. **Visuelle Abnahme:**
    - Playwright-Screenshots `e2e/test-results/` neu erzeugen: Video, Audio, Deck, Canvas, Web, Start, jeweils hell und
      dunkel, bei 1280×800, 1440×900 und 1920×1080.
    - Vergleich mit `docs/director-studio/design/final-shots/` und der Korrekturliste in §1.
    - Prüfskript für den Kontrast (`docs/director-studio/design/contrast.py`) gegen die endgültigen Token-Werte laufen lassen.

---

## 18. Referenzbilder (`docs/director-studio/design/final-shots/`)

| Datei | Zeigt | Achtung, abweichend von dieser Spezifikation |
|---|---|---|
| `01-workspace-video-1440.png` | Hauptlayout, L-Fusion, Filmstreifen, nummerierte Marker und Chips | Composer noch als Box; Tungsten-TC, Stepper-Kreis und Pill; Hinweisprosa im Timeline-Kopf; Tooltip über dem Lineal; graue Pillen für V2/T1 |
| `02-workspace-video-1920.png` | Wirkung bei 1920 | wie oben |
| `03-workspace-video-1280.png` | Einklappverhalten bei 1280 | Asset-Titel abgeschnitten (jetzt Liste); Monitor noch kleiner als nach §2.4 |
| `04-workspace-video-light.png` | Helles Theme mit dunklem Monitor | Basisfläche jetzt etwas dunkler (`#E3E2DE`) |
| `05-workspace-slides-model-popover.png` | Inhalt des Modell-Popovers (Ebenen 1 und 2) | Ebene 2 jetzt **an derselben Stelle** statt daneben, Breite höchstens 400 px |
| `06-workspace-web.png` | Web-Kategorie, Seitenkarten | QA-Zeilen nur mit Daten |
| `07-director-panel-detail.png` | Kartentypen, Fehler, Toast, Budget-Popover | Karten erscheinen jetzt im Dock; Radio und Pill neutral statt Tungsten; Werkzeugschritte im Klartext |
| `08-start.png` | Startbildschirm | Feature und Karten nur mit echten Daten (§7.12) |
