import { useEffect, useState } from 'react';
import { useT } from '../../i18n.ts';
import { useActions, useStudioStore } from '../../state/context.tsx';
import { AssetBrowser } from '../assets/AssetBrowser.tsx';
import { Splitter } from '../common/Splitter.tsx';
import { Composer } from '../composer/Composer.tsx';
import { DirectorPanel } from '../director/DirectorPanel.tsx';
import { Monitor } from '../monitor/Monitor.tsx';
import { ModelPickerBar } from '../picker/ModelPickerBar.tsx';
import { Stage } from '../stage/Stage.tsx';
import { Header } from './Header.tsx';

const LAYOUT_KEY = 'director-studio.layout';

function readLayout(): { top: number; panel: number } {
  const fallback = { top: typeof window !== 'undefined' ? Math.round(Math.min(640, Math.max(240, window.innerHeight * 0.4))) : 300, panel: 380 };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<typeof fallback>) };
  } catch {
    // ignorieren
  }
  return fallback;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

/** Globale Tastenkürzel der Wiedergabe (nur Timeline-Projekte, nicht in Eingabefeldern). */
function usePlaybackShortcuts() {
  const actions = useActions();
  const store = useStudioStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
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
          if (target?.closest('[role="separator"], [role="slider"], [role="application"]:not(.tl-scroll)')) return;
          event.preventDefault();
          const step = (event.shiftKey ? doc.fps : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
          state.transport?.pause();
          actions.requestSeek(state.playhead + step);
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

/** Arbeitsbereich nach dem Wireframe im Plan (Abschnitt 4). */
export function Workspace() {
  const t = useT();
  const [layout, setLayout] = useState(readLayout);
  usePlaybackShortcuts();

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // ignorieren
    }
  }, [layout]);

  return (
    <div className="workspace" style={{ '--top-h': `${layout.top}px`, '--panel-w': `${layout.panel}px` } as React.CSSProperties}>
      <Header />
      <div className="ws-top">
        <Monitor />
        <Splitter orientation="vertical" value={layout.panel} min={300} max={720} invert label={t('director.label')} onChange={(panel) => setLayout((l) => ({ ...l, panel }))} />
        <DirectorPanel />
      </div>
      <Splitter orientation="horizontal" value={layout.top} min={180} max={900} label={t('monitor.label')} onChange={(top) => setLayout((l) => ({ ...l, top }))} />
      <Stage />
      <ModelPickerBar />
      <Composer />
      <AssetBrowser />
    </div>
  );
}
