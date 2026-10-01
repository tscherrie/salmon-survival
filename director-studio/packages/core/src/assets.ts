import { z } from 'zod';

export const ASSET_KINDS = ['image', 'video', 'audio', 'text', 'code', 'data', 'font', 'document', 'web'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ['active', 'rejected', 'archived'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Herkunft: `generated` (KI-Modell), `imported` (in den Projektspeicher kopiert),
 * `linked` (nur verknüpft, bleibt am Originalort), `derived` (Proxy/Analyse/Schnitt),
 * `director` (vom Director geschriebener Text/Code), `web` (Web-Referenz mit Quelle).
 */
export const ASSET_SOURCES = ['generated', 'imported', 'linked', 'derived', 'director', 'web'] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

export const LINEAGE_RELATIONS = ['input', 'reference', 'derived', 'variation', 'extracted'] as const;
export type LineageRelation = (typeof LINEAGE_RELATIONS)[number];

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  /** Feinere Einordnung, z. B. music, voice, sfx, stem, character-sheet, storyboard-frame, treatment, shot-list, lyrics, beat-map, word-timings, rotoscope, component. */
  subtype: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(ASSET_STATUSES).default('active'),
  source: z.enum(ASSET_SOURCES),
  mime: z.string().optional(),
  sha256: z.string().optional(),
  /** Relativer Pfad im Projekt (`assets/store/…`) oder absoluter Pfad bei `linked`. */
  path: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  generationId: z.string().optional(),
  /** Modell, das das Asset erzeugt hat (fal endpoint_id). */
  modelId: z.string().optional(),
  prompt: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  sourceUrl: z.string().optional(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export type AssetInput = z.input<typeof assetSchema>;

export interface LineageEdge {
  parentId: string;
  childId: string;
  relation: LineageRelation;
}

export interface AssetQuery {
  text?: string;
  kinds?: AssetKind[];
  subtypes?: string[];
  statuses?: AssetStatus[];
  sources?: AssetSource[];
  tags?: string[];
  modelId?: string;
  limit?: number;
}

/** Filterlogik (gemeinsam für Index und Tests). Volltext über Titel, Beschreibung, Tags, Prompt, ID. */
export function assetMatches(asset: Asset, query: AssetQuery): boolean {
  if (query.kinds?.length && !query.kinds.includes(asset.kind)) return false;
  if (query.subtypes?.length && (!asset.subtype || !query.subtypes.includes(asset.subtype))) return false;
  const statuses = query.statuses ?? ['active'];
  if (statuses.length && !statuses.includes(asset.status)) return false;
  if (query.sources?.length && !query.sources.includes(asset.source)) return false;
  if (query.modelId && asset.modelId !== query.modelId) return false;
  if (query.tags?.length && !query.tags.every((t) => asset.tags.includes(t))) return false;
  if (query.text && query.text.trim()) {
    const haystack = [asset.id, asset.title, asset.description ?? '', asset.prompt ?? '', asset.subtype ?? '', ...asset.tags]
      .join(' ')
      .toLowerCase();
    const terms = query.text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

export function filterAssets(assets: readonly Asset[], query: AssetQuery): Asset[] {
  const result = assets.filter((a) => assetMatches(a, query));
  result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return query.limit ? result.slice(0, query.limit) : result;
}

export function assetKindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('font/') || /font/.test(mime)) return 'font';
  if (mime === 'application/json') return 'data';
  if (mime === 'application/pdf' || mime.includes('presentation') || mime.includes('document')) return 'document';
  if (mime.startsWith('text/')) return 'text';
  return 'data';
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  tsx: 'text/tsx',
  ts: 'text/typescript',
  js: 'text/javascript',
  html: 'text/html',
  css: 'text/css',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
};

export function mimeFromExtension(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export function extensionFromMime(mime: string): string {
  for (const [ext, m] of Object.entries(EXTENSION_MIME)) {
    if (m === mime) return ext;
  }
  return 'bin';
}
