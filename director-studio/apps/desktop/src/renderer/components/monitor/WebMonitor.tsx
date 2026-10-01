import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VIEWPORTS, type PreviewViewport, type Rect, type Site } from '@studio/core';
import { PICK_MODE_MESSAGE } from '../../lib/previewMessages.ts';
import { useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useActions, useApi, useApiMode, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { PointerOverlay } from './PointerOverlay.tsx';

const VIEWPORT_IDS: PreviewViewport[] = ['mobile', 'tablet', 'desktop'];

/**
 * Web-Vorschau. Electron: eingebettete `WebContentsView` (Main-Prozess) – hier nur ein Platzhalter,
 * dessen Position per `previewSetBounds` gemeldet wird; die Seitenwahl navigiert sie per `previewNavigate`.
 * Browser/Fake: `<iframe sandbox="allow-scripts">`, die Seite steht im Hash der iframe-URL.
 * Element-Picks kommen in beiden Fällen als `preview_pick`-Ereignis und landen als Chip im Composer.
 */
export function WebMonitor({ site }: { site: Site }) {
  const t = useT();
  const api = useApi();
  const mode = useApiMode();
  const actions = useActions();
  const projectId = useStudio((s) => s.projectId);
  const viewport = useStudio((s) => s.viewport);
  const selectedPageId = useStudio((s) => s.selectedPageId);
  const overlays = useStudio((s) => s.overlays);
  const preview = useStudio((s) => s.preview);
  const [url, setUrl] = useState<string | null>(null);
  /** Zählt abgeschlossene `previewOpen`-Aufrufe (jeder lädt die Startseite der Site). */
  const [openCount, setOpenCount] = useState(0);
  const justOpened = useRef(false);
  const [pickMode, setPickMode] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const size = useElementSize(hostRef);
  const page = site.pages.find((p) => p.id === selectedPageId) ?? site.pages[0];
  const pagePath = page?.path ?? '/';
  const vp = VIEWPORTS[viewport];

  // Vorschau öffnen (je Viewport)
  useEffect(() => {
    if (!projectId) return;
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
  }, [api, projectId, viewport, actions, t]);

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
    if (mode !== 'electron' || !projectId || openCount === 0) return;
    const fresh = justOpened.current;
    justOpened.current = false;
    // Direkt nach dem Öffnen steht die Vorschau bereits auf der Startseite.
    if (fresh && pagePath === '/') return;
    api.previewNavigate(projectId, pagePath).catch((error: unknown) => actions.toast('error', t('monitor.previewError', { error: error instanceof Error ? error.message : String(error) })));
  }, [mode, api, projectId, openCount, pagePath, actions, t]);

  // Picker-Modus
  useEffect(() => {
    if (!projectId) return;
    void api.previewSetPickMode(projectId, pickMode);
    frameRef.current?.contentWindow?.postMessage({ type: PICK_MODE_MESSAGE, enabled: pickMode }, '*');
  }, [api, projectId, pickMode]);

  const scale = size.width > 0 ? Math.min(1, (size.width - 16) / vp.width) : 0.5;
  const frameHeight = size.height > 0 ? Math.round((size.height - 16) / scale) : vp.height;
  const src = url ? `${url}#${pagePath}` : null;

  const onRegion = (rect: Rect) => actions.insertRef({ kind: 'region', doc: 'site', ...(page ? { page: page.path } : {}), rect });

  return (
    <div className="monitor-web">
      <div className="monitor-toolbar" role="toolbar" aria-label={t('monitor.label')}>
        <div className="segmented" role="group" aria-label={t('monitor.viewport')}>
          {VIEWPORT_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={viewport === id} onClick={() => actions.setViewport(id)}>
              {t(`monitor.viewport.${id}`)}
            </button>
          ))}
        </div>
        <button type="button" className="toggle" aria-pressed={pickMode} onClick={() => { setPickMode((v) => !v); setRegionMode(false); }}>
          <Icon name="cursor" size={14} /> {t('monitor.pickMode')}
        </button>
        {mode === 'fake' && (
          <button type="button" className="toggle" aria-pressed={regionMode} onClick={() => { setRegionMode((v) => !v); setPickMode(false); }}>
            <Icon name="region" size={14} /> {t('monitor.regionMode')}
          </button>
        )}
        <span className="spacer" />
        {site.pages.length > 1 ? (
          <select className="monitor-page-select" aria-label={t('monitor.page')} value={page?.id ?? ''} onChange={(e) => actions.selectPage(e.target.value)}>
            {site.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.path}
              </option>
            ))}
          </select>
        ) : (
          <span className="monitor-caption">{pagePath}</span>
        )}
        <button type="button" className="button button-small" onClick={() => projectId && void api.previewOpenExternal(projectId)}>
          <Icon name="external" size={14} /> {t('monitor.openExternal')}
        </button>
      </div>
      <div className="monitor-stage monitor-stage-web" ref={hostRef} data-preview-host>
        {preview.status === 'error' && <div className="monitor-error">{t('monitor.previewError', { error: preview.error ?? '' })}</div>}
        {mode === 'electron' ? (
          !url && <div className="monitor-empty">{t('monitor.previewStarting')}</div>
        ) : src ? (
          <div className="web-frame-holder" style={{ width: vp.width * scale, height: frameHeight * scale }}>
            <iframe
              ref={frameRef}
              className="web-frame"
              title={t('monitor.label')}
              sandbox="allow-scripts"
              src={src}
              width={vp.width}
              height={frameHeight}
              style={{ transform: `scale(${scale})` }}
              onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: PICK_MODE_MESSAGE, enabled: pickMode }, '*')}
            />
            {regionMode && <PointerOverlay docWidth={vp.width} docHeight={frameHeight} onPoint={() => undefined} onRegion={onRegion} label={t('monitor.regionMode')} />}
          </div>
        ) : (
          <div className="monitor-empty">{t('monitor.previewStarting')}</div>
        )}
      </div>
    </div>
  );
}
