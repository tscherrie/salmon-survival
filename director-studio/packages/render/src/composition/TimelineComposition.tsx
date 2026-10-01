import type { TimelineCompositionProps } from './types.ts';

/**
 * PLATZHALTER – wird vom Render-Paket vollständig implementiert (Export-Name und Props bleiben gleich).
 * Rendert vorerst nur einen neutralen Hintergrund, damit die UI dagegen bauen kann.
 */
export function TimelineComposition(props: TimelineCompositionProps) {
  return <div style={{ width: '100%', height: '100%', background: props.timeline.backgroundColor ?? '#000' }} />;
}
