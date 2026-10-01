import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { SandboxTimelinePreview, wordsForTimeline, type ExportRequest } from '@studio/browser-media';
import { clipAssetIds, type Asset, type Clip, type FormatSpec, type Timeline } from '@studio/core';
import type { AssetMedia, MediaErrorInfo } from '@studio/render/browser';
import { useT } from '../../i18n.ts';
import { useElementSize, usePeaks, waveformPath } from '../../lib/hooks.ts';
import { clipDisplayName } from '../../lib/labels.ts';
import { useRenderModule } from '../../lib/renderAdapter.ts';
import { formatTc, tcParts } from '../../lib/timecode.ts';
import { useActions, useApi, useAssetUrl, useStudio, useStudioStore } from '../../state/context.tsx';
import { selectUserMarkers } from '../../state/selectors.ts';
import { Icon } from '../common/Icon.tsx';
import { ariaKeyShortcuts, type KeyName } from '../common/Kbd.tsx';
import { Popover } from '../common/Popover.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { MonitorEmpty, type FullscreenControl } from './MonitorParts.tsx';

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

/**
 * Bildbereich (DESIGN.md §2.4): Innenabstand 12 oben und seitlich, unten schließt der Transport an.
 * Also Breite − 24 und Höhe − 12; die 44 px des Transports liegen außerhalb des gemessenen Bereichs.
 */
export const STAGE_PAD_X = 24;
export const STAGE_PAD_Y = 12;
/** Unter dieser Monitorbreite wandern Format und Safe Areas in das ⋯-Menü (§7.4). */
const NARROW_TRANSPORT_W = 640;

export function fitBox(format: Pick<FormatSpec, 'width' | 'height'>, size: { width: number; height: number }): { width: number; height: number } {
  if (size.width <= 0 || size.height <= 0) return { width: 480, height: Math.round((480 * format.height) / format.width) };
  const scale = Math.max(0.01, Math.min((size.width - STAGE_PAD_X) / format.width, (size.height - STAGE_PAD_Y) / format.height));
  return { width: Math.floor(format.width * scale), height: Math.floor(format.height * scale) };
}

export function buildMedia(
  timeline: Timeline,
  assets: readonly Asset[],
  assetUrl: (id: string, v?: 'original' | 'proxy' | 'thumb') => string,
  missingLabel = 'Datei fehlt',
): Record<string, AssetMedia> {
  const used = new Set<string>();
  // Auch Assets aus Clip-Props (`rotoscope`, `…Asset`, `…AssetId`) – Komponenten brauchen sie in der Vorschau.
  for (const track of timeline.tracks) for (const clip of track.clips) for (const id of clipAssetIds(clip)) used.add(id);
  for (const component of Object.values(timeline.components)) used.add(component.assetId);
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
      // Bekannt fehlende verknüpfte Datei: gar nicht erst laden, Platzhalter zeigen.
      ...(asset.metadata?.missing === true ? { error: missingLabel } : {}),
    };
  }
  return out;
}

/** Ausgelassene Medien, die noch zum aktuellen Schnitt gehören (Clip existiert und nutzt das Asset noch). */
export function currentMediaIssues(issues: readonly MediaErrorInfo[], timeline: Timeline): MediaErrorInfo[] {
  const clips = new Map(timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]));
  return issues.filter((i) => {
    const clip = clips.get(i.clipId);
    return !!clip && (!i.assetId || clipAssetIds(clip).includes(i.assetId));
  });
}

/**
 * Clip unter dem Abspielkopf für die Meta im Transport: die erste Spur (Reihenfolge des Dokuments, also V1 zuerst),
 * die an dieser Stelle einen Clip hat.
 */
export function clipAtPlayhead(timeline: Timeline, frame: number): { clip: Clip; trackId: string } | null {
  for (const track of timeline.tracks) {
    if (track.hidden) continue;
    const clip = track.clips.find((c) => c.start <= frame && frame < c.start + c.duration);
    if (clip) return { clip, trackId: track.id };
  }
  return null;
}

// ───────────────────────── Transport ─────────────────────────

/** Timecode des Abspielkopfs (Plex Mono 15/500, `--text`; Frames gedämpft) plus Gesamtdauer. Rendert je Frame. */
function TransportClock({ fps, duration }: { fps: number; duration: number }) {
  const t = useT();
  const playhead = useStudio((s) => s.playhead);
  const { head, frames } = tcParts(playhead, fps, 'smpte');
  const total = formatTc(duration, fps, 'smpte');
  return (
    <span className="tp-clock" aria-label={t('monitor.timecodeAria', { time: head + frames, duration: total })} aria-live="off" role="timer">
      <span className="tp-tc mono" aria-hidden="true">
        {head}
        <span className="ff">{frames}</span>
      </span>
      <span className="tp-dur mono" aria-hidden="true">
        / {total}
      </span>
    </span>
  );
}

/** Meta aus dem Clip unter dem Abspielkopf: „Shot 04 – Lichter · V1 · v4“. */
function TransportMeta({ timeline }: { timeline: Timeline }) {
  const playhead = useStudio((s) => s.playhead);
  const assets = useStudio((s) => s.assets);
  const version = useStudio((s) => s.viewing?.number ?? s.documentVersion);
  const titles = useMemo(() => new Map(assets.map((a) => [a.id, a.title])), [assets]);
  const hit = clipAtPlayhead(timeline, playhead);
  const parts = hit ? [clipDisplayName(hit.clip, titles), hit.trackId, `v${version}`] : [`v${version}`];
  const text = parts.join(' · ');
  return (
    <span className="tp-meta" title={text}>
      {text}
    </span>
  );
}

function TransportButton({
  label,
  keys,
  ariaKeys,
  icon,
  onClick,
  disabled,
  className = 'ibtn',
  pressed,
}: {
  label: string;
  keys?: readonly KeyName[];
  /** Standardname für `aria-keyshortcuts`, wenn die Taste im Tooltip als Symbol steht (← → …). */
  ariaKeys?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  pressed?: boolean;
}) {
  const shortcut = ariaKeys ?? (keys ? ariaKeyShortcuts(keys) : undefined);
  return (
    <Tooltip label={label} {...(keys ? { keys } : {})}>
      <button
        type="button"
        className={className}
        aria-label={label}
        {...(shortcut ? { 'aria-keyshortcuts': shortcut } : {})}
        {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  );
}

/** Mitte des Transports: Marker bzw. Anfang/Ende, Bild zurück, Play/Pause, Bild vor. */
function TransportControls({ duration, disabled }: { duration: number; disabled: boolean }) {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  const playing = useStudio((s) => s.playing);
  const hasMarkers = useStudio((s) => selectUserMarkers(s).length > 0);
  const step = (delta: number) => {
    const state = store.getState();
    state.transport?.pause();
    actions.requestSeek(state.playhead + delta);
  };
  return (
    <div className="tp-c">
      {hasMarkers ? (
        <TransportButton label={t('stage.prevMarker')} keys={['[']} icon="prev" disabled={disabled} onClick={() => actions.jumpToMarker(-1)} />
      ) : (
        <TransportButton label={t('monitor.toStart')} keys={['Home']} icon="skipBack" disabled={disabled} onClick={() => actions.requestSeek(0)} />
      )}
      <TransportButton label={t('monitor.frameBack')} keys={['←']} ariaKeys="ArrowLeft" icon="frameBack" disabled={disabled} onClick={() => step(-1)} />
      <Tooltip label={playing ? t('monitor.pause') : t('monitor.play')} keys={['Space']}>
        <button
          type="button"
          className="tp-play"
          aria-label={playing ? t('monitor.pause') : t('monitor.play')}
          aria-keyshortcuts={ariaKeyShortcuts(['Space'])}
          disabled={disabled}
          onClick={() => actions.togglePlay()}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
      </Tooltip>
      <TransportButton label={t('monitor.frameForward')} keys={['→']} ariaKeys="ArrowRight" icon="frameFwd" disabled={disabled} onClick={() => step(1)} />
      {hasMarkers ? (
        <TransportButton label={t('stage.nextMarker')} keys={[']']} icon="next" disabled={disabled} onClick={() => actions.jumpToMarker(1)} />
      ) : (
        <TransportButton label={t('monitor.toEnd')} keys={['End']} icon="skipFwd" disabled={disabled} onClick={() => actions.requestSeek(Math.max(0, duration - 1))} />
      )}
    </div>
  );
}

/** Format-Segment (nur bei mehr als einem Format). */
function FormatSegment({ formats, current }: { formats: readonly FormatSpec[]; current: string }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className="seg" role="group" aria-label={t('monitor.format')}>
      {formats.map((f) => (
        <button key={f.id} type="button" aria-pressed={f.id === current} onClick={() => actions.setFormat(f.id)}>
          {f.id}
        </button>
      ))}
    </div>
  );
}

/** ⋯-Menü bei schmalem Monitor: Format und Safe Areas. */
function TransportMore({ formats, current, showSafeArea }: { formats: readonly FormatSpec[]; current: string; showSafeArea: boolean }) {
  const t = useT();
  const actions = useActions();
  const safeArea = useStudio((s) => s.safeArea);
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top"
      align="end"
      className="tp-menu"
      label={t('monitor.more')}
      anchor={
        <Tooltip label={t('monitor.more')} disabled={open}>
          <button type="button" className="ibtn" aria-label={t('monitor.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="more" size={16} />
          </button>
        </Tooltip>
      }
    >
      <ul className="menu" role="menu" aria-label={t('monitor.more')}>
        {formats.length > 1 &&
          formats.map((f) => (
            <li key={f.id} role="none">
              <button type="button" role="menuitemradio" aria-checked={f.id === current} onClick={() => actions.setFormat(f.id)}>
                <span className="menu-check" aria-hidden="true">
                  {f.id === current && <Icon name="check" size={14} />}
                </span>
                <span>
                  {t('monitor.format')} <span className="mono">{f.id}</span>
                </span>
              </button>
            </li>
          ))}
        {showSafeArea && (
          <li role="none">
            <button type="button" role="menuitemcheckbox" aria-checked={safeArea} onClick={() => actions.toggleSafeArea()}>
              <span className="menu-check" aria-hidden="true">
                {safeArea && <Icon name="check" size={14} />}
              </span>
              <span>{t('monitor.safeArea')}</span>
            </button>
          </li>
        )}
      </ul>
    </Popover>
  );
}

/**
 * Transport (44 px, unter dem Bild; ersetzt die frühere Monitor-Leiste, §7.4): links Timecode, Dauer und Meta, mittig
 * (auf die Monitorbreite zentriert) die Wiedergabe, rechts Format, Safe Areas, Ton, Proxy-Hinweis und Vollbild.
 */
function Transport({
  timeline,
  formats,
  format,
  audioOnly,
  muted,
  onToggleMute,
  fullscreen,
  issues,
  proxy,
  disabled,
}: {
  timeline: Timeline;
  formats: readonly FormatSpec[];
  format: FormatSpec;
  audioOnly: boolean;
  muted: boolean;
  onToggleMute: () => void;
  fullscreen: FullscreenControl | null;
  issues: readonly MediaErrorInfo[];
  proxy: boolean;
  disabled: boolean;
}) {
  const t = useT();
  const actions = useActions();
  const safeArea = useStudio((s) => s.safeArea);
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  // Ungemessen (0) gilt als breit
  const narrow = width > 0 && width < NARROW_TRANSPORT_W;
  const multiFormat = formats.length > 1;
  return (
    <div className="transport" ref={ref} role="toolbar" aria-label={t('monitor.transport')}>
      <div className="tp-l">
        <TransportClock fps={timeline.fps} duration={timeline.durationFrames} />
        <TransportMeta timeline={timeline} />
      </div>
      <TransportControls duration={timeline.durationFrames} disabled={disabled} />
      <div className="tp-r">
        {issues.length > 0 && (
          <span className="badge badge-warn" role="status" data-testid="monitor-media-issues" title={issues.map((i) => `${i.clipId}: ${i.message}`).join('\n')}>
            <Icon name="warning" size={12} /> {t('monitor.mediaIssues', { n: issues.length })}
          </span>
        )}
        {proxy && (
          <Tooltip label={t('monitor.proxyTip')}>
            <span className="badge warn tp-proxy" tabIndex={0}>
              {t('monitor.proxy')}
            </span>
          </Tooltip>
        )}
        {!narrow && multiFormat && <FormatSegment formats={formats} current={format.id} />}
        {!narrow && !audioOnly && (
          <Tooltip label={t('monitor.safeArea')}>
            <button type="button" className="ibtn" aria-label={t('monitor.safeArea')} aria-pressed={safeArea} onClick={() => actions.toggleSafeArea()}>
              <Icon name="safeArea" size={16} />
            </button>
          </Tooltip>
        )}
        {narrow && !audioOnly && <TransportMore formats={formats} current={format.id} showSafeArea />}
        <TransportButton label={muted ? t('monitor.unmute') : t('monitor.mute')} icon={muted ? 'muted' : 'volume'} onClick={onToggleMute} pressed={muted} />
        {fullscreen && !audioOnly && (
          <TransportButton label={fullscreen.active ? t('monitor.exitFullscreen') : t('monitor.fullscreen')} icon="fullscreen" onClick={fullscreen.toggle} pressed={fullscreen.active} />
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Audio-Projekt: Mix-Wellenform ─────────────────────────

const MixClip = memo(function MixClip({ clip, fps, left, width, height }: { clip: Clip; fps: number; left: number; width: number; height: number }) {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const peaks = usePeaks(api, projectId, clip.assetId);
  const w = Math.max(1, Math.round(width));
  const d = useMemo(() => {
    if (!peaks) return '';
    const fromMs = (clip.in / fps) * 1000;
    const toMs = fromMs + (clip.duration / fps) * 1000 * (clip.speed ?? 1);
    return waveformPath(peaks.peaks, peaks.durationMs, fromMs, toMs, Math.min(w, 8000), height);
  }, [peaks, clip.in, clip.duration, clip.speed, fps, w, height]);
  if (!d) return null;
  return (
    <svg className="mix-clip" style={{ left, width: w, height }} viewBox={`0 0 ${Math.min(w, 8000)} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
});

/** Ebene der Mix-Wellenform: alle hörbaren Audio-Clips an ihrer Zeitposition, übereinander. */
const MixLayer = memo(function MixLayer({ timeline, width, height }: { timeline: Timeline; width: number; height: number }) {
  const duration = Math.max(1, timeline.durationFrames);
  const clips = timeline.tracks.filter((tr) => tr.kind === 'audio' && !tr.muted).flatMap((tr) => tr.clips.filter((c) => c.assetId));
  return (
    <>
      {clips.map((clip) => (
        <MixClip key={clip.id} clip={clip} fps={timeline.fps} left={(clip.start / duration) * width} width={(clip.duration / duration) * width} height={height} />
      ))}
    </>
  );
});

/**
 * Audio-Projekt (§7.4): Statt eines Bildes die Mix-Wellenform über die volle Breite (`--trk-music`, 60 %) mit
 * Abspielkopf. Der gespielte Teil steht voll deckend, damit die Position auch ohne Linie lesbar ist.
 */
function AudioMix({ timeline, width, height }: { timeline: Timeline; width: number; height: number }) {
  const t = useT();
  const playhead = useStudio((s) => s.playhead);
  const waveH = Math.max(24, Math.round(Math.min(height * 0.6, 220)));
  const x = (Math.min(playhead, timeline.durationFrames) / Math.max(1, timeline.durationFrames)) * width;
  return (
    <div className="audio-mix" role="img" aria-label={t('monitor.audioMix')}>
      <div className="audio-mix-wave" style={{ height: waveH }}>
        <div className="audio-mix-base">
          <MixLayer timeline={timeline} width={width} height={waveH} />
        </div>
        <div className="audio-mix-played" style={{ width: x }}>
          <MixLayer timeline={timeline} width={width} height={waveH} />
        </div>
      </div>
      <span className="audio-mix-playhead" style={{ left: Math.round(x) }} aria-hidden="true" />
    </div>
  );
}

// ───────────────────────── Monitor (Video und Audio) ─────────────────────────

export function VideoMonitor({
  timeline,
  audioOnly,
  fullscreen = null,
  monitorRef,
}: {
  timeline: Timeline;
  audioOnly: boolean;
  fullscreen?: FullscreenControl | null;
  /** Nur für Doppelklick ins Vollbild (der Monitor selbst geht ins Vollbild, inklusive Transport). */
  monitorRef?: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const mod = useRenderModule();
  const actions = useActions();
  const store = useStudioStore();
  const formatId = useStudio((s) => s.formatId);
  const safeArea = useStudio((s) => s.safeArea);
  const playbackRate = useStudio((s) => s.playbackRate);
  const seekRequest = useStudio((s) => s.seekRequest);
  const assets = useStudio((s) => s.assets);
  const projectId = useStudio((s) => s.projectId);
  const api = useApi();
  const native = (api as typeof api & { isNative?: boolean }).isNative === true;
  const assetUrl = useAssetUrl();
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const [muted, setMuted] = useState(false);

  const formats = timeline.formats.length ? timeline.formats : [{ id: 'base', width: timeline.width, height: timeline.height }];
  const format = formats.find((f) => f.id === formatId) ?? formats[0]!;
  // Audio-Projekt: Die Wellenform nutzt die volle Breite des Bildbereichs
  const box = audioOnly && size.width > 0 ? { width: Math.floor(size.width - STAGE_PAD_X), height: Math.floor(size.height - STAGE_PAD_Y) } : fitBox(format, size);
  const missingLabel = t('monitor.mediaMissingFile');
  const media = useMemo(() => buildMedia(timeline, assets, assetUrl, missingLabel), [timeline, assets, assetUrl, missingLabel]);
  // Proxy-Hinweis: Video-Assets spielen im Monitor als 540p-Proxy (der Export nutzt die Originale)
  const proxy = useMemo(() => Object.values(media).some((m) => m.kind === 'video'), [media]);
  // Fehlende/defekte Medien meldet die Komposition (je Clip und Medium einmal) – als Hinweis im Transport.
  const [mediaIssues, setMediaIssues] = useState<MediaErrorInfo[]>([]);
  const onMediaError = useCallback((info: MediaErrorInfo) => {
    setMediaIssues((list) => (list.some((i) => i.clipId === info.clipId && i.assetId === info.assetId) ? list : [...list, info]));
  }, []);
  const visibleIssues = useMemo(() => currentMediaIssues(mediaIssues, timeline), [mediaIssues, timeline]);
  const words = useMemo(() => wordsForTimeline(timeline, assets), [timeline, assets]);
  const inputProps = useMemo(() => ({ timeline, assets: media, words, includeAudio: true, formatId: format.id, onMediaError }), [timeline, media, words, format.id, onMediaError]);
  const [sandboxRequest, setSandboxRequest] = useState<ExportRequest | null>(null);
  const [sandboxReady, setSandboxReady] = useState(0);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  useEffect(() => {
    if (!native || !projectId || timeline.durationFrames <= 0) return;
    let alive = true; setSandboxError(null);
    void (async () => {
      const components: Record<string, string> = {};
      for (const [id, component] of Object.entries(timeline.components)) { const response = await fetch(assetUrl(component.assetId, 'original')); if (!response.ok) throw new Error(`Komponente ${id}: Datei fehlt`); components[id] = await response.text(); }
      if (alive) setSandboxRequest({ document: timeline, assets: media, components, words, format: 'mp4', options: { formatId: format.id, normalizeLufs: format.id === 'podcast' ? -16 : -14 } });
    })().catch((error) => { if (alive) setSandboxError((error as Error).message); });
    return () => { alive = false; };
  }, [native, projectId, timeline, media, words, format.id, assetUrl, audioOnly]);
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
  }, [Composition, hasContent, actions, store, sandboxReady]);

  // Seek-Anfragen von Bühne/Tastatur/Timecode-Links
  useEffect(() => {
    if (seekRequest) playerRef.current?.seekTo(seekRequest.frame);
  }, [seekRequest]);

  // Ton: Zustand gilt auch für einen neu aufgebauten Player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) player.mute?.();
    else player.unmute?.();
  }, [muted, Composition, hasContent, sandboxReady]);

  const toggleFullscreenByDoubleClick = () => {
    if (!audioOnly && fullscreen && monitorRef?.current) fullscreen.toggle();
  };

  return (
    <div className={`monitor-video${audioOnly ? ' is-audio' : ''}`}>
      <div className="monitor-stage" ref={stageRef}>
        {!hasContent ? (
          <MonitorEmpty icon="film" title={t('monitor.emptyTitle')} text={t('monitor.emptyText')} />
        ) : (
          <div className="player-box" style={{ width: box.width, height: box.height }} onDoubleClick={toggleFullscreenByDoubleClick}>
            {native ? (
              sandboxError ? <div className="monitor-error" role="alert">{sandboxError}</div> : sandboxRequest ? <SandboxTimelinePreview ref={playerRef} request={sandboxRequest} playbackRate={playbackRate} style={{ width: box.width, height: box.height }} onReady={() => setSandboxReady((n) => n + 1)} onError={(error) => setSandboxError(error.message)} /> : <div className="monitor-empty">{t('common.loading')}</div>
            ) : Composition ? (
              <Player
                ref={playerRef}
                component={Composition as unknown as ComponentType<Record<string, unknown>>}
                inputProps={inputProps as unknown as Record<string, unknown>}
                durationInFrames={Math.max(1, timeline.durationFrames)}
                compositionWidth={format.width}
                compositionHeight={format.height}
                fps={timeline.fps}
                controls={false}
                spaceKeyToPlayOrPause={false}
                clickToPlay={false}
                doubleClickToFullscreen={false}
                initiallyMuted={muted}
                playbackRate={playbackRate}
                style={{ width: box.width, height: box.height }}
                errorFallback={({ error }) => <div className="monitor-error">{error.message}</div>}
              />
            ) : (
              <div className="monitor-empty">{t('common.loading')}</div>
            )}
            {audioOnly && <AudioMix timeline={timeline} width={box.width} height={box.height} />}
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
      <Transport
        timeline={timeline}
        formats={formats}
        format={format}
        audioOnly={audioOnly}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        fullscreen={fullscreen}
        issues={visibleIssues}
        proxy={proxy}
        disabled={!hasContent}
      />
    </div>
  );
}
