import { useRef } from 'react';
import { useT } from '../../i18n.ts';
import { useActions, useStudio, useViewDocument } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { CanvasMonitor, DeckMonitor } from './DocMonitors.tsx';
import { MonitorEmpty, useFullscreen } from './MonitorParts.tsx';
import { VideoMonitor } from './VideoMonitor.tsx';
import { WebMonitor } from './WebMonitor.tsx';

/** Banner für alte Versionen (28 px oben im Monitor, §7.4): Was man sieht, und der Weg zurück. */
function VersionBanner({ number }: { number: number }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className="version-banner" role="status">
      <Icon name="eye" size={14} />
      <span className="version-banner-text">{t('monitor.viewingOld', { number })}</span>
      <button type="button" className="btn ghost sm" onClick={() => actions.exitVersionView()}>
        {t('versions.backToCurrent')}
      </button>
    </div>
  );
}

/**
 * Monitor (Mitte oben, immer dunkel, nur die Ecke unten rechts gerundet): Player, Folie, Leinwand oder Web-Vorschau –
 * je nach Dokument. Unter dem Bild liegt bei allen Kategorien die 44-px-Leiste (Transport bzw. Werkzeuge).
 */
export function Monitor() {
  const t = useT();
  const doc = useViewDocument();
  const category = useStudio((s) => s.manifest?.category ?? null);
  const viewing = useStudio((s) => s.viewing);
  const ref = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(ref);
  let content;
  switch (doc?.kind) {
    case 'timeline':
      content = <VideoMonitor timeline={doc} audioOnly={category === 'audio'} fullscreen={fullscreen} monitorRef={ref} />;
      break;
    case 'deck':
      content = <DeckMonitor deck={doc} />;
      break;
    case 'canvas':
      content = <CanvasMonitor canvas={doc} />;
      break;
    case 'site':
      content = <WebMonitor site={doc} />;
      break;
    default:
      content = (
        <div className="monitor-stage">
          <MonitorEmpty icon="monitor" title={t('monitor.emptyTitle')} text={t('monitor.noDocument')} />
        </div>
      );
  }
  return (
    <section ref={ref} className={`monitor always-dark${viewing ? ' is-viewing-old' : ''}${fullscreen?.active ? ' is-fullscreen' : ''}`} aria-label={t('monitor.label')}>
      {viewing && <VersionBanner number={viewing.number} />}
      {content}
    </section>
  );
}
