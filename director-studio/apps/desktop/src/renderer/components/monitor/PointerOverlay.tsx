import { useRef, useState, type ReactNode } from 'react';
import type { Rect } from '@studio/core';
import { DRAG_THRESHOLD_PX } from '../../lib/timelineGeometry.ts';

/**
 * Transparente Ebene über einer skalierten Ansicht: Klick → Punkt, Ziehen → Rechteck,
 * jeweils in Dokument-Koordinaten. Nur lesend – es wird nie etwas verschoben.
 */
export function PointerOverlay({
  docWidth,
  docHeight,
  onPoint,
  onRegion,
  label,
  children,
  onKeyDown,
  className,
}: {
  docWidth: number;
  docHeight: number;
  onPoint: (x: number, y: number, modifiers: { altKey: boolean; shiftKey: boolean }) => void;
  onRegion?: ((rect: Rect) => void) | undefined;
  label: string;
  children?: ReactNode;
  onKeyDown?: ((event: React.KeyboardEvent) => void) | undefined;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Rect | null>(null);

  const toDoc = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const sx = rect.width > 0 ? docWidth / rect.width : 1;
    const sy = rect.height > 0 ? docHeight / rect.height : 1;
    return {
      x: Math.max(0, Math.min(docWidth, (clientX - rect.left) * sx)),
      y: Math.max(0, Math.min(docHeight, (clientY - rect.top) * sy)),
      sx,
      sy,
    };
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    ref.current?.focus();
    const start = toDoc(event.clientX, event.clientY);
    const startClient = { x: event.clientX, y: event.clientY };
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey };
    let dragging = false;
    let current = start;
    const move = (e: MouseEvent) => {
      if (!dragging && Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) < DRAG_THRESHOLD_PX) return;
      if (!onRegion) return;
      dragging = true;
      current = toDoc(e.clientX, e.clientY);
      setDrag(normalizeRect(start, current));
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (dragging && onRegion) {
        current = toDoc(e.clientX, e.clientY);
        const rect = normalizeRect(start, current);
        if (rect.width >= 1 && rect.height >= 1) onRegion(rect);
        return;
      }
      onPoint(start.x, start.y, modifiers);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={ref}
      className={`pointer-overlay ${className ?? ''}`}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="application"
      aria-label={label}
    >
      {children}
      {drag && (
        <div
          className="region-box"
          style={{
            left: `${(drag.x / docWidth) * 100}%`,
            top: `${(drag.y / docHeight) * 100}%`,
            width: `${(drag.width / docWidth) * 100}%`,
            height: `${(drag.height / docHeight) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(b.x - a.x)),
    height: Math.round(Math.abs(b.y - a.y)),
  };
}

/** Markierung eines Elements (Tastaturfokus/Hover) in Prozent der Dokumentgröße. */
export function HighlightBox({ rect, docWidth, docHeight }: { rect: Rect; docWidth: number; docHeight: number }) {
  return (
    <div
      className="highlight-box"
      style={{
        left: `${(rect.x / docWidth) * 100}%`,
        top: `${(rect.y / docHeight) * 100}%`,
        width: `${(rect.width / docWidth) * 100}%`,
        height: `${(rect.height / docHeight) * 100}%`,
      }}
    />
  );
}
