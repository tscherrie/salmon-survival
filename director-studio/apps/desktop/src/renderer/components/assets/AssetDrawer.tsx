import { useEffect, useState } from 'react';
import { formatUsd, type Asset, type LineageEdge } from '@studio/core';
import { formatDateTime, useT } from '../../i18n.ts';
import { probeLinkedFile, type LinkedFileState } from '../../lib/assets.ts';
import { formatBytes, formatDurationMs } from '../../lib/hooks.ts';
import { useActions, useApi, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';

type LineageState = { status: 'loading' } | { status: 'ready'; parents: LineageEdge[]; children: LineageEdge[] } | { status: 'error'; error: string };

/**
 * Herkunft über `api.getLineage` (Kanten mit Relation). Neu geladen, wenn sich das Asset, die Asset-Liste
 * oder die Generierungen ändern (neue Kinder entstehen durch Generierungen).
 */
function useLineage(assetId: string): LineageState {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const assets = useStudio((s) => s.assets);
  const generations = useStudio((s) => s.generations);
  const [state, setState] = useState<{ assetId: string; value: LineageState } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api
      .getLineage(projectId, assetId)
      .then((result) => {
        if (alive) setState({ assetId, value: { status: 'ready', parents: result.parents, children: result.children } });
      })
      .catch((error: unknown) => {
        if (alive) setState({ assetId, value: { status: 'error', error: error instanceof Error ? error.message : String(error) } });
      });
    return () => {
      alive = false;
    };
  }, [api, projectId, assetId, assets, generations]);
  // Beim Wechsel des Assets nicht kurz die Herkunft des vorigen zeigen.
  return state && state.assetId === assetId ? state.value : { status: 'loading' };
}

/** Erreichbarkeit der Datei eines verknüpften Assets (siehe `probeLinkedFile`). */
function useLinkedFileState(asset: Asset): LinkedFileState {
  const assetUrl = useAssetUrl();
  const [state, setState] = useState<{ asset: Asset; value: LinkedFileState }>({ asset, value: 'unknown' });
  const url = asset.source === 'linked' ? assetUrl(asset.id, 'original') : '';
  useEffect(() => {
    let alive = true;
    void probeLinkedFile(asset, url).then((value) => {
      if (alive) setState({ asset, value });
    });
    return () => {
      alive = false;
    };
  }, [asset, url]);
  if (asset.metadata?.missing === true) return 'missing';
  return state.asset === asset ? state.value : 'unknown';
}

/** Detail-Drawer: Metadaten, Prompt, Herkunft, Generierung, Aktionen. */
export function AssetDrawer({ asset, onClose, onSelect }: { asset: Asset; onClose: () => void; onSelect: (id: string) => void }) {
  const t = useT();
  const actions = useActions();
  const assets = useStudio((s) => s.assets);
  const generations = useStudio((s) => s.generations);
  const assetUrl = useAssetUrl();
  const lineage = useLineage(asset.id);
  const fileState = useLinkedFileState(asset);
  const [relinking, setRelinking] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
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
  if (asset.width && asset.height) rows.push([t('assets.pixels'), `${asset.width}×${asset.height}${asset.fps ? ` @ ${asset.fps} fps` : ''}`]);
  if (asset.bytes !== undefined) rows.push([t('assets.size'), formatBytes(asset.bytes)]);
  if (asset.path) rows.push([t('assets.path'), asset.path]);
  if (asset.sourceUrl) rows.push(['URL', asset.sourceUrl]);
  if (asset.tags.length) rows.push([t('assets.tags'), asset.tags.join(', ')]);

  const relink = async () => {
    setRelinking(true);
    const ok = await actions.relinkAsset(asset.id);
    setRelinking(false);
    // Vorschaubild neu laden (gleiche URL, aber jetzt erreichbare Datei)
    if (ok) setPreviewKey((k) => k + 1);
  };

  const lineageList = (edges: LineageEdge[], idOf: (edge: LineageEdge) => string) =>
    edges.length === 0 ? (
      <span className="muted">—</span>
    ) : (
      <ul className="lineage-list">
        {edges.map((edge) => {
          const id = idOf(edge);
          return (
            <li key={`${id}:${edge.relation}`}>
              <button type="button" className="link-button" onClick={() => onSelect(id)}>
                {titleOf(id)} <code>{id}</code>
              </button>
              <span className="lineage-relation">{t(`lineage.${edge.relation}`)}</span>
            </li>
          );
        })}
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
      {fileState === 'missing' ? (
        <div className="asset-missing" role="alert">
          <Icon name="warning" size={14} />
          <span>{t('assets.fileMissing')}</span>
          <button type="button" className="button button-small" onClick={() => void relink()} disabled={relinking}>
            <Icon name="link" size={12} /> {t('assets.relink')}
          </button>
        </div>
      ) : (
        (asset.kind === 'image' || asset.kind === 'video') && <img key={previewKey} className="asset-drawer-preview" src={assetUrl(asset.id, 'thumb')} alt="" />
      )}
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
        {lineage.status === 'loading' ? (
          <p className="muted">{t('common.loading')}</p>
        ) : lineage.status === 'error' ? (
          <p className="muted">{t('assets.lineageError', { error: lineage.error })}</p>
        ) : (
          <div className="lineage">
            <div>
              <span className="lineage-label">{t('assets.parents')}</span>
              {lineageList(lineage.parents, (e) => e.parentId)}
            </div>
            <div>
              <span className="lineage-label">{t('assets.children')}</span>
              {lineageList(lineage.children, (e) => e.childId)}
            </div>
          </div>
        )}
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
              <dt>{t('assets.status')}</dt>
              <dd>{t(`director.gen.${generation.status}`)}</dd>
            </div>
            <div>
              <dt>{t('assets.purpose')}</dt>
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
