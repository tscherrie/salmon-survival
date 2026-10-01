---
name: slides
description: Präsentationen im Deck-Dokument – Storyline, Theme, Folienlayouts als Elemente (1920×1080), Lesbarkeit, Diagramme, Sprechernotizen, Export PDF/PPTX.
---

# Slides (Deck-Dokument)

## Storyline zuerst (Checkpoint „Storyline & Gliederung“)

- Ziel der Präsentation und gewünschte Entscheidung/Handlung des Publikums.
- Gliederung als Folientitel, die zusammen gelesen die Geschichte erzählen (Aktionstitel: „Kosten
  sinken 30 % durch …“ statt „Kosten“). 1 Kernaussage pro Folie.

## Theme (Checkpoint „Theme & Beispielfolien“)

`apply_document_ops` mit `update_theme`: Farben (bg, fg, accent, muted), Fonts (heading/body), ggf.
`css`. Eigene Schriften als Font-Assets über `fontAssets` (Familie → Asset-ID) einbetten – die Vorschau
hat kein externes Netz, Google Fonts laden dort nicht. Dann 3 Beispielfolien (Titel, Inhalt, Daten) mit
`add_slide` und `render_still` (target "document", slideId) zeigen.

## Layout-Regeln (1920×1080 Raster)

- Ränder ≥ 96 px; 12-Spalten-Raster (Spalte ~120 px, Abstand 24 px).
- Titel 56–72 px, Fließtext ≥ 28 px, Fußnoten ≥ 20 px. Max. ~40 Wörter Fließtext je Folie.
- Elemente: `text` (Markdown-light), `image` (assetId), `shape`, `chart` (Daten des Nutzers!),
  `html` (für Sonderfälle), `video`. Jedes Element mit sprechender `id` (z. B. `s3_title`) – der Nutzer
  referenziert sie.
- Textrollen über `style.role` (title|subtitle|body|caption|kicker|quote|stat) statt Einzelwerten – Größe,
  Schrift und Farbe kommen dann aus dem Theme.
- Deutsche Texte bekommen automatisch Trennstellen (lange Komposita brechen an Silbengrenzen);
  `style.hyphens: "none"` oder `"manual"` schaltet das je Element ab (z. B. für Markennamen).
- Bilder für Folien mit dem Bildmodell im Theme-Stil generieren (Seitenverhältnis passend zum Platz).
- `build` für schrittweises Einblenden in der Präsentation, sparsam.

## Notizen & Export

Sprechernotizen (`notes`) mit dem gesprochenen Text je Folie. Vor dem Export jede Folie per
`render_still` prüfen (Überläufe, Kontrast, Ausrichtung); dann `export_project` ("pdf" bzw. "pptx").
