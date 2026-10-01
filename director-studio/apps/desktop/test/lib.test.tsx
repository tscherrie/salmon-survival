import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComposerSegment, Ref } from '@studio/core';
import { displayText, labelContextFor, refChipLabel, refChipParts } from '../src/renderer/lib/labels.ts';
import { isNumbered, isPageRef, reconcileRefNumbers, refKey } from '../src/renderer/lib/refNumbers.ts';
import { formatTc, tcParts } from '../src/renderer/lib/timecode.ts';
import { Markdown, parseMarkdownBlocks } from '../src/renderer/lib/markdown.tsx';
import { beatFrames, fitZoom, formatRulerLabel, rulerSteps, snapToBeat, visibleFrames, xToFrame, frameToX, TIMELINE_PAD } from '../src/renderer/lib/timelineGeometry.ts';
import { lineageOf, assetUiStatus } from '../src/renderer/lib/assets.ts';
import { setLanguage, t } from '../src/renderer/i18n.ts';
import { waveformPath } from '../src/renderer/lib/hooks.ts';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { DEMO_VIDEO_PATH } from '../src/renderer/fake/demoProjects.ts';

describe('Markdown', () => {
  it('rendert Absätze, Überschriften, Listen, Code, fett/kursiv und sichere Links', () => {
    const onLink = vi.fn();
    render(<Markdown text={'## Plan\n\nDas ist **wichtig** und *leise*, siehe `code`.\n\n- eins\n- zwei\n\n1. a\n2. b\n\n[Quelle](https://example.com) [böse](javascript:alert(1))'} onLink={onLink} />);
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByText('wichtig').tagName).toBe('STRONG');
    expect(screen.getByText('leise').tagName).toBe('EM');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getAllByRole('list')).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: 'Quelle' }));
    expect(onLink).toHaveBeenCalledWith('https://example.com');
    expect(screen.queryByRole('link', { name: 'böse' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('javascript:');
  });

  it('macht Timecodes anklickbar (ohne Handler: reiner Text)', () => {
    const onTimecode = vi.fn();
    const { rerender } = render(<Markdown text="Refrain ab 00:24.000 und 1:02:05.5 – nicht 2026" onTimecode={onTimecode} timecodeLabel={(tc) => `Zu ${tc}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zu 00:24.000' }));
    expect(onTimecode).toHaveBeenCalledWith(24);
    fireEvent.click(screen.getByRole('button', { name: 'Zu 1:02:05.5' }));
    expect(onTimecode).toHaveBeenLastCalledWith(3725.5);
    rerender(<Markdown text="Refrain ab 00:24.000" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(parseMarkdownBlocks('```\nx\n```')).toEqual([{ type: 'code', text: 'x' }]);
  });
});

describe('Timeline-Geometrie', () => {
  it('rechnet Frames und Pixel hin und zurück', () => {
    expect(frameToX(30, 30, 100)).toBe(TIMELINE_PAD + 100);
    expect(xToFrame(TIMELINE_PAD + 100, 30, 100)).toBe(30);
    expect(xToFrame(0, 30, 100)).toBe(0);
    expect(fitZoom({ durationFrames: 1800, fps: 30 }, 616)).toBeCloseTo(10);
  });

  it('wählt ein lesbares Lineal-Raster', () => {
    expect(rulerSteps(50)).toEqual({ major: 2, minor: 0.5 });
    expect(rulerSteps(5).major).toBe(30);
    expect(formatRulerLabel(65, 5)).toBe('1:05');
    expect(formatRulerLabel(1.5, 0.5)).toBe('0:01.5');
  });

  it('snapt nur innerhalb der Toleranz und begrenzt den Sichtbereich', () => {
    const beats = beatFrames([
      { id: 'a', frame: 30, kind: 'beat' },
      { id: 'b', frame: 45, kind: 'downbeat' },
      { id: 'c', frame: 50, kind: 'section' },
    ]);
    expect(beats).toEqual([30, 45]);
    expect(snapToBeat(37, beats, 30, 50)).toBe(30);
    expect(snapToBeat(40, beats, 30, 200)).toBe(40); // 12 px bei 200 px/s ≈ 1,8 Frames
    expect(visibleFrames(0, 0, 30, 50, 1800)).toEqual([0, 1800]);
    const [from, to] = visibleFrames(1000, 500, 30, 50, 1800);
    expect(from).toBeLessThan(xToFrame(1000, 30, 50));
    expect(to).toBeGreaterThan(xToFrame(1500, 30, 50));
  });

  it('erzeugt Wellenform-Pfade aus min/max-Paaren', () => {
    const d = waveformPath([-0.5, 0.5, -1, 1, -0.2, 0.2, -0.1, 0.1], 400, 0, 400, 100, 20);
    expect(d.startsWith('M0,10')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(waveformPath([], 0, 0, 1, 10, 10)).toBe('');
  });
});

describe('Beschriftungen, Status, Herkunft, i18n', () => {
  it('Referenz-Beschriftungen nutzen Namen aus Dokument und Assets', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.openProject(DEMO_VIDEO_PATH);
    const ctx = labelContextFor(snap.document, snap.assets);
    expect(ctx.names?.c_sb04).toBe('Refrain: Lichter');
    expect(ctx.names?.V1).toBe('Video');
    expect(ctx.names?.sec_3).toBe('Refrain 1');
    expect(ctx.names?.ast_char_mira).toBe('Mira – Charakterblatt v3');
    const used = new Set(snap.usedAssetIds);
    expect(assetUiStatus(snap.assets.find((a) => a.id === 'ast_clip_rejected')!, used)).toBe('rejected');
    const mira = snap.assets.find((a) => a.id === 'ast_char_mira')!;
    expect(lineageOf(mira, snap.assets, snap.generations).children).toHaveLength(6);
    const vocals = snap.assets.find((a) => a.id === 'ast_vocals')!;
    expect(lineageOf(vocals, snap.assets, snap.generations).parents).toEqual(['ast_song']);
  });

  it('übersetzt mit Platzhaltern und wechselt die Sprache', () => {
    expect(t('versions.viewingBanner', { number: 12 })).toBe('Ältere Version v12 – nur Ansicht');
    setLanguage('en');
    expect(t('versions.viewingBanner', { number: 12 })).toBe('Older version v12 – view only');
    setLanguage('de');
  });
});

const ref = (r: Ref): ComposerSegment => ({ type: 'ref', ref: r });
const text = (value: string): ComposerSegment => ({ type: 'text', text: value });
const time = (frame: number): ComposerSegment => ref({ kind: 'time', frame });

describe('Nummernvergabe (DESIGN.md §9.3)', () => {
  it('vergibt in Reihenfolge des Auftretens die kleinste freie Nummer und verwendet Lücken wieder', () => {
    const first = reconcileRefNumbers({}, [time(10), text(' und '), time(20), ref({ kind: 'clip', clipId: 'c1' })]);
    expect(first).toEqual({ 'time:10': 1, 'time:20': 2, 'clip:c1': 3 });
    // Marker 1 entfernt: 2 und 3 bleiben, der neue Marker bekommt die freie 1
    const second = reconcileRefNumbers(first, [time(20), ref({ kind: 'clip', clipId: 'c1' }), time(30)]);
    expect(second).toEqual({ 'time:20': 2, 'clip:c1': 3, 'time:30': 1 });
    // Danach geht es mit der nächsten freien Nummer weiter
    expect(reconcileRefNumbers(second, [time(20), ref({ kind: 'clip', clipId: 'c1' }), time(30), time(40)])['time:40']).toBe(4);
  });

  it('hält die Nummern stabil, wenn Text oder Chips umgestellt werden', () => {
    const numbers = reconcileRefNumbers({}, [text('Erst '), time(10), text(' dann '), time(20)]);
    const moved = reconcileRefNumbers(numbers, [time(20), text(' vor '), time(10), text(' – neu formuliert')]);
    expect(moved).toEqual({ 'time:10': 1, 'time:20': 2 });
    // Unverändert: dieselbe Referenz (stabil für Selektoren)
    expect(moved).toBe(numbers);
  });

  it('gleiche Frames teilen sich eine Nummer; Assets und Versionen bleiben ohne', () => {
    const numbers = reconcileRefNumbers({}, [time(372), ref({ kind: 'asset', assetId: 'a1' }), time(372), ref({ kind: 'version', versionNumber: 2 }), time(400)]);
    expect(numbers).toEqual({ 'time:372': 1, 'time:400': 2 });
    expect(isNumbered({ kind: 'asset', assetId: 'a1' })).toBe(false);
    expect(isNumbered({ kind: 'version', versionNumber: 2 })).toBe(false);
    expect(isNumbered({ kind: 'slide', slideId: 's1' })).toBe(true);
  });

  it('Senden (leerer Composer) setzt die Nummern zurück', () => {
    expect(reconcileRefNumbers({ 'time:10': 1, 'time:20': 2 }, [])).toEqual({});
    expect(reconcileRefNumbers({ 'time:10': 2 }, [time(30)])).toEqual({ 'time:30': 1 });
  });

  it('bildet Schlüssel nach dem, worauf gezeigt wird', () => {
    expect(refKey({ kind: 'time', frame: 372 })).toBe('time:372');
    expect(refKey({ kind: 'clip', clipId: 'c12', trackId: 'V1' })).toBe('clip:c12');
    expect(refKey({ kind: 'marker', markerId: 'm3' })).toBe('marker:m3');
    expect(refKey({ kind: 'slide', slideId: 's3' })).toBe('slide:s3');
    expect(refKey({ kind: 'asset', assetId: 'ast_1' })).toBe('asset:ast_1');
    const page: Ref = { kind: 'element', doc: 'site', page: '/karte', selector: 'body', source: { file: 'src/pages/Menu.tsx', line: 1 } };
    expect(isPageRef(page)).toBe(true);
    expect(refKey(page)).toBe('page:/karte');
    // Elemente zählen nach ihrer Identität, nicht nach Rahmen (anderer Viewport = dieselbe Referenz)
    const a: Ref = { kind: 'element', doc: 'site', page: '/', elementId: 'hero', bbox: { x: 0, y: 0, width: 400, height: 80 } };
    const b: Ref = { kind: 'element', doc: 'site', page: '/', elementId: 'hero', bbox: { x: 0, y: 0, width: 300, height: 120 } };
    expect(refKey(a)).toBe(refKey(b));
    expect(refKey({ kind: 'region', doc: 'deck', slideId: 's1', rect: { x: 1, y: 2, width: 3, height: 4 } })).toBe(
      'region:{"doc":"deck","rect":{"height":4,"width":3,"x":1,"y":2},"slideId":"s1"}',
    );
  });
});

describe('Timecode (DESIGN.md §9.2)', () => {
  it('formatiert smpte, short und ruler; Frames getrennt', () => {
    expect(tcParts(372, 30, 'short')).toEqual({ head: '00:12', frames: ':12' });
    expect(formatTc(372, 30, 'smpte')).toBe('00:00:12:12');
    expect(formatTc(30 * 3600 + 45, 30, 'short')).toBe('01:00:01:15');
    expect(formatTc(25 * 65, 25, 'ruler')).toBe('1:05');
    // Frames im Lineal erst, wenn ein Frame mindestens 8 px breit ist
    expect(formatTc(25 * 65 + 3, 25, 'ruler', { pps: 199 })).toBe('1:05');
    expect(formatTc(25 * 65 + 3, 25, 'ruler', { pps: 200 })).toBe('1:05:03');
  });

  it('nutzt Drop-Frame bei 29,97 und 59,94 fps', () => {
    expect(formatTc(1800, 29.97, 'smpte')).toBe('00:01:00;02');
    expect(formatTc(17982, 29.97, 'smpte')).toBe('00:10:00;00');
    expect(tcParts(3600, 59.94, 'short').frames).toBe(';04');
  });

  it('zeigt bei Millisekunden-Zeitbasis (Audio, 1000 fps) Millisekunden', () => {
    expect(formatTc(12_400, 1000, 'short')).toBe('00:12.400');
  });
});

describe('Chip-Teile ohne Emoji (DESIGN.md §9.1)', () => {
  it('liefert Icon, Text und gedämpften Zusatz je Referenzart', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.openProject(DEMO_VIDEO_PATH);
    const ctx = labelContextFor(snap.document, snap.assets);
    expect(refChipParts({ kind: 'time', frame: 372 }, ctx)).toEqual({ icon: null, text: '00:12', secondary: ':12', mono: true });
    expect(refChipParts({ kind: 'clip', clipId: 'c_sb03' }, ctx)).toEqual({ icon: 'film', text: 'Strophe: Tunnel' });
    expect(refChipParts({ kind: 'marker', markerId: 'sec_3' }, ctx)).toEqual({ icon: 'marker', text: 'Refrain 1' });
    expect(refChipParts({ kind: 'asset', assetId: 'ast_char_mira' }, ctx)).toEqual({ icon: 'image', thumbAssetId: 'ast_char_mira', text: 'Mira – Charakterblatt v3' });
    expect(refChipParts({ kind: 'asset', assetId: 'ast_song' }, ctx)).toEqual({ icon: 'audio', text: snap.assets.find((a) => a.id === 'ast_song')!.title });
    expect(refChipParts({ kind: 'slide', slideId: 's3' }, { slideNumbers: { s3: 3 } })).toEqual({ icon: 'slides', text: 'Folie 3' });
    expect(refChipParts({ kind: 'element', doc: 'site', page: '/karte', selector: 'body' }, ctx)).toEqual({ icon: 'web', text: '/karte', mono: true });
    expect(refChipParts({ kind: 'region', doc: 'deck', slideId: 's3', rect: { x: 10, y: 20, width: 420.4, height: 180 } }, { slideNumbers: { s3: 3 } })).toEqual({
      icon: 'region',
      text: 'Folie 3 · 420×180',
    });
    const all: Ref[] = [
      { kind: 'time', frame: 0 },
      { kind: 'range', from: 0, to: 30, trackId: 'V1' },
      { kind: 'clip', clipId: 'c_sb01' },
      { kind: 'marker', markerId: 'sec_1' },
      { kind: 'asset', assetId: 'ast_char_mira' },
      { kind: 'slide', slideId: 'x' },
      { kind: 'element', doc: 'canvas', elementId: 'l1' },
      { kind: 'region', doc: 'timeline', frame: 30, rect: { x: 0, y: 0, width: 10, height: 10 } },
      { kind: 'version', versionNumber: 3 },
    ];
    for (const r of all) expect([...refChipLabel(r, ctx)].filter((c) => c.codePointAt(0)! >= 0x1f000 || c === '⏱' || c === '◳' || c === '⬚')).toEqual([]);
  });

  it('displayText setzt Chips als Beschriftung in den Text (Warteschlange, Ansagen)', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.openProject(DEMO_VIDEO_PATH);
    const ctx = labelContextFor(snap.document, snap.assets);
    expect(displayText([text('Bei '), time(372), text(' weicher, wie '), ref({ kind: 'asset', assetId: 'ast_char_mira' })], ctx)).toBe(
      'Bei 00:12:12 weicher, wie Mira – Charakterblatt v3',
    );
  });
});
