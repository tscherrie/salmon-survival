import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as Remotion from 'remotion';
import { canRenderMediaOnWeb, renderMediaOnWeb, renderStillOnWeb } from '@remotion/web-renderer';
import { TimelineComposition, resolveFormat, type OverlayComponentProps, type AssetMedia } from '@studio/render/browser';
import type { Timeline, TimedWord } from '@studio/core';
import { compileComponentSource } from './compiler.ts';
import { loadBrowserComponent } from './component-runtime.ts';
import { assertMediaSandboxRole } from './sandbox-role.ts';
import { mixTimelineAudio } from './audio.ts';
import { withFFmpeg } from './ffmpeg.ts';
import { BrowserCapabilityError, MediaRepairError, type ExportRequest } from './types.ts';

// The independent project's operator confirmed a total team size of at most three.
// Remotion remains separately licensed; this setting does not disable its usage telemetry.
const remotionLicenseKey = 'free-license' as const;

/** Static checks never establish trust: arbitrary component code runs only behind the opaque iframe boundary. */
export function assertComponentSandbox(): void {
  assertMediaSandboxRole();
}
export async function loadSandboxComponents(codes: Record<string, string> = {}): Promise<Record<string, React.ComponentType<OverlayComponentProps>>> {
  if (Object.keys(codes).length) assertComponentSandbox();
  const out: Record<string, React.ComponentType<OverlayComponentProps>> = {};
  for (const [id, code] of Object.entries(codes)) out[id] = loadBrowserComponent(await compileComponentSource(code), { React, jsxRuntime, remotion: Remotion });
  return out;
}
export async function timelineRenderProps(request: ExportRequest) {
  if (request.document.kind !== 'timeline') throw new Error('Timeline erforderlich');
  request.onProgress?.('Komponenten übersetzen', .05);
  const timeline = request.document, format = resolveFormat(timeline, request.options?.formatId), components = await loadSandboxComponents(request.components);
  const missing = Object.keys(timeline.components).filter((id) => !components[id]); if (missing.length) throw new MediaRepairError(missing.map((assetId) => ({ assetId, reason: 'Komponentenquelltext fehlt' })));
  const issues: Array<{ assetId: string; reason: string }> = [];
  const inputProps = { timeline, assets: request.assets, components, words: request.words ?? [], formatId: format.id, includeAudio: false, videoComponent: 'web' as const, showPlaceholders: false, onMediaError: (i: { assetId: string; message: string }) => { issues.push({ assetId: i.assetId, reason: i.message }); }, onComponentError: (i: { componentId: string; message: string }) => { issues.push({ assetId: i.componentId, reason: i.message }); } };
  const composition = { id: 'DirectorStudio', component: TimelineComposition, defaultProps: inputProps, durationInFrames: Math.max(1, timeline.durationFrames), fps: timeline.fps, width: format.width, height: format.height };
  return { inputProps, composition, issues };
}
export async function renderTimelineStill(request: ExportRequest): Promise<Blob> {
  const { composition, inputProps, issues } = await timelineRenderProps(request);
  request.onProgress?.('Standbild rendern', .2);
  const result = await renderStillOnWeb({ composition, inputProps, frame: request.options?.frame ?? 0, signal: request.signal, allowHtmlInCanvas: false, licenseKey: remotionLicenseKey });
  if (issues.length) throw new MediaRepairError(issues);
  return result.blob({ format: request.format === 'jpg' || request.format === 'jpeg' ? 'jpeg' : 'png', quality: request.options?.quality ?? .95 });
}
export async function muxVideo(silent: Blob, audio: Blob, format: 'mp4' | 'mov', signal?: AbortSignal): Promise<Blob> {
  return withFFmpeg(async (ff) => {
    await ff.writeFile('silent.mp4', new Uint8Array(await silent.arrayBuffer())); await ff.writeFile('mix.wav', new Uint8Array(await audio.arrayBuffer()));
    if (await ff.exec(['-i', 'silent.mp4', '-i', 'mix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', `film.${format}`])) throw new Error('Bild/Ton-Mux fehlgeschlagen');
    const bytes = await ff.readFile(`film.${format}`); if (typeof bytes === 'string') throw new Error('Ungültiges Video'); return new Blob([new Uint8Array(bytes)], { type: format === 'mov' ? 'video/quicktime' : 'video/mp4' });
  }, signal);
}
export async function renderTimelineVideo(request: ExportRequest): Promise<Blob> {
  if (request.document.kind !== 'timeline' || request.document.durationFrames <= 0) throw new Error('Nichtleere Timeline erforderlich');
  const { composition, inputProps, issues } = await timelineRenderProps(request);
  const support = await canRenderMediaOnWeb({ width: composition.width, height: composition.height, container: 'mp4', videoCodec: 'h264', muted: true });
  let silent: Blob;
  if (support.canRender) {
    const render = await renderMediaOnWeb({ composition, inputProps, container: 'mp4', videoCodec: 'h264', muted: true, signal: request.signal, allowHtmlInCanvas: false, outputTarget: 'arraybuffer', licenseKey: remotionLicenseKey, onProgress: (p) => request.onProgress?.('Video', p.progress) }); silent = await render.getBlob();
  } else {
    if (request.options?.visualOnly) throw new BrowserCapabilityError('video-codec', `Der isolierte Komponentenexport benötigt native H.264-Unterstützung: ${support.issues.map((i) => i.message).join('; ')}`);
    // Real codec fallback, using the same composition and per-frame images. Single-thread WASM has a 2 GiB address space.
    const estimated = composition.width * composition.height * 4 * composition.durationInFrames;
    if (estimated > 1_500_000_000) throw new BrowserCapabilityError('video-codec', `${support.issues.map((i) => i.message).join('; ')}. Der WASM-Ersatz benötigt für diese Timeline zu viel Arbeitsspeicher; native H.264-Unterstützung oder ein kürzerer Exportbereich ist erforderlich.`);
    silent = await withFFmpeg(async (ff) => {
      for (let frame = 0; frame < composition.durationInFrames; frame++) { if (request.signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError'); const image = await renderStillOnWeb({ composition, inputProps, frame, allowHtmlInCanvas: false, signal: request.signal, licenseKey: remotionLicenseKey }); const blob = await image.blob(); await ff.writeFile(`frame-${String(frame).padStart(8, '0')}.png`, new Uint8Array(await blob.arrayBuffer())); request.onProgress?.('Videoframes', frame / composition.durationInFrames); }
      if (await ff.exec(['-framerate', String(composition.fps), '-i', 'frame-%08d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'silent.mp4'])) throw new Error('H.264-Browserexport fehlgeschlagen'); const bytes = await ff.readFile('silent.mp4'); if (typeof bytes === 'string') throw new Error('Ungültiges Video'); return new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
    }, request.signal);
  }
  if (issues.length) throw new MediaRepairError(issues);
  if (request.options?.visualOnly) return silent;
  const audio = await mixTimelineAudio(request.document, request.assets, { sampleRate: request.options?.sampleRate, normalizeLufs: request.options?.normalizeLufs ?? -14, signal: request.signal, onProgress: request.onProgress });
  return muxVideo(silent, audio, request.format === 'mov' ? 'mov' : 'mp4', request.signal);
}
