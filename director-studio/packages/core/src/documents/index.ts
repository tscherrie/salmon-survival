import { applyCanvasOps, createCanvas, summarizeCanvas, type Canvas, type CanvasOpInput } from './canvas.ts';
import type { OpContext } from './common.ts';
import { applyDeckOps, createDeck, summarizeDeck, type Deck, type DeckOpInput } from './deck.ts';
import { applySiteOps, createSite, summarizeSite, type Site, type SiteOpInput } from './site.ts';
import {
  applyTimelineOps,
  clipAssetIds,
  createTimeline,
  STANDARD_FORMATS,
  summarizeTimeline,
  type FormatSpec,
  type Timeline,
  type TimelineOpInput,
} from './timeline.ts';

export * from './common.ts';
export * from './timeline.ts';
export * from './deck.ts';
export * from './canvas.ts';
export * from './site.ts';

export const PROJECT_CATEGORIES = ['video', 'audio', 'slides', 'graphic', 'web'] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export type StudioDocument = Timeline | Deck | Canvas | Site;
export type DocumentKind = StudioDocument['kind'];
export type DocumentOp = TimelineOpInput | DeckOpInput | CanvasOpInput | SiteOpInput;

export const CATEGORY_DOCUMENT: Record<ProjectCategory, DocumentKind> = {
  video: 'timeline',
  audio: 'timeline',
  slides: 'deck',
  graphic: 'canvas',
  web: 'site',
};

export const CATEGORY_LABELS: Record<ProjectCategory, string> = {
  video: 'Video',
  audio: 'Audio',
  slides: 'Präsentation',
  graphic: 'Grafik / Collage',
  web: 'Website',
};

export function createDocument(category: ProjectCategory, options: { format?: FormatSpec; formats?: FormatSpec[] } = {}): StudioDocument {
  switch (category) {
    case 'video':
      return createTimeline({
        ...(options.format ? { format: options.format } : {}),
        ...(options.formats ? { formats: options.formats } : {}),
      });
    case 'audio':
      // Audio-Timelines rechnen in Millisekunden-Ticks (fps = 1000) für sample-nahe Schnitte.
      return createTimeline({ fps: 1000, audioOnly: true, format: STANDARD_FORMATS['16:9']!, formats: [] });
    case 'slides':
      return createDeck();
    case 'graphic':
      return createCanvas(options.format ? { width: options.format.width, height: options.format.height } : {});
    case 'web':
      return createSite();
  }
}

/** Wendet Operationen typgerecht an. Wirft `DocumentOpError` bei der ersten ungültigen Operation. */
export function applyDocumentOps<D extends StudioDocument>(doc: D, ops: readonly DocumentOp[], ctx: OpContext = {}): D {
  switch (doc.kind) {
    case 'timeline':
      return applyTimelineOps(doc, ops as TimelineOpInput[], ctx) as D;
    case 'deck':
      return applyDeckOps(doc, ops as DeckOpInput[], ctx) as D;
    case 'canvas':
      return applyCanvasOps(doc, ops as CanvasOpInput[], ctx) as D;
    case 'site':
      return applySiteOps(doc, ops as SiteOpInput[], ctx) as D;
  }
}

export function summarizeDocument(doc: StudioDocument, names: Record<string, string> = {}): string {
  switch (doc.kind) {
    case 'timeline':
      return summarizeTimeline(doc, names);
    case 'deck':
      return summarizeDeck(doc);
    case 'canvas':
      return summarizeCanvas(doc);
    case 'site':
      return summarizeSite(doc);
  }
}

/** Alle Asset-IDs, die ein Dokument verwendet (für den Status „im Dokument“). */
export function documentAssetIds(doc: StudioDocument): Set<string> {
  const ids = new Set<string>();
  switch (doc.kind) {
    case 'timeline':
      // Clip-Assets inkl. Asset-Referenzen in props (z. B. `rotoscope`, `…Asset`, `…AssetId`), siehe `clipAssetIds`.
      for (const t of doc.tracks) for (const c of t.clips) for (const id of clipAssetIds(c)) ids.add(id);
      for (const c of Object.values(doc.components)) ids.add(c.assetId);
      break;
    case 'deck':
      for (const a of Object.values(doc.theme.fontAssets ?? {})) ids.add(a);
      for (const s of doc.slides) {
        if (s.background && typeof s.background === 'object') ids.add(s.background.assetId);
        for (const e of s.elements) if (e.assetId) ids.add(e.assetId);
      }
      break;
    case 'canvas': {
      const visit = (layers: Canvas['layers']) => {
        for (const l of layers) {
          if (l.assetId) ids.add(l.assetId);
          if (l.maskAssetId) ids.add(l.maskAssetId);
          if (l.children) visit(l.children);
        }
      };
      visit(doc.layers);
      break;
    }
    case 'site':
      for (const p of doc.pages) for (const a of Object.values(p.mockups ?? {})) ids.add(a);
      break;
  }
  return ids;
}
