import { useCallback, useMemo, useState } from 'react';
import { ASSET_SOURCES, assetMatches, type AssetKind, type AssetSource } from '@studio/core';
import { useT } from '../../i18n.ts';
import { assetUiStatus, matchesStatusFilter, shortModelName, type AssetUiStatus } from '../../lib/assets.ts';
import { useDebounced } from '../../lib/hooks.ts';
import { useLayout } from '../../lib/layout.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';
import { ariaKeyShortcuts } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { AssetCard } from './AssetCard.tsx';
import { AssetDrawer } from './AssetDrawer.tsx';

type SortKey = 'newest' | 'kind' | 'cost';
const STATUS_FILTERS: Array<AssetUiStatus | 'all'> = ['all', 'used', 'unused', 'rejected', 'linked'];

/** Asset-Browser (linke Seitenleiste): Kopf mit Import und Einklappen, Filter, Suche, Sortierung, Karten, Details. */
export function AssetBrowser({ searchDelayMs = 200 }: { searchDelayMs?: number }) {
  const t = useT();
  const actions = useActions();
  const assets = useStudio((s) => s.assets);
  const usedIds = useStudio((s) => s.usedAssetIds);
  const models = useStudio((s) => s.models);
  const assetUrl = useAssetUrl();
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<AssetKind[]>([]);
  const [status, setStatus] = useState<AssetUiStatus | 'all'>('all');
  const [source, setSource] = useState<AssetSource | 'all'>('all');
  const [model, setModel] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debouncedQuery = useDebounced(query, searchDelayMs);
  const layout = useLayout();

  const used = useMemo(() => new Set(usedIds), [usedIds]);
  const modelNames = useMemo(() => new Map((models ?? []).map((m) => [m.id, m.displayName])), [models]);
  const presentKinds = useMemo(() => [...new Set(assets.map((a) => a.kind))].sort(), [assets]);
  const presentModels = useMemo(() => [...new Set(assets.map((a) => a.modelId).filter((m): m is string => !!m))].sort(), [assets]);

  const visible = useMemo(() => {
    const list = assets.filter(
      (a) =>
        (kinds.length === 0 || kinds.includes(a.kind)) &&
        matchesStatusFilter(a, used, status) &&
        (source === 'all' || a.source === source) &&
        (model === 'all' || a.modelId === model) &&
        assetMatches(a, { text: debouncedQuery, statuses: ['active', 'rejected', 'archived'] }),
    );
    const byNewest = (x: (typeof list)[number], y: (typeof list)[number]) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0);
    if (sort === 'newest') list.sort(byNewest);
    else if (sort === 'kind') list.sort((x, y) => x.kind.localeCompare(y.kind) || x.title.localeCompare(y.title));
    else list.sort((x, y) => (y.costUsd ?? 0) - (x.costUsd ?? 0) || byNewest(x, y));
    return list;
  }, [assets, kinds, used, status, source, model, debouncedQuery, sort]);

  const selected = selectedId ? assets.find((a) => a.id === selectedId) : undefined;
  const onOpen = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);
  const onInsert = useCallback((id: string) => actions.insertRef({ kind: 'asset', assetId: id }), [actions]);
  const toggleKind = (kind: AssetKind) => setKinds((ks) => (ks.includes(kind) ? ks.filter((k) => k !== kind) : [...ks, kind]));

  return (
    <section className="assets" aria-label={t('assets.label')}>
      <header className="assets-head">
        <h2>{t('assets.title')}</h2>
        <span className="assets-count" aria-live="polite">
          {t('assets.count', { count: visible.length, total: assets.length })}
        </span>
        <span className="spacer" />
        <Tooltip label={t('assets.link')}>
          <button type="button" className="ibtn" onClick={() => void actions.importFiles('link')} aria-label={t('assets.link')}>
            <Icon name="link" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('assets.import')}>
          <button type="button" className="ibtn" onClick={() => void actions.importFiles('import')} aria-label={t('assets.import')}>
            <Icon name="plus" size={16} />
          </button>
        </Tooltip>
        {layout && (
          <Tooltip label={t('layout.hideAssets')} keys={['mod', '1']}>
            <button
              type="button"
              className="ibtn"
              aria-label={t('layout.hideAssets')}
              aria-expanded={true}
              aria-keyshortcuts={ariaKeyShortcuts(['mod', '1'])}
              onClick={() => layout.toggle('assets')}
            >
              <Icon name="sideLeft" size={16} />
            </button>
          </Tooltip>
        )}
      </header>
      <div className="assets-toolbar" role="toolbar" aria-label={t('assets.label')}>
        <div className="field search-box">
          <Icon name="search" size={14} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('assets.searchPlaceholder')} aria-label={t('assets.search')} />
        </div>
        <div className="kind-filters" role="group" aria-label={t('assets.kind')}>
          {presentKinds.map((kind) => (
            <button key={kind} type="button" className="filter-chip" aria-pressed={kinds.includes(kind)} onClick={() => toggleKind(kind)}>
              <Icon name={ASSET_KIND_ICONS[kind]} size={12} /> {t(`assetKind.${kind}`)}
            </button>
          ))}
        </div>
        <label className="select-label">
          <span>{t('assets.status')}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as AssetUiStatus | 'all')} aria-label={t('assets.status')}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('assets.filterAll', { label: t('assets.status') }) : t(`assetStatus.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          <span>{t('assets.source')}</span>
          <select value={source} onChange={(e) => setSource(e.target.value as AssetSource | 'all')} aria-label={t('assets.source')}>
            <option value="all">{t('assets.filterAll', { label: t('assets.source') })}</option>
            {ASSET_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`assetSource.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          <span>{t('assets.model')}</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t('assets.model')}>
            <option value="all">{t('assets.filterAll', { label: t('assets.model') })}</option>
            {presentModels.map((m) => (
              <option key={m} value={m}>
                {shortModelName(m, modelNames)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          <span>{t('assets.sort')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('assets.sort')}>
            <option value="newest">{t('assets.sort.newest')}</option>
            <option value="kind">{t('assets.sort.kind')}</option>
            <option value="cost">{t('assets.sort.cost')}</option>
          </select>
        </label>
      </div>
      <div className="assets-body">
        <div className="assets-grid" role="list" aria-label={t('assets.label')}>
          {visible.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              status={assetUiStatus(asset, used)}
              linked={asset.source === 'linked'}
              modelName={asset.modelId ? shortModelName(asset.modelId, modelNames) : null}
              thumbUrl={asset.kind === 'image' || asset.kind === 'video' ? assetUrl(asset.id, 'thumb') : ''}
              proxyUrl={asset.kind === 'video' ? assetUrl(asset.id, 'proxy') : ''}
              selected={asset.id === selectedId}
              onOpen={onOpen}
              onInsert={onInsert}
            />
          ))}
          {visible.length === 0 && <p className="assets-empty">{t('assets.empty')}</p>}
        </div>
        {selected && <AssetDrawer asset={selected} onClose={() => setSelectedId(null)} onSelect={setSelectedId} />}
      </div>
    </section>
  );
}
