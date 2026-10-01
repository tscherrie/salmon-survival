---
name: rotoscope-overlay
description: Über generiertes Footage zeichnen – Masken, Pose, Tiefe, Konturen extrahieren, als Daten-Assets speichern und mit einer seeded Remotion-Komponente im eigenen Stil rendern.
---

# Rotoscope-Overlay

Generiertes Video ist Fundament, nicht unbedingt das Endbild: Bewegung extrahieren, eigenen Look zeichnen.

## Pipeline

1. **Basis-Shot** generieren (Bewegung und Timing zählen, Look egal) – klare Silhouette, ruhiger
   Hintergrund erleichtert Extraktion.
2. **Extraktion über fal-Werkzeuge** (Picker „Werkzeuge“, `search_models({modality:"tools", text:…})`):
   - Segmentierung/Matting → Maskenvideo oder Maske je Frame
   - Pose → Keypoints je Frame (JSON)
   - Tiefe → Tiefenvideo
   - Konturen/Linien → Linien-Video oder aus Masken lokal vereinfachte Polygone
   Ergebnisse als Assets mit Lineage `extracted` zum Basis-Shot.
3. **Daten vereinfachen:** Polygone/Keypoints je Frame als JSON-Daten-Asset (subtype `rotoscope`):
   `{ fps, width, height, frames: [{ t, polygons: [[x,y]…], keypoints: {...} }] }` in normierten
   Koordinaten (0..1). Auf 2er-Frames reduzieren („on twos“) spart Daten und wirkt handgemacht.
4. **Komponente** (`write_component`): liest das Daten-Asset über `props.rotoscope` (Asset-ID) aus
   `assets`, zeichnet SVG/Canvas im Stil (Tusche, Papier, Kreide), „Boil“: Linien leicht variieren mit
   `random(frameOn2)` – deterministisch.
5. **Komposition:** Basis ausblenden, mischen (multiply) oder nur als Lichtquelle nutzen; Papier-Textur
   darüber; `render_still` an Bewegungsspitzen prüfen.

## Muster für Boil (deterministisch)

```tsx
const step = Math.floor(frame / 2);              // auf Zweiern
const jitter = (salt: number) => (random(`${step}-${salt}`) - 0.5) * 2 * width * 0.0015;
```

## Qualität

Maskenflattern glätten (über 3 Frames mitteln), Konturen nicht zu detailliert (Stil vor Genauigkeit),
Timing der gezeichneten Linie exakt zur Basis (Daten-fps = Clip-fps oder sauber umrechnen).
