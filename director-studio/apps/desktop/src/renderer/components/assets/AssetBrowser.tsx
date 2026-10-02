import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ASSET_SOURCES, assetMatches, type Asset, type AssetKind, type AssetSource } from '@studio/core';
import { useLanguage, useT } from '../../i18n.ts';
import { assetUiStatus, assetUsageMap, matchesStatusFilter, shortModelName, type AssetUiStatus } from '../../lib/assets.ts';
import { hasDragType } from '../../lib/dnd.ts';
import { useDebounced } from '../../lib/hooks.ts';
import { useLayout } from '../../lib/layout.ts';
import { useActions, useApiMode, useAssetUrl, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';
import { ariaKeyShortcuts, isMacPlatform } from '../common/Kbd.tsx';
import { Popover } from '../common/Popover.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { AssetCard, type AssetView } from './AssetCard.tsx';
import { AssetDrawer } from './AssetDrawer.tsx';

type SortKey = 'newest' | 'kind' | 'cost';
type StatusFilter = AssetUiStatus | 'all';
type ViewPref = 'auto' | AssetView;
type GroupBy = 'usage' | 'kind' | 'none';
type UsageGroup = 'inComposer' | 'used' | 'unused' | 'rejected';

const STATUS_FILTERS: StatusFilter[] = ['all', 'used', 'unused', 'rejected', 'linked'];
const SORTS: SortKey[] = ['newest', 'kind', 'cost'];
const GROUPINGS: GroupBy[] = ['usage', 'kind', 'none'];
const USAGE_GROUPS: UsageGroup[] = ['inComposer', 'used', 'unused', 'rejected'];
/** Reihenfolge der Typ-Tabs (§7.3); angezeigt werden nur vorhandene Typen. */
const KIND_ORDER: AssetKind[] = ['image', 'video', 'audio', 'text', 'data', 'code', 'font', 'document', 'web'];
/** Höchstens so viele Typen stehen als Tab in der Zeile; die übrigen kommen in „Mehr“. */
const MAX_INLINE_KINDS = 5;
/** Ab dieser Leistenbreite zeigt „Automatisch“ das Raster mit zwei Spalten, darunter die Liste. */
const GRID_MIN_WIDTH = 264;

const VIEW_KEY = 'director-studio.assets.view';
const GROUP_KEY = 'director-studio.assets.groupBy';

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignorieren (privates Fenster, gesperrter Speicher)
  }
}

/** Breite eines Elements (ResizeObserver); 0, solange unbekannt (jsdom). */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Dateien, die von außen über das Fenster gezogen werden: Solange das passiert, zeigt die Leiste ihr Overlay
 * (§7.3). Zähler über dragenter/dragleave (Capture, damit `stopPropagation` anderer Zonen nicht stört), dazu ein
 * Wächter, falls ein dragleave fehlt.
 */
function useWindowFileDrag(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const isFiles = (e: DragEvent) => hasDragType(e.dataTransfer, 'Files');
    const reset = () => {
      depth = 0;
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      setActive(false);
    };
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(reset, 1200);
    };
    const onEnter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth += 1;
      setActive(true);
      arm();
    };
    const onOver = (e: DragEvent) => {
      if (isFiles(e)) arm();
    };
    const onLeave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    window.addEventListener('dragenter', onEnter, true);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    return () => {
      if (watchdog) clearTimeout(watchdog);
      window.removeEventListener('dragenter', onEnter, true);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
    };
  }, []);
  return active;
}

/** Pfeiltasten in einem Menü (`role="menu"`): Fokus wandert zwischen den Einträgen; beim Öffnen auf den aktuellen. */
function useMenuFocus(open: boolean, listRef: RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const items = list ? [...list.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open, listRef]);
  return (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
}

/** Kleines Popover-Menü mit Ikonen-Auslöser und Tooltip. */
function MenuButton({
  label,
  icon,
  open,
  setOpen,
  align = 'end',
  children,
  className,
  text,
}: {
  label: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  open: boolean;
  setOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  align?: 'start' | 'end';
  children: ReactNode;
  className?: string;
  /** Beschriftung statt Icon (z. B. „Mehr“ in den Typ-Tabs). */
  text?: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const onKeyDown = useMenuFocus(open, listRef);
  const trigger = text ? (
    <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      {text}
    </button>
  ) : (
    <button type="button" className={className ?? 'ibtn sm'} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      {icon && <Icon name={icon} size={14} />}
    </button>
  );
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align={align}
      label={label}
      className="assets-menu"
      anchor={
        text ? (
          trigger
        ) : (
          <Tooltip label={label} disabled={open}>
            {trigger}
          </Tooltip>
        )
      }
    >
      <ul ref={listRef} className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
        {children}
      </ul>
    </Popover>
  );
}

function MenuRadio({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <li role="none">
      <button type="button" role="menuitemradio" aria-checked={checked} onClick={onSelect}>
        <span className="menu-check" aria-hidden="true">
          {checked && <Icon name="check" size={12} />}
        </span>
        {children}
      </button>
    </li>
  );
}

interface Group {
  key: string;
  label: string | null;
  items: Asset[];
}

/**
 * Asset-Leiste (DESIGN.md §7.3): Kopf mit Anzahl, Hinzufügen-Menü und Einklappen · Suche mit Filter-Knopf
 * (Status, Quelle, Modell, Sortierung im Popover) · Typ-Tabs mit Ansicht und Gruppierung · entfernbare
 * Filter-Pills · Gruppen (Verwendung, Typ oder keine) als Raster (ab 264 px) oder Liste · 32-px-Fußzeile ·
 * Drop-Overlay nur beim Ziehen von Dateien · Detailansicht als Overlay neben der Leiste.
 */
export function AssetBrowser({ searchDelayMs = 200 }: { searchDelayMs?: number }) {
  const t = useT();
  const lang = useLanguage(); const native=useApiMode()==='native';
  const dropFooter=native?(lang==='de'?'Dateien hierher ziehen – sie werden im Projekt gespeichert.':'Drag files here to store them in the project.'):t('assets.dropFooter');
  const dropRelease=native?(lang==='de'?'Loslassen zum Importieren':'Release to import'):t('assets.dropRelease');
  const actions = useActions();
  const allAssets = useStudio((s) => s.assets);
  const assets=useMemo(()=>native?allAssets.filter((asset)=>!(asset.source==='derived' && asset.subtype==='thumbnail' && asset.metadata?.sourceAssetId)):allAssets,[allAssets,native]);
  const usedIds = useStudio((s) => s.usedAssetIds);
  const models = useStudio((s) => s.models);
  const composer = useStudio((s) => s.composer);
  const doc = useStudio((s) => s.document);
  const assetUrl = useAssetUrl();
  const layout = useLayout();
  const listId = useId();

  // Sitzung: Typ, Suche, Filter (§10, nicht gespeichert)
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<AssetSource | 'all'>('all');
  const [model, setModel] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  // Gespeichert: Ansicht und Gruppierung
  const [viewPref, setViewPref] = useState<ViewPref>(() => readPref(VIEW_KEY, ['auto', 'grid', 'list'] as const, 'auto'));
  const [groupBy, setGroupByState] = useState<GroupBy>(() => readPref(GROUP_KEY, GROUPINGS, 'usage'));
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const debouncedQuery = useDebounced(query, searchDelayMs);

  const sectionRef = useRef<HTMLElement>(null);
  const width = useElementWidth(sectionRef);
  const fileDrag = useWindowFileDrag();

  const autoView: AssetView = width === 0 || width >= GRID_MIN_WIDTH ? 'grid' : 'list';
  const view: AssetView = viewPref === 'auto' ? autoView : viewPref;
  const toggleView = () => {
    const next: AssetView = view === 'grid' ? 'list' : 'grid';
    // Entspricht die Wahl der Automatik, gilt wieder „automatisch“
    const pref: ViewPref = next === autoView ? 'auto' : next;
    setViewPref(pref);
    writePref(VIEW_KEY, pref);
  };
  const setGroupBy = (value: GroupBy) => {
    setGroupByState(value);
    writePref(GROUP_KEY, value);
    setGroupOpen(false);
  };

  const used = useMemo(() => new Set(usedIds), [usedIds]);
  const inComposer = useMemo(
    () => new Set(composer.flatMap((seg) => (seg.type === 'ref' && seg.ref.kind === 'asset' ? [seg.ref.assetId] : []))),
    [composer],
  );
  const usage = useMemo(() => assetUsageMap(doc), [doc]);
  const modelNames = useMemo(() => new Map((models ?? []).map((m) => [m.id, m.displayName])), [models]);
  const presentKinds = useMemo(() => {
    const kinds = new Set(assets.map((a) => a.kind));
    return KIND_ORDER.filter((k) => kinds.has(k));
  }, [assets]);
  const presentModels = useMemo(() => [...new Set(assets.map((a) => a.modelId).filter((m): m is string => !!m))].sort(), [assets]);
  const activeKind = kind !== 'all' && presentKinds.includes(kind) ? kind : 'all';

  const visible = useMemo(() => {
    const list = assets.filter(
      (a) =>
        (activeKind === 'all' || a.kind === activeKind) &&
        matchesStatusFilter(a, used, status) &&
        (source === 'all' || a.source === source) &&
        (model === 'all' || a.modelId === model) &&
        assetMatches(a, { text: debouncedQuery, statuses: ['active', 'rejected', 'archived'] }),
    );
    const byNewest = (x: Asset, y: Asset) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0);
    if (sort === 'newest') list.sort(byNewest);
    else if (sort === 'kind') list.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.title.localeCompare(y.title));
    else list.sort((x, y) => (y.costUsd ?? 0) - (x.costUsd ?? 0) || byNewest(x, y));
    return list;
  }, [assets, activeKind, used, status, source, model, debouncedQuery, sort]);

  const usageGroupOf = useCallback(
    (a: Asset): UsageGroup => {
      if (a.status === 'rejected' || a.status === 'archived') return 'rejected';
      if (inComposer.has(a.id)) return 'inComposer';
      return used.has(a.id) ? 'used' : 'unused';
    },
    [inComposer, used],
  );
  const groups = useMemo<Group[]>(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, items: visible }];
    if (groupBy === 'kind') {
      return KIND_ORDER.map((k) => ({ key: k, label: t(`assetKind.${k}`), items: visible.filter((a) => a.kind === k) })).filter((g) => g.items.length > 0);
    }
    return USAGE_GROUPS.map((g) => ({ key: g, label: t(`assets.group.${g}`), items: visible.filter((a) => usageGroupOf(a) === g) })).filter(
      (g) => g.items.length > 0,
    );
    // `lang`: Gruppennamen nach einem Sprachwechsel neu
  }, [groupBy, visible, usageGroupOf, lang, t]);
  // „Verworfen“ ist standardmäßig eingeklappt – außer es ist die einzige Gruppe (z. B. Filter „Verworfen“)
  const isCollapsed = (g: Group) => toggledGroups[g.key] ?? (g.key === 'rejected' && groups.length > 1);

  const filterCount = (status !== 'all' ? 1 : 0) + (source !== 'all' ? 1 : 0) + (model !== 'all' ? 1 : 0) + (sort !== 'newest' ? 1 : 0);
  const narrowed = filterCount > 0 || activeKind !== 'all' || debouncedQuery.trim() !== '';
  const resetFilters = () => {
    setQuery('');
    setKind('all');
    setStatus('all');
    setSource('all');
    setModel('all');
    setSort('newest');
  };
  const pills: Array<{ key: string; text: string; onRemove: () => void }> = [];
  if (status !== 'all') pills.push({ key: 'status', text: t('assets.pill', { label: t('assets.status'), value: t(`assets.statusFilter.${status}`) }), onRemove: () => setStatus('all') });
  if (source !== 'all') pills.push({ key: 'source', text: t('assets.pill', { label: t('assets.source'), value: t(`assets.sourceFilter.${source}`) }), onRemove: () => setSource('all') });
  if (model !== 'all') pills.push({ key: 'model', text: t('assets.pill', { label: t('assets.model'), value: shortModelName(model, modelNames) }), onRemove: () => setModel('all') });
  if (sort !== 'newest') pills.push({ key: 'sort', text: t('assets.pill', { label: t('assets.sort'), value: t(`assets.sort.${sort}`) }), onRemove: () => setSort('newest') });

  // Typ-Tabs: so viele wie in die Zeile passen (höchstens fünf), der Rest unter „Mehr“
  const tabsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tabsWidth = useElementWidth(tabsRef);
  const [inlineCount, setInlineCount] = useState(Math.min(presentKinds.length, MAX_INLINE_KINDS));
  useLayoutEffect(() => {
    const cap = Math.min(presentKinds.length, MAX_INLINE_KINDS);
    const measure = measureRef.current;
    if (!measure || tabsWidth === 0) {
      setInlineCount(cap);
      return;
    }
    const widths = [...measure.children].map((el) => el.getBoundingClientRect().width);
    const allW = widths[0] ?? 0;
    const moreW = widths[widths.length - 1] ?? 0;
    const fits = (n: number, withMore: boolean) => allW + widths.slice(1, n + 1).reduce((sum, w) => sum + w, 0) + (withMore ? moreW : 0) <= tabsWidth + 0.5;
    if (presentKinds.length <= MAX_INLINE_KINDS && fits(presentKinds.length, false)) {
      setInlineCount(presentKinds.length);
      return;
    }
    let n = cap;
    while (n > 0 && !fits(n, true)) n -= 1;
    setInlineCount(n);
  }, [tabsWidth, presentKinds, lang]);
  const inlineKinds = presentKinds.slice(0, inlineCount);
  const moreKinds = presentKinds.slice(inlineCount);
  const activeInMore = activeKind !== 'all' && moreKinds.includes(activeKind);
  const pickKind = (k: AssetKind | 'all') => setKind((cur) => (k !== 'all' && cur === k ? 'all' : k));

  // Zeigen eines Asset-Chips (§9.4): Ist die Karte ausgefiltert oder ihre Gruppe eingeklappt, wird sie sichtbar gemacht
  const flashKey = useStudio((s) => s.flash?.key ?? null);
  const flashNonce = useStudio((s) => s.flash?.nonce ?? 0);
  useEffect(() => {
    if (!flashKey?.startsWith('asset:')) return;
    const asset = assets.find((a) => a.id === flashKey.slice('asset:'.length));
    if (!asset) return;
    if (!visible.includes(asset)) {
      setQuery('');
      setKind('all');
      setStatus('all');
      setSource('all');
      setModel('all');
    }
    const groupKey = groupBy === 'none' ? 'all' : groupBy === 'kind' ? asset.kind : usageGroupOf(asset);
    setToggledGroups((cur) => (cur[groupKey] === false ? cur : { ...cur, [groupKey]: false }));
    // Nur beim Blitz selbst (neue Nonce), nicht bei jeder Änderung der Liste
  }, [flashKey, flashNonce]);

  // mod+K fokussiert die Suche (§13.4), solange die Leiste offen ist
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (e.defaultPrevented || !mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      const input = sectionRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selected = selectedId ? assets.find((a) => a.id === selectedId) : undefined;
  const [drawerFocus, setDrawerFocus] = useState(false);
  const onOpen = useCallback((id: string, viaKeyboard: boolean) => {
    setDrawerFocus(viaKeyboard);
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);
  const onInsert = useCallback((id: string) => actions.insertRef({ kind: 'asset', assetId: id }), [actions]);
  const onRelink = useCallback((id: string) => void actions.relinkAsset(id), [actions]);
  const closeDrawer = useCallback(
    (restoreFocus: boolean) => {
      const id = selectedId;
      setSelectedId(null);
      if (restoreFocus && id) sectionRef.current?.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(id)}"] .asset-card-main`)?.focus();
    },
    [selectedId],
  );

  // Ablage von Dateien auf der Leiste: verknüpfen, ohne Chips zu setzen
  const onDragOver = (e: React.DragEvent) => {
    if (!hasDragType(e.dataTransfer, 'Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = native?'copy':'link';
    if (!dropOver) setDropOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropOver(false);
    if (!hasDragType(e.dataTransfer, 'Files')) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void actions.importDroppedFiles(files, { insert: false });
  };
  useEffect(() => {
    if (!fileDrag) setDropOver(false);
  }, [fileDrag]);

  const filterButton = (
    <Tooltip label={t('assets.filter')} disabled={filterOpen}>
      <button
        type="button"
        className={`ibtn sm assets-filter-btn${filterCount > 0 ? ' is-active' : ''}`}
        aria-label={filterCount > 0 ? t('assets.filterActive') : t('assets.filter')}
        aria-haspopup="dialog"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((v) => !v)}
      >
        <Icon name="filter" size={14} />
        {filterCount > 0 && <span className="assets-filter-dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  );

  let body: ReactNode;
  if (assets.length === 0) {
    body = (
      <div className="empty-state assets-empty">
        <Icon name="image" size={20} />
        <strong>{t('assets.emptyTitle')}</strong>
        <span>{t('assets.emptyText')}</span>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="empty-state assets-empty">
        <Icon name="search" size={20} />
        <strong>{debouncedQuery.trim() ? t('assets.noHits', { query: debouncedQuery.trim() }) : t('assets.empty')}</strong>
        <button type="button" className="btn sm" onClick={resetFilters}>
          {t('assets.filterReset')}
        </button>
      </div>
    );
  } else {
    body = groups.map((g) => {
      const collapsed = isCollapsed(g);
      const headId = `${listId}-${g.key}`;
      return (
        <section key={g.key} className={`asset-group${collapsed ? ' is-collapsed' : ''}`} aria-labelledby={g.label ? headId : undefined}>
          {g.label && (
            <h3 className="asset-group-head">
              <button
                type="button"
                id={headId}
                aria-expanded={!collapsed}
                onClick={() => setToggledGroups((cur) => ({ ...cur, [g.key]: !collapsed }))}
              >
                <Icon name="chevronRight" size={12} className="asset-group-chevron" />
                <span className="overline">{g.label}</span>
                <span className="asset-group-count mono">{g.items.length}</span>
              </button>
            </h3>
          )}
          {!collapsed && (
            <div className={`asset-list is-${view}`} role="list" aria-label={g.label ?? t('assets.label')}>
              {g.items.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  status={assetUiStatus(asset, used)}
                  usage={usage.get(asset.id) ?? EMPTY}
                  inComposer={inComposer.has(asset.id)}
                  modelName={asset.modelId ? shortModelName(asset.modelId, modelNames) : null}
                  thumbUrl={asset.kind === 'image' || asset.kind === 'video' ? assetUrl(asset.id, 'thumb') : ''}
                  proxyUrl={asset.kind === 'video' ? assetUrl(asset.id, 'proxy') : ''}
                  selected={asset.id === selectedId}
                  view={view}
                  onOpen={onOpen}
                  onInsert={onInsert}
                  onRelink={onRelink}
                />
              ))}
            </div>
          )}
        </section>
      );
    });
  }

  return (
    <section
      ref={sectionRef}
      className={`assets${fileDrag ? ' is-file-drag' : ''}`}
      aria-label={t('assets.label')}
      onDragOver={fileDrag ? onDragOver : undefined}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
      }}
      onDrop={fileDrag ? onDrop : undefined}
    >
      <header className="assets-head">
        <h2>{t('assets.title')}</h2>
        <span className="assets-count" aria-live="polite">
          {narrowed ? t('assets.count', { count: visible.length, total: assets.length }) : assets.length}
        </span>
        <span className="spacer" />
        <MenuButton label={t('assets.add')} icon="plus" open={addOpen} setOpen={setAddOpen}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAddOpen(false);
                void actions.importFiles('import');
              }}
            >
              <Icon name="plus" size={14} />
              {t('assets.import')}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAddOpen(false);
                void actions.importFiles('link');
              }}
            >
              <Icon name="link" size={14} />
              {t('assets.link')}
            </button>
          </li>
        </MenuButton>
        {layout && (
          <Tooltip label={t('layout.hideAssets')} keys={['mod', '1']}>
            <button
              type="button"
              className="ibtn sm"
              aria-label={t('layout.hideAssets')}
              aria-expanded={true}
              aria-keyshortcuts={ariaKeyShortcuts(['mod', '1'])}
              onClick={() => layout.toggle('assets')}
            >
              <Icon name="sideLeft" size={15} />
            </button>
          </Tooltip>
        )}
      </header>

      <div className="assets-tools">
        <Popover
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          align="start"
          label={t('assets.filter')}
          className="assets-filter-pop"
          anchor={
            <div className="field assets-search">
              <Icon name="search" size={14} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('assets.searchPlaceholder')}
                aria-label={t('assets.search')}
                aria-keyshortcuts={ariaKeyShortcuts(['mod', 'K'])}
              />
              {filterButton}
            </div>
          }
        >
          <h3 className="assets-pop-head">{t('assets.filter')}</h3>
          <div className="assets-filter-grid">
            <label htmlFor={`${listId}-status`}>{t('assets.status')}</label>
            <select id={`${listId}-status`} className="field" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={t('assets.status')}>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {t(`assets.statusFilter.${s}`)}
                </option>
              ))}
            </select>
            <label htmlFor={`${listId}-source`}>{t('assets.source')}</label>
            <select id={`${listId}-source`} className="field" value={source} onChange={(e) => setSource(e.target.value as AssetSource | 'all')} aria-label={t('assets.source')}>
              <option value="all">{t('common.all')}</option>
              {ASSET_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`assets.sourceFilter.${s}`)}
                </option>
              ))}
            </select>
            <label htmlFor={`${listId}-model`}>{t('assets.model')}</label>
            <select id={`${listId}-model`} className="field" value={model} onChange={(e) => setModel(e.target.value)} aria-label={t('assets.model')}>
              <option value="all">{t('common.all')}</option>
              {presentModels.map((m) => (
                <option key={m} value={m}>
                  {shortModelName(m, modelNames)}
                </option>
              ))}
            </select>
            <label htmlFor={`${listId}-sort`}>{t('assets.sort')}</label>
            <select id={`${listId}-sort`} className="field" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('assets.sort')}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`assets.sort.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {filterCount > 0 && (
            <div className="assets-pop-foot">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setStatus('all');
                  setSource('all');
                  setModel('all');
                  setSort('newest');
                }}
              >
                {t('assets.filterReset')}
              </button>
            </div>
          )}
        </Popover>

        <div className="assets-tabrow">
          <div ref={tabsRef} className="assets-tabs" role="group" aria-label={t('assets.kind')}>
            <button type="button" className="assets-tab" aria-pressed={activeKind === 'all'} onClick={() => pickKind('all')}>
              {t('common.all')}
            </button>
            {inlineKinds.map((k) => (
              <button key={k} type="button" className="assets-tab" aria-pressed={activeKind === k} onClick={() => pickKind(k)}>
                {t(`assetKind.${k}`)}
              </button>
            ))}
            {moreKinds.length > 0 && (
              <MenuButton
                label={t('assets.more')}
                open={moreOpen}
                setOpen={setMoreOpen}
                align="start"
                className={`assets-tab assets-tab-more${activeInMore ? ' is-on' : ''}`}
                text={
                  <>
                    {activeInMore ? t(`assetKind.${activeKind}`) : t('assets.more')}
                    <Icon name="chevronDown" size={12} />
                  </>
                }
              >
                {moreKinds.map((k) => (
                  <MenuRadio
                    key={k}
                    checked={activeKind === k}
                    onSelect={() => {
                      setMoreOpen(false);
                      pickKind(k);
                    }}
                  >
                    <Icon name={ASSET_KIND_ICONS[k]} size={14} />
                    {t(`assetKind.${k}`)}
                  </MenuRadio>
                ))}
              </MenuButton>
            )}
          </div>
          {/* Messzeile (unsichtbar): Breiten aller Tabs für die Verteilung auf Zeile und „Mehr“ */}
          <div ref={measureRef} className="assets-tabs assets-tabs-measure" aria-hidden="true">
            <span className="assets-tab">{t('common.all')}</span>
            {presentKinds.map((k) => (
              <span key={k} className="assets-tab">
                {t(`assetKind.${k}`)}
              </span>
            ))}
            <span className="assets-tab assets-tab-more">
              {t('assets.more')}
              <Icon name="chevronDown" size={12} />
            </span>
          </div>
          <Tooltip label={view === 'grid' ? t('assets.view.showList') : t('assets.view.showGrid')}>
            <button type="button" className="ibtn sm" aria-label={view === 'grid' ? t('assets.view.showList') : t('assets.view.showGrid')} onClick={toggleView}>
              <Icon name={view === 'grid' ? 'list' : 'grid'} size={14} />
            </button>
          </Tooltip>
          <MenuButton label={t('assets.group')} icon="group" open={groupOpen} setOpen={setGroupOpen}>
            {GROUPINGS.map((g) => (
              <MenuRadio key={g} checked={groupBy === g} onSelect={() => setGroupBy(g)}>
                {t(`assets.group.${g}`)}
              </MenuRadio>
            ))}
          </MenuButton>
        </div>

        {pills.length > 0 && (
          <div className="assets-pills">
            {pills.map((pill) => (
              <span key={pill.key} className="assets-pill">
                <span className="assets-pill-text">{pill.text}</span>
                <button type="button" className="assets-pill-x" aria-label={t('assets.filterRemove', { label: pill.text })} onClick={pill.onRemove}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="assets-body" id={listId}>
        {body}
      </div>

      <footer className="assets-foot">
        <Icon name="link" size={13} />
        <Tooltip label={dropFooter}>
          <span className="assets-foot-text">{dropFooter}</span>
        </Tooltip>
      </footer>

      {fileDrag && (
        <div className={`assets-drop${dropOver ? ' is-over' : ''}`} aria-hidden="true">
          <Icon name="link" size={18} />
          <span>{dropRelease}</span>
        </div>
      )}

      {selected && (
        <AssetDrawer
          asset={selected}
          usage={usage.get(selected.id) ?? EMPTY}
          inComposer={inComposer.has(selected.id)}
          autoFocus={drawerFocus}
          onClose={closeDrawer}
          onSelect={setSelectedId}
          containerRef={sectionRef}
        />
      )}
    </section>
  );
}

const EMPTY: readonly string[] = [];
