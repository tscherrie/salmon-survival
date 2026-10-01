---
name: kinetic-typography
description: Kinetische Typografie als Remotion-Komponente – OverlayComponentProps, Wort-Timing aus words/props, Beat-Hits, Safe Areas, Determinismus, Performance.
---

# Kinetische Typografie (Remotion-Komponenten)

## Vertrag

Jede Komponente bekommt `OverlayComponentProps` (aus `@studio/render`):

```ts
interface OverlayComponentProps {
  clip: Clip;              // der Timeline-Clip (id, start, duration, props, text …)
  frame: number;           // Frame relativ zum Clip-Start
  durationInFrames: number;
  fps: number;
  width: number;           // Größe des aktuellen Formats (16:9, 9:16 …)
  height: number;
  props: Record<string, unknown>;   // clip.props – Timing/Text/Stil kommen von hier
  assets: Record<string, AssetMedia>;
  words: TimedWord[];      // { text, start, end } in Sekunden, absolut auf der Timeline
  random: (salt?: string | number) => number; // deterministisch (Clip-ID + Frame + salt)
}
```

Erlaubte Imports: `react`, `remotion` (z. B. `interpolate`, `spring`, `Easing`, `AbsoluteFill`), Studio-FX.
Verboten: `Math.random`, `Date`, Netzwerk, Timer, globale Zustände.

## Muster: Wort-für-Wort auf Wortzeiten

```tsx
import React from 'react';
import { AbsoluteFill, interpolate, spring } from 'remotion';

export default function LyricSlam({ clip, frame, fps, width, height, words, props }: OverlayComponentProps) {
  const clipStartSec = clip.start / fps;
  const t = clipStartSec + frame / fps;                 // absolute Timeline-Zeit
  const visible = words.filter((w) => w.start <= t + 0.05 && w.end >= clipStartSec);
  const size = Math.round((props.sizeRatio as number ?? 0.12) * Math.min(width, height));
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', padding: width * 0.08 }}>
      {visible.map((w, i) => {
        const local = (t - w.start) * fps;              // Frames seit Wortbeginn
        const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 180 } });
        const y = interpolate(pop, [0, 1], [size * 0.4, 0]);
        return (
          <div key={i} style={{ fontSize: size, lineHeight: 0.95, fontWeight: 900, transform: `translateY(${y}px)`, opacity: pop }}>
            {w.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
```

`words` enthält alle Wortzeiten des Projekts – immer auf den Clipbereich filtern. Alternativ Timing über
`props` übergeben (`{"hits":[12.48, 12.96]}` aus der Beat-Map) statt Zahlen im Code.

## Gestaltungsregeln

- Betonte Silbe/Wort auf Beat-Hit: Skalierung/Versatz 2–4 Frames vor dem Beat beginnen (Antizipation),
  Peak auf dem Beat.
- Hierarchie: 1 Hero-Wort groß, Rest klein; nie mehr als ~7 Wörter gleichzeitig lesbar.
- Lesezeit: jedes Wort ≥ 6–8 Frames sichtbar (bei 30 fps), Zeilen ≥ Wörter/3 s.
- Safe Areas: Positionen relativ zu `width/height`; in 9:16 unteres Fünftel und rechten Rand frei.
- Text nie über unruhigen Hintergrund ohne Lösung (Freiraum im Shot, Plate, Schatten, Mischmodus).
- Deutsche Komposita: Eingebaute Textclips trennen deutsche Wörter automatisch an Silbengrenzen
  (`props.hyphens`: `auto` | `manual` | `none`, `props.lang` Standard `de`). In eigenen Komponenten
  Silbentrennung manuell (`props.lines`) oder Wortgrößen anpassen.

## Ablauf

write_component → apply_document_ops (register_component + Clip auf T1/V2 mit props) → render_still an
erstem Wort, Peak, Ende und im 9:16-Format → korrigieren. Performance: keine Filter/Blur auf großen
Flächen pro Frame, keine riesigen Schatten; Fonts lokal.
