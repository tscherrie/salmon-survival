import { useRef, useState } from 'react';
import { LAYOUT_LIMITS } from '../../lib/layout.ts';

/**
 * Ziehbarer Trenner als Overlay über einer Kante (DESIGN.md §2.2): nimmt keinen Platz im Raster ein, die 7 px breite
 * Trefferfläche sitzt mittig auf der Kante, `::after` zeichnet die Haarlinie. `orientation="vertical"` trennt Spalten
 * (ändert eine Breite), `horizontal` trennt Zeilen (ändert eine Höhe); `invert` für Größen rechts bzw. unten.
 *
 * - Doppelklick: zurück auf den Standard des Breakpoints (`onReset`).
 * - Über das Minimum hinaus um mehr als 48 px gezogen: Leiste klappt auf die Schiene ein (`onCollapse(true)`);
 *   aus der Schiene heraus gezogen klappt sie wieder auf.
 * - Tastatur: Pfeile ±16 px (Umschalt ±48 px), Enter klappt ein bzw. auf.
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  onChange,
  label,
  invert = false,
  className,
  collapsed = false,
  railSize = 0,
  onCollapse,
  onReset,
}: {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  invert?: boolean;
  className?: string;
  collapsed?: boolean;
  /** Größe im eingeklappten Zustand (Schiene bzw. Bühnen-Leiste), Startwert beim Herausziehen. */
  railSize?: number;
  onCollapse?: (collapsed: boolean) => void;
  onReset?: () => void;
}) {
  const start = useRef<{ pos: number; size: number; collapsed: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number) => Math.min(Math.max(v, min), Math.max(min, max));
  const vertical = orientation === 'vertical';

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start.current = { pos: vertical ? event.clientX : event.clientY, size: collapsed ? railSize : value, collapsed };
    setDragging(true);
    // Während des Ziehens: einheitlicher Cursor, keine Textauswahl, keine Übergänge, iframes ohne Pointer
    document.documentElement.dataset.resizing = vertical ? 'col' : 'row';
    const move = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const delta = (vertical ? e.clientX : e.clientY) - s.pos;
      const raw = s.size + (invert ? -delta : delta);
      if (onCollapse && raw < min - LAYOUT_LIMITS.collapseOvershoot) {
        if (!s.collapsed) {
          s.collapsed = true;
          onCollapse(true);
        }
        return;
      }
      if (s.collapsed && onCollapse) {
        s.collapsed = false;
        onCollapse(false);
      }
      onChange(clamp(raw));
    };
    const up = () => {
      start.current = null;
      setDragging(false);
      delete document.documentElement.dataset.resizing;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const dec = vertical ? 'ArrowLeft' : 'ArrowUp';
    const inc = vertical ? 'ArrowRight' : 'ArrowDown';
    if (event.key === dec || event.key === inc) {
      event.preventDefault();
      const step = (event.shiftKey ? 48 : 16) * (event.key === inc ? 1 : -1) * (invert ? -1 : 1);
      if (collapsed) {
        if (step > 0) onCollapse?.(false);
        return;
      }
      onChange(clamp(value + step));
    } else if (event.key === 'Enter' && onCollapse) {
      event.preventDefault();
      onCollapse(!collapsed);
    }
  };

  return (
    <div
      className={`splitter splitter-${orientation}${className ? ` ${className}` : ''}${dragging ? ' is-dragging' : ''}${collapsed ? ' is-collapsed' : ''}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={collapsed ? railSize : value}
      aria-valuemin={onCollapse ? railSize : min}
      aria-valuemax={Math.max(min, max)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onReset?.()}
      onKeyDown={onKeyDown}
    />
  );
}
