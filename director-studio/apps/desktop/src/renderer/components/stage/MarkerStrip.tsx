import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n.ts';
import { formatTc, tcParts } from '../../lib/timecode.ts';
import { layoutMarkerTags, markerTagWidth } from '../../lib/timelineGeometry.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import type { UserMarker } from '../../state/selectors.ts';
import { Icon } from '../common/Icon.tsx';
import { Kbd } from '../common/Kbd.tsx';

/**
 * Markerleiste (DESIGN.md §8): 16 px ganz oben in der Timeline. Ein Nutzer-Marker ist ein Zeit-Chip im Composer
 * (§8.1); die Leiste zeigt ihn als nummerierten Daylight-Tag, zentriert auf seinem Frame. Das Setzen per Klick wertet
 * `TimelineStage` aus, weil die Trefferzone 4 px ins Lineal ragt; hier stehen Tags, Geister-Marker, der einmalige
 * Hinweis, das Kontextmenü und die Tastatur der Toolbar (Roving-Tabindex).
 */

/** Geister-Marker unter dem Pointer: Zielframe (ggf. eingerastet) und seine x-Position im Inhalt. */
export interface StripGhost {
  frame: number;
  x: number;
  snapped: boolean;
}

/** Dauer der Settle-Animation plus Luft; danach verliert der neue Tag seine Klasse. */
const SETTLE_MS = 240;
/** Halbe Breite der Trefferzone eines Tags (24 × 20, §8.8). */
const TAG_HIT_HALF = 12;

interface MenuState {
  key: string;
  n: number;
  frame: number;
  x: number;
  y: number;
}

/** Kontextmenü eines Markers: „Hierhin springen“ · „Marker entfernen (Entf)“. */
function MarkerMenu({ menu, onJump, onRemove, onClose }: { menu: MenuState; onJump: () => void; onRemove: () => void; onClose: () => void }) {
  const t = useT();
  const actions = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Im Fenster halten und das erste Element fokussieren
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      top: menu.y + r.height > window.innerHeight - 4 ? Math.max(4, menu.y - r.height) : menu.y,
    });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu.x, menu.y]);

  useEffect(() => {
    actions.pushOverlay();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      actions.popOverlay();
    };
  }, [actions]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
    e.stopPropagation();
  };

  // Das Portal liegt im React-Baum unter der Timeline: Mausereignisse dürfen dort keine Geste auslösen
  return createPortal(
    <div
      ref={ref}
      className="tl-menu"
      role="menu"
      aria-label={t('stage.markerMenu', { n: menu.n })}
      style={pos}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onJump}>
        <Icon name="chevronRight" size={14} />
        <span>{t('stage.markerJump')}</span>
      </button>
      <button type="button" role="menuitem" onClick={onRemove}>
        <Icon name="close" size={14} />
        <span>{t('stage.markerRemove')}</span>
        <Kbd keys={['Delete']} />
      </button>
    </div>,
    document.body,
  );
}

export const MarkerStrip = memo(function MarkerStrip({
  fps,
  pps,
  width,
  view,
  markers,
  ghost,
  coach,
  onZoomTo,
  onExit,
}: {
  fps: number;
  pps: number;
  width: number;
  /** Sichtbarer Ausschnitt (Hinweis links, Geister-Timecode kippt am rechten Rand). */
  view: { left: number; width: number };
  markers: readonly UserMarker[];
  ghost: StripGhost | null;
  /** Einmaliger Hinweis (§8.6) sichtbar? */
  coach: boolean;
  onZoomTo: (from: number, to: number) => void;
  /** Esc: zurück zur Timeline. */
  onExit: () => void;
}) {
  const t = useT();
  const actions = useActions();
  const hoveredKey = useStudio((s) => s.hoveredRefKey);
  const flash = useStudio((s) => s.flash);
  const lastMarkerKey = useStudio((s) => s.lastMarkerKey);
  const stripRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const seenKeys = useRef<Set<string>>(new Set(markers.map((m) => m.key)));

  const items = useMemo(() => layoutMarkerTags(markers, pps, fps), [markers, pps, fps]);
  const rovingKeys = useMemo(
    () => items.flatMap((item) => (item.type === 'collector' ? [`collector:${item.from}-${item.to}`] : item.marker.pending ? [] : [item.marker.key])),
    [items],
  );
  const tabKey = activeKey && rovingKeys.includes(activeKey) ? activeKey : (rovingKeys[0] ?? null);

  // Neuer Marker „setzt sich“ (§5): nur der Tag, der gerade erst erschienen ist und zuletzt gesetzt wurde
  useEffect(() => {
    const seen = seenKeys.current;
    const fresh = markers.some((m) => m.key === lastMarkerKey && !seen.has(m.key));
    seenKeys.current = new Set(markers.map((m) => m.key));
    if (!fresh || !lastMarkerKey) return;
    setSettling(lastMarkerKey);
    const timer = setTimeout(() => setSettling(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [markers, lastMarkerKey]);

  // Nach dem Entfernen per Tastatur geht der Fokus zum Nachbarn
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const el = rovingElement(key);
    if (el) {
      setActiveKey(key);
      el.focus();
    }
  }, [items]);

  const rovingElement = (key: string) =>
    Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? []).find((el) => el.dataset.roving === key) ?? null;

  const jump = (marker: UserMarker) => actions.revealRef({ kind: 'time', frame: marker.frame });

  /** Entfernt Marker und Chip; der Fokus geht zum Nachbarn (bzw. zurück zur Timeline, wenn keiner bleibt). */
  const remove = (key: string) => {
    const i = rovingKeys.indexOf(key);
    const neighbour = rovingKeys[i + 1] ?? rovingKeys[i - 1] ?? null;
    pendingFocus.current = neighbour;
    if (hoveredKey === key) actions.setHoveredRef(null);
    actions.removeRefByKey(key);
    if (!neighbour) onExit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-roving]');
    if (!el) return;
    const buttons = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? []);
    const i = buttons.indexOf(el);
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        // Fokus wandert, der Abspielkopf bleibt stehen
        e.preventDefault();
        e.stopPropagation();
        const next = buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))];
        if (next) {
          setActiveKey(next.dataset.roving ?? null);
          next.focus();
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        const key = el.dataset.markerKey;
        if (!key) return;
        e.preventDefault();
        e.stopPropagation();
        remove(key);
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onExit();
        break;
      default:
        break;
    }
  };

  // Geister-Timecode rechts vom Tag; läuft er über den sichtbaren Rand, steht er links davon
  const ghostTc = ghost ? tcParts(ghost.frame, fps, 'short') : null;
  const ghostTcWidth = ghostTc ? (ghostTc.head.length + ghostTc.frames.length) * 6.3 + 10 + (ghost?.snapped ? 14 : 0) : 0;
  const ghostFlip = ghost ? ghost.x + TAG_HIT_HALF + ghostTcWidth > view.left + view.width - 4 : false;

  return (
    <div
      ref={stripRef}
      className="tl-strip"
      role="toolbar"
      aria-label={t('stage.markers')}
      aria-orientation="horizontal"
      data-marker-strip=""
      style={{ width }}
      onKeyDown={onKeyDown}
    >
      {coach && (
        <span className="mk-coach" style={{ left: view.left + 8 }} aria-hidden="true">
          {t('stage.markerStripCoach')}
        </span>
      )}
      {items.map((item) => {
        if (item.type === 'collector') {
          const key = `collector:${item.from}-${item.to}`;
          return (
            <button
              key={key}
              type="button"
              className="mk mk-collector"
              style={{ left: item.x }}
              data-roving={key}
              tabIndex={tabKey === key ? 0 : -1}
              aria-label={t('stage.markerCollector', { count: item.markers.length, from: formatTc(item.from, fps, 'short'), to: formatTc(item.to, fps, 'short') })}
              onMouseDown={(e) => e.stopPropagation()}
              onFocus={() => setActiveKey(key)}
              onClick={() => onZoomTo(item.from, item.to)}
            >
              <span className="mk-tag">{item.markers.length}</span>
            </button>
          );
        }
        const m = item.marker;
        const time = formatTc(m.frame, fps, 'short');
        if (m.pending) {
          // Schwebend (Aufnahme läuft): Umriss ohne Nummer, nicht bedienbar
          return (
            <span key={m.key} className={`mk mk-${item.level} is-pending`} style={{ left: item.x }} title={t('stage.markerPendingAria', { time })} aria-hidden="true">
              <span className="mk-tag" />
            </span>
          );
        }
        const linked = hoveredKey === m.key;
        const flashing = flash?.key === m.key ? flash.nonce : 0;
        return (
          <button
            key={m.key}
            type="button"
            className={`mk mk-${item.level}${linked ? ' is-linked' : ''}${settling === m.key ? ' is-settling' : ''}`}
            style={{ left: item.x }}
            data-roving={m.key}
            data-marker-key={m.key}
            data-ref-key={m.key}
            tabIndex={tabKey === m.key ? 0 : -1}
            aria-label={t('stage.markerAria', { n: m.n, time })}
            aria-keyshortcuts="Enter Delete"
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={() => setActiveKey(m.key)}
            onClick={() => jump(m)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActiveKey(m.key);
              setMenu({ key: m.key, n: m.n, frame: m.frame, x: e.clientX, y: e.clientY });
            }}
            onMouseEnter={() => actions.setHoveredRef(m.key)}
            onMouseLeave={() => actions.setHoveredRef(null)}
          >
            <span className="mk-tag" style={{ width: markerTagWidth(m.n) }}>
              {m.n}
              {flashing ? <span key={flashing} className="mk-flash" aria-hidden="true" /> : null}
            </span>
          </button>
        );
      })}
      {ghost && ghostTc && (
        <>
          <span className="mk mk-normal mk-ghost" style={{ left: ghost.x }} aria-hidden="true">
            <span className="mk-tag">
              <Icon name="plus" size={9} />
            </span>
          </span>
          <span
            className="mk-ghost-tc mono"
            style={ghostFlip ? { left: ghost.x - TAG_HIT_HALF - ghostTcWidth } : { left: ghost.x + TAG_HIT_HALF }}
            aria-hidden="true"
          >
            <span>
              {ghostTc.head}
              <span className="ff">{ghostTc.frames}</span>
            </span>
            {ghost.snapped && <Icon name="magnet" size={10} />}
          </span>
        </>
      )}
      {menu && (
        <MarkerMenu
          menu={menu}
          onClose={() => {
            setMenu(null);
            rovingElement(menu.key)?.focus();
          }}
          onJump={() => {
            setMenu(null);
            actions.revealRef({ kind: 'time', frame: menu.frame });
            rovingElement(menu.key)?.focus();
          }}
          onRemove={() => {
            setMenu(null);
            remove(menu.key);
          }}
        />
      )}
    </div>
  );
});
