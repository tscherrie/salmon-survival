import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '../../i18n.ts';
import { useStudio } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

/**
 * Gemeinsame Bausteine der Monitore (DESIGN.md §7.4): Leerzustand, Modus-Segment, einmaliger Zeige-Hinweis und
 * Vollbild. Die Leiste unter dem Bild (`.transport`) ist bei allen Kategorien gleich gebaut: links, Mitte, rechts.
 */

/** Leerzustand (§11): Icon 20 · Titel 13/600 · ein Satz · höchstens eine Aktion; Spalte bis 360 px, im Bereich zentriert. */
export function MonitorEmpty({
  icon,
  title,
  text,
  action,
  tone,
}: {
  icon: IconName;
  title: string;
  text?: string | undefined;
  action?: ReactNode;
  tone?: 'danger';
}) {
  return (
    <div className={`monitor-empty${tone ? ` is-${tone}` : ''}`} role="status">
      <Icon name={icon} size={20} />
      <strong className="monitor-empty-title">{title}</strong>
      {text && <p className="monitor-empty-text">{text}</p>}
      {action}
    </div>
  );
}

export interface ModeOption<M extends string> {
  id: M;
  label: string;
  /** Tooltip: Was der Modus bewirkt (nach dem einmaligen Hinweis steht die Erklärung nur noch hier). */
  tip: string;
  icon: IconName;
}

/** Modus-Segment (Ansehen | Element | Region), ersetzt Hinweiszeile und die früheren Umschalter. */
export function ModeSegment<M extends string>({ modes, value, onChange }: { modes: ReadonlyArray<ModeOption<M>>; value: M; onChange: (mode: M) => void }) {
  const t = useT();
  return (
    <div className="seg tp-mode" role="group" aria-label={t('monitor.mode')}>
      {modes.map((mode) => (
        <Tooltip key={mode.id} label={mode.tip}>
          <button type="button" aria-pressed={value === mode.id} onClick={() => onChange(mode.id)}>
            <Icon name={mode.icon} size={14} />
            <span className="seg-label">{mode.label}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Einmaliger Hinweis zum Zeigen (§8.6, Schlüssel `monitorPointing`) als Zeile in der Monitorleiste. */
export function MonitorCoach() {
  const t = useT();
  const open = useStudio((s) => s.coach.monitorPointing === 'open');
  if (!open) return null;
  return (
    <span className="monitor-coach">
      <Icon name="cursor" size={12} />
      <span className="monitor-coach-text">{t('monitor.clickHint')}</span>
    </span>
  );
}

export interface FullscreenControl {
  active: boolean;
  toggle: () => void;
}

/**
 * Vollbild für den ganzen Monitor (Bild und Transport bleiben zusammen). `null`, wenn die Umgebung kein Vollbild
 * kennt (z. B. jsdom).
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenControl | null {
  const [active, setActive] = useState(false);
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  useEffect(() => {
    if (!supported) return;
    const sync = () => setActive(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref, supported]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void ref.current?.requestFullscreen().catch(() => undefined);
  }, [ref]);
  return useMemo(() => (supported ? { active, toggle } : null), [supported, active, toggle]);
}
