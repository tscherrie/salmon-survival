import { memo, useMemo } from 'react';
import type { Canvas, Deck, Slide } from '@studio/core';
import { useRenderModule } from '../lib/renderAdapter.ts';
import { ReactCanvas, ReactDeckSlide } from './ReactDocRenderers.tsx';

/**
 * Adapter: Folie/Leinwand in Dokumentgröße, skaliert per CSS. Nutzt `deckToHtml`/`canvasToSvg` aus
 * @studio/render (isoliert in einem `sandbox=""`-iframe ohne Skripte), sonst die eigenen React-Renderer.
 * Interaktion (Klick/Ziehen) liegt immer in einer Ebene darüber – das iframe ist `pointer-events: none`.
 */

type AssetUrl = (assetId: string, variant?: 'original' | 'proxy' | 'thumb') => string;

function Scaled({ width, height, scale, children }: { width: number; height: number; scale: number; children: React.ReactNode }) {
  return (
    <div className="doc-scaled" style={{ width: width * scale, height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
    </div>
  );
}

export const SlideView = memo(function SlideView({
  deck,
  slide,
  assetUrl,
  scale,
  title,
}: {
  deck: Deck;
  slide: Slide;
  assetUrl: AssetUrl;
  scale: number;
  title: string;
}) {
  const mod = useRenderModule();
  const html = useMemo(() => {
    if (!mod || typeof mod.deckToHtml !== 'function') return null;
    try {
      return mod.deckToHtml(deck, { assetUrl: (id: string) => assetUrl(id), mode: 'stage', slideIds: [slide.id] });
    } catch {
      return null;
    }
  }, [mod, deck, slide.id, assetUrl]);
  return (
    <Scaled width={deck.width} height={deck.height} scale={scale}>
      {html ? (
        <iframe className="doc-frame" title={title} sandbox="" srcDoc={html} width={deck.width} height={deck.height} tabIndex={-1} />
      ) : (
        <ReactDeckSlide deck={deck} slide={slide} assetUrl={assetUrl} />
      )}
    </Scaled>
  );
});

export const CanvasView = memo(function CanvasView({ canvas, assetUrl, scale, title }: { canvas: Canvas; assetUrl: AssetUrl; scale: number; title: string }) {
  const mod = useRenderModule();
  const html = useMemo(() => {
    if (!mod || typeof mod.canvasToSvg !== 'function') return null;
    try {
      const svg = mod.canvasToSvg(canvas, { assetUrl: (id: string) => assetUrl(id), size: { width: canvas.width, height: canvas.height } });
      return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;
    } catch {
      return null;
    }
  }, [mod, canvas, assetUrl]);
  return (
    <Scaled width={canvas.width} height={canvas.height} scale={scale}>
      {html ? (
        <iframe className="doc-frame" title={title} sandbox="" srcDoc={html} width={canvas.width} height={canvas.height} tabIndex={-1} />
      ) : (
        <ReactCanvas canvas={canvas} assetUrl={assetUrl} />
      )}
    </Scaled>
  );
});
