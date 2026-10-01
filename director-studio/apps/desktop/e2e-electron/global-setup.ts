import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Baut Main/Preload (esbuild) und den Renderer (Vite), bevor die App gestartet wird. */
export default function globalSetup(): void {
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(import.meta.url);
  execFileSync(process.execPath, [join(appDir, 'scripts/build-main.mjs')], { cwd: appDir, stdio: 'inherit' });
  execFileSync(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build', '--config', 'vite.renderer.config.ts'], { cwd: appDir, stdio: 'inherit' });
}
