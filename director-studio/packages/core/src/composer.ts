import { normalizeRef, parseRefTag, refLabel, serializeRef, type Ref, type RefLabelContext } from './refs.ts';

/** Inhalt des Composers: Text mit eingebetteten Referenz-Chips. */
export type ComposerSegment = { type: 'text'; text: string } | { type: 'ref'; ref: Ref };

export interface ComposerMessage {
  segments: ComposerSegment[];
}

export interface SerializedComposer {
  /** Text mit `<ref …/>`-Tags an den Chip-Positionen. */
  text: string;
  /** Referenzen in Reihenfolge ihres Auftretens; gleiche Referenzen teilen sich eine ID. */
  refs: Array<{ id: string; ref: Ref }>;
}

/** Fasst benachbarte Textsegmente zusammen und entfernt leere. */
export function normalizeSegments(segments: readonly ComposerSegment[]): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      if (seg.text === '') continue;
      const last = out[out.length - 1];
      if (last && last.type === 'text') {
        out[out.length - 1] = { type: 'text', text: last.text + seg.text };
      } else {
        out.push({ type: 'text', text: seg.text });
      }
    } else {
      out.push({ type: 'ref', ref: normalizeRef(seg.ref) });
    }
  }
  return out;
}

/** Länge des Composer-Inhalts in „Positionen“: Zeichen zählen 1, ein Chip zählt 1. */
export function composerLength(segments: readonly ComposerSegment[]): number {
  return segments.reduce((n, s) => n + (s.type === 'text' ? s.text.length : 1), 0);
}

/**
 * Fügt einen Chip an einer Position ein (Positionen wie in {@link composerLength}).
 * Positionen außerhalb werden auf Anfang/Ende begrenzt.
 */
export function insertRefAt(segments: readonly ComposerSegment[], position: number, ref: Ref): ComposerSegment[] {
  const target = Math.max(0, Math.min(position, composerLength(segments)));
  const out: ComposerSegment[] = [];
  let pos = 0;
  let inserted = false;
  for (const seg of segments) {
    if (inserted) {
      out.push(seg);
      continue;
    }
    if (seg.type === 'ref') {
      if (pos === target) {
        out.push({ type: 'ref', ref });
        inserted = true;
      }
      out.push(seg);
      pos += 1;
      continue;
    }
    const end = pos + seg.text.length;
    if (target >= pos && target <= end) {
      const cut = target - pos;
      out.push({ type: 'text', text: seg.text.slice(0, cut) });
      out.push({ type: 'ref', ref });
      out.push({ type: 'text', text: seg.text.slice(cut) });
      inserted = true;
    } else {
      out.push(seg);
    }
    pos = end;
  }
  if (!inserted) out.push({ type: 'ref', ref });
  return normalizeSegments(out);
}

export function appendText(segments: readonly ComposerSegment[], text: string): ComposerSegment[] {
  return normalizeSegments([...segments, { type: 'text', text }]);
}

export function appendRef(segments: readonly ComposerSegment[], ref: Ref): ComposerSegment[] {
  return normalizeSegments([...segments, { type: 'ref', ref }]);
}

export function removeSegment(segments: readonly ComposerSegment[], index: number): ComposerSegment[] {
  return normalizeSegments(segments.filter((_, i) => i !== index));
}

export function isComposerEmpty(segments: readonly ComposerSegment[]): boolean {
  return normalizeSegments(segments).every((s) => s.type === 'text' && s.text.trim() === '');
}

/** Für den Director: Text mit Tags + Liste der Referenzen. */
export function serializeComposer(message: ComposerMessage, fps = 30): SerializedComposer {
  const refs: Array<{ id: string; ref: Ref }> = [];
  const keyToId = new Map<string, string>();
  let text = '';
  for (const seg of normalizeSegments(message.segments)) {
    if (seg.type === 'text') {
      text += seg.text;
      continue;
    }
    const key = JSON.stringify(seg.ref);
    let id = keyToId.get(key);
    if (!id) {
      id = `r${refs.length + 1}`;
      keyToId.set(key, id);
      refs.push({ id, ref: seg.ref });
    }
    text += serializeRef(seg.ref, id, fps);
  }
  return { text, refs };
}

/** Umkehrung von {@link serializeComposer}. */
export function parseSerializedComposer(text: string, fps = 30): ComposerSegment[] {
  const segments: ComposerSegment[] = [];
  const re = /<ref\s[^>]*?\/>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
    segments.push({ type: 'ref', ref: parseRefTag(m[0], fps).ref });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return normalizeSegments(segments);
}

/** Lesbare Darstellung (z. B. für den Gesprächsverlauf). */
export function composerToDisplayText(segments: readonly ComposerSegment[], ctx: RefLabelContext = {}): string {
  return normalizeSegments(segments)
    .map((s) => (s.type === 'text' ? s.text : `[${refLabel(s.ref, ctx)}]`))
    .join('');
}
