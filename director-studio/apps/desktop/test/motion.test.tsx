import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from '../src/renderer/components/common/Toasts.tsx';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

/**
 * Bewegung (DESIGN.md §5, §12): Marker „setzt sich“ im selben Frame, in dem der Chip einsetzt; Toasts blenden aus;
 * alle Übergänge aus der Token-Skala; `prefers-reduced-motion` ohne Wege, Atmen und Blinken.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/styles/app.css'), 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

describe('Marker und Chip (§5)', () => {
  it('ein neuer Marker setzt sich vor dem ersten Zeichnen, sein Chip setzt im selben Frame ein; ältere Chips bleiben ruhig', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    const editor = screen.getByTestId('composer-editor');
    const entering = () => Array.from(editor.querySelectorAll<HTMLElement>('.chip.is-entering'), (c) => c.dataset.refKey);
    act(() => studio.store.getState().addMarkerAt(30));
    expect(entering()).toEqual([studio.store.getState().lastMarkerKey]);
    act(() => fireEvent.animationEnd(editor.querySelector('.chip.is-entering')!));
    expect(entering()).toEqual([]);
    act(() => studio.store.getState().addMarkerAt(90));
    act(() => studio.store.getState().addMarkerAt(150));
    // Nur der jeweils neue Chip setzt ein; die schon vorhandenen (neu aufgebaut) bleiben ruhig
    expect(editor.querySelectorAll('.chip')).toHaveLength(3);
    expect(entering()).toEqual([studio.store.getState().lastMarkerKey]);
    // Der Tag des zuletzt gesetzten Markers „setzt sich“ (Klasse liegt schon nach dem synchronen Rendern an)
    const settling = container.querySelectorAll('.mk.is-settling');
    expect(settling).toHaveLength(1);
    expect(settling[0]!.getAttribute('aria-label')).toMatch(/^Marker 3 bei/);
  });
});

describe('Toasts (§5: Verschwinden 120 ms)', () => {
  it('Schließen blendet aus und entfernt den Toast danach', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    vi.useFakeTimers();
    renderStudio(<Toasts />, studio);
    act(() => studio.store.getState().toast('success', 'Gespeichert'));
    const toast = screen.getByText('Gespeichert').closest('.toast')!;
    fireEvent.click(toast.querySelector('button')!);
    expect(toast).toHaveClass('is-leaving');
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(130));
    expect(screen.queryByText('Gespeichert')).toBeNull();
  });
});

describe('Stylesheet: Bewegung aus der Skala (§12) und reduzierte Bewegung (§5)', () => {
  it('jede transition nutzt die Dauer-Tokens', () => {
    const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim());
    expect(transitions.length).toBeGreaterThan(10);
    const off = transitions.filter((value) => value !== 'none' && value.split(',').some((part) => !/var\(--t-(fast|med|slow)\)/.test(part)));
    expect(off).toEqual([]);
  });

  it('Animationen: Atmen 1,6 s, Blinken 1,05 s im Schritt, Blitz 600 ms, sonst Tokens', () => {
    const animations = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]!.trim()).filter((v) => !v.startsWith('none'));
    const allowed = [/var\(--t-(fast|med|slow)\)/, /^breathe 1\.6s/, /^blink 1\.05s steps\(1\)/, /^[a-z-]*flash 600ms/, /^spin 0\.9s linear/];
    expect(animations.filter((v) => !allowed.some((re) => re.test(v)))).toEqual([]);
  });

  it('prefers-reduced-motion: keine Animationen, Übergänge 1 ms, Spinner als ruhiger Ring, Blitz ohne Ausblenden', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}\n', start));
    expect(block).toContain('animation: none !important');
    expect(block).toContain('transition-duration: 1ms !important');
    expect(block).toMatch(/\.spin \{\s*border-color: var\(--text-3\) !important;/);
    for (const flash of ['chip-flash', 'ref-flash', 'sel-flash', 'tl-flash', 'doc-flash']) expect(block).toContain(`${flash} 600ms steps(1, end)`);
    expect(block).not.toMatch(/breathe|blink|rise-in/);
  });
});
