import type { StudioDocument, TimedWord } from '@studio/core';
import type { AssetMedia } from '@studio/render/browser';

export interface ExportRequest {
  document: StudioDocument;
  assets: Record<string, AssetMedia>;
  /** Source TSX or the existing compiled CommonJS format. Executed only in the sandbox. */
  components?: Record<string, string>;
  words?: TimedWord[];
  /** The actual site source snapshot, never read from another project's filesystem. */
  siteFiles?: Record<string, string | Uint8Array>;
  format: string;
  filename?: string;
  options?: { frame?: number; slideIds?: string[]; sampleRate?: number; normalizeLufs?: number; formatId?: string; quality?: number; /** Internal sandbox transfer: audio/codec processing occurs outside untrusted code. */ visualOnly?: boolean };
  onProgress?: (phase: string, progress: number) => void;
  signal?: AbortSignal;
}
export interface ExportResult { blob: Blob; filename: string; mimeType: string; warnings: string[] }
export interface MediaProbe { kind: 'image' | 'video' | 'audio'; mime: string; bytes: number; width?: number; height?: number; durationMs?: number; sampleRate?: number; channels?: number }
export class MediaRepairError extends Error {
  override name = 'MediaRepairError';
  constructor(public readonly issues: Array<{ assetId: string; reason: string }>) { super(`Medien vor dem Export reparieren: ${issues.map((i) => `${i.assetId}: ${i.reason}`).join('; ')}`); }
}
export class BrowserCapabilityError extends Error {
  override name = 'BrowserCapabilityError';
  constructor(public readonly capability: string, message: string) { super(message); }
}
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError'); }
