import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { RefLabelContext, StudioApi, StudioDocument } from '@studio/core';
import { apiModeOf, type ApiMode } from '../api.ts';
import { labelContextFor } from '../lib/labels.ts';
import type { StudioState, StudioStore } from './store.ts';

const StoreContext = createContext<StudioStore | null>(null);
const ApiContext = createContext<{ api: StudioApi; mode: ApiMode } | null>(null);

export function StudioProvider({ api, store, children }: { api: StudioApi; store: StudioStore; children: ReactNode }) {
  const apiValue = useMemo(() => ({ api, mode: apiModeOf(api) }), [api]);
  return (
    <ApiContext.Provider value={apiValue}>
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    </ApiContext.Provider>
  );
}

export function useStudioStore(): StudioStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StudioProvider fehlt');
  return store;
}

/** Abonniert einen Ausschnitt des Zustands. Selektoren sollten stabile Referenzen liefern. */
export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStore(useStudioStore(), selector);
}

/** Aktionen sind stabil (Teil des Store-Objekts) – kein Abo nötig. */
export function useActions(): StudioState {
  return useStudioStore().getState();
}

export function useApi(): StudioApi {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('StudioProvider fehlt');
  return ctx.api;
}

export function useApiMode(): ApiMode {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('StudioProvider fehlt');
  return ctx.mode;
}

/** Angezeigtes Dokument: ältere Version im Ansehen-Modus oder die aktuelle. */
export function useViewDocument(): StudioDocument | null {
  return useStudio((s) => s.viewing?.document ?? s.document);
}

export function useLabelContext(): RefLabelContext {
  const doc = useViewDocument();
  const assets = useStudio((s) => s.assets);
  return useMemo(() => labelContextFor(doc, assets), [doc, assets]);
}

/** Asset-URL für das aktuelle Projekt (immer über die API, nie selbst gebaut). */
export function useAssetUrl(): (assetId: string, variant?: 'original' | 'proxy' | 'thumb') => string {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  return useMemo(() => (assetId: string, variant: 'original' | 'proxy' | 'thumb' = 'original') => (projectId ? api.assetUrl(projectId, assetId, variant) : ''), [api, projectId]);
}
