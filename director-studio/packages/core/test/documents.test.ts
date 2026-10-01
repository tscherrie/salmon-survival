import { describe, expect, it } from 'vitest';
import {
  applyCanvasOps,
  applyDeckOps,
  applyDocumentOps,
  applySiteOps,
  applyTimelineOps,
  canvasLayersAt,
  clipsAtFrame,
  clipsInRange,
  contentEnd,
  createCanvas,
  createDeck,
  createDocument,
  createSite,
  createTimeline,
  deckElementsAt,
  documentAssetIds,
  DocumentOpError,
  findLayer,
  parseDataSrc,
  summarizeDocument,
  summarizeTimeline,
  type AssetKind,
  type OpContext,
  type Timeline,
} from '../src/index.ts';

const assets: Record<string, AssetKind> = { vid1: 'video', vid2: 'video', img1: 'image', song: 'audio', code1: 'code' };
const ctx: OpContext = { assetKind: (id) => assets[id] };

function baseTimeline(): Timeline {
  return applyTimelineOps(createTimeline({ durationFrames: 0 }), [{ op: 'update_timeline', patch: { durationFrames: 900 } }], ctx);
}

describe('timeline ops', () => {
  it('creates a default video timeline', () => {
    const t = createTimeline();
    expect(t.tracks.map((x) => x.id)).toEqual(['V1', 'V2', 'T1', 'A1', 'A2', 'A3']);
    expect(t.fps).toBe(30);
    expect(t.width).toBe(1920);
  });

  it('inserts, moves, trims and updates clips', () => {
    let t = baseTimeline();
    t = applyTimelineOps(
      t,
      [
        { op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'vid1', start: 0, duration: 150 } },
        { op: 'insert_clip', trackId: 'V1', clip: { id: 'c2', assetId: 'vid2', start: 150, duration: 150 } },
        { op: 'insert_clip', trackId: 'T1', clip: { id: 't1', text: 'faster', style: 'hero', start: 30, duration: 60 } },
        { op: 'insert_clip', trackId: 'A2', clip: { id: 'a1', assetId: 'song', start: 0, duration: 900, gainDb: -3 } },
      ],
      ctx,
    );
    expect(clipsAtFrame(t, 40).map((x) => x.clip.id)).toEqual(['c1', 't1', 'a1']);
    t = applyTimelineOps(t, [{ op: 'move_clip', clipId: 'c2', start: 300 }], ctx);
    t = applyTimelineOps(t, [{ op: 'trim_clip', clipId: 'c1', duration: 120, in: 15 }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 't1', patch: { text: 'FASTER', props: { color: 'red' } } }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 't1', patch: { props: { size: 200, color: null } } }], ctx);
    const t1 = t.tracks.find((x) => x.id === 'T1')!.clips[0]!;
    expect(t1.text).toBe('FASTER');
    expect(t1.props).toEqual({ size: 200 });
    expect(clipsInRange(t, 100, 310, 'V1').map((x) => x.clip.id)).toEqual(['c1', 'c2']);
    expect(contentEnd(t)).toBe(900);
  });

  it('rejects overlaps on exclusive tracks but allows them on text tracks', () => {
    const t = applyTimelineOps(baseTimeline(), [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'vid1', start: 0, duration: 150 } }], ctx);
    expect(() =>
      applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c2', assetId: 'vid2', start: 100, duration: 150 } }], ctx),
    ).toThrow(/überlappen/);
    const withTexts = applyTimelineOps(
      t,
      [
        { op: 'insert_clip', trackId: 'T1', clip: { id: 'x1', text: 'a', start: 0, duration: 100 } },
        { op: 'insert_clip', trackId: 'T1', clip: { id: 'x2', text: 'b', start: 50, duration: 100 } },
      ],
      ctx,
    );
    expect(withTexts.tracks.find((x) => x.id === 'T1')!.clips).toHaveLength(2);
  });

  it('validates track/asset compatibility, bounds and ids', () => {
    const t = baseTimeline();
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'song', start: 0, duration: 10 } }], ctx)).toThrow(/Typ "audio"/);
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'nope', start: 0, duration: 10 } }], ctx)).toThrow(/existiert nicht/);
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'vid1', start: 890, duration: 30 } }], ctx)).toThrow(/Timeline-Ende/);
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'T1', clip: { id: 'c1', start: 0, duration: 30 } }], ctx)).toThrow(/text oder componentId/);
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'XX', clip: { id: 'c1', text: 'a', start: 0, duration: 30 } }], ctx)).toThrow(/Spur "XX"/);
    expect(() =>
      applyTimelineOps(
        t,
        [
          { op: 'insert_clip', trackId: 'T1', clip: { id: 'dup', text: 'a', start: 0, duration: 30 } },
          { op: 'insert_clip', trackId: 'T1', clip: { id: 'dup', text: 'b', start: 40, duration: 30 } },
        ],
        ctx,
      ),
    ).toThrow(/existiert bereits/);
  });

  it('reports the failing op index and leaves the input untouched', () => {
    const t = baseTimeline();
    try {
      applyTimelineOps(t, [
        { op: 'insert_clip', trackId: 'T1', clip: { id: 'ok', text: 'a', start: 0, duration: 30 } },
        { op: 'remove_clip', clipId: 'missing' },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentOpError);
      expect((error as DocumentOpError).opIndex).toBe(1);
      expect((error as Error).message).toMatch(/Operation 2 \(remove_clip\)/);
    }
    expect(t.tracks.find((x) => x.id === 'T1')!.clips).toHaveLength(0);
  });

  it('rejects malformed ops via schema', () => {
    expect(() => applyTimelineOps(baseTimeline(), [{ op: 'insert_clip', trackId: 'T1', clip: { id: 'a', text: 'x', start: -5, duration: 0 } } as never])).toThrow(DocumentOpError);
    expect(() => applyTimelineOps(baseTimeline(), [{ op: 'explode' } as never])).toThrow(DocumentOpError);
  });

  it('handles components, markers and tracks', () => {
    let t = baseTimeline();
    expect(() => applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V2', clip: { id: 'o1', componentId: 'cmp', start: 0, duration: 30 } }], ctx)).toThrow(/unbekannte Komponente/);
    t = applyTimelineOps(
      t,
      [
        { op: 'register_component', componentId: 'cmp', component: { assetId: 'code1', name: 'PaperRoto' } },
        { op: 'insert_clip', trackId: 'V2', clip: { id: 'o1', componentId: 'cmp', start: 0, duration: 30 } },
        { op: 'add_marker', marker: { id: 'm2', frame: 300, kind: 'section', label: 'Chorus' } },
        { op: 'add_marker', marker: { id: 'm1', frame: 30, kind: 'beat' } },
        { op: 'add_track', track: { id: 'A4', kind: 'audio', role: 'ambience' } },
        { op: 'update_track', trackId: 'A2', patch: { duck: { byTrackId: 'A1', db: -8 } } },
      ],
      ctx,
    );
    expect(t.markers.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(() => applyTimelineOps(t, [{ op: 'unregister_component', componentId: 'cmp' }], ctx)).toThrow(/noch verwendet/);
    expect(() => applyTimelineOps(t, [{ op: 'register_component', componentId: 'bad', component: { assetId: 'img1', name: 'X' } }], ctx)).toThrow(/Typ "image"/);
    const summary = summarizeTimeline(t, { song: 'Song' });
    expect(summary).toContain('V2 overlay');
    expect(summary).toContain('Komponente cmp');
    expect(summary).toContain('00:10.000 section Chorus');
    expect(summary).toContain('1 Beat-Marker');
  });
});

describe('deck ops', () => {
  it('adds, moves and edits slides and elements', () => {
    let d = createDeck();
    d = applyDeckOps(
      d,
      [
        { op: 'add_slide', slide: { id: 's1', title: 'Titel', elements: [{ id: 'e1', type: 'text', x: 100, y: 100, width: 800, height: 200, text: 'Hallo' }] } },
        { op: 'add_slide', slide: { id: 's2', elements: [] } },
        { op: 'add_element', slideId: 's2', element: { id: 'e2', type: 'image', x: 0, y: 0, width: 1920, height: 1080, assetId: 'img1' } },
        { op: 'add_element', slideId: 's2', element: { id: 'e3', type: 'text', x: 50, y: 50, width: 400, height: 100, text: 'Oben', z: 2 } },
        { op: 'move_slide', slideId: 's2', index: 0 },
        { op: 'update_element', slideId: 's1', elementId: 'e1', patch: { style: { color: '#f00' } } },
        { op: 'update_element', slideId: 's1', elementId: 'e1', patch: { style: { fontSize: 72 } } },
        { op: 'update_theme', patch: { name: 'Paper', colors: { accent: '#ff5500' } } },
      ],
      ctx,
    );
    expect(d.slides.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(d.slides[1]!.elements[0]!.style).toEqual({ color: '#f00', fontSize: 72 });
    expect(deckElementsAt(d.slides[0]!, 60, 60).map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(summarizeDocument(d)).toContain('2 Folien');
    expect(documentAssetIds(d)).toEqual(new Set(['img1']));
  });

  it('validates element requirements', () => {
    const d = applyDeckOps(createDeck(), [{ op: 'add_slide', slide: { id: 's1', elements: [] } }]);
    expect(() => applyDeckOps(d, [{ op: 'add_element', slideId: 's1', element: { id: 'x', type: 'image', x: 0, y: 0, width: 10, height: 10 } }], ctx)).toThrow(/braucht assetId/);
    expect(() => applyDeckOps(d, [{ op: 'add_element', slideId: 's1', element: { id: 'x', type: 'image', x: 0, y: 0, width: 10, height: 10, assetId: 'vid1' } }], ctx)).toThrow(/Typ "video"/);
    expect(() => applyDeckOps(d, [{ op: 'remove_slide', slideId: 'nope' }])).toThrow(/existiert nicht/);
  });
});

describe('canvas ops', () => {
  it('manages a layer tree', () => {
    let c = createCanvas({ width: 1000, height: 1000 });
    c = applyCanvasOps(
      c,
      [
        { op: 'add_layer', layer: { id: 'bg', type: 'shape', shape: 'rect', x: 0, y: 0, width: 1000, height: 1000 } },
        { op: 'add_layer', layer: { id: 'g1', type: 'group', x: 0, y: 0, width: 1000, height: 1000, children: [] } },
        { op: 'add_layer', parentId: 'g1', layer: { id: 'photo', type: 'image', assetId: 'img1', x: 100, y: 100, width: 300, height: 300 } },
        { op: 'add_layer', parentId: 'g1', layer: { id: 'txt', type: 'text', text: 'COLLAGE', x: 150, y: 150, width: 200, height: 50 } },
        { op: 'update_layer', layerId: 'txt', patch: { style: { color: 'black' }, rotation: -5 } },
      ],
      ctx,
    );
    expect(findLayer(c.layers, 'txt')?.rotation).toBe(-5);
    expect(canvasLayersAt(c, 160, 160).map((l) => l.id)).toEqual(['txt', 'photo', 'bg']);
    c = applyCanvasOps(c, [{ op: 'move_layer', layerId: 'photo', parentId: null, index: 0 }], ctx);
    expect(c.layers[0]!.id).toBe('photo');
    expect(() => applyCanvasOps(c, [{ op: 'move_layer', layerId: 'g1', parentId: 'g1', index: 0 }], ctx)).toThrow(/in sich selbst/);
    expect(() => applyCanvasOps(c, [{ op: 'add_layer', parentId: 'txt', layer: { id: 'z', type: 'text', text: 'a', x: 0, y: 0, width: 1, height: 1 } }], ctx)).toThrow(/keine Gruppe/);
    expect(() => applyCanvasOps(c, [{ op: 'update_layer', layerId: 'txt', patch: { id: 'other' } }], ctx)).toThrow(/id\/children/);
    expect(documentAssetIds(c)).toEqual(new Set(['img1']));
  });
});

describe('site ops', () => {
  it('manages pages and snapshots', () => {
    let s = createSite();
    s = applySiteOps(s, [
      { op: 'add_page', page: { id: 'about', path: '/about', title: 'Über' } },
      { op: 'update_site', patch: { stage: 'code' } },
      { op: 'snapshot_files', files: { 'src/App.tsx': 'abc' } },
    ]);
    expect(s.stage).toBe('code');
    expect(s.files).toEqual({ 'src/App.tsx': 'abc' });
    expect(() => applySiteOps(s, [{ op: 'add_page', page: { id: 'x', path: '/about', title: 'Dup' } }])).toThrow(/schon belegt/);
    expect(parseDataSrc('src/App.tsx:12:5')).toEqual({ file: 'src/App.tsx', line: 12, column: 5 });
    expect(parseDataSrc('garbage')).toBeUndefined();
  });
});

describe('createDocument / applyDocumentOps', () => {
  it('creates per category and dispatches ops', () => {
    expect(createDocument('audio').kind).toBe('timeline');
    expect((createDocument('audio') as Timeline).fps).toBe(1000);
    expect(createDocument('slides').kind).toBe('deck');
    expect(createDocument('graphic').kind).toBe('canvas');
    expect(createDocument('web').kind).toBe('site');
    const deck = applyDocumentOps(createDocument('slides'), [{ op: 'add_slide', slide: { id: 's1', elements: [] } }]);
    expect(deck.kind === 'deck' && deck.slides.length).toBe(1);
  });
});
