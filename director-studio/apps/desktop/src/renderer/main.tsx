import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getStudioApi } from './api.ts';
import { App } from './App.tsx';
import { installDropGuard } from './lib/dropGuard.ts';
import { applyThemeMode, readThemeMode } from './lib/theme.ts';
import './styles/app.css';

applyThemeMode(readThemeMode());
installDropGuard();

const container = document.getElementById('root');
if (!container) throw new Error('#root fehlt');
const root = createRoot(container);
void getStudioApi().then((api) =>
  root.render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  ),
);
