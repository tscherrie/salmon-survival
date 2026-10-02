import { createRoot } from 'react-dom/client';
import { applyContrastMode, applyThemeMode, readContrastMode, readThemeMode } from '../../desktop/src/renderer/lib/theme.ts';
import { installDropGuard } from '../../desktop/src/renderer/lib/dropGuard.ts';
import { BrowserStudioApi } from './BrowserStudioApi.ts';
import { DirectorHostBridge } from './hostBridge.ts';
import { installNativeRuntime } from './nativeRuntime.ts';
import { NativeEditor } from './NativeEditor.tsx';
import '../../desktop/src/renderer/styles/app.css';
import './native.css';

applyThemeMode(readThemeMode()); applyContrastMode(readContrastMode()); installDropGuard();
const host = new DirectorHostBridge();
installNativeRuntime(host);
const bootstrap = (window as Window & { __DIRECTOR_BOOTSTRAP__?: { apiBaseUrl?: string } }).__DIRECTOR_BOOTSTRAP__;
const api = new BrowserStudioApi(host, bootstrap?.apiBaseUrl ?? '');
const root = document.getElementById('root'); if (!root) throw new Error('Editor root missing');
createRoot(root).render(<NativeEditor api={api} host={host}/>);
