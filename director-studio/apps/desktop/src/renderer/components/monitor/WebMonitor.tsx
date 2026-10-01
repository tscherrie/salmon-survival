import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VIEWPORTS, type PreviewViewport, type Rect, type Site } from '@studio/core';
import { PICK_MODE_MESSAGE } from '../../fake/sitePreview.ts';
import { useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useActions, useApi, useApiMode, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { PointerOverlay } from './PointerOverlay.tsx';

const VIEWPORT_IDS: PreviewViewport[] = ['mobile', 'tablet', 'desktop'];

/**
 * Web-Vorschau. Electron: eingebettete `WebContentsView` (Main-Prozess) – hier nur ein Platzhalter,
 * dessen Position per `previewSetBounds` gemeldet wird. Browser/Fake: `<iframe sandbox="allow-scripts">`.
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
  const [pickMode, setPickMode] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const size = useElementSize(hostRef);
  const page = site.pages.find((p) => p.id === selectedPageId) ?? site.pages[0];
  const vp = VIEWPORTS[viewport];

  // Vorschau öffnen (je Viewport)
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api
      .previewOpen(projectId, { viewport })
      .then((result) => {
        if (alive) setUrl(result.url);
      })
      .catch((error: unknown) => actions.toast('error', t('monitor.previewError', { error: error instanceof Error ? error.message : String(error) })));
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

  // Picker-Modus
  useEffect(() => {
    if (!projectId) return;
    void api.previewSetPickMode(projectId, pickMode);
    frameRef.current?.contentWindow?.postMessage({ type: PICK_MODE_MESSAGE, enabled: pickMode }, '*');
  }, [api, projectId, pickMode]);

  const scale = size.width > 0 ? Math.min(1, (size.width - 16) / vp.width) : 0.5;
  const frameHeight = size.height > 0 ? Math.round((size.height - 16) / scale) : vp.height;
  const src = url ? `${url}#${page?.path ?? '/'}` : null;

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
        <span className="monitor-caption">{page?.path}</span>
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
