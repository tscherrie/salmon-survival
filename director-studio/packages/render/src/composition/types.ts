import type { ComponentType } from 'react';
import type { AssetKind, Clip, Timeline } from '@studio/core';

/**
 * VERTRAG zwischen UI (Remotion Player im Renderer) und Render-Worker (renderStill/renderMedia).
 * Beide verwenden dieselbe Komposition, damit Vorschau und Export identisch aussehen.
 */

/** Auflösbares Medium eines Assets (URL im Renderer: `studio-asset://…`; im Render-Worker: http(s)/file-URL). */
export interface AssetMedia {
  id: string;
  kind: AssetKind;
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  durationMs?: number | undefined;
  fps?: number | undefined;
}

/** Wortzeitstempel (Sekunden, absolut auf der Timeline) für kinetische Typografie. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** Props, die jede Overlay-/Text-/Übergangskomponente (vom Director geschrieben) bekommt. */
export interface OverlayComponentProps {
  /** Der Clip, zu dem die Komponente gehört. */
  clip: Clip;
  /** Frame relativ zum Clip-Start. */
  frame: number;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  /** `clip.props` (vom Director gesetzt). */
  props: Record<string, unknown>;
  assets: Record<string, AssetMedia>;
  words: TimedWord[];
  /** Deterministischer Zufall (Seed aus Clip-ID + Frame). */
  random: (salt?: string | number) => number;
}

export interface TimelineCompositionProps {
  timeline: Timeline;
  assets: Record<string, AssetMedia>;
  /** Kompilierte Director-Komponenten, Schlüssel = componentId der Timeline. */
  components?: Record<string, ComponentType<OverlayComponentProps>> | undefined;
  /** Formatvariante (z. B. `9:16`); bestimmt Reframing. Standard: erstes Format bzw. Timeline-Größe. */
  formatId?: string | undefined;
  /** Audio in der Vorschau abspielen. Beim Export `false`: Audio mischt ffmpeg separat. */
  includeAudio?: boolean | undefined;
  /** Wortzeitstempel für Text-Stile wie `karaoke`/`word-by-word`. */
  words?: TimedWord[] | undefined;
}
