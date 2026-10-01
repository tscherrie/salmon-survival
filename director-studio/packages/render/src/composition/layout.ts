import type { CSSProperties } from 'react';

/** Positionierung von Bild/Video im Clip-Rahmen (fit + Reframing). */

export type MediaFit = 'cover' | 'contain' | 'fill' | 'none';

export interface MediaLayoutInput {
  boxWidth: number;
  boxHeight: number;
  /** Eigenmaße des Mediums (falls bekannt → exakte Berechnung). */
  mediaWidth?: number | undefined;
  mediaHeight?: number | undefined;
  fit: MediaFit;
  /** Gewünschter Bildmittelpunkt im Quellmedium (normiert 0..1). */
  centerX?: number | undefined;
  centerY?: number | undefined;
  /** Zusätzlicher Zoom (Reframing-Scale, Ken-Burns). */
  zoom?: number | undefined;
}

/**
 * Liefert den Stil für das Medienelement. Mit bekannten Eigenmaßen wird das Medium absolut platziert,
 * sodass `centerX/centerY` exakt der Bildmitte entsprechen (bei `cover` auf den Rand begrenzt, damit
 * keine Lücken entstehen). Ohne Eigenmaße: `object-fit` + `object-position`.
 */
export function computeMediaStyle(input: MediaLayoutInput): CSSProperties {
  const cx = clamp01(input.centerX ?? 0.5);
  const cy = clamp01(input.centerY ?? 0.5);
  const zoom = input.zoom && input.zoom > 0 ? input.zoom : 1;
  const { boxWidth: bw, boxHeight: bh, mediaWidth: mw, mediaHeight: mh } = input;
  if (input.fit === 'fill') {
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      objectFit: 'fill',
      ...(zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: `${cx * 100}% ${cy * 100}%` } : {}),
    };
  }
  if (mw && mh && mw > 0 && mh > 0) {
    const base = input.fit === 'cover' ? Math.max(bw / mw, bh / mh) : input.fit === 'contain' ? Math.min(bw / mw, bh / mh) : 1;
    const s = base * zoom;
    const dw = mw * s;
    const dh = mh * s;
    let left = bw / 2 - cx * dw;
    let top = bh / 2 - cy * dh;
    if (dw >= bw) left = Math.min(0, Math.max(bw - dw, left));
    else if (input.centerX === undefined) left = (bw - dw) / 2;
    if (dh >= bh) top = Math.min(0, Math.max(bh - dh, top));
    else if (input.centerY === undefined) top = (bh - dh) / 2;
    return {
      position: 'absolute',
      left: r(left),
      top: r(top),
      width: r(dw),
      height: r(dh),
      maxWidth: 'none',
      maxHeight: 'none',
      objectFit: 'fill',
    };
  }
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    objectFit: input.fit,
    objectPosition: `${r(cx * 100)}% ${r(cy * 100)}%`,
    ...(zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: `${r(cx * 100)}% ${r(cy * 100)}%` } : {}),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Ebenen-Transformation eines Clips: `x`/`y` sind Versatz als ANTEIL der Bildbreite/-höhe
 * (0.1 = 10 % nach rechts/unten; formatunabhängig), `scale` Faktor, `rotation` in Grad.
 */
export function clipLayerTransform(t: { x?: number | undefined; y?: number | undefined; scale?: number | undefined; rotation?: number | undefined } | undefined, width: number, height: number): string | undefined {
  if (!t) return undefined;
  const parts: string[] = [];
  if (t.x || t.y) parts.push(`translate(${r((t.x ?? 0) * width)}px, ${r((t.y ?? 0) * height)}px)`);
  if (t.rotation) parts.push(`rotate(${t.rotation}deg)`);
  if (t.scale !== undefined && t.scale !== 1) parts.push(`scale(${t.scale})`);
  return parts.length ? parts.join(' ') : undefined;
}
