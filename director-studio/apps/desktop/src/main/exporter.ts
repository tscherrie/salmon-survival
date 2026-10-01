import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportOptions, Timeline } from '@studio/core';
import { timelineHasMixAudio, type MediaToolkit } from '@studio/media';
import { safeFileName, writeFileAtomic, type ProjectStore } from '@studio/project';
import type { MediaErrorInfo } from '@studio/render/browser';
import { assetFileUrl, type RenderService } from './services.ts';

export interface ExportDeps {
  media: MediaToolkit;
  render: RenderService;
  siteUrl: () => Promise<string>;
  now?: () => Date;
  /** Beim Rendern ausgelassene (fehlende/defekte) Medien; das Video entsteht trotzdem. */
  onMediaError?: ((info: MediaErrorInfo) => void) | undefined;
}

/** Erlaubte Export-Ziele je Dokumenttyp. */
export const EXPORT_TARGETS: Record<'timeline-video' | 'timeline-audio' | 'deck' | 'canvas' | 'site', string[]> = {
  'timeline-video': ['mp4', 'mov', 'wav'],
  'timeline-audio': ['wav', 'mp3', 'm4a', 'flac'],
  deck: ['pdf', 'pptx', 'png'],
  canvas: ['png', 'jpeg', 'pdf', 'svg'],
  site: ['zip'],
};

/**
 * Exportiert das aktuelle Dokument nach `<projekt>/exports/`.
 * Video: Remotion rendert das Bild stumm, ffmpeg mischt den Ton (Ducking/Fades), normalisiert auf
 * −14 LUFS (True Peak −1 dBTP) und muxt. Audio-Projekte: Mix + Normalisierung (Podcast-Ziel −16 LUFS
 * wenn `format` = `podcast`).
 */
export async function exportProject(store: ProjectStore, options: ExportOptions, deps: ExportDeps): Promise<{ path: string }> {
  const doc = await store.getDocument();
  if (!doc) throw new Error('Das Projekt hat noch kein Dokument – erst das Planungsgespräch abschließen.');
  const target = options.target.toLowerCase().replace(/^\./, '');
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = safeFileName(`${store.manifest.title} ${stamp}${options.format ? ` ${options.format.replace(':', 'x')}` : ''}`);
  const outDir = join(store.dir, 'exports');
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `${base}.${target}`);
  const work = await mkdtemp(join(tmpdir(), 'studio-export-'));
  try {
    switch (doc.kind) {
      case 'timeline': {
        const audioOnly = doc.tracks.every((t) => t.kind === 'audio');
        if (audioOnly || ['wav', 'mp3', 'm4a', 'flac'].includes(target)) {
          assertTarget(target, audioOnly ? 'timeline-audio' : 'timeline-video');
          const mix = await renderMix(store, doc, deps.media, work);
          if (!mix) throw new Error('Die Timeline enthält keinen Ton');
          await deps.media.normalizeLoudness(mix, out, { targetLufs: options.format === 'podcast' ? -16 : -14, truePeakDb: -1 });
          return { path: out };
        }
        assertTarget(target, 'timeline-video');
        const silent = join(work, 'picture.mp4');
        await deps.render.renderTimelineVideo(store, { out: silent, formatId: options.format, onMediaError: deps.onMediaError });
        const mix = await renderMix(store, doc, deps.media, work);
        if (!mix) {
          await copyFile(silent, out);
          return { path: out };
        }
        const normalized = join(work, 'mix-normalized.wav');
        await deps.media.normalizeLoudness(mix, normalized, { targetLufs: -14, truePeakDb: -1 });
        await deps.media.mux(silent, normalized, out);
        return { path: out };
      }
      case 'deck': {
        assertTarget(target, 'deck');
        const mod = await deps.render.load();
        const assetUrl = (id: string) => assetFileUrl(store, id);
        if (target === 'pptx') {
          const bytes = await mod.deckToPptx(doc, { assetPath: (id) => {
            const asset = store.getAsset(id);
            return asset ? store.assetFilePath(asset) : undefined;
          } });
          await writeFileAtomic(out, bytes);
          return { path: out };
        }
        if (target === 'pdf') {
          const result = await mod.renderDeck(doc, { assetUrl, outDir: work, formats: ['pdf'] });
          if (!result.pdf) throw new Error('PDF konnte nicht erzeugt werden');
          await copyFile(result.pdf, out);
          return { path: out };
        }
        const folder = join(outDir, base);
        await mod.renderDeck(doc, { assetUrl, outDir: folder, formats: ['png'] });
        return { path: folder };
      }
      case 'canvas': {
        assertTarget(target, 'canvas');
        const mod = await deps.render.load();
        await mod.renderCanvas(doc, { assetUrl: (id) => assetFileUrl(store, id), out, format: target as 'png' | 'jpeg' | 'pdf' | 'svg' });
        return { path: out };
      }
      case 'site': {
        assertTarget(target, 'site');
        const mod = await deps.render.load();
        await mod.buildSiteZip(store.siteDir, out);
        return { path: out };
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function assertTarget(target: string, kind: keyof typeof EXPORT_TARGETS): void {
  if (!EXPORT_TARGETS[kind].includes(target)) {
    throw new Error(`Export als „${target}“ ist hier nicht möglich. Möglich: ${EXPORT_TARGETS[kind].join(', ')}`);
  }
}

async function renderMix(store: ProjectStore, timeline: Timeline, media: MediaToolkit, work: string): Promise<string | null> {
  // Auch Originalton von Videoclips (`includeSourceAudio`) zählt – sonst wären solche Exporte stumm.
  if (!timelineHasMixAudio(timeline)) return null;
  const out = join(work, 'mix.wav');
  await media.renderAudioMix(
    timeline,
    (assetId) => {
      const asset = store.getAsset(assetId);
      return asset ? store.assetFilePath(asset) : undefined;
    },
    out,
  );
  return out;
}
