import type { ReactNode } from 'react';
import type { Canvas, Deck, Layer, Ref, Site, SitePage } from '@studio/core';
import { SlideView } from '../../docview/DocViews.tsx';
import { useT } from '../../i18n.ts';
import { countLayers } from '../../lib/layout.ts';
import { refKey } from '../../lib/refNumbers.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';

/**
 * Bühnen der Dokument-Kategorien (DESIGN.md §7.10): links die Index-Spalte (so breit wie die Asset-Leiste, wie bei der
 * Timeline) mit großem Readout und Legende, rechts Folienstreifen, Ebenenliste oder Seitenkarten. Die Höhe der Bühne
 * richtet sich nach diesem Inhalt (§2.3, `stageContentHeight`); nichts hier darf höher werden, sonst entsteht eine
 * Scrollleiste. Ein Klick referenziert (nummerierter Chip); Hover verknüpft Karte und Chip in beide Richtungen.
 */

/** Breite der Folien-Thumbs (§7.10). */
export const SLIDE_THUMB_W = 148;

/** Leerzustand der Bühne (§11): Icon 20, Titel, optional ein Satz; links bündig in einer zentrierten Spalte. */
export function StageEmpty({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  return (
    <div className="stage-empty" role="status">
      <Icon name={icon} size={20} />
      <strong className="stage-empty-title">{title}</strong>
      {text && <p className="stage-empty-text">{text}</p>}
    </div>
  );
}

/** Nummer, Hover-Verknüpfung und Blitz für eine referenzierbare Karte der Bühne (§9.4). */
function useStageRef(ref: Ref) {
  const actions = useActions();
  const key = refKey(ref);
  const n = useStudio((s) => s.refNumbers[key]);
  const linked = useStudio((s) => s.hoveredRefKey === key);
  const flash = useStudio((s) => (s.flash?.key === key ? s.flash.nonce : 0));
  return {
    key,
    n,
    linked,
    flash,
    hover: n
      ? {
          onMouseEnter: () => actions.setHoveredRef(key),
          onMouseLeave: () => actions.setHoveredRef(null),
        }
      : {},
  };
}

/** Nummern-Badge (wie das Kästchen im Chip) und Blitz-Ring einer referenzierten Karte. */
function RefMarks({ n, flash }: { n: number | undefined; flash: number }) {
  return (
    <>
      {n ? (
        <span className="doc-ref-n mono" aria-hidden="true">
          {n}
        </span>
      ) : null}
      {flash ? <span key={flash} className="doc-flash" aria-hidden="true" /> : null}
    </>
  );
}

/** Index-Spalte: großes Readout (Mono 18) mit Einheit, darunter ruhige Meta-Zeilen. */
function DocIndex({ readout, unit, children }: { readout: ReactNode; unit?: string; children?: ReactNode }) {
  return (
    <div className="doc-index">
      <div className="doc-readout">
        <span className="doc-readout-value mono">{readout}</span>
        {unit && <span className="doc-readout-unit">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

function DocStageFrame({ index, children }: { index: ReactNode; children: ReactNode }) {
  return (
    <div className="doc-stage">
      {index}
      <div className="doc-stage-main">{children}</div>
    </div>
  );
}

// ───────────────────────── Folien ─────────────────────────

function SlideCard({ deck, index, selected }: { deck: Deck; index: number; selected: boolean }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const slide = deck.slides[index]!;
  const { n, linked, flash, hover } = useStageRef({ kind: 'slide', slideId: slide.id });
  const scale = SLIDE_THUMB_W / deck.width;
  return (
    <div role="listitem" className="slide-item">
      <button
        type="button"
        className={`slide-thumb${selected ? ' is-selected' : ''}${slide.hidden ? ' is-hidden' : ''}${n ? ' is-ref' : ''}${linked ? ' is-linked' : ''}`}
        aria-current={selected ? 'true' : undefined}
        aria-label={t('stage.slideAria', { n: index + 1, title: slide.title ?? slide.id })}
        onClick={() => {
          actions.selectSlide(slide.id);
          actions.insertRef({ kind: 'slide', slideId: slide.id });
        }}
        {...hover}
      >
        <span className="slide-thumb-view" style={{ width: SLIDE_THUMB_W, height: Math.round(deck.height * scale) }}>
          <SlideView deck={deck} slide={slide} assetUrl={assetUrl} scale={scale} title={slide.title ?? slide.id} />
          {slide.hidden && (
            <span className="slide-thumb-hidden" title={t('stage.hidden')}>
              <Icon name="eyeOff" size={12} />
            </span>
          )}
          <RefMarks n={n} flash={flash} />
        </span>
        <span className="slide-thumb-label">
          <span className="slide-thumb-number mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="slide-thumb-title">{slide.title ?? ''}</span>
        </span>
      </button>
    </div>
  );
}

/** Folienstreifen mit Index-Spalte: Klick zeigt die Folie im Monitor und fügt sie als Referenz ein. */
export function DeckStage({ deck }: { deck: Deck }) {
  const t = useT();
  const selected = useStudio((s) => s.selectedSlideId);
  if (deck.slides.length === 0) return <StageEmpty icon="slides" title={t('stage.noSlides')} />;
  const currentIndex = Math.max(0, deck.slides.findIndex((s) => s.id === selected));
  const current = deck.slides[currentIndex]!;
  const hidden = deck.slides.filter((s) => s.hidden).length;
  const hasSections = deck.slides.some((s) => s.layout === 'section');
  // Gruppen: Eine Abschnittsfolie beginnt eine neue Gruppe (Mikro-Label über der Gruppe)
  const groups: Array<{ label: string | null; items: number[] }> = [];
  deck.slides.forEach((slide, i) => {
    if (i === 0 || (hasSections && slide.layout === 'section')) groups.push({ label: hasSections && slide.layout === 'section' ? (slide.title ?? '') : null, items: [] });
    groups.at(-1)!.items.push(i);
  });
  return (
    <DocStageFrame
      index={
        <DocIndex
          readout={
            <>
              {currentIndex + 1}
              <span className="dim sep">/</span>
              <span className="dim">{deck.slides.length}</span>
            </>
          }
        >
          <span className="doc-index-title">{current.title ?? current.id}</span>
          {hidden > 0 && <span className="doc-index-meta">{t('stage.hiddenCount', { count: hidden })}</span>}
        </DocIndex>
      }
    >
      <div className={`slide-strip${hasSections ? ' has-sections' : ''}`} role="list" aria-label={t('stage.slides')}>
        {groups.map((group, g) => (
          <div key={g} className="slide-group" role="none">
            {hasSections && <span className="slide-group-label">{group.label}</span>}
            <div className="slide-group-items" role="none">
              {group.items.map((i) => (
                <SlideCard key={deck.slides[i]!.id} deck={deck} index={i} selected={deck.slides[i]!.id === selected || (!selected && i === 0)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </DocStageFrame>
  );
}

// ───────────────────────── Ebenen ─────────────────────────

const LAYER_ICONS: Record<Layer['type'], IconName> = { image: 'image', text: 'text', shape: 'region', group: 'layers' };

function LayerRow({ layer, depth }: { layer: Layer; depth: number }) {
  const t = useT();
  const actions = useActions();
  const ref: Ref = { kind: 'element', doc: 'canvas', elementId: layer.id, bbox: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } };
  const { n, linked, flash, hover } = useStageRef(ref);
  const name = layer.name ?? (layer.type === 'text' ? (layer.text ?? layer.id).slice(0, 30) : layer.id);
  return (
    <div role="none" className="layer-node">
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        className={`layer-row${layer.hidden ? ' is-hidden' : ''}${n ? ' is-ref' : ''}${linked ? ' is-linked' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        aria-label={t('stage.layerAria', { name })}
        onClick={() => actions.insertRef(ref)}
        {...hover}
      >
        <Icon name={LAYER_ICONS[layer.type]} size={14} />
        <span className="layer-name">{name}</span>
        {layer.hidden && <Icon name="eyeOff" size={12} className="layer-hidden" title={t('stage.hidden')} />}
        {n ? <span className="doc-ref-n is-inline mono">{n}</span> : null}
        <span className="layer-meta mono">
          {Math.round(layer.width)}&nbsp;×&nbsp;{Math.round(layer.height)}
        </span>
        {flash ? <span key={flash} className="doc-flash" aria-hidden="true" /> : null}
      </button>
      {layer.children && layer.children.length > 0 && <LayerRows layers={layer.children} depth={depth + 1} />}
    </div>
  );
}

function LayerRows({ layers, depth }: { layers: readonly Layer[]; depth: number }) {
  // Oberste Ebene zuerst (wie in Grafikprogrammen)
  return (
    <>
      {[...layers].reverse().map((layer) => (
        <LayerRow key={layer.id} layer={layer} depth={depth} />
      ))}
    </>
  );
}

/** Ebenenliste der Leinwand mit Index-Spalte: Klick fügt die Ebene als Element-Referenz ein. */
export function CanvasStage({ canvas }: { canvas: Canvas }) {
  const t = useT();
  if (canvas.layers.length === 0) return <StageEmpty icon="layers" title={t('stage.noLayers')} />;
  const count = countLayers(canvas.layers);
  return (
    <DocStageFrame
      index={
        <DocIndex readout={count} unit={t('stage.layers')}>
          <span className="doc-index-meta mono">
            {canvas.width}
            <span className="dim">&nbsp;×&nbsp;</span>
            {canvas.height}
          </span>
        </DocIndex>
      }
    >
      <div className="layer-list" role="tree" aria-label={t('stage.layers')}>
        <LayerRows layers={canvas.layers} depth={0} />
      </div>
    </DocStageFrame>
  );
}

// ───────────────────────── Seiten ─────────────────────────

/** Seiten-Referenz: Element-Ref auf den `body` einer Seite (wie der Positionsknopf im Composer). */
export function pageRef(page: SitePage): Ref {
  return { kind: 'element', doc: 'site', page: page.path, selector: 'body', ...(page.sourceFile ? { source: { file: page.sourceFile, line: 1 } } : {}) };
}

function PageCard({ page, selected }: { page: SitePage; selected: boolean }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const viewport = useStudio((s) => s.viewport);
  const ref = pageRef(page);
  const { n, linked, flash, hover } = useStageRef(ref);
  const mockup = page.mockups?.[viewport] ?? Object.values(page.mockups ?? {})[0];
  return (
    <div role="listitem" className="page-item">
      <button
        type="button"
        className={`page-card${selected ? ' is-selected' : ''}${n ? ' is-ref' : ''}${linked ? ' is-linked' : ''}`}
        aria-current={selected ? 'page' : undefined}
        aria-label={t('stage.pageAria', { title: page.title, path: page.path })}
        onClick={() => {
          actions.selectPage(page.id);
          actions.insertRef(ref);
        }}
        {...hover}
      >
        <span className="page-card-view always-dark">
          {mockup ? (
            <span className="page-card-img" style={{ backgroundImage: `url("${assetUrl(mockup, 'thumb')}")` }} />
          ) : (
            // Platzhalter: schematische Seite (Navigation, Titel, Text) statt eines leeren Kastens
            <span className="page-card-wire" aria-hidden="true">
              <i className="w-nav" />
              <i className="w-title" />
              <i className="w-line" />
              <i className="w-line short" />
              <i className="w-blocks" />
            </span>
          )}
          <RefMarks n={n} flash={flash} />
        </span>
        <span className="page-card-label">
          <span className="page-card-title">{page.title}</span>
          <span className="page-card-path mono">{page.path}</span>
        </span>
      </button>
    </div>
  );
}

/** Seitenkarten der Website mit Index-Spalte: Klick zeigt die Seite im Monitor und referenziert sie. */
export function SiteStage({ site }: { site: Site }) {
  const t = useT();
  const selected = useStudio((s) => s.selectedPageId);
  const current = site.pages.find((p) => p.id === selected) ?? site.pages[0];
  return (
    <DocStageFrame
      index={
        <DocIndex readout={site.pages.length} unit={t('stage.pages')}>
          <span className="doc-index-meta">
            {t(site.stage === 'code' ? 'stage.site.code' : 'stage.site.mockup')} · {t(`stage.site.framework.${site.framework}`)}
          </span>
        </DocIndex>
      }
    >
      <div className="page-strip" role="list" aria-label={t('stage.pages')}>
        {site.pages.map((page) => (
          <PageCard key={page.id} page={page} selected={page.id === current?.id} />
        ))}
      </div>
    </DocStageFrame>
  );
}
