import { describe, expect, it } from 'vitest';
import {
  applyCanvasOps,
  applyDeckOps,
  applySiteOps,
  applyTimelineOps,
  clipAssetIds,
  createCanvas,
  createDeck,
  createSite,
  createTimeline,
  deckOpSchema,
  documentAssetIds,
  findClip,
  findLayer,
  isAssetPropKey,
  isSafeSitePath,
  siteOpSchema,
  timelineOpSchema,
  type AssetKind,
  type Deck,
  type OpContext,
  type Timeline,
} from '../src/index.ts';

const assets: Record<string, AssetKind> = {
  vid1: 'video',
  vid2: 'video',
  img1: 'image',
  img2: 'image',
  song: 'audio',
  voice: 'audio',
  code1: 'code',
  roto1: 'data',
  logo1: 'image',
  font1: 'font',
};
const ctx: OpContext = { assetKind: (id) => assets[id] };

function baseTimeline(): Timeline {
  return applyTimelineOps(createTimeline({ durationFrames: 0 }), [{ op: 'update_timeline', patch: { durationFrames: 900 } }], ctx);
}

function clipOf(t: Timeline, id: string) {
  const hit = findClip(t, id);
  if (!hit) throw new Error(`Clip ${id} fehlt`);
  return hit.clip;
}

describe('Patch-Schemas injizieren keine Defaults (zod 4)', () => {
  it('update_clip-Patch enthält nur die übergebenen Felder', () => {
    const op = timelineOpSchema.parse({ op: 'update_clip', clipId: 'c1', patch: { name: 'x', transform: { x: 0.1 } } });
    expect(op.op === 'update_clip' && op.patch).toEqual({ name: 'x', transform: { x: 0.1 } });
  });

  it('update_theme- und update_site-Patches enthalten keine Defaults', () => {
    const theme = deckOpSchema.parse({ op: 'update_theme', patch: { name: 'Paper' } });
    expect(theme.op === 'update_theme' && theme.patch).toEqual({ name: 'Paper' });
    const site = siteOpSchema.parse({ op: 'update_site', patch: { stage: 'code' } });
    expect(site.op === 'update_site' && site.patch).toEqual({ stage: 'code' });
  });
});

describe('timeline: update_clip', () => {
  function withClip(): Timeline {
    return applyTimelineOps(
      baseTimeline(),
      [
        {
          op: 'insert_clip',
          trackId: 'V1',
          clip: {
            id: 'c1',
            assetId: 'vid1',
            start: 0,
            duration: 150,
            in: 60,
            speed: 2,
            transform: { fit: 'contain', reframe: { '4:5': { x: 0.4, y: 0.5 } } },
          },
        },
      ],
      ctx,
    );
  }

  it('behält in, speed und transform.fit bei Patches ohne diese Felder', () => {
    let t = withClip();
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { name: 'renamed' } }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { gainDb: -6, opacity: 0.8 } }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { transform: { reframe: { '9:16': { x: 0.6, y: 0.5 } } } } }], ctx);
    const c = clipOf(t, 'c1');
    expect(c.name).toBe('renamed');
    expect(c.in).toBe(60);
    expect(c.speed).toBe(2);
    expect(c.transform?.fit).toBe('contain');
    // reframe wird je Format gemergt, nicht ersetzt
    expect(c.transform?.reframe).toEqual({ '4:5': { x: 0.4, y: 0.5 }, '9:16': { x: 0.6, y: 0.5 } });
  });

  it('null entfernt optionale Felder bzw. setzt Defaults zurück', () => {
    let t = withClip();
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { transform: { reframe: { '4:5': null }, x: 0.25 } } }], ctx);
    expect(clipOf(t, 'c1').transform).toEqual({ fit: 'contain', x: 0.25 });
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { in: null, speed: null, transform: null, gainDb: -3 } }], ctx);
    const c = clipOf(t, 'c1');
    expect(c.in).toBe(0);
    expect(c.speed).toBe(1);
    expect(c.transform).toBeUndefined();
    expect(c.gainDb).toBe(-3);
    t = applyTimelineOps(t, [{ op: 'update_clip', clipId: 'c1', patch: { gainDb: null } }], ctx);
    expect('gainDb' in clipOf(t, 'c1')).toBe(false);
  });

  it('Pflichtfelder lassen sich nicht per null löschen', () => {
    expect(() => applyTimelineOps(withClip(), [{ op: 'update_clip', clipId: 'c1', patch: { start: null } } as never], ctx)).toThrow(/patch\.start/);
  });

  it('componentId: null gibt eine Komponente frei (unregister_component danach möglich)', () => {
    let t = applyTimelineOps(
      baseTimeline(),
      [
        { op: 'register_component', componentId: 'cmp', component: { assetId: 'code1', name: 'PaperRoto' } },
        { op: 'insert_clip', trackId: 'V2', clip: { id: 'o1', componentId: 'cmp', assetId: 'img1', start: 0, duration: 30 } },
      ],
      ctx,
    );
    expect(() => applyTimelineOps(t, [{ op: 'unregister_component', componentId: 'cmp' }], ctx)).toThrow(/noch verwendet/);
    t = applyTimelineOps(
      t,
      [
        { op: 'update_clip', clipId: 'o1', patch: { componentId: null } },
        { op: 'unregister_component', componentId: 'cmp' },
      ],
      ctx,
    );
    expect(clipOf(t, 'o1').componentId).toBeUndefined();
    expect(t.components).toEqual({});
  });
});

describe('timeline: update_track / Ducking', () => {
  it('duck: null entfernt Ducking, danach ist remove_track der Schlüsselspur möglich', () => {
    let t = applyTimelineOps(baseTimeline(), [{ op: 'update_track', trackId: 'A2', patch: { duck: { byTrackId: 'A1', db: -8 } } }], ctx);
    expect(() => applyTimelineOps(t, [{ op: 'remove_track', trackId: 'A1' }], ctx)).toThrow(/Ducking/);
    t = applyTimelineOps(
      t,
      [
        { op: 'update_track', trackId: 'A2', patch: { duck: null } },
        { op: 'remove_track', trackId: 'A1' },
      ],
      ctx,
    );
    expect(t.tracks.find((x) => x.id === 'A2')!.duck).toBeUndefined();
    expect(t.tracks.some((x) => x.id === 'A1')).toBe(false);
  });

  it('duck wird feldweise gemergt und kennt attack/release/lead/mode', () => {
    let t = applyTimelineOps(
      baseTimeline(),
      [{ op: 'update_track', trackId: 'A2', patch: { duck: { byTrackId: 'A1', db: -8, attackMs: 40, releaseMs: 300, leadMs: 120, mode: 'signal' } } }],
      ctx,
    );
    t = applyTimelineOps(t, [{ op: 'update_track', trackId: 'A2', patch: { duck: { db: -12, leadMs: null } } }], ctx);
    expect(t.tracks.find((x) => x.id === 'A2')!.duck).toEqual({ byTrackId: 'A1', db: -12, attackMs: 40, releaseMs: 300, mode: 'signal' });
    expect(() => applyTimelineOps(t, [{ op: 'update_track', trackId: 'A2', patch: { duck: { mode: 'sidechain' } } } as never], ctx)).toThrow();
    expect(() => applyTimelineOps(t, [{ op: 'update_track', trackId: 'A2', patch: { duck: { attackMs: -5 } } }], ctx)).toThrow();
  });

  it('neues Ducking ohne byTrackId/db wird lesbar abgelehnt, Selbst-Ducking ebenso', () => {
    expect(() => applyTimelineOps(baseTimeline(), [{ op: 'update_track', trackId: 'A2', patch: { duck: { db: -6 } } }], ctx)).toThrow(
      /Spur "A2" ist ungültig – duck\.byTrackId/,
    );
    expect(() => applyTimelineOps(baseTimeline(), [{ op: 'update_track', trackId: 'A2', patch: { duck: { byTrackId: 'A2', db: -6 } } }], ctx)).toThrow(
      /selbst ducken/,
    );
  });

  it('update_track lässt nicht genannte Felder unverändert und löscht per null', () => {
    let t = applyTimelineOps(baseTimeline(), [{ op: 'update_track', trackId: 'A2', patch: { gainDb: -4, muted: true } }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_track', trackId: 'A2', patch: { name: 'Score', role: null } }], ctx);
    const a2 = t.tracks.find((x) => x.id === 'A2')!;
    expect(a2).toMatchObject({ name: 'Score', gainDb: -4, muted: true, kind: 'audio' });
    expect(a2.role).toBeUndefined();
  });
});

describe('timeline: add_track prüft mitgebrachte Clips', () => {
  it('lehnt falsche Asset-Arten, unbekannte Assets und fehlende assetIds ab', () => {
    const t = baseTimeline();
    const add = (clips: unknown[]) => applyTimelineOps(t, [{ op: 'add_track', track: { id: 'V3', kind: 'video', clips } } as never], ctx);
    expect(() => add([{ id: 'x', assetId: 'song', start: 0, duration: 10 }])).toThrow(/Typ "audio"/);
    expect(() => add([{ id: 'x', assetId: 'nope', start: 0, duration: 10 }])).toThrow(/existiert nicht/);
    expect(() => add([{ id: 'x', start: 0, duration: 10 }])).toThrow(/braucht assetId/);
  });

  it('sortiert die Clips nach Start', () => {
    const t = applyTimelineOps(
      baseTimeline(),
      [
        {
          op: 'add_track',
          track: {
            id: 'V3',
            kind: 'video',
            clips: [
              { id: 'x', assetId: 'vid1', start: 50, duration: 10 },
              { id: 'y', assetId: 'vid2', start: 0, duration: 10 },
            ],
          },
        },
      ],
      ctx,
    );
    expect(t.tracks.find((x) => x.id === 'V3')!.clips.map((c) => c.id)).toEqual(['y', 'x']);
  });
});

describe('timeline: Asset-Referenzen in Clip-Props', () => {
  it('erkennt Asset-Schlüssel nach Konvention', () => {
    expect(['rotoscope', 'logoAsset', 'maskAssetId', 'asset', 'assetId'].every(isAssetPropKey)).toBe(true);
    expect(['title', 'color', 'assets', 'rotoscopeMode'].some(isAssetPropKey)).toBe(false);
  });

  it('validiert props-Referenzen und zählt sie in documentAssetIds', () => {
    const t = applyTimelineOps(
      baseTimeline(),
      [
        { op: 'register_component', componentId: 'cmp', component: { assetId: 'code1', name: 'PaperRoto' } },
        {
          op: 'insert_clip',
          trackId: 'V2',
          clip: { id: 'ov', componentId: 'cmp', start: 0, duration: 30, props: { rotoscope: 'roto1', logoAsset: 'logo1', title: 'img2' } },
        },
        {
          op: 'insert_clip',
          trackId: 'V1',
          clip: { id: 'c1', assetId: 'vid1', start: 0, duration: 30, transitionIn: { type: 'component', componentId: 'cmp', durationFrames: 10, props: { maskAssetId: 'img1' } } },
        },
      ],
      ctx,
    );
    expect(clipAssetIds(clipOf(t, 'ov'))).toEqual(['roto1', 'logo1']);
    expect(documentAssetIds(t)).toEqual(new Set(['roto1', 'logo1', 'vid1', 'img1', 'code1']));
    expect(() =>
      applyTimelineOps(t, [{ op: 'update_clip', clipId: 'ov', patch: { props: { rotoscope: 'ast_tippfehler' } } }], ctx),
    ).toThrow(/Asset "ast_tippfehler" \(props\.rotoscope\) existiert nicht/);
    expect(() =>
      applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'T1', clip: { id: 't9', text: 'a', start: 0, duration: 10, props: { bgAssetId: 'nope' } } }], ctx),
    ).toThrow(/props\.bgAssetId/);
    expect(() =>
      applyTimelineOps(t, [{ op: 'add_track', track: { id: 'V9', kind: 'overlay', clips: [{ id: 'z', assetId: 'img1', start: 0, duration: 5, props: { rotoscope: 'nope' } }] } }], ctx),
    ).toThrow(/props\.rotoscope/);
  });
});

describe('timeline: Fade-Kurve und Originalton', () => {
  it('akzeptiert fadeCurve und includeSourceAudio auf Videospuren', () => {
    const t = applyTimelineOps(
      baseTimeline(),
      [
        { op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'vid1', start: 0, duration: 60, includeSourceAudio: true, fadeInFrames: 10, fadeCurve: 'equal-power' } },
        { op: 'insert_clip', trackId: 'A2', clip: { id: 'a1', assetId: 'song', start: 0, duration: 60, fadeOutFrames: 15, fadeCurve: 'linear' } },
      ],
      ctx,
    );
    expect(clipOf(t, 'c1')).toMatchObject({ includeSourceAudio: true, fadeCurve: 'equal-power' });
    expect(clipOf(t, 'a1').fadeCurve).toBe('linear');
  });

  it('lehnt ungültige Kurven, includeSourceAudio außerhalb von Videospuren und bei Bildern ab', () => {
    const t = baseTimeline();
    expect(() =>
      applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'A2', clip: { id: 'a1', assetId: 'song', start: 0, duration: 60, fadeCurve: 'log' } } as never], ctx),
    ).toThrow();
    expect(() =>
      applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'A2', clip: { id: 'a1', assetId: 'vid1', start: 0, duration: 60, includeSourceAudio: true } }], ctx),
    ).toThrow(/nur für Clips auf Videospuren/);
    expect(() =>
      applyTimelineOps(t, [{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: 'img1', start: 0, duration: 60, includeSourceAudio: true } }], ctx),
    ).toThrow(/ist ein Bild/);
  });
});

describe('timeline: update_timeline', () => {
  it('lässt Formate unverändert und entfernt backgroundColor per null', () => {
    let t = applyTimelineOps(createTimeline(), [{ op: 'update_timeline', patch: { backgroundColor: '#000', formats: [{ id: '9:16', width: 1080, height: 1920 }] } }], ctx);
    t = applyTimelineOps(t, [{ op: 'update_timeline', patch: { durationFrames: 300 } }], ctx);
    expect(t.formats.map((f) => f.id)).toEqual(['9:16']);
    expect(t.backgroundColor).toBe('#000');
    t = applyTimelineOps(t, [{ op: 'update_timeline', patch: { backgroundColor: null } }], ctx);
    expect('backgroundColor' in t).toBe(false);
  });
});

describe('deck: update_theme', () => {
  it('behält eigene Schriften, wenn der Patch fonts nicht nennt', () => {
    let d = applyDeckOps(createDeck(), [{ op: 'update_theme', patch: { fonts: { heading: 'Lora', body: 'Lora' } } }], ctx);
    d = applyDeckOps(d, [{ op: 'update_theme', patch: { name: 'Paper' } }], ctx);
    d = applyDeckOps(d, [{ op: 'update_theme', patch: { css: '.x{}' } }], ctx);
    expect(d.theme.fonts).toEqual({ heading: 'Lora', body: 'Lora' });
    expect(d.theme.name).toBe('Paper');
    d = applyDeckOps(d, [{ op: 'update_theme', patch: { fonts: { heading: 'Space Grotesk' } } }], ctx);
    expect(d.theme.fonts).toEqual({ heading: 'Space Grotesk', body: 'Lora' });
  });

  it('mergt Farben schlüsselweise, null löscht', () => {
    let d = applyDeckOps(createDeck(), [{ op: 'update_theme', patch: { colors: { accent: '#f50', text: '#111' }, background: '#fff' } }], ctx);
    d = applyDeckOps(d, [{ op: 'update_theme', patch: { colors: { accent: null, muted: '#888' }, background: null } }], ctx);
    expect(d.theme.colors).toEqual({ text: '#111', muted: '#888' });
    expect(d.theme.background).toBeUndefined();
  });

  it('fontAssets: Font-Assets werden geprüft, gezählt und per null entfernt', () => {
    let d = applyDeckOps(createDeck(), [{ op: 'update_theme', patch: { fonts: { heading: 'Brand Sans', body: 'Inter' }, fontAssets: { 'Brand Sans': 'font1' } } }], ctx);
    expect(d.theme.fontAssets).toEqual({ 'Brand Sans': 'font1' });
    expect(documentAssetIds(d)).toEqual(new Set(['font1']));
    expect(() => applyDeckOps(d, [{ op: 'update_theme', patch: { fontAssets: { Other: 'img1' } } }], ctx)).toThrow(/Typ "image"/);
    expect(() => applyDeckOps(d, [{ op: 'update_theme', patch: { fontAssets: { Other: 'nope' } } }], ctx)).toThrow(/existiert nicht/);
    d = applyDeckOps(d, [{ op: 'update_theme', patch: { fontAssets: { 'Brand Sans': null } } }], ctx);
    expect(d.theme.fontAssets).toBeUndefined();
  });
});

describe('deck: Folien und Elemente', () => {
  function deckWithSlide(): Deck {
    return applyDeckOps(
      createDeck(),
      [
        {
          op: 'add_slide',
          slide: {
            id: 's1',
            background: { assetId: 'img1' },
            notes: 'n',
            elements: [{ id: 'e1', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'Hi', build: 1, style: { role: 'title', color: '#f00' } }],
          },
        },
      ],
      ctx,
    );
  }

  it('add_slide prüft das Hintergrund-Asset', () => {
    expect(() => applyDeckOps(createDeck(), [{ op: 'add_slide', slide: { id: 's1', background: { assetId: 'song' } } }], ctx)).toThrow(/Typ "audio"/);
    expect(() => applyDeckOps(createDeck(), [{ op: 'add_slide', slide: { id: 's1', background: { assetId: 'nope' } } }], ctx)).toThrow(/existiert nicht/);
    expect(deckWithSlide().slides[0]!.background).toEqual({ assetId: 'img1' });
  });

  it('update_slide löscht optionale Felder per null und lässt Elemente unverändert', () => {
    const d = applyDeckOps(deckWithSlide(), [{ op: 'update_slide', slideId: 's1', patch: { background: null, title: 'Neu', notes: null } }], ctx);
    const s = d.slides[0]!;
    expect(s.background).toBeUndefined();
    expect(s.notes).toBeUndefined();
    expect(s.title).toBe('Neu');
    expect(s.elements).toHaveLength(1);
    expect(() => applyDeckOps(d, [{ op: 'update_slide', slideId: 's1', patch: { background: { assetId: 'song' } } }], ctx)).toThrow(/Typ "audio"/);
  });

  it('update_element: null löscht Felder und einzelne Stil-Schlüssel', () => {
    const d = applyDeckOps(deckWithSlide(), [{ op: 'update_element', slideId: 's1', elementId: 'e1', patch: { build: null, style: { color: null, fontSize: 64 } } }], ctx);
    const e = d.slides[0]!.elements[0]!;
    expect(e.build).toBeUndefined();
    expect(e.style).toEqual({ role: 'title', fontSize: 64 });
    expect(() => applyDeckOps(d, [{ op: 'update_element', slideId: 's1', elementId: 'e1', patch: { x: null } } as never], ctx)).toThrow(/patch\.x/);
  });

  it('style.role muss eine bekannte Rolle sein', () => {
    const d = deckWithSlide();
    expect(() => applyDeckOps(d, [{ op: 'update_element', slideId: 's1', elementId: 'e1', patch: { style: { role: 'headline' } } }], ctx)).toThrow(/style\.role "headline"/);
    const ok = applyDeckOps(d, [{ op: 'update_element', slideId: 's1', elementId: 'e1', patch: { style: { role: 'kicker' } } }], ctx);
    expect(ok.slides[0]!.elements[0]!.style?.role).toBe('kicker');
  });
});

describe('canvas: update_layer', () => {
  function canvas() {
    return applyCanvasOps(
      createCanvas({ width: 1000, height: 1000, background: 'linear-gradient(180deg, #fff, #eee)' }),
      [{ op: 'add_layer', layer: { id: 't', type: 'text', text: 'A', x: 0, y: 0, width: 100, height: 40, rotation: 5, style: { color: 'black', fontSize: 30 } } }],
      ctx,
    );
  }

  it('lehnt Stil-Strings und -Zahlen lesbar ab statt den Stil zu zerstören', () => {
    const c = canvas();
    expect(c.background).toBe('linear-gradient(180deg, #fff, #eee)');
    expect(() => applyCanvasOps(c, [{ op: 'update_layer', layerId: 't', patch: { style: 'color: red' } }], ctx)).toThrow(/style ist ungültig/);
    expect(() => applyCanvasOps(c, [{ op: 'update_layer', layerId: 't', patch: { style: 5 } }], ctx)).toThrow(/style ist ungültig/);
    expect(findLayer(c.layers, 't')!.style).toEqual({ color: 'black', fontSize: 30 });
  });

  it('null löscht einzelne Stil-Schlüssel, den ganzen Stil oder optionale Felder', () => {
    let c = applyCanvasOps(canvas(), [{ op: 'update_layer', layerId: 't', patch: { style: { color: null, fontWeight: 700 }, rotation: null } }], ctx);
    let t = findLayer(c.layers, 't')!;
    expect(t.style).toEqual({ fontSize: 30, fontWeight: 700 });
    expect(t.rotation).toBeUndefined();
    c = applyCanvasOps(c, [{ op: 'update_layer', layerId: 't', patch: { style: null } }], ctx);
    t = findLayer(c.layers, 't')!;
    expect(t.style).toBeUndefined();
  });

  it('Pflichtfelder: lesbarer Fehler statt ZodError-JSON', () => {
    expect(() => applyCanvasOps(canvas(), [{ op: 'update_layer', layerId: 't', patch: { x: null } }], ctx)).toThrow(/Ebene "t" ist ungültig – x:/);
  });

  it('style.maskMode muss alpha oder luminance sein', () => {
    const c = applyCanvasOps(
      canvas(),
      [{ op: 'add_layer', layer: { id: 'p', type: 'image', assetId: 'img1', maskAssetId: 'img2', x: 0, y: 0, width: 10, height: 10, style: { maskMode: 'alpha' } } }],
      ctx,
    );
    expect(findLayer(c.layers, 'p')!.style).toEqual({ maskMode: 'alpha' });
    expect(() => applyCanvasOps(c, [{ op: 'update_layer', layerId: 'p', patch: { style: { maskMode: 'invert' } } }], ctx)).toThrow(/maskMode "invert"/);
  });
});

describe('site: update_site / Seiten / Snapshot', () => {
  it('update_site setzt framework, stage und outputDir nicht auf Defaults zurück', () => {
    let s = createSite({ framework: 'html' });
    s = applySiteOps(s, [{ op: 'update_site', patch: { outputDir: 'build' } }], ctx);
    s = applySiteOps(s, [{ op: 'update_site', patch: { stage: 'code' } }], ctx);
    expect(s).toMatchObject({ framework: 'html', stage: 'code', outputDir: 'build' });
    s = applySiteOps(s, [{ op: 'update_site', patch: { devCommand: 'npm run dev', buildCommand: 'npm run build' } }], ctx);
    expect(s).toMatchObject({ framework: 'html', stage: 'code', outputDir: 'build', devCommand: 'npm run dev' });
    s = applySiteOps(s, [{ op: 'update_site', patch: { devCommand: null, outputDir: null } }], ctx);
    expect(s.devCommand).toBeUndefined();
    expect(s.outputDir).toBe('dist');
    expect(s.buildCommand).toBe('npm run build');
  });

  it('prüft Mockup-Assets bei add_page und update_page', () => {
    const s = createSite();
    expect(() => applySiteOps(s, [{ op: 'add_page', page: { id: 'a', path: '/a', title: 'A', mockups: { mobile: 'song' } } }], ctx)).toThrow(/Mockup mobile.*Typ "audio"/);
    expect(() => applySiteOps(s, [{ op: 'update_page', pageId: 'home', patch: { mockups: { desktop: 'nope' } } }], ctx)).toThrow(/Mockup desktop.*existiert nicht/);
  });

  it('mergt Mockups je Viewport und löscht per null', () => {
    let s = applySiteOps(createSite(), [{ op: 'update_page', pageId: 'home', patch: { mockups: { desktop: 'img1' }, sourceFile: 'src/App.tsx' } }], ctx);
    s = applySiteOps(s, [{ op: 'update_page', pageId: 'home', patch: { mockups: { mobile: 'img2' } } }], ctx);
    expect(s.pages[0]!.mockups).toEqual({ desktop: 'img1', mobile: 'img2' });
    expect(documentAssetIds(s)).toEqual(new Set(['img1', 'img2']));
    s = applySiteOps(s, [{ op: 'update_page', pageId: 'home', patch: { mockups: { desktop: null }, sourceFile: null } }], ctx);
    expect(s.pages[0]!.mockups).toEqual({ mobile: 'img2' });
    expect(s.pages[0]!.sourceFile).toBeUndefined();
    expect(s.pages[0]!.title).toBe('Start');
  });

  it('snapshot_files ersetzt den Datei-Snapshot vollständig und lehnt Pfade außerhalb von site/ ab', () => {
    let s = applySiteOps(createSite(), [{ op: 'snapshot_files', files: { 'src/App.tsx': 'h1', 'index.html': 'h2' } }], ctx);
    s = applySiteOps(s, [{ op: 'snapshot_files', files: { 'src/App.tsx': 'h3' } }], ctx);
    expect(s.files).toEqual({ 'src/App.tsx': 'h3' });
    for (const bad of ['../evil.js', '/etc/passwd', 'src/../../x', 'C:/x', 'a\\b', 'src//a', './a']) {
      expect(isSafeSitePath(bad)).toBe(false);
      expect(() => applySiteOps(s, [{ op: 'snapshot_files', files: { [bad]: 'h' } }], ctx)).toThrow();
    }
    expect(isSafeSitePath('src/pages/Home.tsx')).toBe(true);
  });
});
