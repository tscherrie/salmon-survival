import { stableStringify, type ComposerSegment, type Ref } from '@studio/core';

/**
 * Nummerierte Referenzen (DESIGN.md §9.3). Jede Bühnen-Referenz im Composer trägt im Chip, auf der Bühne und im
 * Monitor dieselbe Nummer. Der Schlüssel (`refKey`) identifiziert, *worauf* gezeigt wird: Zwei Chips mit demselben
 * Schlüssel teilen sich eine Nummer, und `insertRef` fügt einen vorhandenen Schlüssel kein zweites Mal ein.
 */

type ElementRef = Extract<Ref, { kind: 'element' }>;

/** Seiten-Referenz: Element-Ref auf den `body` einer Seite (so erzeugen Seitenkarte und Positionsknopf sie). */
export function isPageRef(ref: Ref): ref is ElementRef & { page: string } {
  return ref.kind === 'element' && ref.doc === 'site' && ref.selector === 'body' && !ref.elementId && !ref.text && ref.page !== undefined;
}

/**
 * Stabiler Schlüssel einer Referenz, z. B. `time:372`, `clip:c12`, `marker:m3`, `slide:s3`, `page:/karte`,
 * `asset:ast_1`, `element:{…}`, `region:{…}`. Elemente zählen nach ihrer Identität (ID bzw. Selektor), nicht nach
 * Rahmen oder Quelltext-Position: Derselbe Klick in einer anderen Viewport-Breite ist dieselbe Referenz.
 */
export function refKey(ref: Ref): string {
  switch (ref.kind) {
    case 'time':
      return `time:${ref.frame}`;
    case 'range':
      return `range:${ref.from}-${ref.to}${ref.trackId ? `@${ref.trackId}` : ''}`;
    case 'clip':
      return `clip:${ref.clipId}`;
    case 'marker':
      return `marker:${ref.markerId}`;
    case 'asset':
      return `asset:${ref.assetId}`;
    case 'slide':
      return `slide:${ref.slideId}`;
    case 'version':
      return `version:${ref.versionNumber}`;
    case 'element': {
      if (isPageRef(ref)) return `page:${ref.page}`;
      const where = { doc: ref.doc, slideId: ref.slideId, page: ref.page };
      const identity = ref.elementId ? { ...where, elementId: ref.elementId } : { ...where, selector: ref.selector, tag: ref.tag, text: ref.text };
      return `element:${stableStringify(identity)}`;
    }
    case 'region':
      return `region:${stableStringify({ doc: ref.doc, slideId: ref.slideId, page: ref.page, frame: ref.frame, rect: ref.rect })}`;
  }
}

/** Nummeriert werden alle Bühnen-Referenzen, nicht Assets und Versionen. */
export function isNumbered(ref: Ref): boolean {
  return ref.kind !== 'asset' && ref.kind !== 'version';
}

/**
 * Gleicht die Nummern mit dem Composer-Inhalt ab:
 * 1. vorhandene Schlüssel behalten ihre Nummer (auch wenn Text umgestellt wird),
 * 2. neue Schlüssel bekommen in Reihenfolge ihres Auftretens die kleinste freie positive Zahl (Lücken werden wieder
 *    vergeben),
 * 3. Schlüssel, die nicht mehr vorkommen, fallen weg.
 * Ändert sich nichts, kommt `prev` unverändert zurück (stabile Referenz für Selektoren).
 */
export function reconcileRefNumbers(prev: Readonly<Record<string, number>>, segments: readonly ComposerSegment[]): Record<string, number> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (seg.type !== 'ref' || !isNumbered(seg.ref)) continue;
    const key = refKey(seg.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  const next: Record<string, number> = {};
  const used = new Set<number>();
  for (const key of keys) {
    const n = prev[key];
    if (n !== undefined && Number.isInteger(n) && n > 0 && !used.has(n)) {
      next[key] = n;
      used.add(n);
    }
  }
  let candidate = 1;
  for (const key of keys) {
    if (next[key] !== undefined) continue;
    while (used.has(candidate)) candidate += 1;
    next[key] = candidate;
    used.add(candidate);
  }
  const prevKeys = Object.keys(prev);
  const unchanged = prevKeys.length === keys.length && keys.every((key) => prev[key] === next[key]);
  return unchanged ? (prev as Record<string, number>) : next;
}
