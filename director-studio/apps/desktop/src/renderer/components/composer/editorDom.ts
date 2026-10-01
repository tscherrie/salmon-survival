import { normalizeSegments, type ComposerSegment, type Ref } from '@studio/core';
import { refChipParts, refChipTitle, type ChipLabelContext } from '../../lib/labels.ts';
import { isNumbered, refKey } from '../../lib/refNumbers.ts';
import { createIconElement } from '../common/Icon.tsx';

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

/** Zusätze beim Bauen der Chips: Nummern aus dem Store und Thumbnails für Bild- und Video-Assets. */
export interface ChipRenderOptions {
  /** Nummer je Referenz-Schlüssel (`refNumbers`); Assets und Versionen bleiben ohne Nummer. */
  numbers?: Readonly<Record<string, number>> | undefined;
  thumbUrl?: ((assetId: string) => string | null) | undefined;
}

function chipNumber(ref: Ref, opts: ChipRenderOptions): number | undefined {
  return isNumbered(ref) ? opts.numbers?.[refKey(ref)] : undefined;
}

/** Signatur eines Chips (Nummer und Beschriftung): Weicht sie vom DOM ab, baut der Editor neu auf. */
export function chipSignature(ref: Ref, ctx: ChipLabelContext, opts: ChipRenderOptions = {}): string {
  const parts = refChipParts(ref, ctx);
  return `${chipNumber(ref, opts) ?? ''}|${parts.text}${parts.secondary ?? ''}`;
}

/**
 * Chip nach DESIGN.md §7.7.2: `[Nummer] [Icon oder Thumb] Label [×]`. Zeit-Chips zeigen statt eines Icons den
 * Timecode in Mono mit gedämpften Frames. `data-ref-key` und `data-ref-n` verbinden den Chip mit seinen
 * Gegenstücken auf Bühne und Monitor (Hover `.is-linked`, Blitz `.is-flash`).
 */
export function createChip(ref: Ref, ctx: ChipLabelContext, removeLabel: (label: string) => string, opts: ChipRenderOptions = {}): HTMLElement {
  const parts = refChipParts(ref, ctx);
  const label = parts.text + (parts.secondary ?? '');
  const n = chipNumber(ref, opts);
  const chip = document.createElement('span');
  chip.className = `chip chip-${ref.kind}`;
  chip.contentEditable = 'false';
  chip.title = refChipTitle(ref, ctx);
  chip.dataset.ref = JSON.stringify(ref);
  chip.dataset.refKey = refKey(ref);
  if (n !== undefined) chip.dataset.refN = String(n);
  chip.dataset.sig = chipSignature(ref, ctx, opts);
  if (n !== undefined) {
    const num = document.createElement('span');
    num.className = 'n';
    num.textContent = String(n);
    chip.append(num);
  }
  const thumb = parts.thumbAssetId ? opts.thumbUrl?.(parts.thumbAssetId) : null;
  if (thumb) {
    const th = document.createElement('span');
    th.className = 'th';
    th.style.backgroundImage = `url("${thumb}")`;
    chip.append(th);
  } else if (parts.icon) {
    chip.append(createIconElement(parts.icon, 12, 'chip-icon'));
  }
  const text = document.createElement('span');
  text.className = parts.mono ? 'chip-label tc' : 'chip-label';
  text.textContent = parts.text;
  if (parts.secondary) {
    const ff = document.createElement('span');
    ff.className = 'ff';
    ff.textContent = parts.secondary;
    text.append(ff);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'chip-remove';
  remove.tabIndex = -1;
  remove.setAttribute('aria-label', removeLabel(label));
  remove.append(createIconElement('close', 10));
  chip.append(text, remove);
  return chip;
}

/** Baut den Editor-Inhalt aus Segmenten neu auf. */
export function renderSegments(
  root: HTMLElement,
  segments: readonly ComposerSegment[],
  ctx: ChipLabelContext,
  removeLabel: (label: string) => string,
  opts: ChipRenderOptions = {},
): void {
  root.textContent = '';
  segments.forEach((seg, i) => {
    if (seg.type === 'text') {
      root.appendChild(document.createTextNode(seg.text));
    } else {
      root.appendChild(createChip(seg.ref, ctx, removeLabel, opts));
      const next = segments[i + 1];
      if (!next || next.type === 'ref') root.appendChild(document.createTextNode(ZWSP));
    }
  });
}

/** Signaturen der Chips im DOM, in Dokumentreihenfolge (Gegenstück zu `chipSignature`). */
export function domChipSignatures(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('.chip'))
    .filter(isChip)
    .map((chip) => chip.dataset.sig ?? '')
    .join('\n');
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
