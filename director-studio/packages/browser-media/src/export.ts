import { zipSync, strToU8 } from 'fflate';
import { materializeAssets } from './assets.ts';
import { mixTimelineAudio } from './audio.ts';
import { transcodeBlob } from './ffmpeg.ts';
import { buildWebsite } from './compiler.ts';
import { canvasImage, canvasSvg, deckImages, imagesPdf, browserDeckPptx } from './documents.ts';
import { renderTimelineVideo, renderTimelineStill } from './timeline.tsx';
import { assertComponentSandbox } from './timeline.tsx';
import { checkAbort, type ExportRequest, type ExportResult } from './types.ts';
import { timelineSrt } from './subtitles.ts';

export const EXPORT_FORMATS = { timeline: ['mp4', 'mov', 'wav', 'mp3', 'm4a', 'flac', 'png', 'jpeg', 'srt'], deck: ['pdf', 'pptx', 'png'], canvas: ['png', 'jpeg', 'pdf', 'svg'], site: ['zip'] } as const;
export async function exportProject(raw: ExportRequest): Promise<ExportResult> {
  if (raw.document.kind === 'timeline' && ['mp4', 'mov', 'png', 'jpeg', 'jpg'].includes(raw.format.toLowerCase())) {
    try { assertComponentSandbox(); } catch { const { exportInSandbox } = await import('./sandbox-client.tsx'); return exportInSandbox(raw); }
  }
  checkAbort(raw.signal); const format = raw.format.toLowerCase().replace(/^jpg$/, 'jpeg');
  if (!(EXPORT_FORMATS[raw.document.kind] as readonly string[]).includes(format)) throw new Error(`Export ${format} passt nicht zu ${raw.document.kind}`);
  raw.onProgress?.(format === 'srt' ? 'Untertitel exportieren' : 'Medien prüfen', 0);
  const request: ExportRequest = { ...raw, format, assets: raw.document.kind === 'site' || format === 'srt' ? raw.assets : await materializeAssets(raw.document, raw.assets, raw.signal) }; const doc = request.document;
  let blob: Blob, extension = format; const warnings: string[] = [];
  if (doc.kind === 'timeline') {
    if (format === 'srt') blob = timelineSrt(doc, request.words, request.assets);
    else if (format === 'mp4' || format === 'mov') blob = await renderTimelineVideo(request);
    else if (format === 'png' || format === 'jpeg') blob = await renderTimelineStill(request);
    else { blob = await mixTimelineAudio(doc, request.assets, { sampleRate: request.options?.sampleRate, normalizeLufs: request.options?.normalizeLufs ?? (request.options?.formatId === 'podcast' ? -16 : -14), onProgress: request.onProgress, signal: request.signal }); if (format !== 'wav') blob = await transcodeBlob(blob, format as 'mp3' | 'm4a' | 'flac', request.signal); }
  } else if (doc.kind === 'canvas') {
    if (format === 'svg') blob = canvasSvg(doc, request.assets);
    else { blob = await canvasImage(doc, request.assets, format === 'jpeg' ? 'image/jpeg' : 'image/png', request.options?.quality); if (format === 'pdf') blob = await imagesPdf([{ blob, width: doc.unit === 'mm' ? doc.width / 25.4 * 96 : doc.width, height: doc.unit === 'mm' ? doc.height / 25.4 * 96 : doc.height }]); }
  } else if (doc.kind === 'deck') {
    if (format === 'pptx') { blob = await browserDeckPptx(doc, request.assets); warnings.push('PowerPoint benennt verwendete Schriften; Empfänger benötigen diese Schriften. Freies HTML wird als Bild eingebettet.'); }
    else { const slides = await deckImages(doc, request.assets, request.options?.slideIds); if (!slides.length) throw new Error('Keine Folien für den Export'); if (format === 'pdf') blob = await imagesPdf(slides.map((s) => ({ blob: s.blob, width: doc.width, height: doc.height }))); else if (slides.length === 1) blob = slides[0]!.blob; else { const files: Record<string, Uint8Array> = {}; for (const [i, s] of slides.entries()) files[`slide-${String(i + 1).padStart(3, '0')}.png`] = new Uint8Array(await s.blob.arrayBuffer()); blob = new Blob([new Uint8Array(zipSync(files))], { type: 'application/zip' }); extension = 'zip'; } }
  } else {
    if (!request.siteFiles || !Object.keys(request.siteFiles).length) throw new Error('Website-Dateisnapshot fehlt; Quellversion vor dem Export laden');
    const files = await buildWebsite(request.siteFiles, doc.framework, request.assets); files['director-project.json'] = strToU8(JSON.stringify(doc, null, 2)); blob = new Blob([new Uint8Array(zipSync(files))], { type: 'application/zip' });
  }
  checkAbort(raw.signal); raw.onProgress?.('Fertig', 1);
  const base = (raw.filename ?? 'director-export').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]/gu, '-');
  return { blob, filename: `${base}.${extension}`, mimeType: blob.type, warnings };
}
