import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatUsd, type Asset, type LineageEdge } from '@studio/core';
import { formatDateTime, useT } from '../../i18n.ts';
import { probeLinkedFile, type LinkedFileState } from '../../lib/assets.ts';
import { formatBytes, formatDurationMs, useClickOutside } from '../../lib/hooks.ts';
import { useActions, useApi, useAssetUrl, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';
import { isMacPlatform } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { AssetPreview } from './AssetCard.tsx';

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

/** Einfache Generierungs-Parameter (Zahlen, Schalter, kurze Texte) für die Detailansicht; Prompt steht eigens. */
function paramRows(input: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === 'prompt' || value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') rows.push([key, String(value)]);
    else if (typeof value === 'string' && value.length <= 80 && !/^(data|blob|https?):/i.test(value)) rows.push([key, value]);
  }
  return rows.slice(0, 12);
}

/**
 * Detailansicht (DESIGN.md §7.3): Overlay-Panel rechts neben der Asset-Leiste (360 px, Höhe der Mittelzone).
 * Vorschau (`.always-dark`), Aktionen, Prompt, Verwendungen, Parameter und Kosten, Herkunft, Metadaten.
 * Schließt mit Esc oder per Klick daneben (Klicks in der Leiste wechseln das Asset).
 */
export function AssetDrawer({
  asset,
  usage,
  inComposer,
  onClose,
  onSelect,
  containerRef,
}: {
  asset: Asset;
  usage: readonly string[];
  inComposer: boolean;
  /** `true`: Fokus zurück auf die Karte (Esc, Schließen-Knopf). */
  onClose: (restoreFocus: boolean) => void;
  onSelect: (id: string) => void;
  /** Bereich, in dem Klicks die Ansicht nicht schließen (die Asset-Leiste samt Overlay). */
  containerRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const actions = useActions();
  const assets = useStudio((s) => s.assets);
  const generations = useStudio((s) => s.generations);
  const assetUrl = useAssetUrl();
  const lineage = useLineage(asset.id);
  const fileState = useLinkedFileState(asset);
  const [relinking, setRelinking] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);
  const generation = generations.find((g) => g.id === asset.generationId || g.outputAssetIds.includes(asset.id));
  const titleOf = (id: string) => assets.find((a) => a.id === id)?.title ?? id;

  useClickOutside([containerRef, drawerRef], () => onClose(false), true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Offene Dialoge und Popover schließen zuerst
      if (document.querySelector('[role="dialog"][aria-modal="true"], .popover')) return;
      e.preventDefault();
      onClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    ['ID', asset.id],
    [t('assets.kind'), `${t(`assetKind.${asset.kind}`)}${asset.subtype ? ` · ${asset.subtype}` : ''}`],
    [t('assets.source'), t(`assetSource.${asset.source}`)],
    [t('assets.created'), formatDateTime(asset.createdAt)],
  ];
  if (asset.modelId) rows.push([t('assets.model'), asset.modelId]);
  if (asset.durationMs !== undefined) rows.push([t('assets.duration'), formatDurationMs(asset.durationMs)]);
  if (asset.width && asset.height) rows.push([t('assets.pixels'), `${asset.width}×${asset.height}${asset.fps ? ` @ ${asset.fps} fps` : ''}`]);
  if (asset.bytes !== undefined) rows.push([t('assets.size'), formatBytes(asset.bytes)]);
  if (asset.path) rows.push([t('assets.path'), asset.path]);
  if (asset.sourceUrl) rows.push(['URL', asset.sourceUrl]);
  if (asset.tags.length) rows.push([t('assets.tags'), asset.tags.join(', ')]);
  const params = generation ? paramRows(generation.input) : [];
  const cost = generation ? (generation.costUsd ?? generation.estimateUsd) : asset.costUsd;

  const relink = async () => {
    setRelinking(true);
    const ok = await actions.relinkAsset(asset.id);
    setRelinking(false);
    // Vorschaubild neu laden (gleiche URL, aber jetzt erreichbare Datei)
    if (ok) setPreviewKey((k) => k + 1);
  };

  const lineageList = (edges: LineageEdge[], idOf: (edge: LineageEdge) => string) =>
    edges.length === 0 ? (
      <span className="asset-drawer-none">—</span>
    ) : (
      <ul className="lineage-list">
        {edges.map((edge) => {
          const id = idOf(edge);
          return (
            <li key={`${id}:${edge.relation}`}>
              <button type="button" className="link-button" onClick={() => onSelect(id)}>
                {titleOf(id)}
              </button>
              <span className="lineage-relation">{t(`lineage.${edge.relation}`)}</span>
            </li>
          );
        })}
      </ul>
    );

  const thumbUrl = asset.kind === 'image' || asset.kind === 'video' ? assetUrl(asset.id, 'thumb') : '';
  const proxyUrl = asset.kind === 'video' ? assetUrl(asset.id, 'proxy') : '';

  return (
    <aside ref={drawerRef} className="asset-drawer" aria-label={`${t('assets.details')}: ${asset.title}`}>
      <div className="asset-drawer-preview always-dark" key={previewKey}>
        <AssetPreview asset={asset} thumbUrl={thumbUrl} proxyUrl={proxyUrl} />
      </div>
      <header className="asset-drawer-header">
        <div className="asset-drawer-heading">
          <h3>{asset.title}</h3>
          <p className="asset-drawer-sub">
            <Icon name={ASSET_KIND_ICONS[asset.kind]} size={12} />
            {t(`assetKind.${asset.kind}`)}
            {asset.subtype ? ` · ${asset.subtype}` : ''} · {t(`assetSource.${asset.source}`)}
            {asset.durationMs !== undefined && (
              <>
                {' · '}
                <span className="mono">{formatDurationMs(asset.durationMs)}</span>
              </>
            )}
          </p>
        </div>
        <Tooltip label={t('common.close')} keys={['Escape']}>
          <button type="button" className="ibtn sm" onClick={() => onClose(true)} aria-label={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        </Tooltip>
      </header>
      {fileState === 'missing' && (
        <div className="asset-missing" role="alert">
          <Icon name="warning" size={14} />
          <span>{t('assets.fileMissing')}</span>
          <button type="button" className="btn sm" onClick={() => void relink()} disabled={relinking} aria-busy={relinking || undefined}>
            <Icon name="link" size={12} /> {t('assets.relink')}
          </button>
        </div>
      )}
      <div className="asset-drawer-actions">
        <button type="button" className="btn sm" onClick={() => actions.insertRef({ kind: 'asset', assetId: asset.id })}>
          <Icon name="plus" size={13} /> {t('assets.toComposer')}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => void actions.revealAsset(asset.id)}>
          <Icon name="folder" size={13} /> {isMacPlatform() ? t('assets.revealMac') : t('assets.revealWin')}
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
        <h4>{t('assets.usages')}</h4>
        {usage.length === 0 && !inComposer ? (
          <p className="asset-drawer-none">{t('assets.usageNone')}</p>
        ) : (
          <div className="asset-usages">
            {inComposer && <span className="asset-usage-ref">{t('assets.inComposer')}</span>}
            {usage.map((place) => (
              <span key={place} className="asset-usage-tag mono">
                {place}
              </span>
            ))}
          </div>
        )}
      </section>
      {(generation || cost !== undefined) && (
        <section>
          <h4>{t('assets.generation')}</h4>
          <dl className="meta-table">
            {generation && (
              <div>
                <dt>{t('assets.model')}</dt>
                <dd className="mono">{generation.endpointId}</dd>
              </div>
            )}
            {generation && (
              <div>
                <dt>{t('assets.status')}</dt>
                <dd>{t(`director.gen.${generation.status}`)}</dd>
              </div>
            )}
            {generation?.purpose && (
              <div>
                <dt>{t('assets.purpose')}</dt>
                <dd>{generation.purpose}</dd>
              </div>
            )}
            {cost !== undefined && (
              <div>
                <dt>{t('assets.cost')}</dt>
                <dd className="mono">{formatUsd(cost)}</dd>
              </div>
            )}
          </dl>
          {params.length > 0 && (
            <>
              <h5>{t('assets.parameters')}</h5>
              <dl className="meta-table">
                {params.map(([k, v]) => (
                  <div key={k}>
                    <dt className="mono">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      )}
      <section>
        <h4>{t('assets.lineage')}</h4>
        {lineage.status === 'loading' ? (
          <p className="asset-drawer-none">{t('common.loading')}</p>
        ) : lineage.status === 'error' ? (
          <p className="asset-drawer-none">{t('assets.lineageError', { error: lineage.error })}</p>
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
    </aside>
  );
}
