import { afterEach, describe, expect, it } from 'vitest';
import { timelineSchema, type Asset, type ProjectSnapshot } from '@studio/core';
import type { MediaErrorInfo } from '@studio/render/browser';
import { buildMedia, currentMediaIssues } from '../src/renderer/components/monitor/VideoMonitor.tsx';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { installDropGuard } from '../src/renderer/lib/dropGuard.ts';
import { createStudioStore } from '../src/renderer/state/store.ts';

const timeline = timelineSchema.parse({
  kind: 'timeline',
  fps: 30,
  width: 1920,
  height: 1080,
  durationFrames: 90,
  tracks: [
    { id: 'V1', kind: 'video', clips: [{ id: 'c1', start: 0, duration: 30, assetId: 'a_video' }] },
    { id: 'T1', kind: 'overlay', clips: [{ id: 'c2', start: 0, duration: 30, componentId: 'fx', props: { rotoscope: 'a_roto', logoAsset: 'a_logo', label: 'kein Asset' } }] },
  ],
  components: { fx: { assetId: 'a_code', name: 'FX' } },
});

function asset(id: string, kind: Asset['kind'], extra: Partial<Asset> = {}): Asset {
  return { id, kind, title: id, source: 'generated', status: 'active', tags: [], createdAt: '2026-10-01T00:00:00.000Z', path: `assets/${id}`, sha256: id, sizeBytes: 1, ...extra } as Asset;
}

describe('Monitor: Medien der Vorschau', () => {
  it('nimmt Asset-Referenzen aus Clip-Props mit und markiert fehlende verknüpfte Dateien', () => {
    const assets = [
      asset('a_video', 'video', { source: 'linked', metadata: { missing: true } }),
      asset('a_roto', 'data'),
      asset('a_logo', 'image'),
      asset('a_fremd', 'image'),
    ];
    const media = buildMedia(timeline, assets, (id, v) => `studio-asset://p/${id}/${v ?? 'original'}`, 'Datei fehlt');
    expect(Object.keys(media).sort()).toEqual(['a_logo', 'a_roto', 'a_video']);
    expect(media.a_video).toMatchObject({ url: 'studio-asset://p/a_video/proxy', error: 'Datei fehlt' });
    expect(media.a_logo!.error).toBeUndefined();
  });

  it('zeigt nur Medienfehler, die noch zum aktuellen Schnitt gehören', () => {
    const issue = (clipId: string, assetId: string): MediaErrorInfo => ({ clipId, assetId, kind: 'image', url: '', message: 'fehlt' });
    const issues = [issue('c1', 'a_video'), issue('c2', 'a_logo'), issue('weg', 'a_video'), issue('c1', 'a_anderes')];
    expect(currentMediaIssues(issues, timeline).map((i) => `${i.clipId}/${i.assetId}`)).toEqual(['c1/a_video', 'c2/a_logo']);
  });
});

describe('Dateien neben Ablagezonen', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  it('verhindert, dass der Browser fallen gelassene Dateien öffnet; Ablagezonen behalten ihre Behandlung', () => {
    uninstall = installDropGuard(window);
    const stray = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(true);
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const zone = document.createElement('div');
    document.body.appendChild(zone);
    let handled = 0;
    zone.addEventListener('drop', (e) => {
      handled++;
      e.preventDefault();
    });
    const onZone = new Event('drop', { bubbles: true, cancelable: true });
    zone.dispatchEvent(onZone);
    expect(handled).toBe(1);
    expect(onZone.defaultPrevented).toBe(true);
    zone.remove();
  });
});

describe('Offene Rückfrage im Snapshot', () => {
  it('übernimmt die Lauf-ID statt sie zu verwerfen', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.createProject({ title: 'Lauf', category: 'video' });
    const store = createStudioStore(api);
    const withQuestion: ProjectSnapshot = {
      ...snap,
      pendingQuestion: { questionId: 'qst_1', runId: 'run_42', questions: [{ id: 'q1', question: 'Format?', options: [{ label: '16:9' }, { label: '9:16' }] }] },
    };
    store.getState().loadSnapshot(withQuestion);
    expect(store.getState().question).toMatchObject({ questionId: 'qst_1', runId: 'run_42' });
    store.getState().loadSnapshot({ ...withQuestion, pendingQuestion: { questionId: 'qst_2', questions: withQuestion.pendingQuestion!.questions } });
    expect(store.getState().question).toMatchObject({ questionId: 'qst_2', runId: null });
  });
});
