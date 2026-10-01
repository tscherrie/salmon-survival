import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isComposerEmpty, refLabel, removeSegment, type ComposerSegment } from '@studio/core';
import { useT } from '../../i18n.ts';
import { segmentIndexAt } from '../../lib/composerOps.ts';
import { REF_MIME, hasDragType, readRefDragData } from '../../lib/dnd.ts';
import { useActions, useLabelContext, useStudio, useStudioStore } from '../../state/context.tsx';
import { getCaretPosition, insertTextAtSelection, isChip, parseDom, positionOf, renderSegments, setCaretPosition } from './editorDom.ts';

/**
 * Rich-Text-Composer (contenteditable) mit nicht editierbaren Chips. Quelle der Wahrheit sind die
 * Segmente im Store; Nutzereingaben werden aus dem DOM gelesen, externe Einfügungen (Bühnenklicks,
 * Drag & Drop, Diktat) bauen das DOM neu auf und setzen den Cursor hinter die Einfügung.
 */
export function ComposerEditor({ onSubmit, disabled }: { onSubmit: () => void; disabled?: boolean }) {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  const segments = useStudio((s) => s.composer);
  const revision = useStudio((s) => s.composerRevision);
  const ctx = useLabelContext();
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef<{ revision: number; json: string; labels: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const empty = isComposerEmpty(segments);

  const labelsKey = segments.map((s) => (s.type === 'ref' ? refLabel(s.ref, ctx) : '')).join('|');

  // DOM neu aufbauen, wenn sich der Inhalt von außen geändert hat (oder Chip-Beschriftungen).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const json = JSON.stringify(segments);
    const prev = rendered.current;
    if (prev && prev.json === json && prev.revision === revision && prev.labels === labelsKey) return;
    renderSegments(el, segments, ctx, (label) => t('composer.removeChip', { label }));
    rendered.current = { revision, json, labels: labelsKey };
    if (document.activeElement === el) setCaretPosition(el, store.getState().caret);
  }, [segments, revision, labelsKey, ctx, t, store]);

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
    rendered.current = { revision: store.getState().composerRevision, json: JSON.stringify(next), labels: next.map((s) => (s.type === 'ref' ? refLabel(s.ref, ctx) : '')).join('|') };
    actions.setComposer(next, caret);
  };

  /** Entfernt das Segment an `index` und setzt den Cursor an `caret` (DOM wird neu gebaut). */
  const removeAt = (index: number, caret: number) => {
    const next: ComposerSegment[] = removeSegment(store.getState().composer, index);
    store.setState((s) => ({ composer: next, caret, composerRevision: s.composerRevision + 1 }));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitFromDom();
      onSubmit();
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
        actions.setComposer(segs);
        removeAt(hit.index, event.key === 'Backspace' ? pos - 1 : pos);
      }
    }
  };

  const onMouseDown = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const remove = target.closest('.chip-remove');
    if (!remove) return;
    event.preventDefault();
    const chip = remove.closest('[data-ref]');
    const el = ref.current!;
    if (!chip || !isChip(chip)) return;
    const pos = positionOf(el, el, Array.from(el.childNodes).indexOf(chip));
    const segs = parseDom(el);
    const hit = pos === null ? null : segmentIndexAt(segs, pos);
    if (hit) {
      actions.setComposer(segs);
      removeAt(hit.index, pos ?? 0);
    }
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
          {dragOver ? t('composer.dropHint') : t('composer.placeholder')}
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
        aria-describedby="composer-hint"
        spellCheck
        data-testid="composer-editor"
        onInput={commitFromDom}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
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
