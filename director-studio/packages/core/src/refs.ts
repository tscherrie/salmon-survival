import { z } from 'zod';
import { formatTimecode, parseTimecodeToFrames } from './time.ts';

/**
 * Referenzen sind das einzige Werkzeug, mit dem der Nutzer auf etwas zeigt.
 * Sie entstehen durch Klicks auf die Bühne oder durch Ziehen von Assets in den Composer.
 */

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof rectSchema>;

export const sourceLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

/** Höchstlänge des sichtbaren Element-Texts in einer Referenz (Kontext für den Director, kein Volltext). */
export const REF_TEXT_MAX = 120;

/** Kürzt sichtbaren Element-Text auf eine Zeile mit höchstens {@link REF_TEXT_MAX} Zeichen. */
export function clampRefText(value: string): string {
  return shorten(value.replace(/\s+/g, ' ').trim(), REF_TEXT_MAX);
}

export const refSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('time'), frame: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('range'),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    trackId: z.string().optional(),
  }),
  z.object({ kind: z.literal('clip'), clipId: z.string().min(1), trackId: z.string().optional() }),
  z.object({ kind: z.literal('marker'), markerId: z.string().min(1) }),
  z.object({ kind: z.literal('asset'), assetId: z.string().min(1) }),
  z.object({ kind: z.literal('slide'), slideId: z.string().min(1) }),
  z.object({
    kind: z.literal('element'),
    doc: z.enum(['deck', 'canvas', 'site']),
    elementId: z.string().optional(),
    slideId: z.string().optional(),
    page: z.string().optional(),
    selector: z.string().optional(),
    source: sourceLocationSchema.optional(),
    bbox: rectSchema.optional(),
    /** Sichtbarer Text des Elements (eine Zeile, ≤ 120 Zeichen; längere Texte werden gekürzt). */
    text: z.string().transform(clampRefText).optional(),
    /** HTML-Tag bzw. Elementtyp in Kleinbuchstaben, z. B. `h1`, `button`, `img`. */
    tag: z
      .string()
      .transform((t) => t.trim().toLowerCase())
      .optional(),
  }),
  z.object({
    kind: z.literal('region'),
    doc: z.enum(['timeline', 'deck', 'canvas', 'site']),
    rect: rectSchema,
    slideId: z.string().optional(),
    frame: z.number().int().nonnegative().optional(),
    page: z.string().optional(),
  }),
  z.object({ kind: z.literal('version'), versionNumber: z.number().int().positive() }),
]);

export type Ref = z.infer<typeof refSchema>;
export type RefKind = Ref['kind'];

export interface RefLabelContext {
  fps?: number;
  /** Anzeigenamen für IDs (Clips, Assets, Folien, Marker …). */
  names?: Record<string, string>;
  /** Folien-Indizes (1-basiert) für Beschriftungen wie „Folie 3“. */
  slideNumbers?: Record<string, number>;
}

/** Normalisiert eine Referenz (z. B. vertauschte Bereichsgrenzen) und validiert sie. */
export function normalizeRef(input: Ref): Ref {
  const ref = refSchema.parse(input);
  if (ref.kind === 'range' && ref.from > ref.to) {
    return { ...ref, from: ref.to, to: ref.from };
  }
  return ref;
}

export function refEquals(a: Ref, b: Ref): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Kurze Beschriftung für Chips im Composer. */
export function refLabel(ref: Ref, ctx: RefLabelContext = {}): string {
  const name = (id: string | undefined) => (id ? (ctx.names?.[id] ?? id) : '');
  const fps = ctx.fps ?? 30;
  switch (ref.kind) {
    case 'time':
      return `⏱ ${formatTimecode(ref.frame, fps)}`;
    case 'range': {
      const track = ref.trackId ? ` · ${name(ref.trackId)}` : '';
      return `⏱ ${formatTimecode(ref.from, fps)}–${formatTimecode(ref.to, fps)}${track}`;
    }
    case 'clip':
      return `🎬 ${name(ref.clipId)}`;
    case 'marker':
      return `🚩 ${name(ref.markerId)}`;
    case 'asset':
      return `📎 ${name(ref.assetId)}`;
    case 'slide': {
      const n = ctx.slideNumbers?.[ref.slideId];
      return n ? `🗂 Folie ${n}` : `🗂 ${name(ref.slideId)}`;
    }
    case 'element': {
      const where = ref.slideId
        ? ctx.slideNumbers?.[ref.slideId]
          ? `Folie ${ctx.slideNumbers[ref.slideId]} · `
          : `${name(ref.slideId)} · `
        : ref.page
          ? `${ref.page} · `
          : '';
      const what = ref.elementId
        ? name(ref.elementId)
        : ref.text
          ? `${ref.tag ? `${ref.tag} ` : ''}„${shorten(ref.text, 40)}“`
          : (ref.selector ?? ref.tag ?? 'Element');
      return `◳ ${where}${what}`;
    }
    case 'region': {
      const r = ref.rect;
      const where =
        ref.doc === 'timeline' && ref.frame !== undefined
          ? `${formatTimecode(ref.frame, fps)} · `
          : ref.slideId
            ? ctx.slideNumbers?.[ref.slideId]
              ? `Folie ${ctx.slideNumbers[ref.slideId]} · `
              : `${name(ref.slideId)} · `
            : ref.page
              ? `${ref.page} · `
              : '';
      return `⬚ ${where}${Math.round(r.width)}×${Math.round(r.height)} @ ${Math.round(r.x)},${Math.round(r.y)}`;
    }
    case 'version':
      return `🕘 v${ref.versionNumber}`;
  }
}

/** Serialisiert eine Referenz als selbstschließendes `<ref …/>`-Tag für den Director. */
export function serializeRef(ref: Ref, id: string, fps = 30): string {
  const attrs: Array<[string, string]> = [
    ['id', id],
    ['type', ref.kind],
  ];
  switch (ref.kind) {
    case 'time':
      attrs.push(['t', formatTimecode(ref.frame, fps)], ['frame', String(ref.frame)]);
      break;
    case 'range':
      attrs.push(
        ['from', formatTimecode(ref.from, fps)],
        ['to', formatTimecode(ref.to, fps)],
        ['fromFrame', String(ref.from)],
        ['toFrame', String(ref.to)],
      );
      if (ref.trackId) attrs.push(['track', ref.trackId]);
      break;
    case 'clip':
      attrs.push(['clip', ref.clipId]);
      if (ref.trackId) attrs.push(['track', ref.trackId]);
      break;
    case 'marker':
      attrs.push(['marker', ref.markerId]);
      break;
    case 'asset':
      attrs.push(['asset', ref.assetId]);
      break;
    case 'slide':
      attrs.push(['slide', ref.slideId]);
      break;
    case 'element':
      attrs.push(['doc', ref.doc]);
      if (ref.slideId) attrs.push(['slide', ref.slideId]);
      if (ref.page) attrs.push(['page', ref.page]);
      if (ref.elementId) attrs.push(['element', ref.elementId]);
      if (ref.selector) attrs.push(['selector', ref.selector]);
      if (ref.source) {
        attrs.push(['source', `${ref.source.file}:${ref.source.line}${ref.source.column ? `:${ref.source.column}` : ''}`]);
      }
      if (ref.bbox) attrs.push(['bbox', rectToString(ref.bbox)]);
      if (ref.tag) attrs.push(['tag', ref.tag]);
      if (ref.text) attrs.push(['text', clampRefText(ref.text)]);
      break;
    case 'region':
      attrs.push(['doc', ref.doc], ['rect', rectToString(ref.rect)]);
      if (ref.slideId) attrs.push(['slide', ref.slideId]);
      if (ref.page) attrs.push(['page', ref.page]);
      if (ref.frame !== undefined) {
        attrs.push(['t', formatTimecode(ref.frame, fps)], ['frame', String(ref.frame)]);
      }
      break;
    case 'version':
      attrs.push(['version', String(ref.versionNumber)]);
      break;
  }
  return `<ref ${attrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`;
}

/** Liest ein `<ref …/>`-Tag zurück. Frame-Attribute haben Vorrang vor Timecodes. */
export function parseRefTag(tag: string, fps = 30): { id: string; ref: Ref } {
  const match = /^<ref\s+([^>]*?)\s*\/>$/.exec(tag.trim());
  if (!match) throw new Error(`Kein gültiges ref-Tag: ${tag}`);
  const attrs = parseAttributes(match[1] ?? '');
  const id = attrs.id;
  const type = attrs.type;
  if (!id || !type) throw new Error(`ref-Tag ohne id/type: ${tag}`);
  const frameOf = (frameKey: string, tcKey: string): number => {
    const frame = attrs[frameKey];
    if (frame !== undefined) return Number(frame);
    const tc = attrs[tcKey];
    if (tc === undefined) throw new Error(`ref-Tag ohne ${tcKey}: ${tag}`);
    return parseTimecodeToFrames(tc, fps);
  };
  let ref: Ref;
  switch (type) {
    case 'time':
      ref = { kind: 'time', frame: frameOf('frame', 't') };
      break;
    case 'range':
      ref = {
        kind: 'range',
        from: frameOf('fromFrame', 'from'),
        to: frameOf('toFrame', 'to'),
        ...(attrs.track ? { trackId: attrs.track } : {}),
      };
      break;
    case 'clip':
      ref = { kind: 'clip', clipId: req(attrs.clip, tag), ...(attrs.track ? { trackId: attrs.track } : {}) };
      break;
    case 'marker':
      ref = { kind: 'marker', markerId: req(attrs.marker, tag) };
      break;
    case 'asset':
      ref = { kind: 'asset', assetId: req(attrs.asset, tag) };
      break;
    case 'slide':
      ref = { kind: 'slide', slideId: req(attrs.slide, tag) };
      break;
    case 'element':
      ref = {
        kind: 'element',
        doc: req(attrs.doc, tag) as 'deck' | 'canvas' | 'site',
        ...(attrs.slide ? { slideId: attrs.slide } : {}),
        ...(attrs.page ? { page: attrs.page } : {}),
        ...(attrs.element ? { elementId: attrs.element } : {}),
        ...(attrs.selector ? { selector: attrs.selector } : {}),
        ...(attrs.source ? { source: parseSource(attrs.source) } : {}),
        ...(attrs.bbox ? { bbox: parseRect(attrs.bbox) } : {}),
        ...(attrs.tag ? { tag: attrs.tag } : {}),
        ...(attrs.text ? { text: attrs.text } : {}),
      };
      break;
    case 'region':
      ref = {
        kind: 'region',
        doc: req(attrs.doc, tag) as 'timeline' | 'deck' | 'canvas' | 'site',
        rect: parseRect(req(attrs.rect, tag)),
        ...(attrs.slide ? { slideId: attrs.slide } : {}),
        ...(attrs.page ? { page: attrs.page } : {}),
        ...(attrs.frame !== undefined || attrs.t !== undefined ? { frame: frameOf('frame', 't') } : {}),
      };
      break;
    case 'version':
      ref = { kind: 'version', versionNumber: Number(req(attrs.version, tag)) };
      break;
    default:
      throw new Error(`Unbekannter ref-Typ "${type}"`);
  }
  return { id, ref: refSchema.parse(ref) };
}

export function rectToString(rect: Rect): string {
  return [rect.x, rect.y, rect.width, rect.height].map((n) => String(round2(n))).join(',');
}

export function parseRect(value: string): Rect {
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Ungültiges Rechteck: ${value}`);
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

function parseSource(value: string): SourceLocation {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(value);
  if (!match) throw new Error(`Ungültige Quellangabe: ${value}`);
  return {
    file: match[1] ?? '',
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
  };
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    attrs[m[1] as string] = unescapeAttr(m[2] ?? '');
  }
  return attrs;
}

function req(value: string | undefined, tag: string): string {
  if (value === undefined || value === '') throw new Error(`Pflichtattribut fehlt in ${tag}`);
  return value;
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Kürzt auf höchstens `max` Zeichen (Codepoints) inkl. Auslassungszeichen. */
function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
