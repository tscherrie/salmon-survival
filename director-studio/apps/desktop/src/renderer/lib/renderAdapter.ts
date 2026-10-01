import { useEffect, useState } from 'react';

/**
 * Adapter zu `@studio/render/browser`. Das Modul wird dynamisch geladen, damit ein (noch) defektes
 * Render-Paket nur den Monitor betrifft und nicht die ganze App. Deck/Leinwand nutzen `deckToHtml`
 * bzw. `canvasToSvg`, sobald vorhanden – sonst die eigenen React-Renderer (`docview/*`).
 */
export type RenderModule = typeof import('@studio/render/browser');

let loading: Promise<RenderModule | null> | null = null;
let loaded: RenderModule | null = null;

export function loadRenderModule(): Promise<RenderModule | null> {
  loading ??= import('@studio/render/browser')
    .then((mod) => {
      loaded = mod;
      return mod;
    })
    .catch((error: unknown) => {
      console.warn('[Director Studio] @studio/render/browser konnte nicht geladen werden:', error);
      return null;
    });
  return loading;
}

/** Liefert das Render-Modul (oder `null`, solange es lädt bzw. wenn es fehlt). */
export function useRenderModule(): RenderModule | null {
  const [mod, setMod] = useState<RenderModule | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    void loadRenderModule().then((m) => {
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return mod;
}
