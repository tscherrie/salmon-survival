import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isComposerEmpty, type Ref } from '@studio/core';
import { useT } from '../../i18n.ts';
import { segmentIndexAt } from '../../lib/composerOps.ts';
import { REF_MIME, hasDragType, readRefDragData } from '../../lib/dnd.ts';
import { useActions, useAssetUrl, useLabelContext, useStudio, useStudioStore } from '../../state/context.tsx';
import {
  chipSignature,
  domChipSignatures,
  getCaretPosition,
  insertTextAtSelection,
  isChip,
  parseDom,
  positionOf,
  renderSegments,
  setCaretPosition,
  type ChipRenderOptions,
} from './editorDom.ts';

/**
 * Rich-Text-Composer (contenteditable) mit nicht editierbaren, nummerierten Chips. Quelle der Wahrheit sind die
 * Segmente im Store; Nutzereingaben werden aus dem DOM gelesen und über Store-Aktionen geschrieben (nie direkt per
 * `setState`, damit die Nummernvergabe an einer Stelle läuft). Externe Einfügungen (Bühnenklicks, Drag & Drop,
 * Diktat) bauen das DOM neu auf und setzen den Cursor hinter die Einfügung.
 * Verknüpfung (DESIGN.md §9.4): Hover über einen Chip meldet seinen Schlüssel, Gegenstücke melden ihn zurück
 * (`.is-linked`); ein Blitz (`.is-flash`) zeigt, welcher Chip gemeint ist; ein Klick zeigt die Stelle.
 */
export function ComposerEditor({
  onSubmit,
  disabled,
  onPositionRef,
  placeholder,
  describedBy,
}: {
  onSubmit: () => void;
  disabled?: boolean;
  /** Alt+Enter: Position der Kategorie referenzieren (Marker am Abspielkopf, aktuelle Folie bzw. Seite; §7.7.3). */
  onPositionRef?: (() => void) | undefined;
  placeholder?: string;
  /** ID der Beschreibung (Tastenkürzel) für `aria-describedby`. */
  describedBy?: string;
}) {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  const segments = useStudio((s) => s.composer);
  const revision = useStudio((s) => s.composerRevision);
  const numbers = useStudio((s) => s.refNumbers);
  const hoveredKey = useStudio((s) => s.hoveredRefKey);
  const flash = useStudio((s) => s.flash);
  const ctx = useLabelContext();
  const assetUrl = useAssetUrl();
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef<{ revision: number; json: string; chips: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const empty = isComposerEmpty(segments);

  const chipOptions = useMemo<ChipRenderOptions>(() => ({ numbers, thumbUrl: (id) => assetUrl(id, 'thumb') || null }), [numbers, assetUrl]);
  const chipsKey = segments.flatMap((s) => (s.type === 'ref' ? [chipSignature(s.ref, ctx, chipOptions)] : [])).join('\n');

  // DOM neu aufbauen, wenn sich der Inhalt von außen geändert hat (oder Nummern bzw. Beschriftungen der Chips).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const json = JSON.stringify(segments);
    const prev = rendered.current;
    if (prev && prev.json === json && prev.revision === revision && prev.chips === chipsKey) return;
    const before = new Set(Array.from(el.querySelectorAll<HTMLElement>('.chip'), (chip) => chip.dataset.refKey));
    renderSegments(el, segments, ctx, (label) => t('composer.removeChip', { label }), chipOptions);
    rendered.current = { revision, json, chips: chipsKey };
    // Neu hinzugekommene Chips setzen ein (§5: 180 ms, Deckkraft plus 4 px Weg) – im selben Frame wie ein neuer Marker
    if (prev) {
      for (const chip of Array.from(el.querySelectorAll<HTMLElement>('.chip'))) {
        if (before.has(chip.dataset.refKey)) continue;
        chip.classList.add('is-entering');
        chip.addEventListener('animationend', () => chip.classList.remove('is-entering'), { once: true });
      }
    }
    if (document.activeElement === el) setCaretPosition(el, store.getState().caret);
  }, [segments, revision, chipsKey, ctx, chipOptions, t, store]);

  // Verknüpfung: Chips mit dem Schlüssel unter dem Pointer (Chip, Marker, Clip …) bekommen `.is-linked`
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const chip of Array.from(el.querySelectorAll<HTMLElement>('.chip'))) {
      chip.classList.toggle('is-linked', hoveredKey !== null && chip.dataset.refKey === hoveredKey);
    }
  }, [hoveredKey, revision, chipsKey]);

  // Blitz (600 ms): Klasse neu setzen, damit die Animation auch bei einem zweiten Blitz von vorn beginnt
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !flash) return;
    const chips = Array.from(el.querySelectorAll<HTMLElement>('.chip')).filter((chip) => chip.dataset.refKey === flash.key);
    for (const chip of chips) {
      chip.classList.remove('is-flash');
      void chip.offsetWidth;
      chip.classList.add('is-flash');
    }
    return () => chips.forEach((chip) => chip.classList.remove('is-flash'));
  }, [flash]);

  // Cursorposition mitführen (auch bei Mausklicks/Pfeiltasten im Editor)
  useEffect(() => {
    const onSelection = () => {
      const el = ref.current;
      if (!el || document.activeElement !== el) return;
      const pos = getCaretPosition(el);
      if (pos !== null && pos !== store.getState().caret) actions.setCaret(pos);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [actions, store]);

  const commitFromDom = () => {
    const el = ref.current;
    if (!el) return;
    const next = parseDom(el);
    const caret = getCaretPosition(el) ?? store.getState().caret;
    actions.setComposer(next, caret);
    // Diese Revision hat der Editor selbst erzeugt: Das DOM stimmt schon, solange die Chips im DOM zu den Nummern
    // passen (nach einem Rückgängig kann ein Chip mit neuer Nummer zurückkehren, dann wird neu aufgebaut)
    rendered.current = { revision: store.getState().composerRevision, json: JSON.stringify(next), chips: domChipSignatures(el) };
  };

  /** Liest den DOM-Stand in den Store und entfernt dann das Segment an `index` (Caret danach an `caret`). */
  const removeAt = (segs: ReturnType<typeof parseDom>, index: number, caret: number) => {
    actions.setComposer(segs);
    actions.removeComposerSegment(index, caret);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitFromDom();
      onSubmit();
      return;
    }
    if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey) {
      // Position referenzieren: Der Chip landet am Caret. `preventDefault` hält globale Alt+Enter-Kürzel fern.
      event.preventDefault();
      commitFromDom();
      onPositionRef?.();
      return;
    }
    if (event.code === 'Space' && event.shiftKey && (event.ctrlKey || event.metaKey)) {
      // Push-to-Talk-Kürzel: kein Leerzeichen einfügen
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      insertTextAtSelection(el, '\n');
      commitFromDom();
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      insertTextAtSelection(el, '\n');
      commitFromDom();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selection = document.getSelection();
      if (!selection || !selection.isCollapsed) return;
      const pos = getCaretPosition(el);
      if (pos === null) return;
      const segs = parseDom(el);
      const target = event.key === 'Backspace' ? pos - 1 : pos;
      if (target < 0) return;
      const hit = segmentIndexAt(segs, target);
      if (hit && segs[hit.index]?.type === 'ref') {
        event.preventDefault();
        removeAt(segs, hit.index, event.key === 'Backspace' ? pos - 1 : pos);
      }
    }
  };

  const chipAt = (target: EventTarget | null): HTMLElement | null => {
    const chip = (target as HTMLElement | null)?.closest?.<HTMLElement>('.chip') ?? null;
    return chip && isChip(chip) && ref.current?.contains(chip) ? chip : null;
  };

  const onMouseDown = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const remove = target.closest('.chip-remove');
    if (!remove) return;
    event.preventDefault();
    const chip = chipAt(remove);
    const el = ref.current!;
    if (!chip) return;
    const pos = positionOf(el, el, Array.from(el.childNodes).indexOf(chip));
    const segs = parseDom(el);
    const hit = pos === null ? null : segmentIndexAt(segs, pos);
    if (hit) removeAt(segs, hit.index, pos ?? 0);
  };

  // Klick auf einen Chip (nicht auf das ×) zeigt, worauf er zeigt (§9.4)
  const onClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('.chip-remove')) return;
    const chip = chipAt(event.target);
    if (!chip) return;
    try {
      actions.revealRef(JSON.parse(chip.dataset.ref!) as Ref);
    } catch {
      // defekter Chip: nichts zu zeigen
    }
  };

  const onMouseOver = (event: React.MouseEvent) => {
    const key = chipAt(event.target)?.dataset.refKey ?? null;
    if (store.getState().hoveredRefKey !== key) actions.setHoveredRef(key);
  };

  const onMouseLeave = () => {
    if (store.getState().hoveredRefKey !== null) actions.setHoveredRef(null);
  };

  const onPaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    insertTextAtSelection(ref.current!, text.replace(/\r\n?/g, '\n'));
    commitFromDom();
  };

  const acceptsDrag = (dt: DataTransfer | null) => hasDragType(dt, REF_MIME) || hasDragType(dt, 'Files');

  const onDragOver = (event: React.DragEvent) => {
    if (!acceptsDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDrop = (event: React.DragEvent) => {
    setDragOver(false);
    const dt = event.dataTransfer;
    const ref_ = readRefDragData(dt);
    const files = dt?.files ? Array.from(dt.files) : [];
    if (!ref_ && files.length === 0) return;
    event.preventDefault();
    const el = ref.current!;
    // Einfügeposition aus dem Drop-Punkt (falls der Browser das kann)
    const doc = el.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const range = typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(event.clientX, event.clientY) : null;
    if (range && el.contains(range.startContainer)) {
      const pos = positionOf(el, range.startContainer, range.startOffset);
      if (pos !== null) actions.setCaret(pos);
    }
    if (ref_) actions.insertRef(ref_);
    else void actions.importDroppedFiles(files);
  };

  return (
    <div className={`composer-editor-wrap${dragOver ? ' is-drag-over' : ''}`}>
      {empty && (
        <div className="composer-placeholder" aria-hidden="true">
          {dragOver ? t('composer.dropHint') : (placeholder ?? t('composer.placeholder'))}
        </div>
      )}
      <div
        ref={ref}
        className="composer-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t('composer.label')}
        aria-describedby={describedBy}
        spellCheck
        data-testid="composer-editor"
        onInput={commitFromDom}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeave}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onBlur={() => {
          const pos = ref.current ? getCaretPosition(ref.current) : null;
          if (pos !== null) actions.setCaret(pos);
        }}
      />
    </div>
  );
}
