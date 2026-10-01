import { useT } from '../../i18n.ts';
import { useStudio, useViewDocument } from '../../state/context.tsx';
import { CanvasMonitor, DeckMonitor } from './DocMonitors.tsx';
import { VideoMonitor } from './VideoMonitor.tsx';
import { WebMonitor } from './WebMonitor.tsx';

/** Monitor (Mitte oben, immer dunkel): Player, Folie, Leinwand oder Web-Vorschau – je nach Dokument. */
export function Monitor() {
  const t = useT();
  const doc = useViewDocument();
  const category = useStudio((s) => s.manifest?.category ?? null);
  let content;
  switch (doc?.kind) {
    case 'timeline':
      content = <VideoMonitor timeline={doc} audioOnly={category === 'audio'} />;
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
      content = <div className="monitor-empty">{t('monitor.noDocument')}</div>;
  }
  return (
    <section className="monitor always-dark" aria-label={t('monitor.label')}>
      {content}
    </section>
  );
}
