import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { labelContextFor } from '../src/renderer/lib/labels.ts';
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
