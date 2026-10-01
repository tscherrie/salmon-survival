import { useState } from 'react';
import type { StudioDocument } from '@studio/core';
import { useT } from '../../i18n.ts';
import { countLayers, useLayout } from '../../lib/layout.ts';
import { tcParts } from '../../lib/timecode.ts';
import { useStudio, useViewDocument } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { ariaKeyShortcuts } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { CanvasStage, DeckStage, SiteStage, StageEmpty } from './DocStages.tsx';
import { StageToolsProvider } from './StageTools.tsx';
import { TimelineStage, useTimelineShortcuts } from './TimelineStage.tsx';

/** Abspielkopf als Timecode in der Leiste, nur bei eingeklappter Bühne (sonst steht er groß in der Index-Spalte). */
function BarTimecode({ fps }: { fps: number }) {
  const playhead = useStudio((s) => s.playhead);
  const { head, frames } = tcParts(playhead, fps, 'smpte');
  return (
    <span className="stage-tc mono" aria-live="off">
      {head}
      <span className="ff">{frames}</span>
    </span>
  );
}

/** Bühnen-Leiste (32 px): Index-Zone mit Icon, Titel und Meta; rechts die Werkzeuge der Kategorie und Einklappen. */
function StageBar({ doc, audioProject, onTools }: { doc: StudioDocument | null; audioProject: boolean; onTools: (el: HTMLElement | null) => void }) {
  const t = useT();
  const layout = useLayout();
  const viewing = useStudio((s) => s.viewing);
  const head = useStudio((s) => s.documentVersion);
  const version = viewing?.number ?? head;
  const collapsed = layout?.collapsed.stage ?? false;

  let icon: IconName = 'sideBottom';
  let title = t('stage.title');
  let meta = '';
  switch (doc?.kind) {
    case 'timeline':
      icon = audioProject ? 'audio' : 'film';
      title = t('stage.timeline');
      meta = t('stage.meta.fps', { fps: doc.fps });
      break;
    case 'deck':
      icon = 'slides';
      title = t('stage.slides');
      meta = t('stage.meta.slides', { count: doc.slides.length });
      break;
    case 'canvas':
      icon = 'layers';
      title = t('stage.layers');
      meta = t('stage.meta.layers', { count: countLayers(doc.layers) });
      break;
    case 'site':
      icon = 'web';
      title = t('stage.pages');
      meta = t('stage.meta.pages', { count: doc.pages.length });
      break;
    default:
      break;
  }
  const toggleLabel = collapsed ? t('layout.showStage') : t('layout.hideStage');

  return (
    <div className="stage-bar">
      <div className="stage-index">
        <Icon name={icon} size={16} />
        <h2 className="stage-title">{title}</h2>
        {doc && (
          <span className="stage-meta">
            <span className="mono">v{version}</span>
            {meta && ` · ${meta}`}
          </span>
        )}
      </div>
      {doc?.kind === 'timeline' && collapsed && <BarTimecode fps={doc.fps} />}
      <div className="stage-tools" ref={onTools} />
      {layout && (
        <Tooltip label={toggleLabel} keys={['mod', '3']}>
          <button
            type="button"
            className="ibtn stage-collapse"
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-keyshortcuts={ariaKeyShortcuts(['mod', '3'])}
            onClick={() => layout.toggle('stage')}
          >
            <Icon name="sideBottom" size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** Bühne (volle Breite, nur lesbar): Leiste plus Timeline, Folienstreifen, Ebenenliste oder Seitenkarte. */
export function Stage() {
  const t = useT();
  const doc = useViewDocument();
  const viewing = useStudio((s) => s.viewing);
  const category = useStudio((s) => s.manifest?.category ?? null);
  const layout = useLayout();
  const collapsed = layout?.collapsed.stage ?? false;
  const [tools, setTools] = useState<HTMLElement | null>(null);
  // Timeline-Kürzel (Enter, Klammern, Beat-Raster …) gelten auch bei eingeklappter Bühne (§8.5)
  useTimelineShortcuts();
  let content;
  switch (doc?.kind) {
    case 'timeline':
      content = <TimelineStage timeline={doc} audioProject={category === 'audio'} />;
      break;
    case 'deck':
      content = <DeckStage deck={doc} />;
      break;
    case 'canvas':
      content = <CanvasStage canvas={doc} />;
      break;
    case 'site':
      content = <SiteStage site={doc} />;
      break;
    default:
      content =
        category === null ? (
          // Projekt ohne Kategorie: Der Director klärt sie im Planungsgespräch (Director-Panel), danach erscheint die Bühne.
          // Leerstil (§11): Icon, Titel, ein Satz; links bündig in einer zentrierten Spalte
          <div className="stage-empty stage-planning" role="status" data-testid="stage-planning">
            <Icon name="director" size={20} />
            <strong className="stage-planning-title">{t('stage.planningTitle')}</strong>
            <p className="stage-planning-hint">{t('stage.planningHint')}</p>
          </div>
        ) : (
          <StageEmpty icon="document" title={t('stage.preparing')} />
        );
  }
  return (
    <section className={`stage${viewing ? ' is-viewing-old' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label={t('stage.label')}>
      <StageBar doc={doc} audioProject={category === 'audio'} onTools={setTools} />
      {!collapsed && (
        <StageToolsProvider value={tools}>
          {/* Das Banner für alte Versionen steht im Monitor (§7.4); die Bühne zeigt nur `is-viewing-old` */}
          <div className="stage-body">{content}</div>
        </StageToolsProvider>
      )}
    </section>
  );
}
