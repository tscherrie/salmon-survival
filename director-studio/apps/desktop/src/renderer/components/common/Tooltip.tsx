import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Kbd, type KeyName } from './Kbd.tsx';

/**
 * Tooltip (DESIGN.md §7.11): ersetzt `title=` an Icon-Knöpfen. Erscheint nach 400 ms; beim Wechsel zwischen
 * Tooltips sofort. Invertiert (`--text` auf `--base`), optional mit Keycaps. Das Kind bekommt `aria-describedby`,
 * solange der Tooltip offen ist. Esc und Pointer-Down schließen ihn.
 */
const SHOW_DELAY_MS = 400;
/** Solange nach dem Schließen eines Tooltips gilt der nächste als „warm“ und erscheint ohne Verzögerung. */
const WARM_MS = 300;
const GAP = 6;
const EDGE = 4;

let openCount = 0;
let lastHiddenAt = -Infinity;

type Placement = 'top' | 'bottom' | 'right' | 'left';

interface ChildProps {
  onPointerEnter?: (e: SyntheticEvent) => void;
  onPointerLeave?: (e: SyntheticEvent) => void;
  onPointerDown?: (e: SyntheticEvent) => void;
  onFocus?: (e: SyntheticEvent) => void;
  onBlur?: (e: SyntheticEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  'aria-describedby'?: string;
}

export function Tooltip({
  label,
  keys,
  placement = 'top',
  disabled = false,
  children,
}: {
  label: string;
  keys?: readonly KeyName[];
  placement?: Placement;
  /** Unterdrückt den Tooltip (z. B. solange das Popover des Auslösers offen ist). */
  disabled?: boolean;
  children: ReactElement;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null && !disabled;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = useCallback((el: HTMLElement) => {
    clear();
    const warm = openCount > 0 || performance.now() - lastHiddenAt < WARM_MS;
    if (warm) setAnchor(el);
    else timer.current = setTimeout(() => setAnchor(el), SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    clear();
    setAnchor(null);
  }, []);

  // Offene Tooltips zählen (für den sofortigen Wechsel)
  useEffect(() => {
    if (!open) return;
    openCount++;
    return () => {
      openCount--;
      lastHiddenAt = performance.now();
    };
  }, [open]);

  useEffect(() => clear, []);

  // Position: am Auslöser (bei Platzmangel auf der Gegenseite), mittig ausgerichtet und im Fenster gehalten
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const a = anchor.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (placement === 'top' || placement === 'bottom') {
      top = placement === 'top' ? a.top - tip.height - GAP : a.bottom + GAP;
      if (placement === 'top' && top < EDGE) top = a.bottom + GAP;
      if (placement === 'bottom' && top + tip.height > vh - EDGE) top = a.top - tip.height - GAP;
      left = a.left + a.width / 2 - tip.width / 2;
    } else {
      left = placement === 'right' ? a.right + GAP : a.left - tip.width - GAP;
      if (placement === 'right' && left + tip.width > vw - EDGE) left = a.left - tip.width - GAP;
      if (placement === 'left' && left < EDGE) left = a.right + GAP;
      top = a.top + a.height / 2 - tip.height / 2;
    }
    left = Math.min(Math.max(EDGE, left), vw - tip.width - EDGE);
    top = Math.min(Math.max(EDGE, top), vh - tip.height - EDGE);
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [anchor, placement, label]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  const props = children.props as ChildProps;
  const trigger = cloneElement(children as ReactElement<ChildProps>, {
    onPointerEnter: (e: SyntheticEvent) => {
      props.onPointerEnter?.(e);
      show(e.currentTarget as HTMLElement);
    },
    onPointerLeave: (e: SyntheticEvent) => {
      props.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: SyntheticEvent) => {
      props.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: SyntheticEvent) => {
      props.onFocus?.(e);
      const el = e.currentTarget as HTMLElement;
      // Nur bei Tastaturfokus (nicht nach einem Mausklick)
      if (el.matches?.(':focus-visible')) show(el);
    },
    onBlur: (e: SyntheticEvent) => {
      props.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && open) hide();
      props.onKeyDown?.(e);
    },
    'aria-describedby': open ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'],
  });

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tooltip${pos ? ' is-placed' : ''}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            <span>{label}</span>
            {keys && keys.length > 0 && <Kbd keys={keys} />}
          </div>,
          document.body,
        )}
    </>
  );
}
