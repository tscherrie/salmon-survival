import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Asset } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { framePaths, pathOf } from './normalize.ts';
import type { MediaPort } from './ports.ts';
import { readImageBlock, type ImageBlockData } from './util.ts';

/** Kantenlänge für Vorschaubilder an den Director (Opus 5.5: Hochauflösungs-Stufe bis 2576 px). */
export const PREVIEW_WIDTH = 1568;

export interface PreviewDeps {
  project: ProjectStore;
  media?: MediaPort | undefined;
}

/**
 * Vorschaubild eines Assets: Bild direkt (oder verkleinert über ffmpeg), Video als Einzelbild bzw.
 * Kontaktabzug. Ergebnisse werden unter `assets/derived/<id>/` zwischengespeichert.
 */
export async function assetPreviewImage(
  deps: PreviewDeps,
  asset: Asset,
  options: { video?: 'frame' | 'contact'; atSec?: number } = {},
): Promise<ImageBlockData | undefined> {
  const path = deps.project.assetFilePath(asset);
  if (!path) return undefined;
  if (asset.kind === 'image') {
    const direct = await readImageBlock(path).catch(() => undefined);
    if (direct) return direct;
    if (!deps.media) return undefined;
    const dir = await derivedDir(deps.project, asset.id);
    const frames = framePaths(await deps.media.extractFrames(path, [0], dir, { width: PREVIEW_WIDTH, format: 'jpg' }), [0]);
    return frames[0] ? readImageBlock(frames[0].path) : undefined;
  }
  if (asset.kind === 'video' && deps.media) {
    const dir = await derivedDir(deps.project, asset.id);
    if (options.video === 'contact') {
      const out = join(dir, 'contact-sheet.jpg');
      const result = pathOf(await deps.media.contactSheet(path, out, { count: 12, columns: 4, width: PREVIEW_WIDTH, tileWidth: Math.round(PREVIEW_WIDTH / 4), labels: true })) ?? out;
      return readImageBlock(result);
    }
    const durationSec = asset.durationMs ? asset.durationMs / 1000 : undefined;
    const at = options.atSec ?? (durationSec ? Math.min(durationSec / 2, 1) : 0);
    const frames = framePaths(await deps.media.extractFrames(path, [at], dir, { width: PREVIEW_WIDTH, format: 'jpg' }), [at]);
    return frames[0] ? readImageBlock(frames[0].path) : undefined;
  }
  return undefined;
}

async function derivedDir(project: ProjectStore, assetId: string): Promise<string> {
  const dir = join(project.derivedDir(assetId), 'director');
  await mkdir(dir, { recursive: true });
  return dir;
}

export function describeAssetLine(asset: Asset): string {
  const parts = [
    `${asset.id}`,
    `${asset.kind}${asset.subtype ? `/${asset.subtype}` : ''}`,
    `„${asset.title}“`,
  ];
  if (asset.durationMs) parts.push(`${(asset.durationMs / 1000).toFixed(1)} s`);
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.modelId) parts.push(asset.modelId);
  if (asset.tags.length) parts.push(`#${asset.tags.join(' #')}`);
  if (asset.status !== 'active') parts.push(`[${asset.status}]`);
  return parts.join(' · ');
}
