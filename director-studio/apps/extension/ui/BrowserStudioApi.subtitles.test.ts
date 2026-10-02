import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetSchema, createTimeline } from '@studio/core';
import type { Asset, Timeline } from '@studio/core';
import { wordsForTimeline } from '@studio/browser-media';
import { BrowserStudioApi } from './BrowserStudioApi.ts';
import type { BrowserJob } from './BrowserStudioApi.ts';
import type { DirectorHostBridge } from './hostBridge.ts';

const apis: BrowserStudioApi[] = [];
afterEach(() => { for (const api of apis.splice(0)) api.dispose(); vi.unstubAllGlobals(); });

function fixture(timeline: Timeline, assets: Asset[]) {
  // Native transport is connected; ordinary HTTP and component byte reads must be unnecessary for SRT.
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const fetch = vi.fn(async () => { throw new Error('Unexpected ordinary HTTP request'); });
  vi.stubGlobal('fetch', fetch);
  const jobs: BrowserJob[] = [], saved: File[] = [], uploaded: Array<{ mime: string; base64: string }> = [];
  const request = vi.fn(async (path: string, method = 'GET', body?: unknown) => {
    if (path === '/api/projects/p1' && method === 'GET') return structuredClone({
      manifest: { id: 'p1' }, document: timeline, assets, versions: [{ number: 1 }], jobs,
    });
    if (path === '/api/projects/p1/actions' && method === 'POST') {
      const action = body as { method: string; params: Record<string, unknown> };
      if (action.method === 'createJob') {
        const job: BrowserJob = { id: 'srt-job', kind: String(action.params.kind), input: action.params.input as Record<string, unknown>, status: 'queued', createdAt: 'now', updatedAt: 'now' };
        jobs.push(job); return structuredClone(job);
      }
      if (action.method === 'claimJob') return { claimed: true };
      if (action.method === 'updateJob') {
        const job = jobs.find((item) => item.id === action.params.jobId);
        if (!job) throw new Error('Test job missing');
        Object.assign(job, action.params.patch); return structuredClone(job);
      }
    }
    if (path === '/api/projects/p1/assets-json' && method === 'POST') {
      const input = body as { name: string; mime: string; base64: string };
      uploaded.push(input);
      const asset = assetSchema.parse({ id: 'exported-srt', kind: 'data', source: 'derived', title: input.name, mime: input.mime, path: 'owned/exported.srt', createdAt: 'now' });
      assets.push(asset); return structuredClone(asset);
    }
    throw new Error(`Unexpected native request: ${method} ${path}`);
  });
  const host = { getStatus: () => ({ connected: true }), request, saveToLibrary: vi.fn(async (file: File) => { saved.push(file); return 'library-file'; }) } as unknown as DirectorHostBridge;
  const api = new BrowserStudioApi(host); api.saveExportsToLibrary = true; apis.push(api);
  return { api, request, fetch, saved, uploaded, jobs };
}

function transcriptAsset(id: string, text: string) {
  return assetSchema.parse({ id, kind: 'audio', title: id, source: 'imported', path: `owned/${id}.wav`, bytes: 100, mime: 'audio/wav', createdAt: 'now', metadata: { transcript: { words: [{ text, start: 2, end: 3 }] } } });
}

function timelineFixture() {
  const timeline = createTimeline({ fps: 30, durationFrames: 180 });
  timeline.components.unused = { name: 'Missing unrelated overlay', assetId: 'missing-code' };
  timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'voice', start: 60, duration: 60, in: 30, speed: 2 });
  timeline.tracks[4]!.muted = true;
  timeline.tracks[4]!.clips.push({ id: 'muted', assetId: 'muted', start: 0, duration: 120, in: 0, speed: 1 });
  const assets = [transcriptAsset('voice', 'Hörbare Sprache.'), transcriptAsset('muted', 'Stumme Sprache.'), assetSchema.parse({
    id: 'missing-code', kind: 'code', title: 'Missing source', source: 'director', path: 'owned/missing.tsx', bytes: 100, mime: 'text/tsx', createdAt: 'now', metadata: { missing: true },
  })];
  return { timeline, assets };
}

describe('native editor SRT caller', () => {
  it('exports real timed subtitles without muted speech or fetching a missing component, then persists and delivers the same file', async () => {
    const { timeline, assets } = timelineFixture();
    // Preview/default consumers retain their existing word list; SRT opts into the audible-track policy.
    expect(wordsForTimeline(timeline, assets).map((word) => word.text)).toEqual(['Stumme Sprache.', 'Hörbare Sprache.']);
    expect(wordsForTimeline(timeline, assets, { excludeMuted: true })).toEqual([{ text: 'Hörbare Sprache.', start: 2.5, end: 3 }]);
    const { api, request, fetch, saved, uploaded, jobs } = fixture(timeline, assets);
    await expect(api.exportProject('p1', { target: 'srt', format: '16:9' })).resolves.toEqual({ path: 'Library: director-export.srt (library-file)' });
    const expected = '1\r\n00:00:02,500 --> 00:00:03,000\r\nHörbare Sprache.\r\n\r\n';
    expect(saved).toHaveLength(1); expect(saved[0]!.name).toBe('director-export.srt');
    expect(saved[0]!.type).toBe('application/x-subrip;charset=utf-8'); expect(await saved[0]!.text()).toBe(expected);
    expect(uploaded).toHaveLength(1); expect(new TextDecoder().decode(Uint8Array.from(atob(uploaded[0]!.base64), (c) => c.charCodeAt(0)))).toBe(expected);
    expect(jobs[0]).toMatchObject({ status: 'completed', output: { filename: 'director-export.srt', assetIds: ['exported-srt'], deliveries: [{ kind: 'library', filename: 'director-export.srt', fileId: 'library-file' }] } });
    expect(request.mock.calls.filter(([path]) => path.includes('/assets/'))).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled(); expect(api.exportJobId).toBeNull();
  });

  it('fails a real metadata-only job clearly when all transcribed speech is muted, including nested job parameters', async () => {
    const { timeline, assets } = timelineFixture(); timeline.tracks[3]!.muted = true;
    const { api, request, fetch, saved, uploaded, jobs } = fixture(timeline, assets);
    const job: BrowserJob = { id: 'muted-job', kind: 'export_project', input: { params: { target: 'srt', format: '16:9' }, projectVersion: 1 }, status: 'queued', createdAt: 'now', updatedAt: 'now' }; jobs.push(job);
    await expect(api.runMediaJob('p1', job, true)).rejects.toThrow('Keine Untertitel vorhanden');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringContaining('Wortzeiten hinzufügen') });
    expect(saved).toHaveLength(0); expect(uploaded).toHaveLength(0);
    expect(request.mock.calls.filter(([path]) => path.includes('/assets/'))).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });
});
