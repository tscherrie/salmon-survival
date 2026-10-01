import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { normalizeRef, type Rect, type Ref } from '@studio/core';
import { useT } from '../../i18n.ts';
import { refKey } from '../../lib/refNumbers.ts';
import { DRAG_THRESHOLD_PX } from '../../lib/timelineGeometry.ts';
import { useActions, useStudio, useStudioStore } from '../../state/context.tsx';
import type { StudioData } from '../../state/types.ts';

/**
 * Zeigen auf Inhalte im Monitor (DESIGN.md §7.4). Eine transparente Ebene über der skalierten Ansicht: Klick → Punkt,
 * Ziehen → Rechteck, jeweils in Dokument-Koordinaten. Nur lesend – es wird nie etwas verschoben.
 *
 * Auswahl auf Medien ist Daylight für Medien (`--ref-media`) mit dunklem Halo (`--ref-media-halo`), damit sie auf
 * hellen wie dunklen Bildern steht (§3.2):
 * - Hover: 1 px gestrichelt plus 1 px Halo,
 * - referenziert: 1,5 px durchgezogen plus Halo und oben links ein Tag aus Nummer und Label,
 * - Region ziehen: wie referenziert, mit 10 % Füllung.
 */

/** Zeigemodus in Folien und Leinwand: Element (Klick wählt, Ziehen zieht eine Region) oder nur Region. */
export type PointMode = 'element' | 'region';

/** Eine referenzierte Stelle im Monitor: Nummer und Label wie im Chip, Rahmen in Dokument-Koordinaten. */
export interface MonitorSelection {
  key: string;
  n: number;
  rect: Rect;
  label: string;
}

const pct = (rect: Rect, docWidth: number, docHeight: number) => ({
  left: `${(rect.x / docWidth) * 100}%`,
  top: `${(rect.y / docHeight) * 100}%`,
  width: `${(rect.width / docWidth) * 100}%`,
  height: `${(rect.height / docHeight) * 100}%`,
});

const contains = (rect: Rect, x: number, y: number) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** Maße als „612 × 148“ (geschütztes Leerzeichen um das Malzeichen, §13). */
export function sizeLabel(rect: Pick<Rect, 'width' | 'height'>): string {
  return `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

/**
 * Referenzen des Composers, die im Monitor sichtbar sind: `pick` liefert für passende Referenzen Rahmen und Label,
 * sonst `null`. Ergebnis ist stabil, solange sich Composer und Nummern nicht ändern.
 */
export function useMonitorSelections(pick: (ref: Ref) => { rect: Rect; label: string } | null): MonitorSelection[] {
  const composer = useStudio((s) => s.composer);
  const numbers = useStudio((s) => s.refNumbers);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: MonitorSelection[] = [];
    for (const seg of composer) {
      if (seg.type !== 'ref') continue;
      const key = refKey(seg.ref);
      const n = numbers[key];
      if (!n || seen.has(key)) continue;
      const hit = pick(seg.ref);
      if (!hit || hit.rect.width <= 0 || hit.rect.height <= 0) continue;
      seen.add(key);
      out.push({ key, n, ...hit });
    }
    return out;
  }, [composer, numbers, pick]);
}

/**
 * Referenz aus dem Monitor einfügen: Chip am Caret, Toast „Referenz 2 hinzugefügt“ mit *Rückgängig*, und der
 * einmalige Hinweis zum Zeigen ist erledigt (§8.6). Steht die Stelle schon im Composer, blitzt nur der Chip.
 */
export function usePointRef(): (ref: Ref) => boolean {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  return useCallback(
    (input: Ref) => {
      if (!actions.insertRef(input)) return false;
      actions.completeCoach('monitorPointing');
      const key = refKey(normalizeRef(input));
      const n = store.getState().refNumbers[key];
      // Während der Sprachaufnahme gibt es noch keinen Chip (und keine Nummer): kein Toast
      if (n) actions.toast('info', t('monitor.refAdded', { n }), { label: t('monitor.undo'), run: () => actions.removeRefByKey(key) });
      return true;
    },
    [actions, store, t],
  );
}

/** Referenzierte Stellen als Rahmen mit Tag; Hover auf einem Chip (`hoveredRefKey`) hebt den Rahmen hervor. */
export function SelectionLayer({
  selections,
  docWidth,
  docHeight,
  scale,
}: {
  selections: readonly MonitorSelection[];
  docWidth: number;
  docHeight: number;
  /** Bildpunkte je Dokument-Pixel: Liegt ein Rahmen zu nah an der Oberkante, steht das Tag innen. */
  scale: number;
}) {
  const hovered = useStudio((s) => s.hoveredRefKey);
  const flash = useStudio((s) => s.flash);
  return (
    <>
      {selections.map((sel) => {
        const inside = sel.rect.y * scale < 24;
        return (
          <div
            key={sel.key}
            className={`sel-box is-ref${hovered === sel.key ? ' is-linked' : ''}${inside ? ' tag-inside' : ''}`}
            data-ref-key={sel.key}
            style={pct(sel.rect, docWidth, docHeight)}
          >
            <span className="sel-tag">
              <span className="n">{sel.n}</span>
              <span className="sel-label">{sel.label}</span>
            </span>
            {flash?.key === sel.key ? <span key={flash.nonce} className="sel-flash" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </>
  );
}

export function PointerOverlay({
  docWidth,
  docHeight,
  onPoint,
  onRegion,
  label,
  children,
  onKeyDown,
  className,
  mode = 'element',
  hitTest,
  selections,
  scale = 1,
}: {
  docWidth: number;
  docHeight: number;
  onPoint: (x: number, y: number, modifiers: { altKey: boolean; shiftKey: boolean }) => void;
  onRegion?: ((rect: Rect) => void) | undefined;
  label: string;
  children?: ReactNode;
  onKeyDown?: ((event: React.KeyboardEvent) => void) | undefined;
  className?: string;
  /** `region`: Ein Klick tut nichts, es gibt keine Hover-Rahmen; nur Ziehen zählt. */
  mode?: PointMode;
  /** Element unter dem Pointer (Dokument-Koordinaten) für den gestrichelten Hover-Rahmen. */
  hitTest?: ((x: number, y: number) => Rect | null) | undefined;
  /** Referenzierte Stellen (Rahmen mit Nummern-Tag). */
  selections?: readonly MonitorSelection[] | undefined;
  scale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = useActions();
  const store = useStudioStore();
  const [drag, setDrag] = useState<Rect | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  /** Schlüssel, den diese Ebene als Verknüpfungs-Hover gesetzt hat (nur den räumt sie wieder ab). */
  const linkedKey = useRef<string | null>(null);

  const toDoc = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const sx = rect.width > 0 ? docWidth / rect.width : 1;
    const sy = rect.height > 0 ? docHeight / rect.height : 1;
    return {
      x: Math.max(0, Math.min(docWidth, (clientX - rect.left) * sx)),
      y: Math.max(0, Math.min(docHeight, (clientY - rect.top) * sy)),
    };
  };

  const setLinked = (key: string | null) => {
    if (linkedKey.current === key) return;
    const state: StudioData = store.getState();
    // Nur den eigenen Hover zurücksetzen, nicht den eines Chips
    if (key === null && state.hoveredRefKey !== linkedKey.current) {
      linkedKey.current = null;
      return;
    }
    linkedKey.current = key;
    actions.setHoveredRef(key);
  };

  const onMouseMove = (event: React.MouseEvent) => {
    if (drag) return;
    const { x, y } = toDoc(event.clientX, event.clientY);
    // Über einer referenzierten Stelle: Chip und Rahmen gemeinsam hervorheben (§9.4)
    const over = selections ? [...selections].reverse().find((s) => contains(s.rect, x, y)) : undefined;
    setLinked(over?.key ?? null);
    if (mode !== 'element' || !hitTest) {
      if (hover) setHover(null);
      return;
    }
    const hit = over ? null : hitTest(x, y);
    if (hit?.x !== hover?.x || hit?.y !== hover?.y || hit?.width !== hover?.width || hit?.height !== hover?.height) setHover(hit);
  };

  const onMouseLeave = () => {
    setHover(null);
    setLinked(null);
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
      setHover(null);
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
      if (mode === 'element') onPoint(start.x, start.y, modifiers);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={ref}
      className={`pointer-overlay mode-${mode}${hover ? ' is-over' : ''} ${className ?? ''}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="application"
      aria-label={label}
    >
      {selections && <SelectionLayer selections={selections} docWidth={docWidth} docHeight={docHeight} scale={scale} />}
      {hover && <div className="sel-box is-hover" style={pct(hover, docWidth, docHeight)} />}
      {children}
      {drag && <div className="sel-box is-region" style={pct(drag, docWidth, docHeight)} />}
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

/** Markierung eines Elements beim Durchgehen mit der Tastatur: wie der Hover-Rahmen, in Prozent der Dokumentgröße. */
export function HighlightBox({ rect, docWidth, docHeight }: { rect: Rect; docWidth: number; docHeight: number }) {
  return <div className="sel-box is-hover is-keyboard" style={pct(rect, docWidth, docHeight)} />;
}
