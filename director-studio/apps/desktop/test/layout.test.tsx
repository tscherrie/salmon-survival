import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createTimeline, type Timeline } from '@studio/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Workspace } from '../src/renderer/components/workspace/Workspace.tsx';
import {
  DEFAULT_STORED_LAYOUT,
  LAYOUT_KEY,
  breakpointFor,
  readStoredLayout,
  resolveLayout,
  stageContentHeight,
  trackHeights,
  type StoredLayout,
} from '../src/renderer/lib/layout.ts';
import { DEMO_DECK_PATH, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

/** Arbeitsbereich-Layout (DESIGN.md §2.2–2.5, §10, §13.4; Test-Vertrag §15). */

function setViewport(width: number, height: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => setViewport(1440, 900));

function vars(): Record<string, string> {
  const el = document.querySelector<HTMLElement>('.workspace');
  if (!el) throw new Error('Arbeitsbereich fehlt');
  return Object.fromEntries(['--side-l', '--side-r', '--stage-h', '--index-w'].map((v) => [v, el.style.getPropertyValue(v)]));
}

function stored(): Partial<StoredLayout> {
  return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<StoredLayout>;
}

function press(code: string) {
  fireEvent.keyDown(window, { key: code.replace('Digit', ''), code, ctrlKey: true });
}

/** Timeline wie im Referenzbild: V1, V2, T1, A1–A3 (Stimme, Musik, SFX) und Abschnitts-Marker. */
function referenceTimeline(): Timeline {
  const tl = createTimeline({ fps: 25 });
  return {
    ...tl,
    tracks: [
      { id: 'V1', kind: 'video', clips: [] },
      { id: 'V2', kind: 'overlay', clips: [] },
      { id: 'T1', kind: 'text', clips: [] },
      { id: 'A1', kind: 'audio', role: 'voice', clips: [] },
      { id: 'A2', kind: 'audio', role: 'music', clips: [] },
      { id: 'A3', kind: 'audio', role: 'sfx', clips: [] },
    ],
    markers: [{ id: 's1', frame: 0, kind: 'section', label: 'Intro' }],
  } as Timeline;
}

describe('Layout-Modell (lib/layout.ts)', () => {
  it('Breakpoints und Standardmaße nach §2.3', () => {
    expect(breakpointFor(1280)).toBe('compact');
    expect(breakpointFor(1360)).toBe('compact');
    expect(breakpointFor(1440)).toBe('standard');
    expect(breakpointFor(1920)).toBe('wide');
    const at = (width: number, height: number) => resolveLayout(DEFAULT_STORED_LAYOUT, { viewport: { width, height }, category: 'video', doc: referenceTimeline() });
    expect(at(1280, 800)).toMatchObject({ sideL: 240, sideR: 328, indexW: 240 });
    expect(at(1440, 900)).toMatchObject({ sideL: 272, sideR: 368, indexW: 272 });
    expect(at(1920, 1080)).toMatchObject({ sideL: 304, sideR: 420 });
    expect(trackHeights('compact', 800)).toEqual({ video: 34, overlay: 18, text: 18, voice: 26, music: 30, sfx: 20 });
    expect(trackHeights('standard', 900)).toEqual({ video: 40, overlay: 20, text: 20, voice: 30, music: 34, sfx: 22 });
  });

  it('Bühnenhöhe nach Inhalt (§2.3/§2.4): 244 / 264 / 290 px für die Referenz-Timeline, höchstens 40 % der Höhe', () => {
    const doc = referenceTimeline();
    expect(stageContentHeight(doc, { bp: 'compact', viewportHeight: 800 })).toBe(244);
    expect(stageContentHeight(doc, { bp: 'standard', viewportHeight: 900 })).toBe(264);
    expect(stageContentHeight(doc, { bp: 'wide', viewportHeight: 1080 })).toBe(290);
    expect(resolveLayout(DEFAULT_STORED_LAYOUT, { viewport: { width: 1440, height: 600 }, category: 'video', doc }).stageOpenH).toBe(240);
    // Folien 16:9: 32 + 12 + 83 + 22 + 12; Web: 221
    expect(stageContentHeight({ kind: 'deck', width: 1920, height: 1080 } as never, { bp: 'standard', viewportHeight: 900 })).toBe(161);
    expect(stageContentHeight({ kind: 'site', pages: [] } as never, { bp: 'standard', viewportHeight: 900 })).toBe(221);
  });

  it('Automatik: unter 1200 px Breite Assets auf der Schiene (Index 168 px), unter 760 px Höhe Bühne auf der Leiste', () => {
    const narrow = resolveLayout(DEFAULT_STORED_LAYOUT, { viewport: { width: 1180, height: 900 }, category: 'video', doc: referenceTimeline() });
    expect(narrow.collapsed.assets).toBe(true);
    expect(narrow).toMatchObject({ sideL: 40, indexW: 168 });
    // ausdrücklich geöffnet bleibt offen
    expect(resolveLayout({ ...DEFAULT_STORED_LAYOUT, assetsCollapsed: false }, { viewport: { width: 1180, height: 900 }, category: 'video', doc: null }).collapsed.assets).toBe(false);
    const low = resolveLayout(DEFAULT_STORED_LAYOUT, { viewport: { width: 1440, height: 740 }, category: 'video', doc: referenceTimeline() });
    expect(low.collapsed.stage).toBe(true);
    expect(low.stageH).toBe(32);
  });

  it('Grenzen: Seitenleisten 200–400 / 300–520 px, Monitor nie unter 420 px, gezogene Bühne 120 px bis 50 %', () => {
    const big = resolveLayout({ ...DEFAULT_STORED_LAYOUT, assetsW: 999, chatW: 10, stageH: { video: 999 } }, { viewport: { width: 1920, height: 1080 }, category: 'video', doc: null });
    expect(big).toMatchObject({ assetsW: 400, chatW: 300, stageOpenH: 540 });
    const tight = resolveLayout({ ...DEFAULT_STORED_LAYOUT, assetsCollapsed: false, assetsW: 400, chatW: 520 }, { viewport: { width: 1200, height: 900 }, category: 'video', doc: null });
    expect(1200 - tight.sideL - tight.sideR).toBeGreaterThanOrEqual(420);
    expect(tight.max.director).toBeLessThanOrEqual(1200 - tight.sideL - 420);
  });

  it('liest gespeicherten Zustand robust und löscht den alten Schlüssel', () => {
    localStorage.setItem('director-studio.layout', JSON.stringify({ top: 300, panel: 380 }));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ assetsW: 320, chatW: 'x', stageH: { video: 300, slides: -5 }, assetsCollapsed: true, chatCollapsed: 1 }));
    expect(readStoredLayout()).toEqual({ assetsW: 320, chatW: null, stageH: { video: 300 }, assetsCollapsed: true, chatCollapsed: null, stageCollapsed: null });
    expect(localStorage.getItem('director-studio.layout')).toBeNull();
    localStorage.setItem(LAYOUT_KEY, '{kaputt');
    expect(readStoredLayout()).toEqual(DEFAULT_STORED_LAYOUT);
  });
});

describe('Arbeitsbereich (Workspace.tsx)', () => {
  it('setzt die Rastervariablen aus Breakpoint und Inhalt (1440×900, 1280×800, 1920×1080)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    expect(vars()).toEqual({ '--side-l': '272px', '--side-r': '368px', '--stage-h': '264px', '--index-w': '272px' });
    expect(screen.getByRole('region', { name: 'Asset-Browser' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Director' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bühne (nur lesbar)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nachricht an den Director' })).toBeInTheDocument();
    // Monitor, Director und Composer bilden eine Werkbank; der Monitor bleibt immer dunkel
    const center = document.querySelector('.ws-center')!;
    expect(center.querySelector('.monitor.always-dark')).not.toBeNull();
    expect(center.querySelector('.director')).not.toBeNull();
    expect(center.querySelector('.composer')).not.toBeNull();
    // Die frühere Modell-Leiste ist keine eigene Zeile mehr
    expect(document.querySelector('.workspace > .picker-bar')).toBeNull();

    setViewport(1280, 800);
    expect(vars()).toEqual({ '--side-l': '240px', '--side-r': '328px', '--stage-h': '244px', '--index-w': '240px' });
    setViewport(1920, 1080);
    expect(vars()).toEqual({ '--side-l': '304px', '--side-r': '420px', '--stage-h': '290px', '--index-w': '304px' });
  });

  it('Strg+1/2/3 klappen Assets, Director und Bühne ein und wieder auf und speichern das', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);

    press('Digit1');
    expect(screen.queryByRole('region', { name: 'Asset-Browser' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Assets einblenden' })).toBeInTheDocument();
    expect(vars()).toMatchObject({ '--side-l': '40px', '--index-w': '168px' });
    expect(stored().assetsCollapsed).toBe(true);

    press('Digit2');
    expect(screen.queryByRole('complementary', { name: 'Director' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Director einblenden' })).toBeInTheDocument();
    expect(vars()['--side-r']).toBe('40px');
    expect(stored().chatCollapsed).toBe(true);

    press('Digit3');
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.getByRole('region', { name: 'Bühne (nur lesbar)' })).toBeInTheDocument();
    expect(vars()['--stage-h']).toBe('32px');
    expect(stored().stageCollapsed).toBe(true);

    // Aufklappen per Schiene bzw. Knopf in der Bühnen-Leiste
    fireEvent.click(screen.getByRole('button', { name: 'Assets einblenden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Director einblenden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bühne einblenden' }));
    expect(vars()).toEqual({ '--side-l': '272px', '--side-r': '368px', '--stage-h': '264px', '--index-w': '272px' });
    expect(stored()).toMatchObject({ assetsCollapsed: false, chatCollapsed: false, stageCollapsed: false });

    // Einklapp-Knöpfe in den Köpfen der Bereiche
    fireEvent.click(screen.getByRole('button', { name: 'Assets ausblenden' }));
    expect(vars()['--side-l']).toBe('40px');
    fireEvent.click(screen.getByRole('button', { name: 'Director ausblenden' }));
    expect(vars()['--side-r']).toBe('40px');
  });

  it('Strg+K fokussiert die Asset-Suche, auch wenn die Leiste eingeklappt ist (§13.4)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    const k = () => fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    k();
    expect(document.activeElement).toBe(document.querySelector('.assets input[type="search"]'));
    press('Digit1');
    expect(screen.queryByRole('region', { name: 'Asset-Browser' })).toBeNull();
    k();
    expect(screen.getByRole('region', { name: 'Asset-Browser' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.assets input[type="search"]')));
  });

  it('Strg+0: Fokusmodus klappt alles ein (Composer bleibt), ein zweites Strg+0 stellt her; nicht gespeichert', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    press('Digit3'); // Bühne vorher eingeklappt: soll nach dem Fokusmodus eingeklappt bleiben
    const before = localStorage.getItem(LAYOUT_KEY);

    press('Digit0');
    expect(vars()).toMatchObject({ '--side-l': '40px', '--side-r': '40px', '--stage-h': '32px' });
    expect(screen.getByRole('region', { name: 'Nachricht an den Director' })).toBeInTheDocument();
    expect(localStorage.getItem(LAYOUT_KEY)).toBe(before);

    press('Digit0');
    expect(vars()).toMatchObject({ '--side-l': '272px', '--side-r': '368px', '--stage-h': '32px' });
    expect(localStorage.getItem(LAYOUT_KEY)).toBe(before);
  });

  it('liest gespeicherte Breiten und die Bühnenhöhe je Kategorie', async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ assetsW: 320, chatW: 400, stageH: { video: 300 } }));
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const view = renderStudio(<Workspace />, studio);
    expect(vars()).toEqual({ '--side-l': '320px', '--side-r': '400px', '--stage-h': '300px', '--index-w': '320px' });
    view.unmount();
    // andere Kategorie: inhaltsbasierte Standardhöhe (Folien 16:9)
    const deck = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Workspace />, deck);
    expect(vars()['--stage-h']).toBe('161px');
  });

  it('Splitter: Pfeiltasten ändern und speichern die Breite, Doppelklick setzt auf den Standard zurück', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    const assets = screen.getByRole('separator', { name: 'Breite der Asset-Leiste' });
    fireEvent.keyDown(assets, { key: 'ArrowRight' });
    expect(vars()['--side-l']).toBe('288px');
    expect(stored().assetsW).toBe(288);
    fireEvent.doubleClick(assets);
    expect(vars()['--side-l']).toBe('272px');
    expect(stored().assetsW).toBeNull();

    const director = screen.getByRole('separator', { name: 'Breite des Directors' });
    fireEvent.keyDown(director, { key: 'ArrowLeft', shiftKey: true });
    expect(vars()['--side-r']).toBe('416px');
    // Enter klappt ein (Fenster-Splitter-Muster)
    fireEvent.keyDown(director, { key: 'Enter' });
    expect(vars()['--side-r']).toBe('40px');

    const stage = screen.getByRole('separator', { name: 'Höhe der Bühne' });
    fireEvent.keyDown(stage, { key: 'ArrowUp' });
    expect(vars()['--stage-h']).toBe('280px');
    expect(stored().stageH).toEqual({ video: 280 });
  });

  it('F6 / Umschalt+F6 springen zyklisch durch die Regionen in Leserichtung', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    const order = ['app-header', 'assets', 'monitor', 'director', 'composer', 'stage'];
    for (const cls of order) {
      fireEvent.keyDown(window, { key: 'F6' });
      expect(document.activeElement?.classList.contains(cls)).toBe(true);
    }
    fireEvent.keyDown(window, { key: 'F6' });
    expect(document.activeElement?.classList.contains('app-header')).toBe(true);
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true });
    expect(document.activeElement?.classList.contains('stage')).toBe(true);
  });

  it('Ziehen über das Minimum hinaus klappt die Asset-Leiste auf die Schiene', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    const assets = screen.getByRole('separator', { name: 'Breite der Asset-Leiste' });
    fireEvent.pointerDown(assets, { clientX: 272, button: 0 });
    fireEvent.pointerMove(window, { clientX: 230 });
    expect(vars()['--side-l']).toBe('230px');
    fireEvent.pointerMove(window, { clientX: 140 });
    expect(vars()['--side-l']).toBe('40px');
    fireEvent.pointerUp(window, { clientX: 140 });
    expect(stored().assetsCollapsed).toBe(true);
    expect(document.documentElement.dataset.resizing).toBeUndefined();
  });
});
