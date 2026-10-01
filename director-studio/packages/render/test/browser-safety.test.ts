import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('browser.ts ist browser-sicher', () => {
  it('lässt sich für den Browser bündeln, ohne Node-Module oder src/node/ zu erreichen', async () => {
    const result = await build({
      entryPoints: [path.join(here, '..', 'src', 'browser.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      metafile: true,
      logLevel: 'silent',
      // Laufzeit-Abhängigkeiten der UI bleiben extern; alles andere muss auflösbar sein
      external: ['react', 'react/jsx-runtime', 'react-dom', 'remotion', 'zod'],
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((i) => i.includes('src/node/'))).toBe(false);
    expect(inputs.some((i) => i.startsWith('node:') || /(^|\/)node_modules\/(playwright|esbuild|pptxgenjs|@remotion\/(renderer|bundler))\//.test(i))).toBe(false);
    const imports = Object.values(result.metafile.outputs).flatMap((o) => o.imports.map((i) => i.path));
    expect(imports.filter((p) => p.startsWith('node:') || ['fs', 'path', 'os', 'child_process', 'http', 'zlib', 'crypto'].includes(p))).toEqual([]);
  });
});
