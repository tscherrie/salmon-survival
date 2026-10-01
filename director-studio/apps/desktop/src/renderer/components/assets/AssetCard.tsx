import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatUsd, type Asset } from '@studio/core';
import { useT } from '../../i18n.ts';
import type { AssetUiStatus } from '../../lib/assets.ts';
import { setRefDragData } from '../../lib/dnd.ts';
import { formatDurationMs, usePeaks, waveformPath } from '../../lib/hooks.ts';
import { refKey } from '../../lib/refNumbers.ts';
import { useApi, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';
import { isMacPlatform } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

export type AssetView = 'grid' | 'list';

/** Spurfarbe der Wellenform nach Rolle (§3.1): Musik Ocker, SFX/Atmo Rosé-Taupe, sonst Stimme Salbei. */
function waveTone(asset: Asset): string {
  const sub = asset.subtype?.toLowerCase() ?? '';
  if (sub.includes('music') || sub.includes('musik')) return 'var(--trk-music)';
  if (sub.includes('sfx') || sub.includes('ambience') || sub.includes('atmo')) return 'var(--trk-sfx)';
  return 'var(--trk-voice)';
}

function AssetWave({ asset }: { asset: Asset }) {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const peaks = usePeaks(api, projectId, asset.id);
  const d = useMemo(() => (peaks ? waveformPath(peaks.peaks, peaks.durationMs, 0, peaks.durationMs, 240, 64) : ''), [peaks]);
  return (
    <svg className="asset-wave" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true" style={{ color: waveTone(asset) }}>
      {d ? <path d={d} /> : <line x1="0" y1="32" x2="240" y2="32" />}
    </svg>
  );
}

/**
 * Vorschau (§7.3): Bild, Video mit Hover-Scrub, Wellenform in Spurfarbe, Text/Code/Daten als Ausschnitt in Mono,
 * Schrift als Specimen „Aa“, sonst das Typ-Icon. Video-Kacheln sind `.always-dark`.
 */
export function AssetPreview({ asset, thumbUrl, proxyUrl }: { asset: Asset; thumbUrl: string; proxyUrl: string }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  if (asset.kind === 'image') return <img className="asset-thumb" src={thumbUrl} alt="" loading="lazy" draggable={false} />;
  if (asset.kind === 'video') {
    const onMove = (e: React.MouseEvent) => {
      const r = e.currentTarget.getBoundingClientRect();
      const ratio = r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
      setScrub(ratio);
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = ratio * v.duration;
    };
    return (
      <span className="asset-scrub always-dark" onMouseMove={onMove} onMouseLeave={() => setScrub(null)}>
        <img className="asset-thumb" src={thumbUrl} alt="" loading="lazy" draggable={false} />
        {scrub !== null && videoOk && proxyUrl && !proxyUrl.startsWith('data:image') && (
          <video ref={videoRef} className="asset-thumb asset-video" src={proxyUrl} muted preload="metadata" playsInline onError={() => setVideoOk(false)} />
        )}
        {scrub !== null && <span className="scrub-line" style={{ left: `${scrub * 100}%` }} />}
      </span>
    );
  }
  if (asset.kind === 'audio') {
    return (
      <span className="asset-audio">
        <AssetWave asset={asset} />
      </span>
    );
  }
  if (asset.kind === 'text' || asset.kind === 'code' || asset.kind === 'data') {
    return (
      <span className={`asset-snippet asset-snippet-${asset.kind}`}>
        <span className="asset-snippet-text">{asset.description ?? asset.prompt ?? asset.title}</span>
      </span>
    );
  }
  if (asset.kind === 'font') {
    return (
      <span className="asset-specimen" aria-hidden="true">
        Aa
      </span>
    );
  }
  return (
    <span className="asset-icon">
      <Icon name={ASSET_KIND_ICONS[asset.kind]} size={22} />
    </span>
  );
}

/** Verwendungsorte als Etiketten (`V1`, `A2`, `F3`, `/about`): höchstens zwei, danach `+n`. */
function UsageTags({ usage, className }: { usage: readonly string[]; className: string }) {
  const t = useT();
  if (usage.length === 0) return null;
  const shown = usage.slice(0, 2);
  const rest = usage.length - shown.length;
  return (
    <span className={className} title={usage.join(' · ')}>
      {shown.map((place) => (
        <span key={place} className="media-tag">
          {place}
        </span>
      ))}
      {rest > 0 && <span className="media-tag">{t('assets.usageMore', { count: rest })}</span>}
    </span>
  );
}

/**
 * Meta-Zeile in der UI-Schrift, nur Zahlen in Mono (§4.1): „h3-max · $0.80“, „verknüpft · 1920×1080“,
 * verworfen nur „verworfen“.
 */
function assetMeta(asset: Asset, status: AssetUiStatus, modelName: string | null, t: ReturnType<typeof useT>): ReactNode[] {
  if (status === 'rejected') return [t('assetStatus.rejected')];
  const parts: ReactNode[] = [modelName ?? t(`assetSource.${asset.source}`)];
  const sampleRate = asset.metadata?.sampleRate;
  if (asset.costUsd !== undefined && asset.source !== 'linked') parts.push(<span className="mono">{formatUsd(asset.costUsd)}</span>);
  else if (typeof sampleRate === 'number' && sampleRate > 0) parts.push(<span className="mono">{`${Math.round(sampleRate / 100) / 10} kHz`}</span>);
  else if (asset.width && asset.height) parts.push(<span className="mono">{`${asset.width}×${asset.height}`}</span>);
  return parts;
}

export const AssetCard = memo(function AssetCard({
  asset,
  status,
  usage,
  inComposer,
  modelName,
  thumbUrl,
  proxyUrl,
  selected,
  view,
  onOpen,
  onInsert,
  onRelink,
}: {
  asset: Asset;
  status: AssetUiStatus;
  /** Verwendungsorte im Dokument (`assetUsage`). */
  usage: readonly string[];
  /** Im Composer referenziert: Daylight-Ring statt Etikett (§7.3). */
  inComposer: boolean;
  modelName: string | null;
  thumbUrl: string;
  proxyUrl: string;
  selected: boolean;
  view: AssetView;
  /** `viaKeyboard`: per Enter/Leertaste geöffnet – der Fokus wandert dann in die Detailansicht. */
  onOpen: (id: string, viaKeyboard: boolean) => void;
  onInsert: (id: string) => void;
  onRelink: (id: string) => void;
}) {
  const t = useT();
  // Verknüpfung (§9.4): Hover über einen Asset-Chip hebt die Karte hervor; „Zeigen“ scrollt sie ins Bild und blitzt
  const key = refKey({ kind: 'asset', assetId: asset.id });
  const hovered = useStudio((s) => s.hoveredRefKey === key);
  const flashing = useStudio((s) => s.flash?.key === key);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flashing) cardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [flashing]);
  const missing = asset.source === 'linked' && asset.metadata?.missing === true;
  const duration = asset.durationMs !== undefined && (asset.kind === 'video' || asset.kind === 'audio') ? formatDurationMs(asset.durationMs) : null;
  const meta = assetMeta(asset, status, modelName, t);
  const classes = [
    'asset-card',
    `is-${view}`,
    inComposer && 'is-ref',
    selected && 'is-selected',
    status === 'rejected' && 'is-rejected',
    missing && 'is-missing',
    hovered && 'is-linked',
    flashing && 'is-flash',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={cardRef}
      role="listitem"
      className={classes}
      draggable
      data-asset-id={asset.id}
      data-ref-key={key}
      onDragStart={(e) => setRefDragData(e.dataTransfer, { kind: 'asset', assetId: asset.id }, asset.title)}
      onDoubleClick={() => onInsert(asset.id)}
    >
      <button
        type="button"
        className="asset-card-main"
        onClick={(e) => onOpen(asset.id, e.detail === 0)}
        onKeyDown={(e) => {
          // mod+Enter auf der fokussierten Karte fügt einen Asset-Chip ein (§7.3)
          const mod = isMacPlatform() ? e.metaKey : e.ctrlKey;
          if (e.key === 'Enter' && mod) {
            e.preventDefault();
            onInsert(asset.id);
          }
        }}
        aria-label={`${asset.title} – ${t('assets.details')}`}
      >
        <span className="asset-preview">
          <AssetPreview asset={asset} thumbUrl={thumbUrl} proxyUrl={proxyUrl} />
          {/* In der Liste zeigt das kleine Thumb nur die Dauer; der Typ ist dort am Bild selbst zu erkennen */}
          {(view === 'grid' || !duration) && (
            <span className="media-tag media-kind" aria-hidden="true">
              <Icon name={ASSET_KIND_ICONS[asset.kind]} size={11} />
            </span>
          )}
          {duration && <span className="media-tag media-duration">{duration}</span>}
          {view === 'grid' && <UsageTags usage={usage} className="media-usage" />}
        </span>
        <span className="asset-text">
          <span className="asset-title">{asset.title}</span>
          {/* Meta-Zeile; in der Liste stehen die Verwendungsorte rechts daneben, damit der Titel die ganze Breite hat */}
          {(!missing || view === 'list') && (
          <span className="asset-meta-row">
            {!missing && (
              <span className="asset-meta">
                {meta.map((part, i) => (
                  <span key={i} className={i === 0 ? 'asset-meta-lead' : 'asset-meta-part'}>
                    {i > 0 && ' · '}
                    {part}
                  </span>
                ))}
              </span>
            )}
            {view === 'list' && <UsageTags usage={usage} className="asset-usage-list" />}
          </span>
          )}
        </span>
      </button>
      {missing && (
        <button type="button" className="asset-missing-link" onClick={() => onRelink(asset.id)}>
          <Icon name="warning" size={12} />
          <span>{t('assets.missingRelink')}</span>
        </button>
      )}
      <Tooltip label={t('assets.toComposer')} keys={['mod', 'Enter']}>
        <button type="button" className="asset-insert" onClick={() => onInsert(asset.id)} aria-label={t('assets.toComposer')}>
          <Icon name="plus" size={14} />
        </button>
      </Tooltip>
    </div>
  );
});
