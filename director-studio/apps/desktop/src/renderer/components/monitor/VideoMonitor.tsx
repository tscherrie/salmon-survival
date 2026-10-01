import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { formatTimecode, type Asset, type FormatSpec, type Timeline } from '@studio/core';
import type { AssetMedia } from '@studio/render/browser';
import { useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useRenderModule } from '../../lib/renderAdapter.ts';
import { useActions, useAssetUrl, useStudio, useStudioStore } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';

/** Safe Areas je Format (Anteile 0..1): Titel-/Aktionsbereich bzw. Social-UI-Zonen bei Hochkant. */
export function safeAreasFor(format: FormatSpec): Array<{ x: number; y: number; w: number; h: number; kind: 'action' | 'title' | 'ui' }> {
  const ratio = format.width / format.height;
  if (ratio < 0.7) {
    // 9:16 – oben Profil/Ton, unten Bedienleiste + Caption, rechts Buttons
    return [
      { x: 0.06, y: 0.12, w: 0.76, h: 0.68, kind: 'ui' },
      { x: 0.05, y: 0.05, w: 0.9, h: 0.9, kind: 'action' },
    ];
  }
  return [
    { x: 0.035, y: 0.035, w: 0.93, h: 0.93, kind: 'action' },
    { x: 0.05, y: 0.05, w: 0.9, h: 0.9, kind: 'title' },
  ];
}

function fitBox(format: FormatSpec, size: { width: number; height: number }): { width: number; height: number } {
  if (size.width <= 0 || size.height <= 0) return { width: 480, height: Math.round((480 * format.height) / format.width) };
  const scale = Math.min(size.width / format.width, size.height / format.height);
  return { width: Math.floor(format.width * scale), height: Math.floor(format.height * scale) };
}

function buildMedia(timeline: Timeline, assets: readonly Asset[], assetUrl: (id: string, v?: 'original' | 'proxy' | 'thumb') => string): Record<string, AssetMedia> {
  const used = new Set<string>();
  for (const track of timeline.tracks) for (const clip of track.clips) if (clip.assetId) used.add(clip.assetId);
  const out: Record<string, AssetMedia> = {};
  for (const asset of assets) {
    if (!used.has(asset.id)) continue;
    out[asset.id] = {
      id: asset.id,
      kind: asset.kind,
      url: assetUrl(asset.id, asset.kind === 'video' ? 'proxy' : 'original'),
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      fps: asset.fps,
    };
  }
  return out;
}

function PlayheadClock({ fps }: { fps: number }) {
  const playhead = useStudio((s) => s.playhead);
  return <span className="monitor-clock">{formatTimecode(playhead, fps)}</span>;
}

export function VideoMonitor({ timeline, audioOnly }: { timeline: Timeline; audioOnly: boolean }) {
  const t = useT();
  const mod = useRenderModule();
  const actions = useActions();
  const store = useStudioStore();
  const formatId = useStudio((s) => s.formatId);
  const safeArea = useStudio((s) => s.safeArea);
  const playbackRate = useStudio((s) => s.playbackRate);
  const seekRequest = useStudio((s) => s.seekRequest);
  const assets = useStudio((s) => s.assets);
  const assetUrl = useAssetUrl();
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);

  const formats = timeline.formats.length ? timeline.formats : [{ id: 'base', width: timeline.width, height: timeline.height }];
  const format = formats.find((f) => f.id === formatId) ?? formats[0]!;
  const box = fitBox(format, size);
  const media = useMemo(() => buildMedia(timeline, assets, assetUrl), [timeline, assets, assetUrl]);
  const inputProps = useMemo(() => ({ timeline, assets: media, includeAudio: true, formatId: format.id }), [timeline, media, format.id]);
  const hasContent = timeline.durationFrames > 0;
  const Composition = mod?.TimelineComposition;

  // Player-Ereignisse → Store (Abspielkopf folgt der Wiedergabe)
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => actions.setPlayhead(e.detail.frame);
    const onPlay = () => actions.setPlaying(true);
    const onPause = () => actions.setPlaying(false);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onPause);
    actions.setTransport({
      play: () => player.play(),
      pause: () => player.pause(),
      toggle: () => player.toggle(),
      isPlaying: () => player.isPlaying(),
    });
    const initial = store.getState().playhead;
    if (initial > 0) player.seekTo(initial);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onPause);
      actions.setTransport(null);
    };
  }, [Composition, hasContent, actions, store]);

  // Seek-Anfragen von Bühne/Tastatur/Timecode-Links
  useEffect(() => {
    if (seekRequest) playerRef.current?.seekTo(seekRequest.frame);
  }, [seekRequest]);

  return (
    <div className="monitor-video">
      <div className="monitor-toolbar" role="toolbar" aria-label={t('monitor.label')}>
        {audioOnly ? (
          <span className="badge">{t('monitor.audioOnly')}</span>
        ) : (
          <>
            <div className="segmented" role="group" aria-label={t('monitor.format')}>
              {formats.map((f) => (
                <button key={f.id} type="button" aria-pressed={f.id === format.id} onClick={() => actions.setFormat(f.id)}>
                  {f.id}
                </button>
              ))}
            </div>
            <button type="button" className="toggle" aria-pressed={safeArea} onClick={() => actions.toggleSafeArea()}>
              <Icon name="region" size={14} /> {t('monitor.safeArea')}
            </button>
          </>
        )}
        <span className="spacer" />
        <PlayheadClock fps={timeline.fps} />
      </div>
      <div className="monitor-stage" ref={stageRef}>
        {!hasContent ? (
          <div className="monitor-empty">{t('stage.emptyTimeline')}</div>
        ) : (
          <div className="player-box" style={{ width: box.width, height: box.height }}>
            {Composition ? (
              <Player
                ref={playerRef}
                component={Composition as unknown as ComponentType<Record<string, unknown>>}
                inputProps={inputProps as unknown as Record<string, unknown>}
                durationInFrames={Math.max(1, timeline.durationFrames)}
                compositionWidth={format.width}
                compositionHeight={format.height}
                fps={timeline.fps}
                controls
                spaceKeyToPlayOrPause={false}
                clickToPlay={false}
                doubleClickToFullscreen
                allowFullscreen
                playbackRate={playbackRate}
                style={{ width: box.width, height: box.height }}
                errorFallback={({ error }) => <div className="monitor-error">{error.message}</div>}
              />
            ) : (
              <div className="monitor-empty">{t('common.loading')}</div>
            )}
            {audioOnly && (
              <div className="audio-overlay" aria-hidden="true">
                <Icon name="audio" size={40} />
                <PlayheadClock fps={timeline.fps} />
              </div>
            )}
            {safeArea && !audioOnly && (
              <div className="safe-areas" aria-hidden="true">
                {safeAreasFor(format).map((a, i) => (
                  <div key={i} className={`safe-area safe-area-${a.kind}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
