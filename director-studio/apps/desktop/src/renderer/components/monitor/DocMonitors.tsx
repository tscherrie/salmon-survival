import { useMemo, useRef, useState } from 'react';
import { canvasLayersAt, deckElementsAt, type Canvas, type Deck, type Layer, type Rect } from '@studio/core';
import { CanvasView, SlideView } from '../../docview/DocViews.tsx';
import { useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { HighlightBox, PointerOverlay } from './PointerOverlay.tsx';

function useFitScale(ref: React.RefObject<HTMLElement | null>, width: number, height: number, pad = 24): number {
  const size = useElementSize(ref);
  if (size.width <= 0 || size.height <= 0) return 0.4;
  return Math.max(0.02, Math.min((size.width - pad) / width, (size.height - pad) / height));
}

// ───────────────────────── Präsentation ─────────────────────────

export function DeckMonitor({ deck }: { deck: Deck }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const selectedSlideId = useStudio((s) => s.selectedSlideId);
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(stageRef, deck.width, deck.height);
  const index = Math.max(0, deck.slides.findIndex((s) => s.id === selectedSlideId));
  const slide = deck.slides[index];
  const [focus, setFocus] = useState(-1);

  if (!slide) return <div className="monitor-empty">{t('stage.noSlides')}</div>;
  const go = (delta: number) => {
    const next = deck.slides[Math.max(0, Math.min(deck.slides.length - 1, index + delta))];
    if (next) {
      actions.selectSlide(next.id);
      setFocus(-1);
    }
  };
  const refElement = (elementIndex: number) => {
    const el = slide.elements[elementIndex];
    if (!el) return;
    actions.insertRef({ kind: 'element', doc: 'deck', slideId: slide.id, elementId: el.id, bbox: { x: el.x, y: el.y, width: el.width, height: el.height } });
  };
  const onPoint = (x: number, y: number) => {
    const hit = deckElementsAt(slide, x, y)[0];
    if (hit) refElement(slide.elements.indexOf(hit));
    else actions.insertRef({ kind: 'slide', slideId: slide.id });
  };
  const onRegion = (rect: Rect) => actions.insertRef({ kind: 'region', doc: 'deck', slideId: slide.id, rect });
  const onKeyDown = (event: React.KeyboardEvent) => {
    const n = slide.elements.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (n) setFocus((f) => (f + 1) % n);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (n) setFocus((f) => (f <= 0 ? n - 1 : f - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (focus >= 0) refElement(focus);
      else actions.insertRef({ kind: 'slide', slideId: slide.id });
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      go(-1);
    }
  };
  const focused = focus >= 0 ? slide.elements[focus] : undefined;

  return (
    <div className="monitor-doc">
      <div className="monitor-toolbar" role="toolbar" aria-label={t('monitor.label')}>
        <button type="button" className="ibtn" onClick={() => go(-1)} disabled={index === 0} aria-label={t('monitor.prevSlide')}>
          <Icon name="chevronLeft" />
        </button>
        <span className="monitor-caption">{t('monitor.slideOf', { n: index + 1, total: deck.slides.length })}</span>
        <button type="button" className="ibtn" onClick={() => go(1)} disabled={index >= deck.slides.length - 1} aria-label={t('monitor.nextSlide')}>
          <Icon name="chevronRight" />
        </button>
        <span className="spacer" />
        <span className="hint">{t('monitor.clickHint')}</span>
      </div>
      <div className="monitor-stage" ref={stageRef}>
        <div className="doc-holder" style={{ width: deck.width * scale, height: deck.height * scale }}>
          <SlideView deck={deck} slide={slide} assetUrl={assetUrl} scale={scale} title={slide.title ?? slide.id} />
          <PointerOverlay
            docWidth={deck.width}
            docHeight={deck.height}
            onPoint={onPoint}
            onRegion={onRegion}
            onKeyDown={onKeyDown}
            label={`${t('monitor.slideOf', { n: index + 1, total: deck.slides.length })}. ${t('monitor.clickHint')}`}
          >
            {focused && <HighlightBox rect={{ x: focused.x, y: focused.y, width: focused.width, height: focused.height }} docWidth={deck.width} docHeight={deck.height} />}
          </PointerOverlay>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Leinwand ─────────────────────────

function flattenLayers(layers: readonly Layer[]): Layer[] {
  return layers.flatMap((l) => (l.hidden ? [] : l.type === 'group' ? flattenLayers(l.children ?? []) : [l]));
}

/** Oberste Ebene (direkt unter der Leinwand), die `layerId` enthält. */
export function topLevelLayer(layers: readonly Layer[], layerId: string): Layer | undefined {
  const contains = (l: Layer): boolean => l.id === layerId || (l.children ?? []).some(contains);
  return layers.find(contains);
}

export function CanvasMonitor({ canvas }: { canvas: Canvas }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(stageRef, canvas.width, canvas.height);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(-1);
  const scale = fit * zoom;
  const flat = useMemo(() => flattenLayers(canvas.layers), [canvas.layers]);

  const refLayer = (layer: Layer) =>
    actions.insertRef({ kind: 'element', doc: 'canvas', elementId: layer.id, bbox: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } });
  const onPoint = (x: number, y: number, mods: { altKey: boolean }) => {
    const hit = canvasLayersAt(canvas, x, y)[0];
    if (!hit) return;
    refLayer(mods.altKey ? (topLevelLayer(canvas.layers, hit.id) ?? hit) : hit);
  };
  const onRegion = (rect: Rect) => actions.insertRef({ kind: 'region', doc: 'canvas', rect });
  const onKeyDown = (event: React.KeyboardEvent) => {
    const n = flat.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (n) setFocus((f) => (f + 1) % n);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (n) setFocus((f) => (f <= 0 ? n - 1 : f - 1));
    } else if (event.key === 'Enter' && focus >= 0 && flat[focus]) {
      event.preventDefault();
      refLayer(flat[focus]);
    } else if (event.key === '+' || event.key === '=') {
      setZoom((z) => Math.min(8, z * 1.25));
    } else if (event.key === '-') {
      setZoom((z) => Math.max(0.25, z / 1.25));
    }
  };
  const focused = focus >= 0 ? flat[focus] : undefined;

  return (
    <div className="monitor-doc">
      <div className="monitor-toolbar" role="toolbar" aria-label={t('monitor.label')}>
        <button type="button" className="ibtn" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label={t('monitor.zoomOut')}>
          <Icon name="minus" />
        </button>
        <span className="monitor-caption">{Math.round(scale * 100)} %</span>
        <button type="button" className="ibtn" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label={t('monitor.zoomIn')}>
          <Icon name="plus" />
        </button>
        <button type="button" className="ibtn" onClick={() => setZoom(1)} aria-label={t('monitor.zoomFit')}>
          <Icon name="fit" />
        </button>
        <span className="spacer" />
        <span className="hint">{t('monitor.clickHint')}</span>
      </div>
      <div className={`monitor-stage ${zoom > 1 ? 'is-zoomed' : ''}`} ref={stageRef}>
        <div className="doc-holder" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
          <CanvasView canvas={canvas} assetUrl={assetUrl} scale={scale} title={t('monitor.label')} />
          <PointerOverlay docWidth={canvas.width} docHeight={canvas.height} onPoint={onPoint} onRegion={onRegion} onKeyDown={onKeyDown} label={t('monitor.clickHint')}>
            {focused && <HighlightBox rect={{ x: focused.x, y: focused.y, width: focused.width, height: focused.height }} docWidth={canvas.width} docHeight={canvas.height} />}
          </PointerOverlay>
        </div>
      </div>
    </div>
  );
}
