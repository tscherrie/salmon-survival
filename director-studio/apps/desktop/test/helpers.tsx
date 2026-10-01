import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { DEMO_ROOT, DEMO_VIDEO_ID, DEMO_VIDEO_PATH } from '../src/renderer/fake/demoProjects.ts';
import { StudioProvider } from '../src/renderer/state/context.tsx';
import { createStudioStore, type StudioStore } from '../src/renderer/state/store.ts';

export { DEMO_ROOT, DEMO_VIDEO_ID, DEMO_VIDEO_PATH };
export const DEMO_DECK_PATH = `${DEMO_ROOT}/Pitch-Deck Q4.dstudio`;
export const DEMO_CANVAS_PATH = `${DEMO_ROOT}/Plakat Sommerfest.dstudio`;
export const DEMO_WEB_PATH = `${DEMO_ROOT}/Café Morgenrot.dstudio`;
export const DEMO_AUDIO_PATH = `${DEMO_ROOT}/Podcast Folge 12.dstudio`;

export interface Studio {
  api: FakeStudioApi;
  store: StudioStore;
}

/** Fake-Backend ohne Verzögerung + Store; optional ein Projekt öffnen. */
export async function setupStudio(options: { project?: string; delayMs?: number } = {}): Promise<Studio> {
  const api = new FakeStudioApi({ delayMs: options.delayMs ?? 0 });
  const store = createStudioStore(api);
  await store.getState().init();
  if (options.project) {
    const ok = await store.getState().openProject(options.project);
    if (!ok) throw new Error(`Projekt ${options.project} ließ sich nicht öffnen`);
  }
  return { api, store };
}

export function renderStudio(ui: ReactElement, studio: Studio): RenderResult {
  return render(
    <StudioProvider api={studio.api} store={studio.store}>
      {ui}
    </StudioProvider>,
  );
}

/** Minimaler DataTransfer für Drag & Drop in jsdom. */
export function makeDataTransfer(files: File[] = []): DataTransfer {
  const data = new Map<string, string>();
  const types: string[] = files.length ? ['Files'] : [];
  return {
    data,
    types,
    files,
    items: [],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData(type: string, value: string) {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
    clearData() {
      data.clear();
      types.length = 0;
    },
    setDragImage() {},
  } as unknown as DataTransfer;
}
