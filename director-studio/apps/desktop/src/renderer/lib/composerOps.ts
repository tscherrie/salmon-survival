import { composerLength, normalizeSegments, type ComposerSegment } from '@studio/core';

/** Ergänzende Composer-Operationen (Positionen wie in `insertRefAt`: Zeichen = 1, Chip = 1). */

/** Teilt die Segmente an einer Position in „davor“ und „danach“. */
export function splitAt(segments: readonly ComposerSegment[], position: number): [ComposerSegment[], ComposerSegment[]] {
  const before: ComposerSegment[] = [];
  const after: ComposerSegment[] = [];
  let pos = 0;
  for (const seg of segments) {
    if (seg.type === 'ref') {
      (pos < position ? before : after).push(seg);
      pos += 1;
      continue;
    }
    const end = pos + seg.text.length;
    if (end <= position) before.push(seg);
    else if (pos >= position) after.push(seg);
    else {
      before.push({ type: 'text', text: seg.text.slice(0, position - pos) });
      after.push({ type: 'text', text: seg.text.slice(position - pos) });
    }
    pos = end;
  }
  return [before, after];
}

function lastChar(segments: readonly ComposerSegment[]): string | null {
  const last = segments[segments.length - 1];
  if (!last) return null;
  return last.type === 'text' ? (last.text[last.text.length - 1] ?? null) : '#';
}

function firstChar(segments: readonly ComposerSegment[]): string | null {
  const first = segments[0];
  if (!first) return null;
  return first.type === 'text' ? (first.text[0] ?? null) : '#';
}

/**
 * Fügt mehrere Segmente an einer Position ein (z. B. das Diktat mit Chips).
 * Ergänzt bei Bedarf Leerzeichen an den Nahtstellen. Liefert neue Segmente + neue Caret-Position.
 */
export function insertSegmentsAt(
  segments: readonly ComposerSegment[],
  position: number,
  insert: readonly ComposerSegment[],
): { segments: ComposerSegment[]; caret: number } {
  const clean = normalizeSegments(insert);
  if (clean.length === 0) return { segments: normalizeSegments(segments), caret: position };
  const [before, after] = splitAt(segments, Math.max(0, Math.min(position, composerLength(segments))));
  const middle: ComposerSegment[] = [...clean];
  const prev = lastChar(before);
  if (prev !== null && !/\s/.test(prev) && firstChar(middle) !== null && !/^[\s.,!?;:]/.test(firstChar(middle)!)) {
    middle.unshift({ type: 'text', text: ' ' });
  }
  const next = firstChar(after);
  if (next !== null && !/[\s.,!?;:]/.test(next) && !/\s/.test(lastChar(middle) ?? ' ')) {
    middle.push({ type: 'text', text: ' ' });
  }
  const caret = composerLength(before) + composerLength(middle);
  return { segments: normalizeSegments([...before, ...middle, ...after]), caret };
}

/** Entfernt führende/abschließende Leerzeichen der äußeren Textsegmente. */
export function trimSegments(segments: readonly ComposerSegment[]): ComposerSegment[] {
  const out = normalizeSegments(segments);
  const first = out[0];
  if (first?.type === 'text') {
    const text = first.text.replace(/^\s+/, '');
    if (text) out[0] = { type: 'text', text };
    else out.shift();
  }
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    const text = last.text.replace(/\s+$/, '');
    if (text) out[out.length - 1] = { type: 'text', text };
    else out.pop();
  }
  return out;
}

/** Index des Segments, das die Position `position` (0-basiert, Einheit wie oben) belegt. */
export function segmentIndexAt(segments: readonly ComposerSegment[], position: number): { index: number; offset: number } | null {
  let pos = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const len = seg.type === 'text' ? seg.text.length : 1;
    if (position >= pos && position < pos + len) return { index: i, offset: position - pos };
    pos += len;
  }
  return null;
}
