import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VIEWPORTS, type PreviewViewport, type Rect, type Ref, type Site } from '@studio/core';
import { PICK_MODE_MESSAGE } from '../../lib/previewMessages.ts';
import { useLanguage, useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { isPageRef, refKey } from '../../lib/refNumbers.ts';
import { useActions, useApi, useApiMode, useStudio, useStudioStore } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { MonitorCoach, MonitorEmpty, ModeSegment, type ModeOption } from './MonitorParts.tsx';
import { PointerOverlay, SelectionLayer, sizeLabel, useMonitorSelections, usePointRef } from './PointerOverlay.tsx';
import { STAGE_PAD_X, STAGE_PAD_Y } from './VideoMonitor.tsx';

const VIEWPORT_IDS: PreviewViewport[] = ['mobile', 'tablet', 'desktop'];
const VIEWPORT_ICONS: Record<PreviewViewport, IconName> = { mobile: 'mobile', tablet: 'tablet', desktop: 'monitor' };

/** Zeigemodus der Web-Vorschau: Seite bedienen, Element wählen (Picker der Vorschau) oder Region ziehen. */
type WebMode = 'view' | 'element' | 'region';

/** Ein Web-Element-Pick: Element-Ref auf einer Seite, nicht die ganze Seite. */
const isSitePick = (ref: Ref) => ref.kind === 'element' && ref.doc === 'site' && !isPageRef(ref);

/**
 * Web-Vorschau. Electron: eingebettete `WebContentsView` (Main-Prozess) – hier nur ein Platzhalter,
 * dessen Position per `previewSetBounds` gemeldet wird; die Seitenwahl navigiert sie per `previewNavigate`.
 * Browser/Fake: `<iframe sandbox="allow-scripts">`, die Seite steht im Hash der iframe-URL.
 * Element-Picks kommen in beiden Fällen als `preview_pick`-Ereignis und landen als Chip im Composer.
 */
export function WebMonitor({ site }: { site: Site }) {
  const t = useT(); const language=useLanguage();
  const api = useApi();
  const mode = useApiMode();
  const actions = useActions();
  const store = useStudioStore();
  const pointRef = usePointRef();
  const projectId = useStudio((s) => s.projectId);
  const viewport = useStudio((s) => s.viewport);
  const selectedPageId = useStudio((s) => s.selectedPageId);
  const overlays = useStudio((s) => s.overlays);
  const preview = useStudio((s) => s.preview);
  const [url, setUrl] = useState<string | null>(null);
  /** Zählt abgeschlossene `previewOpen`-Aufrufe (jeder lädt die Startseite der Site). */
  const [openCount, setOpenCount] = useState(0);
  const justOpened = useRef(false);
  const [pointMode, setPointMode] = useState<WebMode>('view');
  /** Erhöht sich bei *Neu laden*: baut das iframe neu auf bzw. navigiert die native Vorschau erneut. */
  const [reloadNonce, setReloadNonce] = useState(0);
  /** Erhöht sich bei *Neu laden* nach einem Fehler: öffnet die Vorschau neu. */
  const [openNonce, setOpenNonce] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const size = useElementSize(hostRef);
  const page = site.pages.find((p) => p.id === selectedPageId) ?? site.pages[0];
  const pagePath = page?.path ?? '/';
  const vp = VIEWPORTS[viewport];
  const pickMode = pointMode === 'element';
  // Region ziehen braucht eine Ebene über der Vorschau; die native Ansicht in Electron liegt über dem DOM
  const regionAvailable = mode !== 'electron';
  const sourceRevision = mode === 'native' ? JSON.stringify(site.files) : '';

  const modes = useMemo<ReadonlyArray<ModeOption<WebMode>>>(
    () => [
      { id: 'view', label: t('monitor.mode.view'), tip: t('monitor.modeTip.view'), icon: 'eye' },
      { id: 'element', label: t('monitor.mode.element'), tip: t('monitor.modeTip.element'), icon: 'cursor' },
      ...(regionAvailable ? [{ id: 'region' as const, label: t('monitor.mode.region'), tip: t('monitor.modeTip.region'), icon: 'region' as const }] : []),
    ],
    [t, regionAvailable],
  );

  // Vorschau öffnen (je Viewport)
  useEffect(() => {
    if (!projectId) return;
    if(mode==='native' && !Object.keys(site.files).length){setUrl(null);return;}
    let alive = true;
    api
      .previewOpen(projectId, { viewport })
      .then((result) => {
        if (!alive) return;
        setUrl(result.url);
        justOpened.current = true;
        setOpenCount((n) => n + 1);
      })
      .catch((error: unknown) => {
        // Veraltete Anfrage (Viewport gewechselt, Projekt geschlossen): kein Fehler-Toast.
        if (!alive) return;
        actions.toast('error', t('monitor.previewError', { error: error instanceof Error ? error.message : String(error) }));
      });
    return () => {
      alive = false;
    };
  }, [api, projectId, viewport, openNonce, actions, t, sourceRevision]);

  // Electron: Platzhalter-Position an die native Ansicht melden; bei offenen Dialogen ausblenden.
  useLayoutEffect(() => {
    if (mode !== 'electron' || !projectId) return;
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const bounds: Rect | null = overlays > 0 || r.width === 0 ? null : { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      void api.previewSetBounds(projectId, bounds);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [mode, api, projectId, overlays, size.width, size.height]);

  useEffect(() => {
    if (mode !== 'electron' || !projectId) return;
    return () => {
      void api.previewSetBounds(projectId, null);
    };
  }, [mode, api, projectId]);

  // Electron: Seitenwahl (Seitenkarte der Bühne oder Auswahl im Monitor) navigiert die native Vorschau.
  useEffect(() => {
    if ((mode !== 'electron' && mode !== 'native') || !projectId || openCount === 0) return;
    const fresh = justOpened.current;
    justOpened.current = false;
    // Direkt nach dem Öffnen steht die Vorschau bereits auf der Startseite.
    if (fresh && pagePath === '/' && reloadNonce === 0) return;
    api.previewNavigate(projectId, pagePath).catch((error: unknown) => actions.toast('error', t('monitor.previewError', { error: error instanceof Error ? error.message : String(error) })));
  }, [mode, api, projectId, openCount, pagePath, reloadNonce, actions, t]);

  // Picker-Modus
  useEffect(() => {
    if (!projectId) return;
    void api.previewSetPickMode(projectId, pickMode);
    frameRef.current?.contentWindow?.postMessage({ type: PICK_MODE_MESSAGE, enabled: pickMode }, '*');
  }, [api, projectId, pickMode]);

  // Picks aus der Vorschau kommen über den Store (`preview_pick`); hier nur Toast mit *Rückgängig* und der Hinweis.
  // Genau ein neuer Pick zählt (ein wiederhergestellter Composer bringt mehrere auf einmal und meldet nichts).
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.refNumbers === prev.refNumbers) return;
        const added = state.composer.flatMap((seg) => {
          if (seg.type !== 'ref' || !isSitePick(seg.ref)) return [];
          const key = refKey(seg.ref);
          return state.refNumbers[key] && !prev.refNumbers[key] ? [key] : [];
        });
        if (added.length !== 1) return;
        const key = added[0]!;
        actions.completeCoach('monitorPointing');
        actions.toast('info', t('monitor.refAdded', { n: state.refNumbers[key]! }), { label: t('monitor.undo'), run: () => actions.removeRefByKey(key) });
      }),
    [store, actions, t],
  );

  const pick = useCallback(
    (ref: Ref): { rect: Rect; label: string } | null => {
      if (ref.kind === 'region') return ref.doc === 'site' && ref.page === pagePath ? { rect: ref.rect, label: sizeLabel(ref.rect) } : null;
      if (!isSitePick(ref) || ref.kind !== 'element' || ref.page !== pagePath || !ref.bbox) return null;
      return { rect: ref.bbox, label: `${ref.selector ?? ref.tag ?? ''} · ${sizeLabel(ref.bbox)}` };
    },
    [pagePath],
  );
  const selections = useMonitorSelections(pick);

  const scale = size.width > 0 ? Math.min(1, (size.width - STAGE_PAD_X) / vp.width) : 0.5;
  const frameHeight = size.height > 0 ? Math.round((size.height - STAGE_PAD_Y) / scale) : vp.height;
  const src = url ? `${url}#${pagePath}` : null;

  const onRegion = (rect: Rect) => pointRef({ kind: 'region', doc: 'site', ...(page ? { page: page.path } : {}), rect });
  const reload = () => {
    if (preview.status === 'error' || !url) setOpenNonce((n) => n + 1);
    else setReloadNonce((n) => n + 1);
  };

  let body;
  if (mode==='native' && !Object.keys(site.files).length) {
    body=<MonitorEmpty icon="web" title={language==='de'?'Noch keine Website':'No website yet'} text={language==='de'?'Beschreibe die Website im nativen Chat. Die Vorschau erscheint, sobald der Director die Quelldateien erstellt.':'Describe the website in the native chat. Preview appears once the director creates its source files.'}/>;
  } else if (preview.status === 'error') {
    body = (
      <MonitorEmpty
        icon="warning"
        tone="danger"
        title={t('monitor.previewErrorTitle')}
        text={preview.error ?? undefined}
        action={
          <button type="button" className="btn sm" onClick={reload}>
            <Icon name="refresh" size={14} />
            {t('monitor.reload')}
          </button>
        }
      />
    );
  } else if (mode === 'electron') {
    body = !url && <MonitorEmpty icon="web" title={t('monitor.previewStarting')} />;
  } else if (src) {
    body = (
      <div className="web-frame-holder" style={{ width: vp.width * scale, height: frameHeight * scale }}>
        <iframe
          key={reloadNonce}
          ref={frameRef}
          className="web-frame"
          title={t('monitor.label')}
          sandbox="allow-scripts"
          src={mode === 'native' ? undefined : src}
          width={vp.width}
          height={frameHeight}
          style={{ transform: `scale(${scale})` }}
          onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: PICK_MODE_MESSAGE, enabled: pickMode }, '*')}
        />
        {pointMode === 'region' ? (
          <PointerOverlay
            docWidth={vp.width}
            docHeight={frameHeight}
            onPoint={() => undefined}
            onRegion={onRegion}
            mode="region"
            selections={selections}
            scale={scale}
            label={t('monitor.modeTip.region')}
          />
        ) : (
          <div className="sel-layer" aria-hidden="true">
            <SelectionLayer selections={selections} docWidth={vp.width} docHeight={frameHeight} scale={scale} />
          </div>
        )}
      </div>
    );
  } else {
    body = <MonitorEmpty icon="web" title={t('monitor.previewStarting')} />;
  }

  return (
    <div className="monitor-web">
      <div className="monitor-stage monitor-stage-web" ref={hostRef} data-preview-host>
        {body}
      </div>
      <div className="transport transport-doc transport-web" role="toolbar" aria-label={t('monitor.label')}>
        <div className="tp-l">
          <div className="seg" role="group" aria-label={t('monitor.viewport')}>
            {VIEWPORT_IDS.map((id) => (
              <Tooltip key={id} label={t('monitor.viewportTip', { label: t(`monitor.viewport.${id}`), width: VIEWPORTS[id].width })}>
                <button type="button" aria-pressed={viewport === id} onClick={() => actions.setViewport(id)}>
                  <Icon name={VIEWPORT_ICONS[id]} size={14} />
                  <span className="seg-label">{t(`monitor.viewport.${id}`)}</span>
                </button>
              </Tooltip>
            ))}
          </div>
          <MonitorCoach />
        </div>
        <ModeSegment modes={modes} value={pointMode} onChange={setPointMode} />
        <div className="tp-r">
          {site.pages.length > 1 ? (
            <select className="monitor-page-select mono" aria-label={t('monitor.page')} value={page?.id ?? ''} onChange={(e) => actions.selectPage(e.target.value)}>
              {site.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </select>
          ) : (
            <span className="tp-path mono">{pagePath}</span>
          )}
          <Tooltip label={t('monitor.reload')}>
            <button type="button" className="ibtn" aria-label={t('monitor.reload')} onClick={reload}>
              <Icon name="refresh" size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t('monitor.openExternal')}>
            <button type="button" className="ibtn" aria-label={t('monitor.openExternal')} onClick={() => projectId && void api.previewOpenExternal(projectId)}>
              <Icon name="external" size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
