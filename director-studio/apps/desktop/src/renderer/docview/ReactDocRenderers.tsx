import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Canvas, Deck, DeckElement, Layer, Slide } from '@studio/core';

/**
 * Eigene, einfache React-Renderer für Folien und Leinwände (Fallback, solange `deckToHtml`/`canvasToSvg`
 * aus @studio/render nicht verfügbar sind, und in Tests). Maßstab 1:1 in Dokument-Pixeln.
 */

type AssetUrl = (assetId: string, variant?: 'original' | 'proxy' | 'thumb') => string;

function themeColor(deck: Deck, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return String(value);
  const key = value.startsWith('$') ? value.slice(1) : value;
  return deck.theme.colors[key] ?? value;
}

function inlineText(text: string): ReactNode[] {
  // **fett** und *kursiv* (Markdown-light der Deck-Elemente)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function MiniChart({ el, deck }: { el: DeckElement; deck: Deck }) {
  const chart = el.chart;
  if (!chart) return null;
  const values = chart.series[0]?.values ?? [];
  const max = Math.max(1, ...values);
  const color = deck.theme.colors.accent ?? deck.theme.colors.primary ?? '#4a90a4';
  const w = el.width;
  const h = el.height;
  const barW = (w / Math.max(1, values.length)) * 0.6;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {values.map((v, i) => {
        const bh = (v / max) * (h - 60);
        const x = (w / values.length) * i + (w / values.length - barW) / 2;
        return (
          <g key={i}>
            <rect x={x} y={h - 40 - bh} width={barW} height={bh} fill={color} rx={4} />
            <text x={x + barW / 2} y={h - 12} textAnchor="middle" fontSize={Math.max(14, h / 22)} fill={deck.theme.colors.text ?? '#333'}>
              {chart.labels[i] ?? ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function elementStyle(deck: Deck, el: DeckElement): CSSProperties {
  const s = el.style ?? {};
  return {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    zIndex: el.z,
    color: themeColor(deck, s.color),
    fontSize: typeof s.fontSize === 'number' ? s.fontSize : s.fontSize ? String(s.fontSize) : 36,
    fontWeight: s.fontWeight as CSSProperties['fontWeight'],
    fontFamily: String(s.fontFamily ?? deck.theme.fonts.body ?? 'Inter'),
    textAlign: (s.align ?? s.textAlign) as CSSProperties['textAlign'],
    lineHeight: s.lineHeight !== undefined ? String(s.lineHeight) : 1.2,
    background: themeColor(deck, s.background ?? s.fill),
    whiteSpace: 'pre-wrap',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };
}

export function ReactDeckSlide({ deck, slide, assetUrl }: { deck: Deck; slide: Slide; assetUrl: AssetUrl }) {
  const bg = slide.background;
  const background =
    typeof bg === 'string' ? themeColor(deck, bg) : bg ? undefined : (themeColor(deck, deck.theme.background) ?? deck.theme.colors.background ?? '#ffffff');
  return (
    <div className="react-slide" style={{ position: 'relative', width: deck.width, height: deck.height, background, overflow: 'hidden' }}>
      {bg && typeof bg === 'object' && (
        <img src={assetUrl(bg.assetId)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {slide.elements.map((el) => {
        const style = elementStyle(deck, el);
        switch (el.type) {
          case 'text':
            return (
              <div key={el.id} style={{ ...style, fontFamily: el.style?.fontWeight && Number(el.style.fontWeight) >= 600 ? deck.theme.fonts.heading : style.fontFamily }}>
                {inlineText(el.text ?? '')}
              </div>
            );
          case 'image':
          case 'video':
            return el.assetId ? (
              <img key={el.id} src={assetUrl(el.assetId, el.type === 'video' ? 'thumb' : 'original')} alt={el.name ?? ''} style={{ ...style, objectFit: 'cover' }} />
            ) : null;
          case 'shape':
            return <div key={el.id} style={{ ...style, borderRadius: el.shape === 'ellipse' ? '50%' : undefined }} />;
          case 'chart':
            return (
              <div key={el.id} style={style}>
                <MiniChart el={el} deck={deck} />
              </div>
            );
          case 'html':
            return (
              <div key={el.id} style={{ ...style, border: '2px dashed rgba(0,0,0,.25)', display: 'grid', placeItems: 'center', fontSize: 24 }}>
                HTML
              </div>
            );
        }
      })}
    </div>
  );
}

function layerTransform(l: Layer): string | undefined {
  if (!l.rotation) return undefined;
  return `rotate(${l.rotation} ${l.x + l.width / 2} ${l.y + l.height / 2})`;
}

function ReactLayer({ layer, assetUrl }: { layer: Layer; assetUrl: AssetUrl }): ReactNode {
  if (layer.hidden) return null;
  const common = { opacity: layer.opacity, transform: layerTransform(layer), style: layer.blend ? ({ mixBlendMode: layer.blend } as CSSProperties) : undefined };
  const s = layer.style ?? {};
  switch (layer.type) {
    case 'group':
      return (
        <g {...common}>
          {(layer.children ?? []).map((child) => (
            <ReactLayer key={child.id} layer={child} assetUrl={assetUrl} />
          ))}
        </g>
      );
    case 'image':
      return layer.assetId ? (
        <image {...common} href={assetUrl(layer.assetId)} x={layer.x} y={layer.y} width={layer.width} height={layer.height} preserveAspectRatio="xMidYMid slice" />
      ) : null;
    case 'shape': {
      const fill = String(s.fill ?? s.background ?? '#999');
      if (layer.shape === 'ellipse') {
        return <ellipse {...common} cx={layer.x + layer.width / 2} cy={layer.y + layer.height / 2} rx={layer.width / 2} ry={layer.height / 2} fill={fill} />;
      }
      if (layer.shape === 'path' && layer.path) return <path {...common} d={layer.path} fill={fill} />;
      return <rect {...common} x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill={fill} />;
    }
    case 'text':
      return (
        <foreignObject {...common} x={layer.x} y={layer.y} width={layer.width} height={layer.height}>
          <div
            style={{
              color: String(s.color ?? '#111'),
              fontSize: typeof s.fontSize === 'number' ? s.fontSize : 32,
              fontWeight: s.fontWeight as CSSProperties['fontWeight'],
              fontFamily: String(s.fontFamily ?? 'Inter, sans-serif'),
              lineHeight: 1.05,
              whiteSpace: 'pre-wrap',
            }}
          >
            {layer.text}
          </div>
        </foreignObject>
      );
  }
}

export function ReactCanvas({ canvas, assetUrl }: { canvas: Canvas; assetUrl: AssetUrl }) {
  return (
    <svg className="react-canvas" width={canvas.width} height={canvas.height} viewBox={`0 0 ${canvas.width} ${canvas.height}`} style={{ display: 'block' }}>
      <rect width={canvas.width} height={canvas.height} fill={canvas.background} />
      {canvas.layers.map((layer) => (
        <ReactLayer key={layer.id} layer={layer} assetUrl={assetUrl} />
      ))}
    </svg>
  );
}
