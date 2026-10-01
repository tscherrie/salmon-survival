import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { StudioApi } from '@studio/core';

/** Gemessene Größe eines Elements (ResizeObserver; ohne Observer: 0×0). */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type PeaksResult = { peaks: number[]; durationMs: number } | null;
const peaksCache = new WeakMap<StudioApi, Map<string, Promise<PeaksResult>>>();

/** Wellenform-Daten eines Assets (gecacht je API + Projekt + Asset). */
export function usePeaks(api: StudioApi, projectId: string | null, assetId: string | undefined): PeaksResult {
  const [peaks, setPeaks] = useState<PeaksResult>(null);
  useEffect(() => {
    if (!projectId || !assetId) return;
    let cache = peaksCache.get(api);
    if (!cache) {
      cache = new Map();
      peaksCache.set(api, cache);
    }
    const key = `${projectId}:${assetId}`;
    let promise = cache.get(key);
    if (!promise) {
      promise = api.assetPeaks(projectId, assetId).catch(() => null);
      cache.set(key, promise);
    }
    let alive = true;
    void promise.then((result) => {
      if (alive) setPeaks(result);
    });
    return () => {
      alive = false;
    };
  }, [api, projectId, assetId]);
  return peaks;
}

/** Ruft `fn` beim Klick außerhalb der Elemente auf. */
export function useClickOutside(refs: Array<RefObject<HTMLElement | null>>, fn: () => void, active: boolean): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (refs.some((r) => r.current && target && r.current.contains(target))) return;
      fnRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active]);
}

/** Erstellt einen SVG-Pfad (gefüllte Fläche) aus min/max-Paaren für einen Ausschnitt. */
export function waveformPath(peaks: readonly number[], durationMs: number, fromMs: number, toMs: number, width: number, height: number): string {
  const pairs = Math.floor(peaks.length / 2);
  if (pairs === 0 || durationMs <= 0 || width <= 0) return '';
  const startIdx = Math.max(0, Math.floor((fromMs / durationMs) * pairs));
  const endIdx = Math.min(pairs, Math.ceil((toMs / durationMs) * pairs));
  const span = endIdx - startIdx;
  if (span <= 0) return '';
  const points = Math.max(2, Math.min(Math.round(width / 2), span, 4000));
  const mid = height / 2;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < points; i++) {
    const a = startIdx + Math.floor((i / points) * span);
    const b = Math.max(a + 1, startIdx + Math.floor(((i + 1) / points) * span));
    let min = 0;
    let max = 0;
    for (let j = a; j < b && j < endIdx; j++) {
      min = Math.min(min, peaks[j * 2] ?? 0);
      max = Math.max(max, peaks[j * 2 + 1] ?? 0);
    }
    const x = ((i + 0.5) / points) * width;
    top.push(`${x.toFixed(1)},${(mid - max * mid).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(mid - min * mid).toFixed(1)}`);
  }
  return `M0,${mid} L${top.join(' L')} L${width},${mid} L${bottom.reverse().join(' L')} Z`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDurationMs(ms: number): string {
  const total = Math.round(ms / 100) / 10;
  if (total < 60) return `${total.toFixed(1)} s`;
  const m = Math.floor(total / 60);
  const s = Math.round(total - m * 60);
  return `${m}:${String(s).padStart(2, '0')} min`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
