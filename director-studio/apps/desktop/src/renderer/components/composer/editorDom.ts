import { normalizeSegments, type ComposerSegment, type Ref, type RefLabelContext } from '@studio/core';
import { refChipLabel, refChipTitle } from '../../lib/labels.ts';

/**
 * DOM-Hilfen für den contenteditable-Composer. Chips sind `<span contenteditable="false" data-ref="…">`.
 * Positionen zählen wie in @studio/core (`insertRefAt`): jedes Zeichen 1, jeder Chip 1.
 * Nach einem Chip am Ende (oder vor einem weiteren Chip) steht ein Null-Breite-Anker (U+200B), damit der
 * Cursor dort stehen kann; er wird beim Auslesen ignoriert.
 */

export const ZWSP = '​';

export function isChip(node: Node | null): boolean {
  return !!node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.ref !== undefined;
}

function cleanText(text: string): string {
  return text.replace(/​/g, '').replace(/ /g, ' ');
}

function visibleLength(text: string): number {
  return cleanText(text).length;
}

export function createChip(ref: Ref, ctx: RefLabelContext, removeLabel: (label: string) => string): HTMLElement {
  const label = refChipLabel(ref, ctx);
  const chip = document.createElement('span');
  chip.className = `chip chip-${ref.kind}`;
  chip.contentEditable = 'false';
  chip.title = refChipTitle(ref, ctx);
  chip.dataset.ref = JSON.stringify(ref);
  const text = document.createElement('span');
  text.className = 'chip-label';
  text.textContent = label;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'chip-remove';
  remove.tabIndex = -1;
  remove.setAttribute('aria-label', removeLabel(label));
  remove.textContent = '×';
  chip.append(text, remove);
  return chip;
}

/** Baut den Editor-Inhalt aus Segmenten neu auf. */
export function renderSegments(root: HTMLElement, segments: readonly ComposerSegment[], ctx: RefLabelContext, removeLabel: (label: string) => string): void {
  root.textContent = '';
  segments.forEach((seg, i) => {
    if (seg.type === 'text') {
      root.appendChild(document.createTextNode(seg.text));
    } else {
      root.appendChild(createChip(seg.ref, ctx, removeLabel));
      const next = segments[i + 1];
      if (!next || next.type === 'ref') root.appendChild(document.createTextNode(ZWSP));
    }
  });
}

/** Liest Segmente aus dem DOM (Text, Chips, Zeilenumbrüche). */
export function parseDom(root: HTMLElement): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  const visit = (node: Node, isRootChild: boolean, isLast: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent ?? '');
      if (text) out.push({ type: 'text', text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (isChip(el)) {
      try {
        out.push({ type: 'ref', ref: JSON.parse(el.dataset.ref!) as Ref });
      } catch {
        // defekter Chip wird verworfen
      }
      return;
    }
    if (el.tagName === 'BR') {
      // Browser hängen an leere Editoren ein <br> an – das letzte ist kein Inhalt.
      if (!(isRootChild && isLast)) out.push({ type: 'text', text: '\n' });
      return;
    }
    // Blöcke (DIV/P) aus Browser-Eingaben: als Zeilenumbruch behandeln
    const last = out[out.length - 1];
    if (out.length > 0 && !(last?.type === 'text' && last.text.endsWith('\n'))) out.push({ type: 'text', text: '\n' });
    el.childNodes.forEach((child, i) => visit(child, false, i === el.childNodes.length - 1));
  };
  root.childNodes.forEach((child, i) => visit(child, true, i === root.childNodes.length - 1));
  return normalizeSegments(out);
}

function nodeSize(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return visibleLength(node.textContent ?? '');
  if (isChip(node)) return 1;
  if ((node as HTMLElement).tagName === 'BR') return 1;
  let sum = 0;
  node.childNodes.forEach((c) => (sum += nodeSize(c)));
  return sum;
}

/** Position (Einheiten wie oben) eines DOM-Punkts im Editor; `null`, wenn außerhalb. */
export function positionOf(root: HTMLElement, container: Node, offset: number): number | null {
  if (container !== root && !root.contains(container)) return null;
  let pos = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) pos += visibleLength((node.textContent ?? '').slice(0, offset));
      else for (let i = 0; i < offset && i < node.childNodes.length; i++) pos += nodeSize(node.childNodes[i]!);
      found = true;
      return;
    }
    if (isChip(node)) {
      pos += 1;
      if (node.contains(container)) found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      pos += visibleLength(node.textContent ?? '');
      return;
    }
    if ((node as HTMLElement).tagName === 'BR') {
      pos += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  if (container === root) {
    for (let i = 0; i < offset && i < root.childNodes.length; i++) pos += nodeSize(root.childNodes[i]!);
    return pos;
  }
  root.childNodes.forEach(visit);
  return found ? pos : null;
}

/** Aktuelle Cursorposition im Editor (`null`, wenn die Auswahl nicht im Editor liegt). */
export function getCaretPosition(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return positionOf(root, range.startContainer, range.startOffset);
}

/** Offset im Rohtext für eine sichtbare Position (U+200B zählt nicht). */
function rawOffsetFor(raw: string, visible: number): number {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (seen === visible) return i;
    if (raw[i] !== ZWSP) seen++;
  }
  return raw.length;
}

/** Setzt den Cursor an eine Position (flach: Textknoten und Chips direkt unter dem Editor). */
export function setCaretPosition(root: HTMLElement, position: number): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  let remaining = Math.max(0, position);
  let placed = false;
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      const len = visibleLength(raw);
      if (remaining <= len) {
        range.setStart(node, rawOffsetFor(raw, remaining));
        placed = true;
        break;
      }
      remaining -= len;
    } else {
      const size = nodeSize(node);
      if (remaining === 0) {
        range.setStartBefore(node);
        placed = true;
        break;
      }
      if (remaining <= size && isChip(node)) {
        range.setStartAfter(node);
        remaining -= size;
        if (remaining === 0) {
          placed = true;
          break;
        }
      } else {
        remaining -= size;
      }
    }
  }
  if (!placed) range.setStart(root, root.childNodes.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Fügt Klartext an der aktuellen Auswahl ein (Einfügen, Enter). */
export function insertTextAtSelection(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  let range: Range;
  if (selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
    range = selection.getRangeAt(0);
  } else {
    range = doc.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  const node = doc.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
