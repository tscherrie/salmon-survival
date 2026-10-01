import { useCallback, useMemo, useRef, useState } from 'react';
import { canvasLayersAt, deckElementsAt, type Canvas, type Deck, type DeckElement, type Layer, type Rect, type Ref } from '@studio/core';
import { CanvasView, SlideView } from '../../docview/DocViews.tsx';
import { useT } from '../../i18n.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { MonitorCoach, ModeSegment, type ModeOption } from './MonitorParts.tsx';
import { HighlightBox, PointerOverlay, sizeLabel, useMonitorSelections, usePointRef, type PointMode } from './PointerOverlay.tsx';
import { STAGE_PAD_X, STAGE_PAD_Y } from './VideoMonitor.tsx';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;

/** Einpassen in den Bildbereich (wie beim Video: Breite − 24, Höhe − 12; die Leiste liegt darunter). */
function useFitScale(ref: React.RefObject<HTMLElement | null>, width: number, height: number): number {
  const size = useElementSize(ref);
  if (size.width <= 0 || size.height <= 0) return 0.4;
  return Math.max(0.02, Math.min((size.width - STAGE_PAD_X) / width, (size.height - STAGE_PAD_Y) / height));
}

const rectOf = (item: { x: number; y: number; width: number; height: number }): Rect => ({ x: item.x, y: item.y, width: item.width, height: item.height });

/** Modi in Folien und Leinwand; der Tooltip trägt die Erklärung, sobald der einmalige Hinweis erledigt ist. */
function usePointModes(): ReadonlyArray<ModeOption<PointMode>> {
  const t = useT();
  return useMemo(
    () => [
      { id: 'element', label: t('monitor.mode.element'), tip: t('monitor.clickHint'), icon: 'cursor' },
      { id: 'region', label: t('monitor.mode.region'), tip: t('monitor.modeTip.region'), icon: 'region' },
    ],
    [t],
  );
}

/** Zoom-Tasten auf der Zeigerebene: + und − (Einpassen über die Leiste). */
function zoomKey(event: React.KeyboardEvent, setZoom: (fn: (z: number) => number) => void): boolean {
  if (event.key === '+' || event.key === '=') {
    setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP));
    return true;
  }
  if (event.key === '-') {
    setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP));
    return true;
  }
  return false;
}

// ───────────────────────── Präsentation ─────────────────────────

function elementName(el: DeckElement): string {
  return el.name ?? (el.type === 'text' && el.text ? el.text.replace(/\s+/g, ' ').trim().slice(0, 32) : el.type);
}

export function DeckMonitor({ deck }: { deck: Deck }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const pointRef = usePointRef();
  const modes = usePointModes();
  const selectedSlideId = useStudio((s) => s.selectedSlideId);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<PointMode>('element');
  const [notes, setNotes] = useState(false);
  const fit = useFitScale(stageRef, deck.width, deck.height);
  const scale = fit * zoom;
  const index = Math.max(0, deck.slides.findIndex((s) => s.id === selectedSlideId));
  const slide = deck.slides[index];
  const [focus, setFocus] = useState(-1);

  const pick = useCallback(
    (ref: Ref): { rect: Rect; label: string } | null => {
      if (!slide || (ref.kind !== 'element' && ref.kind !== 'region') || ref.doc !== 'deck' || ref.slideId !== slide.id) return null;
      if (ref.kind === 'region') return { rect: ref.rect, label: sizeLabel(ref.rect) };
      const el = slide.elements.find((e) => e.id === ref.elementId);
      const rect = el ? rectOf(el) : ref.bbox;
      if (!rect) return null;
      return { rect, label: `${el ? elementName(el) : (ref.elementId ?? ref.selector ?? '')} · ${sizeLabel(rect)}` };
    },
    [slide],
  );
  const selections = useMonitorSelections(pick);

  if (!slide) {
    return (
      <div className="monitor-doc">
        <div className="monitor-stage" ref={stageRef}>
          <div className="monitor-empty">{t('stage.noSlides')}</div>
        </div>
      </div>
    );
  }
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
    pointRef({ kind: 'element', doc: 'deck', slideId: slide.id, elementId: el.id, bbox: rectOf(el) });
  };
  const onPoint = (x: number, y: number) => {
    const hit = deckElementsAt(slide, x, y)[0];
    if (hit) refElement(slide.elements.indexOf(hit));
    else pointRef({ kind: 'slide', slideId: slide.id });
  };
  const onRegion = (rect: Rect) => pointRef({ kind: 'region', doc: 'deck', slideId: slide.id, rect });
  const hitTest = (x: number, y: number) => {
    const hit = deckElementsAt(slide, x, y)[0];
    return hit ? rectOf(hit) : null;
  };
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
      else pointRef({ kind: 'slide', slideId: slide.id });
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      go(-1);
    } else if (zoomKey(event, setZoom)) {
      event.preventDefault();
    }
  };
  const focused = focus >= 0 ? slide.elements[focus] : undefined;
  const slideOf = t('monitor.slideOf', { n: index + 1, total: deck.slides.length });

  return (
    <div className="monitor-doc">
      <div className={`monitor-stage${zoom > 1 ? ' is-zoomed' : ''}`} ref={stageRef}>
        <div className="doc-holder" style={{ width: deck.width * scale, height: deck.height * scale }}>
          <SlideView deck={deck} slide={slide} assetUrl={assetUrl} scale={scale} title={slide.title ?? slide.id} />
          <PointerOverlay
            docWidth={deck.width}
            docHeight={deck.height}
            onPoint={onPoint}
            onRegion={onRegion}
            onKeyDown={onKeyDown}
            mode={mode}
            hitTest={hitTest}
            selections={selections}
            scale={scale}
            label={`${slideOf}. ${t('monitor.clickHint')}`}
          >
            {focused && <HighlightBox rect={rectOf(focused)} docWidth={deck.width} docHeight={deck.height} />}
          </PointerOverlay>
        </div>
      </div>
      {notes && (
        <div className="monitor-notes" role="note" aria-label={t('monitor.notes')}>
          {slide.notes ? <p>{slide.notes}</p> : <p className="is-empty">{t('monitor.notesEmpty')}</p>}
        </div>
      )}
      <div className="transport transport-doc" role="toolbar" aria-label={t('monitor.label')}>
        <div className="tp-l">
          <div className="tp-pager">
            <Tooltip label={t('monitor.prevSlide')} keys={['PageUp']}>
              <button type="button" className="ibtn sm" onClick={() => go(-1)} disabled={index === 0} aria-label={t('monitor.prevSlide')}>
                <Icon name="chevronLeft" size={14} />
              </button>
            </Tooltip>
            <span className="tp-count mono" aria-label={slideOf}>
              {index + 1}
              <span className="dim sep">/</span>
              <span className="dim">{deck.slides.length}</span>
            </span>
            <Tooltip label={t('monitor.nextSlide')} keys={['PageDown']}>
              <button type="button" className="ibtn sm" onClick={() => go(1)} disabled={index >= deck.slides.length - 1} aria-label={t('monitor.nextSlide')}>
                <Icon name="chevronRight" size={14} />
              </button>
            </Tooltip>
          </div>
          {slide.title && (
            <span className="tp-meta" title={slide.title}>
              {slide.title}
            </span>
          )}
        </div>
        <div className="tp-r">
          <MonitorCoach />
          <ModeSegment modes={modes} value={mode} onChange={setMode} />
          <button type="button" className="btn ghost sm" aria-pressed={notes} onClick={() => setNotes((v) => !v)}>
            <Icon name="text" size={14} />
            {t('monitor.notes')}
          </button>
          <Tooltip label={t('monitor.zoomFit')}>
            <button type="button" className="ibtn" aria-label={t('monitor.zoomFit')} disabled={zoom === 1} onClick={() => setZoom(1)}>
              <Icon name="fit" size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Leinwand ─────────────────────────

function flattenLayers(layers: readonly Layer[]): Layer[] {
  return layers.flatMap((l) => (l.hidden ? [] : l.type === 'group' ? flattenLayers(l.children ?? []) : [l]));
}

function findLayer(layers: readonly Layer[], id: string | undefined): Layer | undefined {
  if (!id) return undefined;
  for (const layer of layers) {
    if (layer.id === id) return layer;
    const inner = findLayer(layer.children ?? [], id);
    if (inner) return inner;
  }
  return undefined;
}

/** Oberste Ebene (direkt unter der Leinwand), die `layerId` enthält. */
export function topLevelLayer(layers: readonly Layer[], layerId: string): Layer | undefined {
  const contains = (l: Layer): boolean => l.id === layerId || (l.children ?? []).some(contains);
  return layers.find(contains);
}

const layerLabel = (layer: Layer) => layer.name ?? (layer.type === 'text' ? (layer.text ?? layer.id).slice(0, 32) : layer.id);

export function CanvasMonitor({ canvas }: { canvas: Canvas }) {
  const t = useT();
  const assetUrl = useAssetUrl();
  const pointRef = usePointRef();
  const modes = usePointModes();
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(stageRef, canvas.width, canvas.height);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(-1);
  const [mode, setMode] = useState<PointMode>('element');
  const scale = fit * zoom;
  const flat = useMemo(() => flattenLayers(canvas.layers), [canvas.layers]);

  const pick = useCallback(
    (ref: Ref): { rect: Rect; label: string } | null => {
      if ((ref.kind !== 'element' && ref.kind !== 'region') || ref.doc !== 'canvas') return null;
      if (ref.kind === 'region') return { rect: ref.rect, label: sizeLabel(ref.rect) };
      const layer = findLayer(canvas.layers, ref.elementId);
      const rect = layer ? rectOf(layer) : ref.bbox;
      if (!rect) return null;
      return { rect, label: `${layer ? layerLabel(layer) : (ref.elementId ?? '')} · ${sizeLabel(rect)}` };
    },
    [canvas.layers],
  );
  const selections = useMonitorSelections(pick);

  const refLayer = (layer: Layer) => pointRef({ kind: 'element', doc: 'canvas', elementId: layer.id, bbox: rectOf(layer) });
  const onPoint = (x: number, y: number, mods: { altKey: boolean }) => {
    const hit = canvasLayersAt(canvas, x, y)[0];
    if (!hit) return;
    refLayer(mods.altKey ? (topLevelLayer(canvas.layers, hit.id) ?? hit) : hit);
  };
  const onRegion = (rect: Rect) => pointRef({ kind: 'region', doc: 'canvas', rect });
  const hitTest = (x: number, y: number) => {
    const hit = canvasLayersAt(canvas, x, y)[0];
    return hit ? rectOf(hit) : null;
  };
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
    } else if (zoomKey(event, setZoom)) {
      event.preventDefault();
    }
  };
  const focused = focus >= 0 ? flat[focus] : undefined;

  return (
    <div className="monitor-doc">
      <div className={`monitor-stage${zoom > 1 ? ' is-zoomed' : ''}`} ref={stageRef}>
        <div className="doc-holder" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
          <CanvasView canvas={canvas} assetUrl={assetUrl} scale={scale} title={t('monitor.label')} />
          <PointerOverlay
            docWidth={canvas.width}
            docHeight={canvas.height}
            onPoint={onPoint}
            onRegion={onRegion}
            onKeyDown={onKeyDown}
            mode={mode}
            hitTest={hitTest}
            selections={selections}
            scale={scale}
            label={t('monitor.clickHint')}
          >
            {focused && <HighlightBox rect={rectOf(focused)} docWidth={canvas.width} docHeight={canvas.height} />}
          </PointerOverlay>
        </div>
      </div>
      <div className="transport transport-doc" role="toolbar" aria-label={t('monitor.label')}>
        <div className="tp-l">
          <div className="tp-zoom">
            <Tooltip label={t('monitor.zoomOut')} keys={['-']}>
              <button type="button" className="ibtn sm" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))} aria-label={t('monitor.zoomOut')}>
                <Icon name="minus" size={14} />
              </button>
            </Tooltip>
            <span className="tp-count mono">{Math.round(scale * 100)}&nbsp;%</span>
            <Tooltip label={t('monitor.zoomIn')} keys={['+']}>
              <button type="button" className="ibtn sm" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))} aria-label={t('monitor.zoomIn')}>
                <Icon name="plus" size={14} />
              </button>
            </Tooltip>
          </div>
          <Tooltip label={t('monitor.zoomFit')}>
            <button type="button" className="ibtn" onClick={() => setZoom(1)} aria-label={t('monitor.zoomFit')} disabled={zoom === 1}>
              <Icon name="fit" size={16} />
            </button>
          </Tooltip>
          <span className="tp-meta mono">{sizeLabel(canvas)}</span>
        </div>
        <div className="tp-r">
          <MonitorCoach />
          <ModeSegment modes={modes} value={mode} onChange={setMode} />
        </div>
      </div>
    </div>
  );
}
