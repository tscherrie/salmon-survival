import { z } from 'zod';
import {
  DocumentOpError,
  assertAssetKind,
  assertUniqueId,
  deepClone,
  mergeNested,
  mergePatch,
  parseOrThrow,
  patchSchemaOf,
  setOrDelete,
  type OpContext,
} from './common.ts';

/** Präsentation: Theme + Folien mit frei positionierten Elementen (Pixel im Folienraster). */

export const DECK_ELEMENT_TYPES = ['text', 'image', 'shape', 'video', 'html', 'chart'] as const;

/**
 * Typografische Rollen für `style.role` (Größe/Schrift/Farbe kommen dann aus dem Theme):
 * `title`, `subtitle`, `body`, `caption`, `kicker` (Dachzeile), `quote`, `stat` (große Kennzahl).
 */
export const DECK_TEXT_ROLES = ['title', 'subtitle', 'body', 'caption', 'kicker', 'quote', 'stat'] as const;
export type DeckTextRole = (typeof DECK_TEXT_ROLES)[number];

export const deckElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(DECK_ELEMENT_TYPES),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().optional(),
  z: z.number().int().optional(),
  name: z.string().optional(),
  /** Text (Markdown-light: **fett**, *kursiv*, Zeilenumbrüche) für `text`. */
  text: z.string().optional(),
  /** Freies HTML für `html` (wird isoliert gerendert). */
  html: z.string().optional(),
  assetId: z.string().optional(),
  shape: z.enum(['rect', 'ellipse', 'line']).optional(),
  /** Diagrammdaten für `chart`. */
  chart: z
    .object({
      type: z.enum(['bar', 'line', 'pie']),
      labels: z.array(z.string()),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
    })
    .optional(),
  /**
   * CSS-ähnliche Stilangaben (color, fontSize, fontWeight, fontFamily, background, align, …).
   * `role` ist eine der {@link DECK_TEXT_ROLES} (title|subtitle|body|caption|kicker|quote|stat).
   * `hyphens`: `auto` (Standard; deutsche Texte bekommen Trennstellen) | `manual` | `none`.
   */
  style: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe('CSS-ähnliche Stilangaben; role: title|subtitle|body|caption|kicker|quote|stat; hyphens: auto|manual|none'),
  /** Einblendung in der Präsentation (Reihenfolge). */
  build: z.number().int().nonnegative().optional(),
});
export type DeckElement = z.infer<typeof deckElementSchema>;

export const slideSchema = z.object({
  id: z.string().min(1),
  layout: z.string().optional(),
  title: z.string().optional(),
  background: z.union([z.string(), z.object({ assetId: z.string() })]).optional(),
  elements: z.array(deckElementSchema).default([]),
  notes: z.string().optional(),
  transition: z.enum(['none', 'fade', 'slide', 'zoom']).optional(),
  hidden: z.boolean().optional(),
});
export type Slide = z.infer<typeof slideSchema>;

export const deckFontsSchema = z.object({ heading: z.string(), body: z.string(), mono: z.string().optional() });

export const deckThemeSchema = z.object({
  name: z.string().optional(),
  colors: z.record(z.string(), z.string()).default({}),
  fonts: deckFontsSchema.default({ heading: 'Inter', body: 'Inter' }),
  /** Eingebettete Schriften: Schriftfamilie (wie in `fonts`/`style.fontFamily`) → Font-Asset-ID. */
  fontAssets: z.record(z.string(), z.string()).optional().describe('Schriftfamilie → Font-Asset-ID'),
  background: z.string().optional(),
  /** Zusätzliche globale CSS-Regeln (isoliert). */
  css: z.string().optional(),
});
export type DeckTheme = z.infer<typeof deckThemeSchema>;

export const deckSchema = z.object({
  kind: z.literal('deck'),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  theme: deckThemeSchema.default({ colors: {}, fonts: { heading: 'Inter', body: 'Inter' } }),
  slides: z.array(slideSchema).default([]),
});
export type Deck = z.infer<typeof deckSchema>;
export type DeckInput = z.input<typeof deckSchema>;

export function createDeck(options: { width?: number; height?: number } = {}): Deck {
  return deckSchema.parse({ kind: 'deck', width: options.width ?? 1920, height: options.height ?? 1080 });
}

/**
 * Patch-Schemas ohne Defaults (zod 4 würde sie bei `.partial()` injizieren und echte Werte überschreiben).
 * Semantik: fehlendes Feld = unverändert, `null` = optionales Feld entfernen bzw. auf Standard zurücksetzen.
 * `style`, `colors`, `fonts` und `fontAssets` werden schlüsselweise gemergt (`null` je Schlüssel löscht ihn).
 */
const styleValuePatchSchema = z.union([z.string(), z.number(), z.null()]);
const elementPatchSchema = patchSchemaOf(deckElementSchema.omit({ id: true })).extend({
  style: z.record(z.string(), styleValuePatchSchema).nullable().optional(),
});
const slidePatchSchema = patchSchemaOf(slideSchema.omit({ id: true, elements: true }));
const themePatchSchema = patchSchemaOf(deckThemeSchema).extend({
  colors: z.record(z.string(), z.string().nullable()).nullable().optional(),
  fonts: patchSchemaOf(deckFontsSchema).nullable().optional(),
  fontAssets: z.record(z.string(), z.string().nullable()).nullable().optional(),
});

export const deckOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_slide'), slide: slideSchema, index: z.number().int().nonnegative().optional() }),
  z.object({ op: z.literal('remove_slide'), slideId: z.string() }),
  z.object({ op: z.literal('move_slide'), slideId: z.string(), index: z.number().int().nonnegative() }),
  z.object({ op: z.literal('update_slide'), slideId: z.string(), patch: slidePatchSchema }),
  z.object({ op: z.literal('add_element'), slideId: z.string(), element: deckElementSchema }),
  z.object({ op: z.literal('update_element'), slideId: z.string(), elementId: z.string(), patch: elementPatchSchema }),
  z.object({ op: z.literal('remove_element'), slideId: z.string(), elementId: z.string() }),
  z.object({ op: z.literal('update_theme'), patch: themePatchSchema }),
  z.object({
    op: z.literal('update_deck'),
    patch: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).partial(),
  }),
]);
export type DeckOp = z.infer<typeof deckOpSchema>;
export type DeckOpInput = z.input<typeof deckOpSchema>;

export function applyDeckOps(doc: Deck, ops: readonly DeckOpInput[], ctx: OpContext = {}): Deck {
  let next = deepClone(doc);
  ops.forEach((raw, index) => {
    const parsed = deckOpSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DocumentOpError(index, String((raw as { op?: unknown }).op ?? '?'), parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    try {
      next = applyOne(next, parsed.data, ctx);
    } catch (error) {
      throw new DocumentOpError(index, parsed.data.op, (error as Error).message);
    }
  });
  validateDeck(next);
  return next;
}

function applyOne(doc: Deck, op: DeckOp, ctx: OpContext): Deck {
  switch (op.op) {
    case 'add_slide': {
      assertUniqueId(doc.slides.map((s) => s.id), op.slide.id, 'Folie');
      checkSlideBackground(op.slide, ctx);
      for (const el of op.slide.elements) checkElement(el, ctx);
      doc.slides.splice(Math.min(op.index ?? doc.slides.length, doc.slides.length), 0, op.slide);
      return doc;
    }
    case 'remove_slide': {
      const idx = slideIndex(doc, op.slideId);
      doc.slides.splice(idx, 1);
      return doc;
    }
    case 'move_slide': {
      const idx = slideIndex(doc, op.slideId);
      const [slide] = doc.slides.splice(idx, 1);
      doc.slides.splice(Math.min(op.index, doc.slides.length), 0, slide!);
      return doc;
    }
    case 'update_slide': {
      const idx = slideIndex(doc, op.slideId);
      const slide = doc.slides[idx]!;
      const updated = parseOrThrow(slideSchema, mergePatch(slide as Record<string, unknown>, op.patch), `Folie "${slide.id}"`);
      if (op.patch.background) checkSlideBackground(updated, ctx);
      doc.slides[idx] = updated;
      return doc;
    }
    case 'add_element': {
      const slide = doc.slides[slideIndex(doc, op.slideId)]!;
      assertUniqueId(allElementIds(doc), op.element.id, 'Element');
      checkElement(op.element, ctx);
      slide.elements.push(op.element);
      return doc;
    }
    case 'update_element': {
      const slide = doc.slides[slideIndex(doc, op.slideId)]!;
      const idx = slide.elements.findIndex((e) => e.id === op.elementId);
      if (idx < 0) throw new Error(`Element "${op.elementId}" existiert nicht auf Folie "${op.slideId}"`);
      const current = slide.elements[idx]!;
      const { style, ...rest } = op.patch;
      const next: Record<string, unknown> = mergePatch(current as Record<string, unknown>, rest);
      setOrDelete(next, 'style', mergeNested(current.style, style));
      const merged = parseOrThrow(deckElementSchema, next, `Element "${current.id}"`);
      checkElement(merged, ctx);
      slide.elements[idx] = merged;
      return doc;
    }
    case 'remove_element': {
      const slide = doc.slides[slideIndex(doc, op.slideId)]!;
      const idx = slide.elements.findIndex((e) => e.id === op.elementId);
      if (idx < 0) throw new Error(`Element "${op.elementId}" existiert nicht auf Folie "${op.slideId}"`);
      slide.elements.splice(idx, 1);
      return doc;
    }
    case 'update_theme': {
      const { colors, fonts, fontAssets, ...rest } = op.patch;
      const next: Record<string, unknown> = mergePatch(doc.theme as Record<string, unknown>, rest);
      setOrDelete(next, 'colors', mergeNested(doc.theme.colors, colors));
      setOrDelete(next, 'fonts', mergeNested(doc.theme.fonts, fonts));
      setOrDelete(next, 'fontAssets', mergeNested(doc.theme.fontAssets, fontAssets));
      const theme = parseOrThrow(deckThemeSchema, next, 'Theme');
      for (const [family, assetId] of Object.entries(fontAssets ?? {})) {
        if (assetId !== null) assertAssetKind(ctx, assetId, ['font'], `Schrift "${family}"`);
      }
      doc.theme = theme;
      return doc;
    }
    case 'update_deck': {
      Object.assign(doc, op.patch);
      return doc;
    }
  }
}

function checkSlideBackground(slide: Slide, ctx: OpContext): void {
  if (slide.background && typeof slide.background === 'object') {
    assertAssetKind(ctx, slide.background.assetId, ['image', 'video'], `Hintergrund von Folie "${slide.id}"`);
  }
}

function checkElement(el: DeckElement, ctx: OpContext): void {
  if ((el.type === 'image' || el.type === 'video') && !el.assetId) {
    throw new Error(`Element "${el.id}" (${el.type}) braucht assetId`);
  }
  if (el.type === 'image') assertAssetKind(ctx, el.assetId, ['image'], `Element "${el.id}"`);
  if (el.type === 'video') assertAssetKind(ctx, el.assetId, ['video'], `Element "${el.id}"`);
  if (el.type === 'text' && el.text === undefined) throw new Error(`Element "${el.id}" (text) braucht text`);
  if (el.type === 'html' && el.html === undefined) throw new Error(`Element "${el.id}" (html) braucht html`);
  if (el.type === 'chart' && !el.chart) throw new Error(`Element "${el.id}" (chart) braucht chart`);
  const role = el.style?.role;
  if (role !== undefined && !(DECK_TEXT_ROLES as readonly unknown[]).includes(role)) {
    throw new Error(`Element "${el.id}": style.role "${role}" ist unbekannt (erlaubt: ${DECK_TEXT_ROLES.join('|')})`);
  }
}

export function validateDeck(doc: Deck): void {
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();
  for (const slide of doc.slides) {
    if (slideIds.has(slide.id)) throw new Error(`Doppelte Folien-ID "${slide.id}"`);
    slideIds.add(slide.id);
    for (const el of slide.elements) {
      if (elementIds.has(el.id)) throw new Error(`Doppelte Element-ID "${el.id}"`);
      elementIds.add(el.id);
    }
  }
}

function slideIndex(doc: Deck, slideId: string): number {
  const idx = doc.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) throw new Error(`Folie "${slideId}" existiert nicht`);
  return idx;
}

function allElementIds(doc: Deck): string[] {
  return doc.slides.flatMap((s) => s.elements.map((e) => e.id));
}

export function slideNumbers(doc: Deck): Record<string, number> {
  return Object.fromEntries(doc.slides.map((s, i) => [s.id, i + 1]));
}

/** Element-Treffer an einem Punkt (oberstes zuerst), für Klick-Referenzen auf Folien. */
export function deckElementsAt(slide: Slide, x: number, y: number): DeckElement[] {
  return slide.elements
    .map((el, order) => ({ el, order }))
    .filter(({ el }) => x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height)
    .sort((a, b) => (b.el.z ?? 0) - (a.el.z ?? 0) || b.order - a.order)
    .map(({ el }) => el);
}

export function summarizeDeck(doc: Deck): string {
  const lines = [`Deck ${doc.width}×${doc.height} · ${doc.slides.length} Folien · Theme ${doc.theme.name ?? '—'} (Fonts ${doc.theme.fonts.heading}/${doc.theme.fonts.body})`];
  doc.slides.forEach((slide, i) => {
    const texts = slide.elements
      .filter((e) => e.type === 'text' && e.text)
      .map((e) => (e.text!.length > 50 ? `${e.text!.slice(0, 50)}…` : e.text!))
      .join(' | ');
    lines.push(
      `${i + 1}. ${slide.id}${slide.title ? ` „${slide.title}“` : ''}${slide.layout ? ` [${slide.layout}]` : ''}: ${slide.elements.length} Elemente${texts ? ` — ${texts}` : ''}${slide.notes ? ' · Notizen' : ''}`,
    );
  });
  return lines.join('\n');
}
