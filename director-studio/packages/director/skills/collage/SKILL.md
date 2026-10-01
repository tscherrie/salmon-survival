---
name: collage
description: Grafikdesign und Collagen im Canvas-Dokument – Konzept/Moodboard, Freisteller, Ebenen mit Mischmodi und Effekten (Papier, Korn, Riss), Typo, Druck-Export.
---

# Grafik & Collage (Canvas-Dokument)

## Ablauf

1. Konzept + Moodboard (Checkpoint): Thema, Ton, Referenzen; 6–9 Moodboard-Bilder generieren oder aus
   Uploads; Palette und Typo festlegen.
2. 2–3 Layout-Entwürfe (Checkpoint „Layout-Entwürfe“) als Varianten des Canvas – jeweils `render_still`
   (target "document").
3. Ausarbeitung des gewählten Entwurfs, dann Export (PNG/JPG/WebP, PDF für Druck mit Beschnitt).

## Material bauen

- Freisteller: Bild generieren → Werkzeug-Modell (Matting/Segmentierung) → Masken-Asset; Ebene mit
  `maskAssetId`.
- Papier-/Scan-Looks: Effekte `paper`, `grain`, `tear`, `shadow`, `halftone` auf Ebenen; leichte
  Rotation (±1–4°) und Versatz für Handgemachtes.
- Mischmodi (`blend`: multiply für Druckfarben, screen für Licht) sparsam und begründet.

## Komposition

- Klare Hierarchie: ein dominantes Element, ein sekundäres, Rest Textur.
- Dichte bewusst steuern: Collagen leben von Kontrast zwischen vollen und leeren Zonen.
- Typo als Bildelement: groß, angeschnitten, mit Material (ausgeschnitten, gestempelt) – Lesbarkeit der
  Kernbotschaft behalten.

## Druck

Größe in mm + `dpi` 300, `bleed` 3 mm; Text ≥ 3 mm vom Rand; Bilder in ausreichender Auflösung
(Upscale-Werkzeug). Rechte an Fremdmaterial klären oder generierte Äquivalente nutzen.
