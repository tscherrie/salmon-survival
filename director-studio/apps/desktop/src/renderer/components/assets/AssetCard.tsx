import { memo, useMemo, useRef, useState } from 'react';
import { formatUsd, type Asset } from '@studio/core';
import { useT } from '../../i18n.ts';
import type { AssetUiStatus } from '../../lib/assets.ts';
import { setRefDragData } from '../../lib/dnd.ts';
import { formatDurationMs, usePeaks, waveformPath } from '../../lib/hooks.ts';
import { useApi, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';

function AssetWave({ asset }: { asset: Asset }) {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const peaks = usePeaks(api, projectId, asset.id);
  const d = useMemo(() => (peaks ? waveformPath(peaks.peaks, peaks.durationMs, 0, peaks.durationMs, 240, 64) : ''), [peaks]);
  return (
    <svg className="asset-wave" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true">
      {d ? <path d={d} /> : <line x1="0" y1="32" x2="240" y2="32" />}
    </svg>
  );
}

/** Vorschau: Bild/Video-Thumbnail (Video mit Hover-Scrub), Wellenform, Textausschnitt oder Symbol. */
function AssetPreview({ asset, thumbUrl, proxyUrl }: { asset: Asset; thumbUrl: string; proxyUrl: string }) {
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
      <div className="asset-scrub" onMouseMove={onMove} onMouseLeave={() => setScrub(null)}>
        <img className="asset-thumb" src={thumbUrl} alt="" loading="lazy" draggable={false} />
        {scrub !== null && videoOk && proxyUrl && !proxyUrl.startsWith('data:image') && (
          <video ref={videoRef} className="asset-thumb asset-video" src={proxyUrl} muted preload="metadata" playsInline onError={() => setVideoOk(false)} />
        )}
        {scrub !== null && <span className="scrub-line" style={{ left: `${scrub * 100}%` }} />}
        {asset.durationMs !== undefined && <span className="asset-duration">{formatDurationMs(asset.durationMs)}</span>}
      </div>
    );
  }
  if (asset.kind === 'audio') {
    return (
      <div className="asset-audio">
        <AssetWave asset={asset} />
        {asset.durationMs !== undefined && <span className="asset-duration">{formatDurationMs(asset.durationMs)}</span>}
      </div>
    );
  }
  if (asset.kind === 'text' || asset.kind === 'code' || asset.kind === 'data') {
    return (
      <div className={`asset-snippet asset-snippet-${asset.kind}`}>
        <Icon name={ASSET_KIND_ICONS[asset.kind]} size={14} />
        <p>{asset.description ?? asset.prompt ?? asset.title}</p>
      </div>
    );
  }
  return (
    <div className="asset-icon">
      <Icon name={ASSET_KIND_ICONS[asset.kind]} size={28} />
    </div>
  );
}

export const AssetCard = memo(function AssetCard({
  asset,
  status,
  linked,
  modelName,
  thumbUrl,
  proxyUrl,
  selected,
  onOpen,
  onInsert,
}: {
  asset: Asset;
  status: AssetUiStatus;
  linked: boolean;
  modelName: string | null;
  thumbUrl: string;
  proxyUrl: string;
  selected: boolean;
  onOpen: (id: string) => void;
  onInsert: (id: string) => void;
}) {
  const t = useT();
  return (
    <div
      role="listitem"
      className={`asset-card${selected ? ' is-selected' : ''}${status === 'rejected' ? ' is-rejected' : ''}`}
      draggable
      data-asset-id={asset.id}
      onDragStart={(e) => setRefDragData(e.dataTransfer, { kind: 'asset', assetId: asset.id }, asset.title)}
      onDoubleClick={() => onInsert(asset.id)}
    >
      <button type="button" className="asset-card-main" onClick={() => onOpen(asset.id)} aria-label={`${asset.title} – ${t('assets.details')}`}>
        <span className="asset-preview">
          <AssetPreview asset={asset} thumbUrl={thumbUrl} proxyUrl={proxyUrl} />
        </span>
        <span className="asset-title" title={asset.title}>
          {asset.title}
        </span>
      </button>
      <div className="asset-badges">
        <span className="badge badge-kind">
          <Icon name={ASSET_KIND_ICONS[asset.kind]} size={11} /> {t(`assetKind.${asset.kind}`)}
          {asset.subtype ? ` · ${asset.subtype}` : ''}
        </span>
        {modelName && <span className="badge badge-model" title={asset.modelId}>{modelName}</span>}
        {asset.costUsd !== undefined && <span className="badge badge-cost">{formatUsd(asset.costUsd)}</span>}
        <span className={`status-chip status-${status}`}>{t(`assetStatus.${status}`)}</span>
        {linked && status !== 'linked' && <span className="status-chip status-linked">{t('assetStatus.linked')}</span>}
        {linked && asset.metadata?.missing === true && <span className="status-chip status-missing">{t('assetStatus.missing')}</span>}
      </div>
      <button type="button" className="asset-insert button button-small" onClick={() => onInsert(asset.id)}>
        {t('assets.toComposer')}
      </button>
    </div>
  );
});
