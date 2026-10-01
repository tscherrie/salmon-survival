import React from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineComposition } from '@studio/render/browser';
import { timelineRenderProps, assertComponentSandbox } from './timeline.tsx';
import { exportProject } from './export.ts';
import type { ExportRequest } from './types.ts';
import { renderSiteScreenshot } from './jobs.ts';

assertComponentSandbox();
// Remotion reads browser preferences even during a still render. Opaque frames have no browser
// storage; give this disposable frame an in-memory Storage, never the editor/host storage.
for (const name of ['localStorage', 'sessionStorage']) {
  const values = new Map<string, string>();
  const memory: Storage = { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(String(key), String(value)); } };
  Object.defineProperty(window, name, { configurable: false, value: memory });
}
document.documentElement.style.cssText = 'width:100%;height:100%;margin:0;background:#000'; document.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden';
const mount = document.createElement('div'); mount.style.cssText = 'width:100%;height:100%'; document.body.append(mount); const root = createRoot(mount);
let connected = false, player: PlayerRef | null = null, mixed: HTMLAudioElement | null = null, fps = 30, port: MessagePort | null = null, activePreview = 0;
let website: HTMLIFrameElement | null = null;
window.addEventListener('message', (e) => {
  if (website && e.source === website.contentWindow && ['studio-pick', 'studio-navigate'].includes(e.data?.type)) window.parent.postMessage(e.data, '*');
  else if (website && e.source === window.parent && e.data?.type === 'studio-pick-mode') website.contentWindow?.postMessage(e.data, '*');
});
function event(name: string, frame?: number, message?: string) { port?.postMessage({ type: 'event', name, frame, message }); }
window.addEventListener('message', (e) => {
  if (connected || e.source !== window.parent || e.data?.type !== 'director-media-connect' || !e.ports[0]) return;
  connected = true; port = e.ports[0]; port.onmessage = async ({ data }) => {
    const { id, method, request } = data;
    try {
      if (method === 'export') { const value = await exportProject({ ...request, onProgress: (phase, progress) => port?.postMessage({ type: 'progress', id, phase, progress }) }); port?.postMessage({ type: 'result', id, value }); }
      else if (method === 'site-screenshot') { const value = await renderSiteScreenshot(request.files, request.options); port?.postMessage({ type: 'result', id, value }); }
      else if (method === 'website-preview') {
        mixed?.pause(); root.render(null); website?.remove(); website = document.createElement('iframe');
        website.sandbox.add('allow-scripts'); website.style.cssText = 'position:fixed;left:0;top:0;border:0;width:100%;height:100%;display:block;background:#fff';
        const loaded = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Website konnte nicht starten')), 15000); website!.onload = () => { clearTimeout(timer); resolve(); }; });
        website.srcdoc = request.html; document.body.append(website); await loaded; port?.postMessage({ type: 'result', id, value: null });
      }
      else if (method === 'preview') {
        const serial = ++activePreview, spec = request as ExportRequest & { playbackRate?: number; audioUrl: string };
        mixed?.pause(); mixed = null;
        const { composition, inputProps, issues } = await timelineRenderProps(spec); fps = composition.fps;
        if (serial !== activePreview) return;
        const audioElement = new Audio(spec.audioUrl); mixed = audioElement; audioElement.playbackRate = spec.playbackRate ?? 1;
        let markReady!: () => void; const mounted = new Promise<void>((resolve) => { markReady = resolve; }); let mountTimer: ReturnType<typeof setTimeout>;
        inputProps.onMediaError = (issue) => { issues.push({ assetId: issue.assetId, reason: issue.message }); event('error', undefined, `${issue.assetId}: ${issue.message}`); };
        inputProps.onComponentError = (issue) => { issues.push({ assetId: issue.componentId, reason: issue.message }); event('error', undefined, `${issue.componentId}: ${issue.message}`); };
        root.render(<Player ref={(p) => { if (!p) return; markReady(); if (p === player) return; player = p; for (const name of ['frameupdate', 'seeked'] as const) p.addEventListener(name, (ev) => { event(name, ev.detail.frame); if (mixed && (name === 'seeked' || Math.abs(mixed.currentTime - ev.detail.frame / fps) > .12)) mixed.currentTime = ev.detail.frame / fps; }); p.addEventListener('play', () => { void mixed?.play().catch((error) => event('error')); event('play'); }); p.addEventListener('pause', () => { mixed?.pause(); event('pause'); }); p.addEventListener('ended', () => { mixed?.pause(); event('ended'); }); }} component={TimelineComposition} inputProps={inputProps} durationInFrames={composition.durationInFrames} fps={composition.fps} compositionWidth={composition.width} compositionHeight={composition.height} playbackRate={spec.playbackRate ?? 1} controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} style={{ width: '100%', height: '100%' }} />);
        try { await Promise.race([mounted, new Promise<never>((_, reject) => { mountTimer = setTimeout(() => reject(new Error('Medienvorschau konnte den Player nicht starten')), 20000); })]); await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); } finally { clearTimeout(mountTimer!); }
        if (issues.length) throw new Error(issues.map((i) => i.reason).join('; ')); port?.postMessage({ type: 'result', id, value: null });
      } else if (method === 'control') { const { action, value } = request; if (action === 'play') player?.play(); else if (action === 'pause') player?.pause(); else if (action === 'seek') player?.seekTo(value); else if (action === 'mute') { if (mixed) mixed.muted = true; } else if (action === 'unmute') { if (mixed) mixed.muted = false; } }
    } catch (error) { port?.postMessage({ type: 'error', id, error: error instanceof Error ? error.message : String(error) }); }
  }; port.postMessage({ type: 'ready' });
});
