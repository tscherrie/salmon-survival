import type { Canvas, Deck, Layer, Site } from '@studio/core';
import { SlideView } from '../../docview/DocViews.tsx';
import { useT } from '../../i18n.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';

const THUMB_WIDTH = 132;

/** Folienstreifen: Klick wählt die Folie und fügt sie als Referenz ein. */
export function DeckStage({ deck }: { deck: Deck }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const selected = useStudio((s) => s.selectedSlideId);
  if (deck.slides.length === 0) return <div className="stage-empty">{t('stage.noSlides')}</div>;
  const scale = THUMB_WIDTH / deck.width;
  return (
    <div className="slide-strip" role="list" aria-label={t('stage.slides')}>
      {deck.slides.map((slide, i) => (
        <div role="listitem" key={slide.id}>
          <button
            type="button"
            className={`slide-thumb${slide.id === selected ? ' is-selected' : ''}${slide.hidden ? ' is-hidden' : ''}`}
            aria-current={slide.id === selected ? 'true' : undefined}
            aria-label={t('stage.slideAria', { n: i + 1, title: slide.title ?? slide.id })}
            onClick={() => {
              actions.selectSlide(slide.id);
              actions.insertRef({ kind: 'slide', slideId: slide.id });
            }}
          >
            <span className="slide-thumb-view">
              <SlideView deck={deck} slide={slide} assetUrl={assetUrl} scale={scale} title={slide.title ?? slide.id} />
            </span>
            <span className="slide-thumb-label">
              <span className="slide-thumb-number">{i + 1}</span> {slide.title ?? ''}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

const LAYER_ICONS: Record<Layer['type'], IconName> = { image: 'image', text: 'text', shape: 'region', group: 'layers' };

function LayerRows({ layers, depth }: { layers: readonly Layer[]; depth: number }) {
  const t = useT();
  const actions = useActions();
  // Oberste Ebene zuerst (wie in Grafikprogrammen)
  return (
    <>
      {[...layers].reverse().map((layer) => {
        const name = layer.name ?? (layer.type === 'text' ? (layer.text ?? layer.id).slice(0, 30) : layer.id);
        return (
          <div key={layer.id} role="none">
            <button
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              className={`layer-row${layer.hidden ? ' is-hidden' : ''}`}
              style={{ paddingLeft: 8 + depth * 16 }}
              aria-label={t('stage.layerAria', { name })}
              onClick={() =>
                actions.insertRef({ kind: 'element', doc: 'canvas', elementId: layer.id, bbox: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } })
              }
            >
              <Icon name={LAYER_ICONS[layer.type]} size={13} />
              <span className="layer-name">{name}</span>
              {layer.hidden && <span className="badge badge-muted">{t('stage.hidden')}</span>}
              <span className="layer-meta">
                {Math.round(layer.width)}×{Math.round(layer.height)}
              </span>
            </button>
            {layer.children && layer.children.length > 0 && <LayerRows layers={layer.children} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

/** Ebenenliste der Leinwand: Klick fügt die Ebene als Element-Referenz ein. */
export function CanvasStage({ canvas }: { canvas: Canvas }) {
  const t = useT();
  if (canvas.layers.length === 0) return <div className="stage-empty">{t('stage.noLayers')}</div>;
  return (
    <div className="layer-list" role="tree" aria-label={t('stage.layers')}>
      <LayerRows layers={canvas.layers} depth={0} />
    </div>
  );
}

/** Seitenkarte der Website: Klick navigiert die Vorschau; Seiten lassen sich referenzieren. */
export function SiteStage({ site }: { site: Site }) {
  const t = useT();
  const actions = useActions();
  const selected = useStudio((s) => s.selectedPageId);
  return (
    <div className="page-list" role="list" aria-label={t('stage.pages')}>
      {site.pages.map((page) => (
        <div role="listitem" key={page.id} className={`page-row${page.id === selected ? ' is-selected' : ''}`}>
          <button type="button" className="page-open" aria-current={page.id === selected ? 'page' : undefined} onClick={() => actions.selectPage(page.id)}>
            <Icon name="web" size={14} />
            <span className="page-title">{page.title}</span>
            <code className="page-path">{page.path}</code>
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => actions.insertRef({ kind: 'element', doc: 'site', page: page.path, selector: 'body', ...(page.sourceFile ? { source: { file: page.sourceFile, line: 1 } } : {}) })}
          >
            {t('stage.referencePage')}
          </button>
        </div>
      ))}
    </div>
  );
}
