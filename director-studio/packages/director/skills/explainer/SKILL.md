---
name: explainer
description: Erklärvideo / Motion Graphics – Kernbotschaft, Skript zuerst, Voice-over, Diagramme und Typo als Code-Komponenten, Timing auf Sprache.
---

# Explainer & Motion Graphics

## Reihenfolge

1. **Kernbotschaft** in einem Satz; Zielgruppe und Vorwissen klären (ask_user).
2. **Skript zuerst** (Text-Asset): 130–150 Wörter/Minute Sprechtempo. Ein Gedanke pro Satz; konkrete
   Beispiele statt Abstraktion.
3. **Voice-over** generieren (`voice-and-music`), `transcribe` → Wortzeiten. Das VO ist die Uhr.
4. **Visuelle Sprache:** wenige Formen, klares Raster, 2–3 Farben + Akzent, eine Schriftfamilie.
   Bewegung erklärt (zeigt Ursache → Wirkung), nicht dekoriert.
5. **Szenen als Code-Komponenten** (`write_component`): Diagramme, Zahlen, Icons, Pfeile, Text – exakt,
   scharf, billig zu ändern. Generierte Videos/Bilder nur für Atmosphäre oder reale Objekte.

## Timing

- Visuelles Ereignis auf das Schlüsselwort des VO legen (Wortzeiten → props der Komponente).
- Halte Zustände lange genug zum Lesen (Faustregel: Lesezeit ≈ Wörter / 3 Sekunden + 0.5 s).
- Übergänge motiviert: Objekt aus Szene A wird zu Element von Szene B (Match Cut in Code).

## Diagramme

Zahlen aus der Quelle des Nutzers; keine erfundenen Daten. Achsen beschriften, Einheiten nennen,
Animation baut Daten in der Lesereihenfolge auf.

## Prüfen

render_still an jedem Szenenwechsel und Schlüsselwort; Untertitel aus Wortzeiten; Lautheit VO-Ziel
(z. B. −16 LUFS für sprachlastig) – siehe `sound-mix-loudness`.
