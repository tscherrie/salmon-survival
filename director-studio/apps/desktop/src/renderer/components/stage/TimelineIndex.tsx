import { memo, type Ref } from 'react';
import type { Track } from '@studio/core';
import { useT } from '../../i18n.ts';
import { tcParts } from '../../lib/timecode.ts';
import { RULER_H, SECTIONS_H, STRIP_H } from '../../lib/timelineGeometry.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { ariaKeyShortcuts } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

/**
 * Index-Spalte der Timeline (DESIGN.md §7.9): so breit wie die Asset-Leiste (`--index-w`, §2.2), damit die senkrechte
 * Fuge durchläuft. Oben, deckungsgleich mit Markerleiste, Lineal und Abschnitten: Legende „Marker“ mit Anzahl und
 * Sprungknöpfen, der große Timecode des Abspielkopfs und die Zeilenlegenden. Darunter die Spurköpfe (ohne Mute/Solo,
 * nur Dokumentzustand), die senkrecht mit den Spuren scrollen.
 */

/** Spurfarbe: Video, Overlay, Text; Audio nach Rolle (Stimme, Musik, SFX/Atmo; ohne Rolle wie Stimme). */
export type TrackTone = 'video' | 'overlay' | 'text' | 'voice' | 'music' | 'sfx';

export function trackTone(track: Pick<Track, 'kind' | 'role'>): TrackTone {
  if (track.kind !== 'audio') return track.kind;
  if (track.role === 'music') return 'music';
  if (track.role === 'sfx' || track.role === 'ambience') return 'sfx';
  return 'voice';
}

export interface IndexLane {
  track: Track;
  height: number;
}

/** Großer Timecode des Abspielkopfs; Frames gedämpft. Eigene Komponente, damit nur sie bei jedem Frame neu rendert. */
function IndexTimecode({ fps }: { fps: number }) {
  const playhead = useStudio((s) => s.playhead);
  const { head, frames } = tcParts(playhead, fps, 'smpte');
  return (
    <span className="tl-index-tc mono" aria-live="off">
      {head}
      <span className="ff">{frames}</span>
    </span>
  );
}

export const TimelineIndex = memo(function TimelineIndex({
  fps,
  lanes,
  hasSections,
  bpm,
  markerCount,
  activeTrackId,
  tracksRef,
}: {
  fps: number;
  lanes: readonly IndexLane[];
  hasSections: boolean;
  bpm: number | null;
  markerCount: number;
  activeTrackId: string | null;
  tracksRef: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const actions = useActions();
  const headH = STRIP_H + RULER_H + (hasSections ? SECTIONS_H : 0);
  const noMarkers = markerCount === 0;
  return (
    <div className="tl-index">
      <div className="tl-index-head" style={{ height: headH }}>
        <div className="tl-index-strip">
          <span className="tl-micro">{t('stage.markers')}</span>
          <span className="tl-index-count mono">{markerCount}</span>
          <span className="spacer" />
          <Tooltip label={t('stage.prevMarker')} keys={['[']}>
            <button
              type="button"
              className="tl-index-nav"
              aria-label={t('stage.prevMarker')}
              aria-keyshortcuts={ariaKeyShortcuts(['['])}
              disabled={noMarkers}
              onClick={() => actions.jumpToMarker(-1)}
            >
              <Icon name="chevronLeft" size={12} />
            </button>
          </Tooltip>
          <Tooltip label={t('stage.nextMarker')} keys={[']']}>
            <button
              type="button"
              className="tl-index-nav"
              aria-label={t('stage.nextMarker')}
              aria-keyshortcuts={ariaKeyShortcuts([']'])}
              disabled={noMarkers}
              onClick={() => actions.jumpToMarker(1)}
            >
              <Icon name="chevronRight" size={12} />
            </button>
          </Tooltip>
        </div>
        <div className={`tl-index-readout${hasSections ? '' : ' is-compact'}`}>
          <IndexTimecode fps={fps} />
          <div className="tl-index-legends">
            <span className="tl-micro" style={{ height: RULER_H }}>
              {t('stage.legend.time')}
            </span>
            {hasSections && (
              <span className={`tl-micro${bpm !== null ? ' has-bpm' : ''}`} style={{ height: SECTIONS_H }}>
                <span className="tl-legend-word">{t('stage.legend.sections')}</span>
                {bpm !== null && <span className="tl-index-bpm mono">{t('stage.bpm', { bpm })}</span>}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="tl-index-tracks" ref={tracksRef}>
        {lanes.map(({ track, height }) => (
          <div
            key={track.id}
            className={`tl-track-header tone-${trackTone(track)}${track.id === activeTrackId ? ' is-active' : ''}${track.hidden ? ' is-hidden' : ''}`}
            style={{ height }}
          >
            <span className="tl-swatch" aria-hidden="true" />
            <span className="tl-track-id mono">{track.id}</span>
            <span className="tl-track-name">{track.name ?? track.role ?? t(`stage.track.${track.kind}`)}</span>
            {(track.muted || track.hidden) && (
              <span className="tl-track-state">
                {track.muted && <Icon name="muted" size={12} title={t('stage.muted')} />}
                {track.hidden && <Icon name="eyeOff" size={12} title={t('stage.hidden')} />}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
