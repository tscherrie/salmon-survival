import { useRef } from 'react';

/**
 * Ziehbarer Trenner (Maus + Tastatur). `orientation="vertical"` trennt Spalten (ändert eine Breite),
 * `horizontal` trennt Zeilen (ändert eine Höhe). `invert` für Größen rechts/unten vom Trenner.
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  onChange,
  label,
  invert = false,
}: {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  invert?: boolean;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    start.current = { pos: orientation === 'vertical' ? event.clientX : event.clientY, value };
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      const delta = (orientation === 'vertical' ? e.clientX : e.clientY) - start.current.pos;
      onChange(clamp(start.current.value + (invert ? -delta : delta)));
    };
    const up = () => {
      start.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    const dec = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const inc = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === dec || event.key === inc) {
      event.preventDefault();
      const dir = event.key === inc ? 1 : -1;
      onChange(clamp(value + (invert ? -dir : dir) * step));
    }
  };

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
