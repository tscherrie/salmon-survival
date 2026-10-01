import { useEffect, useMemo } from 'react';
import type { StudioApi } from '@studio/core';
import { Shortcuts } from './components/common/ShortcutsDialog.tsx';
import { Toasts } from './components/common/Toasts.tsx';
import { StartScreen } from './components/start/StartScreen.tsx';
import { Workspace } from './components/workspace/Workspace.tsx';
import { StudioProvider, useStudio, useStudioStore } from './state/context.tsx';
import { createStudioStore, type StudioStore } from './state/store.ts';

function Screens() {
  const store = useStudioStore();
  const screen = useStudio((s) => s.screen);
  useEffect(() => {
    void store.getState().init();
  }, [store]);
  return (
    <>
      {screen === 'start' ? <StartScreen /> : <Workspace />}
      <Shortcuts />
      <Toasts />
    </>
  );
}

/** Wurzel der UI. `store` ist optional (Tests können einen vorbereiteten Store übergeben). */
export function App({ api, store }: { api: StudioApi; store?: StudioStore }) {
  const studioStore = useMemo(() => store ?? createStudioStore(api), [api, store]);
  return (
    <StudioProvider api={api} store={studioStore}>
      <Screens />
    </StudioProvider>
  );
}
