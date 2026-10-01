import { useMemo } from 'react';
import { formatUsd, type Asset } from '@studio/core';
import { formatDateTime, useT } from '../../i18n.ts';
import { lineageOf } from '../../lib/assets.ts';
import { formatBytes, formatDurationMs } from '../../lib/hooks.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';

/** Detail-Drawer: Metadaten, Prompt, Herkunft, Generierung, Aktionen. */
export function AssetDrawer({ asset, onClose, onSelect }: { asset: Asset; onClose: () => void; onSelect: (id: string) => void }) {
  const t = useT();
  const actions = useActions();
  const assets = useStudio((s) => s.assets);
  const generations = useStudio((s) => s.generations);
  const assetUrl = useAssetUrl();
  const lineage = useMemo(() => lineageOf(asset, assets, generations), [asset, assets, generations]);
  const generation = generations.find((g) => g.id === asset.generationId || g.outputAssetIds.includes(asset.id));
  const titleOf = (id: string) => assets.find((a) => a.id === id)?.title ?? id;

  const rows: Array<[string, string]> = [
    ['ID', asset.id],
    [t('assets.kind'), `${t(`assetKind.${asset.kind}`)}${asset.subtype ? ` · ${asset.subtype}` : ''}`],
    [t('assets.source'), t(`assetSource.${asset.source}`)],
    [t('assets.created'), formatDateTime(asset.createdAt)],
  ];
  if (asset.modelId) rows.push([t('assets.model'), asset.modelId]);
  if (asset.costUsd !== undefined) rows.push([t('assets.cost'), formatUsd(asset.costUsd)]);
  if (asset.durationMs !== undefined) rows.push([t('assets.duration'), formatDurationMs(asset.durationMs)]);
  if (asset.width && asset.height) rows.push(['Pixel', `${asset.width}×${asset.height}${asset.fps ? ` @ ${asset.fps} fps` : ''}`]);
  if (asset.bytes !== undefined) rows.push([t('assets.size'), formatBytes(asset.bytes)]);
  if (asset.path) rows.push([t('assets.path'), asset.path]);
  if (asset.sourceUrl) rows.push(['URL', asset.sourceUrl]);
  if (asset.tags.length) rows.push([t('assets.tags'), asset.tags.join(', ')]);

  const lineageList = (ids: string[]) =>
    ids.length === 0 ? (
      <span className="muted">—</span>
    ) : (
      <ul className="lineage-list">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" className="link-button" onClick={() => onSelect(id)}>
              {titleOf(id)} <code>{id}</code>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <aside className="asset-drawer" aria-label={`${t('assets.details')}: ${asset.title}`}>
      <header className="asset-drawer-header">
        <h3>{asset.title}</h3>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </header>
      {(asset.kind === 'image' || asset.kind === 'video') && <img className="asset-drawer-preview" src={assetUrl(asset.id, 'thumb')} alt="" />}
      <div className="asset-drawer-actions">
        <button type="button" className="button button-primary button-small" onClick={() => actions.insertRef({ kind: 'asset', assetId: asset.id })}>
          {t('assets.toComposer')}
        </button>
        <button type="button" className="button button-small" onClick={() => void actions.revealAsset(asset.id)}>
          <Icon name="folder" size={13} /> {t('assets.reveal')}
        </button>
      </div>
      {asset.description && <p className="asset-drawer-desc">{asset.description}</p>}
      {asset.prompt && (
        <section>
          <h4>{t('assets.prompt')}</h4>
          <p className="asset-prompt">{asset.prompt}</p>
        </section>
      )}
      <section>
        <h4>{t('assets.metadata')}</h4>
        <dl className="meta-table">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h4>{t('assets.lineage')}</h4>
        <div className="lineage">
          <div>
            <span className="lineage-label">{t('assets.parents')}</span>
            {lineageList(lineage.parents)}
          </div>
          <div>
            <span className="lineage-label">{t('assets.children')}</span>
            {lineageList(lineage.children)}
          </div>
        </div>
      </section>
      {generation && (
        <section>
          <h4>{t('assets.generation')}</h4>
          <dl className="meta-table">
            <div>
              <dt>{t('assets.model')}</dt>
              <dd>{generation.endpointId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{t(`director.gen.${generation.status}`)}</dd>
            </div>
            <div>
              <dt>Zweck</dt>
              <dd>{generation.purpose}</dd>
            </div>
            <div>
              <dt>{t('assets.cost')}</dt>
              <dd>{formatUsd(generation.costUsd ?? generation.estimateUsd)}</dd>
            </div>
          </dl>
        </section>
      )}
    </aside>
  );
}
