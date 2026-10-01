import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Canvas, Layer, ProjectCategory, StudioDocument, Track } from '@studio/core';

/**
 * Layout des Arbeitsbereichs (DESIGN.md §2.2–2.5, §10): Breakpoints, Standardmaße, Grenzen, inhaltsbasierte
 * Bühnenhöhe und der gespeicherte Zustand. Gespeichert werden nur Abweichungen des Nutzers (`null` = Standard des
 * Breakpoints bzw. Automatik).
 */

export type Breakpoint = 'compact' | 'standard' | 'wide';
export type LayoutPanel = 'assets' | 'director' | 'stage';

/** Breite einer eingeklappten Seitenleiste (Schiene). */
export const RAIL_W = 40;
/** Höhe der Bühnen-Leiste (eingeklappte Bühne). */
export const STAGE_BAR_H = 32;
/** Index-Spalte der Bühne, wenn die Asset-Leiste eingeklappt ist (nur dann ist die Fuge unterbrochen). */
export const INDEX_W_COLLAPSED = 168;

export const LAYOUT_LIMITS = {
  assets: { min: 200, max: 400 },
  director: { min: 300, max: 520 },
  monitorMin: 420,
  stageMin: 120,
  /** Grenze beim Ziehen (Anteil der Fensterhöhe). */
  stageMaxRatio: 0.5,
  /** Grenze der inhaltsbasierten Standardhöhe. */
  stageDefaultRatio: 0.4,
  /** So weit über das Minimum hinaus gezogen, klappt eine Leiste auf die Schiene ein. */
  collapseOvershoot: 48,
  autoCollapseAssetsBelowWidth: 1200,
  autoCollapseStageBelowHeight: 760,
} as const;

export const SIDE_DEFAULTS: Record<Breakpoint, { assets: number; director: number }> = {
  compact: { assets: 240, director: 328 },
  standard: { assets: 272, director: 368 },
  wide: { assets: 304, director: 420 },
};

export function breakpointFor(width: number): Breakpoint {
  if (width <= 1360) return 'compact';
  if (width >= 1800) return 'wide';
  return 'standard';
}

// ───────────────────────── Spurhöhen (§2.3) ─────────────────────────

export interface TrackHeights {
  video: number;
  overlay: number;
  text: number;
  voice: number;
  music: number;
  sfx: number;
}

const TRACK_HEIGHTS: Record<'low' | Breakpoint, TrackHeights> = {
  low: { video: 34, overlay: 18, text: 18, voice: 26, music: 30, sfx: 20 },
  compact: { video: 40, overlay: 20, text: 20, voice: 30, music: 34, sfx: 22 },
  standard: { video: 40, overlay: 20, text: 20, voice: 30, music: 34, sfx: 22 },
  wide: { video: 48, overlay: 22, text: 22, voice: 36, music: 40, sfx: 24 },
};

/** Spurhöhen je Breakpoint; im kompakten Breakpoint bei Fensterhöhe ≤ 820 die niedrige Stufe. */
export function trackHeights(bp: Breakpoint, viewportHeight: number): TrackHeights {
  if (bp === 'compact' && viewportHeight <= 820) return TRACK_HEIGHTS.low;
  return TRACK_HEIGHTS[bp];
}

/** Audio-Projekt (nur Audiospuren): eine Höhe für alle Spuren. */
export const AUDIO_PROJECT_TRACK_H: Record<Breakpoint, number> = { compact: 48, standard: 56, wide: 64 };

/** Höhe einer Spur: Video/Overlay/Text nach Art, Audio nach Rolle (Stimme, Musik, SFX/Atmo; ohne Rolle wie Stimme). */
export function trackHeight(track: Pick<Track, 'kind' | 'role'>, heights: TrackHeights, audioProjectHeight?: number): number {
  if (track.kind === 'audio') {
    if (audioProjectHeight) return audioProjectHeight;
    if (track.role === 'music') return heights.music;
    if (track.role === 'sfx' || track.role === 'ambience') return heights.sfx;
    return heights.voice;
  }
  return heights[track.kind];
}

// ───────────────────────── Bühnenhöhe nach Inhalt (§2.3) ─────────────────────────

/** Feste Teile der Timeline-Bühne: Leiste 32 · Markerleiste 16 · Lineal 22 · Abschnitte 20 · Luft 8. */
export const STAGE_TIMELINE_PARTS = { bar: STAGE_BAR_H, strip: 16, ruler: 22, sections: 20, air: 8 } as const;

/** Anzahl aller Ebenen einer Leinwand (inklusive Gruppeninhalt), also der Zeilen der Ebenenliste. */
export function countLayers(layers: readonly Layer[]): number {
  return layers.reduce((n, layer) => n + 1 + (layer.children ? countLayers(layer.children) : 0), 0);
}

export function stageContentHeight(
  doc: StudioDocument | null,
  options: { bp: Breakpoint; viewportHeight: number; audioProject?: boolean },
): number {
  const { bar, strip, ruler, sections, air } = STAGE_TIMELINE_PARTS;
  switch (doc?.kind) {
    case 'timeline': {
      const heights = trackHeights(options.bp, options.viewportHeight);
      const audioH = options.audioProject ? AUDIO_PROJECT_TRACK_H[options.bp] : undefined;
      const tracks = doc.tracks.reduce((h, track) => h + trackHeight(track, heights, audioH), 0);
      const hasSections = doc.markers.some((m) => m.kind === 'section');
      return bar + strip + ruler + (hasSections ? sections : 0) + tracks + air;
    }
    case 'deck': {
      // Folienstreifen: Thumb 148 px breit im Seitenverhältnis des Decks, Label 22, Innenabstand 12/12
      const thumb = Math.round((148 * doc.height) / doc.width);
      return bar + 12 + thumb + 22 + 12;
    }
    case 'canvas':
      return bar + Math.min(countLayers((doc as Canvas).layers) * 28, 196) + 12;
    case 'site':
      return bar + 12 + 125 + 40 + 12;
    default:
      // Noch kein Dokument (Planung): Platz für den Leerzustand
      return bar + 112;
  }
}

// ───────────────────────── Fenstergröße als abonnierbarer Wert ─────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

let viewport: Viewport = typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : { width: 1440, height: 900 };
const viewportListeners = new Set<() => void>();
let viewportBound = false;

/** Übernimmt die aktuelle Fenstergröße; `true`, wenn sie sich geändert hat. */
function syncViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth === viewport.width && window.innerHeight === viewport.height) return false;
  viewport = { width: window.innerWidth, height: window.innerHeight };
  return true;
}

function subscribeViewport(listener: () => void): () => void {
  if (!viewportBound && typeof window !== 'undefined') {
    viewportBound = true;
    window.addEventListener('resize', () => {
      if (syncViewport()) for (const l of viewportListeners) l();
    });
  }
  viewportListeners.add(listener);
  // Größe kann sich seit dem Laden des Moduls geändert haben (ohne Abonnenten wird nicht gelauscht)
  if (syncViewport()) for (const l of viewportListeners) l();
  return () => viewportListeners.delete(listener);
}

const viewportSnapshot = () => viewport;

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribeViewport, viewportSnapshot, viewportSnapshot);
}

/** Spurhöhen für die aktuelle Fenstergröße (Timeline-Bühne). */
export function useTrackHeights(): { heights: TrackHeights; audioProjectHeight: number } {
  const { width, height } = useViewport();
  const bp = breakpointFor(width);
  return useMemo(() => ({ heights: trackHeights(bp, height), audioProjectHeight: AUDIO_PROJECT_TRACK_H[bp] }), [bp, height]);
}

// ───────────────────────── Gespeicherter Zustand (§10) ─────────────────────────

export const LAYOUT_KEY = 'director-studio.layout.v2';
const LEGACY_LAYOUT_KEY = 'director-studio.layout';

export interface StoredLayout {
  /** Breite der Asset-Leiste; `null` = Standard des Breakpoints. */
  assetsW: number | null;
  /** Breite des Directors; `null` = Standard des Breakpoints. */
  chatW: number | null;
  /** Selbst gezogene Bühnenhöhe je Kategorie (`none` = noch ohne Kategorie). */
  stageH: Partial<Record<ProjectCategory | 'none', number>>;
  /** `null` = Automatik (Assets unter 1200 px Breite eingeklappt, Bühne unter 760 px Höhe), sonst Nutzerwahl. */
  assetsCollapsed: boolean | null;
  chatCollapsed: boolean | null;
  stageCollapsed: boolean | null;
}

export const DEFAULT_STORED_LAYOUT: StoredLayout = { assetsW: null, chatW: null, stageH: {}, assetsCollapsed: null, chatCollapsed: null, stageCollapsed: null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export function readStoredLayout(): StoredLayout {
  try {
    // Der alte Schlüssel (Monitorhöhe/Panelbreite des früheren Layouts) gilt nicht mehr
    localStorage.removeItem(LEGACY_LAYOUT_KEY);
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_STORED_LAYOUT;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const stageH: StoredLayout['stageH'] = {};
    if (data.stageH && typeof data.stageH === 'object') {
      for (const [key, value] of Object.entries(data.stageH as Record<string, unknown>)) {
        const h = num(value);
        if (h !== null) stageH[key as ProjectCategory | 'none'] = h;
      }
    }
    return {
      assetsW: num(data.assetsW),
      chatW: num(data.chatW),
      stageH,
      assetsCollapsed: bool(data.assetsCollapsed),
      chatCollapsed: bool(data.chatCollapsed),
      stageCollapsed: bool(data.stageCollapsed),
    };
  } catch {
    return DEFAULT_STORED_LAYOUT;
  }
}

export function writeStoredLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignorieren
  }
}

// ───────────────────────── Effektives Layout ─────────────────────────

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export interface ResolvedLayout {
  bp: Breakpoint;
  /** Effektive Spaltenbreiten (eingeklappt = Schiene). */
  sideL: number;
  sideR: number;
  /** Effektive Bühnenhöhe (eingeklappt = Leiste). */
  stageH: number;
  indexW: number;
  /** Breiten/Höhe im aufgeklappten Zustand (Werte der Splitter). */
  assetsW: number;
  chatW: number;
  stageOpenH: number;
  collapsed: Record<LayoutPanel, boolean>;
  /** Dynamische Obergrenzen der Splitter (Monitor ≥ 420 px, Bühne ≤ 50 % der Höhe). */
  max: { assets: number; director: number; stage: number };
}

export function resolveLayout(
  stored: StoredLayout,
  input: { viewport: Viewport; category: ProjectCategory | null; doc: StudioDocument | null; focusMode?: boolean },
): ResolvedLayout {
  const { width: vw, height: vh } = input.viewport;
  const bp = breakpointFor(vw);
  const focus = !!input.focusMode;
  const collapsed: Record<LayoutPanel, boolean> = {
    assets: focus || (stored.assetsCollapsed ?? vw < LAYOUT_LIMITS.autoCollapseAssetsBelowWidth),
    director: focus || (stored.chatCollapsed ?? false),
    stage: focus || (stored.stageCollapsed ?? vh < LAYOUT_LIMITS.autoCollapseStageBelowHeight),
  };
  const { assets: A, director: D } = LAYOUT_LIMITS;
  let assetsW = clamp(stored.assetsW ?? SIDE_DEFAULTS[bp].assets, A.min, A.max);
  let chatW = clamp(stored.chatW ?? SIDE_DEFAULTS[bp].director, D.min, D.max);
  // Der Monitor bleibt mindestens 420 px breit: erst den Director, dann die Assets bis zum Minimum verkleinern
  const left = () => (collapsed.assets ? RAIL_W : assetsW);
  const right = () => (collapsed.director ? RAIL_W : chatW);
  let deficit = LAYOUT_LIMITS.monitorMin - (vw - left() - right());
  if (deficit > 0 && !collapsed.director) {
    const take = Math.min(deficit, chatW - D.min);
    chatW -= take;
    deficit -= take;
  }
  if (deficit > 0 && !collapsed.assets) assetsW -= Math.min(deficit, assetsW - A.min);
  const sideL = left();
  const sideR = right();

  const audioProject = input.category === 'audio';
  const content = stageContentHeight(input.doc, { bp, viewportHeight: vh, audioProject });
  const stageMax = Math.round(vh * LAYOUT_LIMITS.stageMaxRatio);
  const userH = stored.stageH[input.category ?? 'none'];
  const stageOpenH = userH !== undefined ? clamp(userH, LAYOUT_LIMITS.stageMin, stageMax) : Math.min(content, Math.round(vh * LAYOUT_LIMITS.stageDefaultRatio));

  return {
    bp,
    sideL,
    sideR,
    stageH: collapsed.stage ? STAGE_BAR_H : stageOpenH,
    indexW: collapsed.assets ? INDEX_W_COLLAPSED : sideL,
    assetsW,
    chatW,
    stageOpenH,
    collapsed,
    max: {
      assets: Math.max(A.min, Math.min(A.max, vw - sideR - LAYOUT_LIMITS.monitorMin)),
      director: Math.max(D.min, Math.min(D.max, vw - sideL - LAYOUT_LIMITS.monitorMin)),
      stage: stageMax,
    },
  };
}

export interface WorkspaceLayout extends ResolvedLayout {
  focusMode: boolean;
  stored: StoredLayout;
  setAssetsW: (width: number | null) => void;
  setChatW: (width: number | null) => void;
  setStageH: (height: number | null) => void;
  setCollapsed: (panel: LayoutPanel, collapsed: boolean) => void;
  toggle: (panel: LayoutPanel) => void;
  toggleFocusMode: () => void;
}

const COLLAPSE_FIELD: Record<LayoutPanel, 'assetsCollapsed' | 'chatCollapsed' | 'stageCollapsed'> = {
  assets: 'assetsCollapsed',
  director: 'chatCollapsed',
  stage: 'stageCollapsed',
};

/**
 * Layout-Zustand des Arbeitsbereichs. Berechnet die Standards je Breakpoint aus der Fenstergröße, speichert nur
 * Abweichungen und verwaltet den (nicht gespeicherten) Fokusmodus.
 */
export function useWorkspaceLayout(input: { category: ProjectCategory | null; doc: StudioDocument | null }): WorkspaceLayout {
  const vp = useViewport();
  const [stored, setStored] = useState<StoredLayout>(readStoredLayout);
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => writeStoredLayout(stored), [stored]);

  const resolved = useMemo(
    () => resolveLayout(stored, { viewport: vp, category: input.category, doc: input.doc, focusMode }),
    [stored, vp, input.category, input.doc, focusMode],
  );

  const categoryKey: ProjectCategory | 'none' = input.category ?? 'none';
  const setAssetsW = useCallback((assetsW: number | null) => setStored((s) => ({ ...s, assetsW })), []);
  const setChatW = useCallback((chatW: number | null) => setStored((s) => ({ ...s, chatW })), []);
  const setStageH = useCallback(
    (height: number | null) =>
      setStored((s) => {
        const stageH = { ...s.stageH };
        if (height === null) delete stageH[categoryKey];
        else stageH[categoryKey] = height;
        return { ...s, stageH };
      }),
    [categoryKey],
  );

  const setCollapsed = useCallback((panel: LayoutPanel, value: boolean) => {
    // Eine Geste im Fokusmodus beendet ihn; der übrige gespeicherte Zustand gilt wieder
    setFocusMode(false);
    setStored((s) => ({ ...s, [COLLAPSE_FIELD[panel]]: value }));
  }, []);

  const toggle = useCallback(
    (panel: LayoutPanel) => {
      if (focusMode) setCollapsed(panel, false);
      else setCollapsed(panel, !resolved.collapsed[panel]);
    },
    [focusMode, resolved.collapsed, setCollapsed],
  );

  const toggleFocusMode = useCallback(() => setFocusMode((f) => !f), []);

  return { ...resolved, focusMode, stored, setAssetsW, setChatW, setStageH, setCollapsed, toggle, toggleFocusMode };
}

// ───────────────────────── Kontext für Einklapp-Knöpfe in den Bereichen ─────────────────────────

const LayoutContext = createContext<WorkspaceLayout | null>(null);
export const LayoutProvider = LayoutContext.Provider;

/** Layout des umgebenden Arbeitsbereichs; `null`, wenn ein Bereich einzeln gerendert wird (Tests). */
export function useLayout(): WorkspaceLayout | null {
  return useContext(LayoutContext);
}
