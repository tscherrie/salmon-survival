import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getStudioApi } from './api.ts';
import { App } from './App.tsx';
import { installDropGuard } from './lib/dropGuard.ts';
import { applyContrastMode, applyThemeMode, readContrastMode, readThemeMode } from './lib/theme.ts';
import './styles/app.css';

applyThemeMode(readThemeMode());
applyContrastMode(readContrastMode());
installDropGuard();

/**
 * Lokale Schriften vorladen (DESIGN.md §4.2): `font-display: block` vermeidet ein Umspringen, das Vorladen vermeidet
 * ein unsichtbares Erstbild. Nach spätestens 300 ms wird trotzdem gerendert (Fallback-Stack).
 */
const FONT_FACES = ['400 13px "Instrument Sans"', '400 13px "IBM Plex Mono"', '500 13px "IBM Plex Mono"', '600 13px "IBM Plex Mono"'];
const FONT_TIMEOUT_MS = 300;

function preloadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const loads = Promise.all(FONT_FACES.map((font) => document.fonts.load(font))).then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  return Promise.race([loads, timeout]);
}

const container = document.getElementById('root');
if (!container) throw new Error('#root fehlt');
const root = createRoot(container);

// Nur im Entwicklungsmodus: Bausteine-Übersicht (Zustandsmatrix §11) unter ?story=bausteine
const story = import.meta.env.DEV && new URLSearchParams(window.location.search).get('story') === 'bausteine';

void (async () => {
  if (story) {
    const [{ BuildingBlocksStory }] = await Promise.all([import('./dev/BuildingBlocksStory.tsx'), preloadFonts()]);
    root.render(
      <StrictMode>
        <BuildingBlocksStory />
      </StrictMode>,
    );
    return;
  }
  const [api] = await Promise.all([getStudioApi(), preloadFonts()]);
  root.render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  );
})();
