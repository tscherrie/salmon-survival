import type { CSSProperties, ReactNode } from 'react';
import { interpolate, spring } from 'remotion';
import type { Clip } from '@studio/core';
import { getSafeArea } from './meta.ts';
import type { TimedWord } from './types.ts';

/**
 * Eingebaute Text-Stile der Textspur. Saubere typografische Standards, deutsche Silbentrennung
 * (`lang="de"` + `hyphens: auto`), Safe-Area-bewusst. Anpassbar über `clip.props`:
 * `color`, `fontFamily`, `fontWeight`, `fontSize` (≤ 1 = Anteil der kurzen Bildkante, sonst px),
 * `position` (`top`|`center`|`bottom`), `align` (`left`|`center`|`right`), `background`
 * (`none` = ohne Kasten), `highlightColor`, `uppercase`, `letterSpacing`, `lineHeight`.
 */

export const TEXT_STYLE_IDS = ['subtitle', 'hero', 'title', 'caption', 'karaoke', 'word-by-word'] as const;
export type TextStyleId = (typeof TEXT_STYLE_IDS)[number];

export const DEFAULT_FONT_STACK = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const DEFAULT_HIGHLIGHT = '#FFD43B';

export interface TextClipViewProps {
  clip: Clip;
  /** Frame relativ zum Clip-Start. */
  frame: number;
  fps: number;
  width: number;
  height: number;
  /** Alle Wortzeitstempel (absolut); gefiltert wird hier. */
  words: TimedWord[];
}

interface TextOptions {
  color: string;
  fontFamily: string;
  fontWeight?: number | string | undefined;
  fontSize?: number | string | undefined;
  position?: 'top' | 'center' | 'bottom' | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
  background?: string | undefined;
  highlightColor: string;
  uppercase: boolean;
  letterSpacing?: string | undefined;
  lineHeight?: number | undefined;
}

function readOptions(clip: Clip): TextOptions {
  const p = clip.props ?? {};
  const str = (key: string) => (typeof p[key] === 'string' ? (p[key] as string) : undefined);
  const num = (key: string) => (typeof p[key] === 'number' ? (p[key] as number) : undefined);
  const position = str('position');
  const align = str('align');
  return {
    color: str('color') ?? '#ffffff',
    fontFamily: str('fontFamily') ?? DEFAULT_FONT_STACK,
    fontWeight: num('fontWeight') ?? str('fontWeight'),
    fontSize: num('fontSize') ?? str('fontSize'),
    position: position === 'top' || position === 'center' || position === 'bottom' ? position : undefined,
    align: align === 'left' || align === 'center' || align === 'right' ? align : undefined,
    background: str('background'),
    highlightColor: str('highlightColor') ?? DEFAULT_HIGHLIGHT,
    uppercase: p.uppercase === true,
    letterSpacing: str('letterSpacing'),
    lineHeight: num('lineHeight'),
  };
}

function resolveFontSize(value: number | string | undefined, fallback: number, minSide: number): number | string {
  if (value === undefined) return Math.round(fallback);
  if (typeof value === 'number') return value <= 1 ? Math.round(value * minSide) : value;
  return value;
}

/** Wörter, die das Zeitfenster des Clips schneiden (Sekunden absolut auf der Timeline). */
export function wordsInClip(words: readonly TimedWord[], clip: Pick<Clip, 'start' | 'duration'>, fps: number): TimedWord[] {
  const from = clip.start / fps;
  const to = (clip.start + clip.duration) / fps;
  return words.filter((w) => w.start < to && w.end > from);
}

/** Ohne Zeitstempel: Wörter des Textes gleichmäßig (nach Länge gewichtet) über den Clip verteilen. */
export function synthesizeWords(text: string, clip: Pick<Clip, 'start' | 'duration'>, fps: number): TimedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t) => t.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const start = clip.start / fps;
  const duration = clip.duration / fps;
  let t = start;
  return tokens.map((token, i) => {
    const d = (weights[i]! / total) * duration;
    const word = { text: token, start: t, end: t + d };
    t += d;
    return word;
  });
}

function fade(frame: number, duration: number, fadeIn: number, fadeOut: number): number {
  let v = 1;
  if (fadeIn > 0) v *= Math.min(1, Math.max(0, frame / fadeIn));
  if (fadeOut > 0) v *= Math.min(1, Math.max(0, (duration - frame) / fadeOut));
  return v;
}

function longestWord(text: string): number {
  return text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
}

function container(opts: TextOptions, padding: string, justify: CSSProperties['justifyContent'], alignItems: CSSProperties['alignItems']): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify,
    alignItems,
    padding,
    boxSizing: 'border-box',
    color: opts.color,
    fontFamily: opts.fontFamily,
    hyphens: 'auto',
    WebkitHyphens: 'auto',
    overflowWrap: 'break-word',
    textRendering: 'optimizeLegibility',
    fontKerning: 'normal',
    fontVariantLigatures: 'common-ligatures',
    whiteSpace: 'pre-line',
  };
}

const justifyFor = (pos: TextOptions['position'], fallback: 'top' | 'center' | 'bottom'): CSSProperties['justifyContent'] =>
  ({ top: 'flex-start', center: 'center', bottom: 'flex-end' })[pos ?? fallback] as CSSProperties['justifyContent'];
const alignFor = (align: TextOptions['align'], fallback: 'left' | 'center' | 'right'): CSSProperties['alignItems'] =>
  ({ left: 'flex-start', center: 'center', right: 'flex-end' })[align ?? fallback] as CSSProperties['alignItems'];

/** Rendert einen Text-Clip im gewünschten Stil (unbekannte Stile → `subtitle`). */
export function TextClipView({ clip, frame, fps, width, height, words }: TextClipViewProps): ReactNode {
  const style = (clip.style ?? 'subtitle') as TextStyleId;
  const opts = readOptions(clip);
  const text = opts.uppercase ? (clip.text ?? '').toLocaleUpperCase('de-DE') : (clip.text ?? '');
  const minSide = Math.min(width, height);
  const sa = getSafeArea(width, height);
  const padding = `${sa.top}px ${sa.right}px ${sa.bottom}px ${sa.left}px`;
  const safeWidth = width - sa.left - sa.right;
  const d = clip.duration;
  const common = { lang: 'de', 'data-text-style': style, 'data-clip-id': clip.id } as const;

  switch (style) {
    case 'hero': {
      const fitted = Math.min(minSide * 0.18, safeWidth / (longestWord(text) * 0.62));
      const size = resolveFontSize(opts.fontSize, fitted, minSide);
      const enter = spring({ frame, fps, config: { damping: 14, stiffness: 170, mass: 0.6 } });
      const scale = interpolate(enter, [0, 1], [0.8, 1]) * interpolate(frame, [Math.max(0, d - 6), Math.max(1, d)], [1, 1.04], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const opacity = fade(frame, d, 5, 6);
      const blur = interpolate(frame, [0, 7], [10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      return (
        <div {...common} style={container(opts, padding, justifyFor(opts.position, 'center'), alignFor(opts.align, 'center'))}>
          <div
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 900,
              lineHeight: opts.lineHeight ?? 0.95,
              letterSpacing: opts.letterSpacing ?? '-0.025em',
              textAlign: opts.align ?? 'center',
              textWrap: 'balance',
              maxWidth: '100%',
              opacity,
              transform: `scale(${scale.toFixed(4)})`,
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
              textShadow: '0 0.04em 0.18em rgba(0,0,0,0.35)',
            }}
          >
            {text}
          </div>
        </div>
      );
    }
    case 'title': {
      const fitted = Math.min(minSide * 0.085, safeWidth / (longestWord(text) * 0.58));
      const size = resolveFontSize(opts.fontSize, fitted, minSide);
      const p = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const eased = 1 - (1 - p) ** 3;
      return (
        <div {...common} style={container(opts, padding, justifyFor(opts.position, 'center'), alignFor(opts.align, 'center'))}>
          <div
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 750,
              lineHeight: opts.lineHeight ?? 1.08,
              letterSpacing: opts.letterSpacing ?? '-0.015em',
              textAlign: opts.align ?? 'center',
              textWrap: 'balance',
              maxWidth: '92%',
              opacity: fade(frame, d, 8, 8),
              transform: `translateY(${((1 - eased) * 0.35).toFixed(4)}em)`,
              textShadow: '0 0.03em 0.15em rgba(0,0,0,0.3)',
            }}
          >
            {text}
          </div>
        </div>
      );
    }
    case 'caption': {
      const size = resolveFontSize(opts.fontSize, minSide * 0.034, minSide);
      return (
        <div {...common} style={container(opts, padding, justifyFor(opts.position, 'bottom'), alignFor(opts.align, 'left'))}>
          <div
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 500,
              lineHeight: opts.lineHeight ?? 1.3,
              letterSpacing: opts.letterSpacing ?? '0.005em',
              textAlign: opts.align ?? 'left',
              maxWidth: '62%',
              opacity: fade(frame, d, 6, 6),
              background: opts.background === 'none' ? undefined : (opts.background ?? 'rgba(0,0,0,0.5)'),
              borderLeft: `0.18em solid ${opts.highlightColor}`,
              padding: '0.35em 0.7em',
            }}
          >
            {text}
          </div>
        </div>
      );
    }
    case 'karaoke': {
      const own = wordsInClip(words, clip, fps);
      const list = own.length ? own : synthesizeWords(clip.text ?? '', clip, fps);
      const t = (clip.start + frame) / fps;
      const size = resolveFontSize(opts.fontSize, minSide * 0.062, minSide);
      return (
        <div {...common} style={container(opts, padding, justifyFor(opts.position, 'bottom'), alignFor(opts.align, 'center'))}>
          <div
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 800,
              lineHeight: opts.lineHeight ?? 1.22,
              letterSpacing: opts.letterSpacing ?? '-0.01em',
              textAlign: opts.align ?? 'center',
              textWrap: 'balance',
              maxWidth: '90%',
              opacity: fade(frame, d, 4, 4),
              textShadow: '0 0.04em 0.16em rgba(0,0,0,0.55)',
              whiteSpace: 'normal',
            }}
          >
            {list.map((w, i) => {
              const state = t >= w.end ? 'past' : t >= w.start ? 'current' : 'future';
              const local = w.end > w.start ? Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start))) : 1;
              const label = opts.uppercase ? w.text.toLocaleUpperCase('de-DE') : w.text;
              return (
                <span key={`${i}-${w.start}`}>
                  <span
                    data-word-state={state}
                    style={{
                      display: 'inline-block',
                      color: state === 'future' ? opts.color : opts.highlightColor,
                      opacity: state === 'future' ? 0.55 : 1,
                      transform: state === 'current' ? `scale(${(1 + 0.08 * (1 - local)).toFixed(4)})` : undefined,
                    }}
                  >
                    {label}
                  </span>
                  {i < list.length - 1 ? ' ' : ''}
                </span>
              );
            })}
          </div>
        </div>
      );
    }
    case 'word-by-word': {
      const own = wordsInClip(words, clip, fps);
      const list = own.length ? own : synthesizeWords(clip.text ?? '', clip, fps);
      const t = (clip.start + frame) / fps;
      let current: TimedWord | undefined;
      for (const w of list) if (w.start <= t) current = w;
      if (!current) return null;
      const label = opts.uppercase ? current.text.toLocaleUpperCase('de-DE') : current.text;
      const fitted = Math.min(minSide * 0.14, safeWidth / (Math.max(3, label.length) * 0.6));
      const size = resolveFontSize(opts.fontSize, fitted, minSide);
      const localFrame = frame - Math.round(current.start * fps - clip.start);
      const pop = spring({ frame: Math.max(0, localFrame), fps, config: { damping: 12, stiffness: 220, mass: 0.5 } });
      return (
        <div {...common} style={container(opts, padding, justifyFor(opts.position, 'center'), alignFor(opts.align, 'center'))}>
          <div
            data-current-word={current.text}
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 850,
              lineHeight: opts.lineHeight ?? 1,
              letterSpacing: opts.letterSpacing ?? '-0.02em',
              textAlign: 'center',
              opacity: fade(frame, d, 0, 3) * Math.min(1, pop * 1.4),
              transform: `scale(${interpolate(pop, [0, 1], [0.6, 1]).toFixed(4)})`,
              textShadow: '0 0.04em 0.18em rgba(0,0,0,0.45)',
            }}
          >
            {label}
          </div>
        </div>
      );
    }
    case 'subtitle':
    default: {
      const size = resolveFontSize(opts.fontSize, minSide * 0.048, minSide);
      const boxed = opts.background !== 'none';
      return (
        <div {...common} data-text-style="subtitle" style={container(opts, padding, justifyFor(opts.position, 'bottom'), alignFor(opts.align, 'center'))}>
          <div
            style={{
              fontSize: size,
              fontWeight: opts.fontWeight ?? 600,
              lineHeight: opts.lineHeight ?? 1.3,
              letterSpacing: opts.letterSpacing ?? '0.005em',
              textAlign: opts.align ?? 'center',
              maxWidth: '88%',
              opacity: fade(frame, d, 3, 3),
              textShadow: boxed ? undefined : '0 0.05em 0.2em rgba(0,0,0,0.85), 0 0 0.08em rgba(0,0,0,0.9)',
            }}
          >
            <span
              style={
                boxed
                  ? {
                      background: opts.background ?? 'rgba(0,0,0,0.62)',
                      padding: '0.1em 0.42em',
                      borderRadius: '0.16em',
                      boxDecorationBreak: 'clone',
                      WebkitBoxDecorationBreak: 'clone',
                    }
                  : undefined
              }
            >
              {text}
            </span>
          </div>
        </div>
      );
    }
  }
}
