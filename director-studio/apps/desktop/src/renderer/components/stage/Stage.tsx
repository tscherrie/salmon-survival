import { useT } from '../../i18n.ts';
import { useActions, useStudio, useViewDocument } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { CanvasStage, DeckStage, SiteStage } from './DocStages.tsx';
import { TimelineStage } from './TimelineStage.tsx';

/** Bühne (volle Breite, nur lesbar): Timeline, Folienstreifen, Ebenenliste oder Seitenkarte. */
export function Stage() {
  const t = useT();
  const actions = useActions();
  const doc = useViewDocument();
  const viewing = useStudio((s) => s.viewing);
  const category = useStudio((s) => s.manifest?.category ?? null);
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
          <div className="stage-empty stage-planning" role="status" data-testid="stage-planning">
            <Icon name="director" size={18} />
            <div>
              <strong className="stage-planning-title">{t('stage.planningTitle')}</strong>
              <p className="stage-planning-hint">{t('stage.planningHint')}</p>
            </div>
          </div>
        ) : (
          <div className="stage-empty">{t('stage.preparing')}</div>
        );
  }
  return (
    <section className={`stage${viewing ? ' is-viewing-old' : ''}`} aria-label={t('stage.label')}>
      {viewing && (
        <div className="version-banner" role="status">
          <Icon name="eye" />
          <span>{t('versions.viewingBanner', { number: viewing.number })}</span>
          <button type="button" className="button button-small" onClick={() => actions.exitVersionView()}>
            {t('versions.backToCurrent')}
          </button>
        </div>
      )}
      {content}
    </section>
  );
}
