import { useState } from 'react';
import { useT } from '../../i18n.ts';
import { useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { ariaKeyShortcuts } from '../common/Kbd.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

/**
 * Schienen eingeklappter Seitenleisten (40 px, DESIGN.md §2.2, §7.6.1). Oben der Knopf zum Aufklappen (gleiche Höhe
 * wie der Kopf der Leiste), darunter eine ruhige Zusammenfassung. Ein Klick irgendwo auf die Schiene klappt auf.
 */

export function AssetsRail({ onExpand }: { onExpand: () => void }) {
  const t = useT();
  const count = useStudio((s) => s.assets.length);
  const label = t('layout.showAssets');
  return (
    <div className="rail rail-assets" onClick={onExpand}>
      <Tooltip label={label} keys={['mod', '1']} placement="right">
        <button type="button" className="ibtn" aria-label={label} aria-expanded={false} aria-keyshortcuts={ariaKeyShortcuts(['mod', '1'])} onClick={(e) => (e.stopPropagation(), onExpand())}>
          <Icon name="sideLeft" size={16} />
        </button>
      </Tooltip>
      <span className="rail-stat" aria-hidden="true">
        <Icon name="image" size={14} />
        <span className="mono">{count}</span>
      </span>
    </div>
  );
}

export function DirectorRail({ onExpand }: { onExpand: () => void }) {
  const t = useT();
  const runState = useStudio((s) => s.runState);
  const directorMessages = useStudio((s) => s.messages.filter((m) => m.role === 'director').length);
  const decisions = useStudio((s) => (s.question ? 1 : 0) + s.approvals.length + s.checkpoints.filter((c) => c.status === 'proposed').length);
  // Ungelesen = Director-Nachrichten seit dem Einklappen
  const [seen] = useState(directorMessages);
  const unread = Math.max(0, directorMessages - seen);
  const label = t('layout.showDirector');
  return (
    <div className="rail rail-director" onClick={onExpand}>
      <Tooltip label={label} keys={['mod', '2']} placement="left">
        <button type="button" className="ibtn" aria-label={label} aria-expanded={false} aria-keyshortcuts={ariaKeyShortcuts(['mod', '2'])} onClick={(e) => (e.stopPropagation(), onExpand())}>
          <Icon name="sideRight" size={16} />
        </button>
      </Tooltip>
      <span className={`run-indicator run-${runState}`} role="status">
        <span className="run-dot" aria-hidden="true" />
        <span className="sr-only">{t(`director.run.${runState}`)}</span>
      </span>
      {unread > 0 && (
        <span className="badge rail-badge" title={t('layout.unread', { count: unread })}>
          <span className="mono">{unread}</span>
          <span className="sr-only">{t('layout.unread', { count: unread })}</span>
        </span>
      )}
      {decisions > 0 && (
        <span className="badge solid rail-badge" title={t('layout.decisions', { count: decisions })}>
          <span className="mono">{decisions}</span>
          <span className="sr-only">{t('layout.decisions', { count: decisions })}</span>
        </span>
      )}
    </div>
  );
}
