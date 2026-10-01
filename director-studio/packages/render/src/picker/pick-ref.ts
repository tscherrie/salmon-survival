import { parseDataSrc, type Ref } from '@studio/core';
import type { PickPayload } from './picker-script.ts';

/**
 * Wandelt einen Pick in eine Referenz (`@studio/core` Ref) um.
 * - `deck`: Klick auf ein Element → `element` mit `slideId` + `elementId`; Klick auf den Folienhintergrund → `slide`.
 * - `canvas`: `element` mit `elementId` = Ebenen-ID (nächstes `data-sid`).
 * - `site`: `element` mit Seite, Selektor, Quelle (`data-src`/`data-loc`) und Box.
 */
export function pickPayloadToRef(payload: PickPayload, doc: 'site' | 'deck' | 'canvas'): Ref {
  const bbox = {
    x: payload.bbox.x,
    y: payload.bbox.y,
    width: Math.max(0, payload.bbox.width),
    height: Math.max(0, payload.bbox.height),
  };
  if (doc === 'deck') {
    const slideId = payload.slideId ?? undefined;
    const elementId = payload.dataSid && payload.dataSid !== slideId ? payload.dataSid : undefined;
    if (slideId && !elementId) return { kind: 'slide', slideId };
    return {
      kind: 'element',
      doc: 'deck',
      ...(slideId ? { slideId } : {}),
      ...(elementId ? { elementId } : {}),
      ...(payload.selector ? { selector: payload.selector } : {}),
      bbox,
    };
  }
  if (doc === 'canvas') {
    const elementId = payload.dataSid && !payload.dataSid.startsWith('__') ? payload.dataSid : undefined;
    return {
      kind: 'element',
      doc: 'canvas',
      ...(elementId ? { elementId } : {}),
      ...(!elementId && payload.selector ? { selector: payload.selector } : {}),
      bbox,
    };
  }
  const source = payload.dataSrc ? parseDataSrc(payload.dataSrc) : undefined;
  return {
    kind: 'element',
    doc: 'site',
    page: payload.page || '/',
    ...(payload.selector ? { selector: payload.selector } : {}),
    ...(payload.dataSid ? { elementId: payload.dataSid } : {}),
    ...(source && source.line > 0 ? { source: { file: source.file, line: source.line, ...(source.column && source.column > 0 ? { column: source.column } : {}) } } : {}),
    bbox,
  };
}
