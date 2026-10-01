import { useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../../i18n.ts';
import { LAYOUT_LIMITS, LayoutProvider, RAIL_W, STAGE_BAR_H, useWorkspaceLayout, type WorkspaceLayout } from '../../lib/layout.ts';
import { useActions, useStudio, useStudioStore, useViewDocument } from '../../state/context.tsx';
import { AssetBrowser } from '../assets/AssetBrowser.tsx';
import { isMacPlatform } from '../common/Kbd.tsx';
import { Splitter } from '../common/Splitter.tsx';
import { Composer } from '../composer/Composer.tsx';
import { DirectorPanel } from '../director/DirectorPanel.tsx';
import { Monitor } from '../monitor/Monitor.tsx';
import { Stage } from '../stage/Stage.tsx';
import { Header } from './Header.tsx';
import { AssetsRail, DirectorRail } from './Rails.tsx';

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

/** Regionen für F6 / Umschalt+F6 in Leserichtung (DESIGN.md §7.1, §13.4). */
const REGION_SELECTORS = ['.app-header', '.assets, .rail-assets', '.monitor', '.director, .rail-director', '.composer', '.stage'];

function cycleRegion(root: HTMLElement, direction: 1 | -1): void {
  const regions = REGION_SELECTORS.map((sel) => root.querySelector<HTMLElement>(sel)).filter((el): el is HTMLElement => !!el);
  if (regions.length === 0) return;
  const active = document.activeElement;
  const current = regions.findIndex((el) => el === active || el.contains(active));
  const next = regions[(current + direction + regions.length) % regions.length]!;
  if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
  next.focus();
}

/**
 * Globale Tastenkürzel des Arbeitsbereichs: Layout (mod+0/1/2/3, F6) überall; Wiedergabe nur bei Timeline-Projekten
 * und nicht in Eingabefeldern.
 */
function useWorkspaceShortcuts(layout: WorkspaceLayout) {
  const actions = useActions();
  const store = useStudioStore();
  // Aktuelles Layout per Ref: der Listener bleibt über Renderings hinweg derselbe
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Layout: mod+0 Fokusmodus, mod+1 Assets, mod+2 Director, mod+3 Bühne (auch aus Eingabefeldern heraus)
      const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (mod && !event.altKey && !event.shiftKey && /^Digit[0-3]$/.test(event.code)) {
        event.preventDefault();
        const digit = event.code.slice(5);
        if (digit === '0') layoutRef.current.toggleFocusMode();
        else layoutRef.current.toggle(digit === '1' ? 'assets' : digit === '2' ? 'director' : 'stage');
        return;
      }
      if (event.key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const root = document.querySelector<HTMLElement>('.workspace');
        if (root) {
          event.preventDefault();
          cycleRegion(root, event.shiftKey ? -1 : 1);
        }
        return;
      }

      if (isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const state = store.getState();
      const doc = state.viewing?.document ?? state.document;
      if (doc?.kind !== 'timeline') return;
      const target = event.target as HTMLElement | null;
      switch (event.key) {
        case ' ':
          if (target?.closest('button, a, [role="button"], summary')) return;
          event.preventDefault();
          actions.togglePlay();
          break;
        case 'j':
        case 'J':
          actions.shuttle('j');
          break;
        case 'k':
        case 'K':
          actions.shuttle('k');
          break;
        case 'l':
        case 'L':
          actions.shuttle('l');
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Umschalt+←/→ (Schlag bzw. ±1 s) gehört der Timeline (useTimelineShortcuts), hier nur ±1 Frame
          if (event.shiftKey) return;
          if (target?.closest('[role="separator"], [role="slider"], [role="application"]:not(.tl-scroll)')) return;
          event.preventDefault();
          state.transport?.pause();
          actions.requestSeek(state.playhead + (event.key === 'ArrowLeft' ? -1 : 1));
          break;
        }
        case 'Home':
          event.preventDefault();
          actions.requestSeek(0);
          break;
        case 'End':
          event.preventDefault();
          actions.requestSeek(doc.durationFrames - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, store]);
}

const px = (v: number) => `${Math.round(v)}px`;

/**
 * Arbeitsbereich (DESIGN.md §2.1/§2.2): Kopfzeile · Assets links · Mitte als eine Werkbank (Monitor, Director und
 * darunter der Composer in voller Breite, L-Fusion um die 14-px-Ecke des Monitors) · Bühne über die ganze Breite.
 * Spaltenbreiten und Bühnenhöhe kommen aus `useWorkspaceLayout` und stehen als Variablen am Raster.
 */
export function Workspace() {
  const t = useT();
  const doc = useViewDocument();
  const category = useStudio((s) => s.manifest?.category ?? null);
  const layout = useWorkspaceLayout({ category, doc });
  useWorkspaceShortcuts(layout);
  // Ein Asset zeigen (Chip-Klick, §9.4) öffnet die eingeklappte Asset-Leiste; die Karte scrollt sich selbst ins Bild
  const flashKey = useStudio((s) => s.flash?.key ?? null);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  useEffect(() => {
    if (flashKey?.startsWith('asset:') && layoutRef.current.collapsed.assets) layoutRef.current.setCollapsed('assets', false);
  }, [flashKey]);

  const style = {
    '--side-l': px(layout.sideL),
    '--side-r': px(layout.sideR),
    '--stage-h': px(layout.stageH),
    '--index-w': px(layout.indexW),
  } as React.CSSProperties;
  const { collapsed } = layout;

  return (
    <LayoutProvider value={layout}>
      <div className={`workspace${layout.focusMode ? ' is-focus' : ''}`} style={style} data-breakpoint={layout.bp}>
        <Header />
        {collapsed.assets ? <AssetsRail onExpand={() => layout.toggle('assets')} /> : <AssetBrowser />}
        <div className="ws-center">
          <Monitor />
          {collapsed.director ? <DirectorRail onExpand={() => layout.toggle('director')} /> : <DirectorPanel />}
          <Composer />
          <Splitter
            className="splitter-director"
            orientation="vertical"
            invert
            value={layout.chatW}
            min={LAYOUT_LIMITS.director.min}
            max={layout.max.director}
            label={t('layout.resizeDirector')}
            collapsed={collapsed.director}
            railSize={RAIL_W}
            onChange={layout.setChatW}
            onCollapse={(c) => layout.setCollapsed('director', c)}
            onReset={() => layout.setChatW(null)}
          />
        </div>
        <Stage />
        <Splitter
          className="splitter-assets"
          orientation="vertical"
          value={layout.assetsW}
          min={LAYOUT_LIMITS.assets.min}
          max={layout.max.assets}
          label={t('layout.resizeAssets')}
          collapsed={collapsed.assets}
          railSize={RAIL_W}
          onChange={layout.setAssetsW}
          onCollapse={(c) => layout.setCollapsed('assets', c)}
          onReset={() => layout.setAssetsW(null)}
        />
        <Splitter
          className="splitter-stage"
          orientation="horizontal"
          invert
          value={layout.stageOpenH}
          min={LAYOUT_LIMITS.stageMin}
          max={layout.max.stage}
          label={t('layout.resizeStage')}
          collapsed={collapsed.stage}
          railSize={STAGE_BAR_H}
          onChange={layout.setStageH}
          onCollapse={(c) => layout.setCollapsed('stage', c)}
          onReset={() => layout.setStageH(null)}
        />
      </div>
    </LayoutProvider>
  );
}
