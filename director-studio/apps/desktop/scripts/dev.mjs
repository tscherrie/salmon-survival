// Entwicklungsstart: Main/Preload bauen, Vite-Dev-Server für den Renderer starten, Electron starten.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const port = Number(process.env.STUDIO_DEV_PORT ?? 5173);

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

await new Promise((resolve, reject) => {
  const p = run(process.execPath, [join(root, 'scripts/build-main.mjs')]);
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build-main exit ${code}`))));
});

const vite = run(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--config', 'vite.renderer.config.ts', '--port', String(port), '--strictPort']);

// Kurz warten, bis Vite lauscht.
await new Promise((resolve) => setTimeout(resolve, 1500));

const electron = run(electronBinary, ['.'], {
  env: { ...process.env, STUDIO_RENDERER_URL: `http://localhost:${port}` },
});

const stop = () => {
  vite.kill();
  electron.kill();
};
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
