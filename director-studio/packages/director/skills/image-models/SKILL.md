---
name: image-models
description: Bildmodelle wählen und prompten – Style-Bible-Frames, Charakterblätter, Edits, Typo-taugliche Bilder, Vektor/Brand, Upscale; Kosten und Konsistenz.
---

# Bildmodelle (fal)

Bilder sind das billigste Werkzeug im Studio: Style testen, Charaktere festlegen, Storyboard und
Startbilder für Video. Iteriere hier, bevor du Video bezahlst.

## Modell wählen (mit search_models verifizieren – Katalog ändert sich)

Suche nach Fähigkeit, nicht nach Namen:
- **Referenzbasiertes Editieren / Konsistenz** (mehrere Referenzbilder, „keep the character“):
  `search_models({modality:"image", text:"edit reference"})` – Kandidaten sind z. B. Gemini-Image-
  („nano-banana“-Familie), FLUX-Kontext-Varianten, Seedream-Edit. Für Charakterblätter und
  Variationen derselben Figur.
- **Typografie im Bild** (Poster, Mockup mit echtem Text): Modelle mit starker Textwiedergabe (z. B.
  Ideogram-Familie). Für Videos trotzdem Text als Komponente setzen.
- **Vektor / Brand / Icons:** Vektor-fähige Modelle (z. B. Recraft-Familie) → SVG/klare Flächen.
- **Fotoreal / Produkt:** aktuelle Flagship-Text-zu-Bild-Modelle; Schema auf Seitenverhältnis,
  Auflösung und Seed prüfen.
- **Werkzeuge (Picker „Werkzeuge“):** Upscale, Hintergrund entfernen (Matting), Segmentierung,
  Outpainting (z. B. für 4:5 aus 3:4), Vektorisierung.

Steht der Bild-Picker auf einem Modell, nutze genau dieses (Edits mit einem anderen Modell sind dann
nur erlaubt, wenn sie zur selben Familie gehören).

## Prompt-Bausteine

1. Bildtyp: „character sheet, front / three-quarter / side view, neutral pose, plain background“ oder
   „storyboard frame, 16:9, …“.
2. Subjekt mit festen Merkmalen (Gesicht, Frisur, Kleidung, Farben) – exakt gleich wiederverwenden.
3. Komposition: Einstellungsgröße, Position im Bild, Freiraum für Text, Blickrichtung.
4. Licht und Farbe aus der Style Bible (Palette als Worte, nicht als Hex-Liste).
5. Material/Medium: „risograph print, two-color, visible paper grain“ statt „beautiful illustration“.

## Style-Bible-Workflow

1. 3–4 Stilrichtungen als je 2 günstige Testbilder (gleiches Motiv!) → Kontaktabzug für den Nutzer.
2. Gewählte Richtung → Stilblatt (Palette, Textur, Licht), Charakterblätter (3 Ansichten + Ausdruck),
   Set-Plates. Alles als Assets mit Tags `style-bible`, `character`, `<name>`.
3. Jede spätere Generierung bekommt diese Assets als Referenz (`"asset:<id>"`).

## Qualität prüfen (get_asset)

Anatomie (Hände, Augen, Zähne), Identität gegenüber Charakterblatt, Palette, Artefakte an Kanten,
Textfehler, ungewollte Wasserzeichen. Fehlschläge mit `reject_asset` und Grund markieren.

## Kosten

Bilder kosten meist Cent-Beträge je Bild oder je Megapixel. Erst 1–2 Varianten, dann Batch. Für
Storyboards niedrige Auflösung; nur Style-Bible-Referenzen und Finals hoch.
