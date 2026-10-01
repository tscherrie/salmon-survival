// Bündelt Electron-Main und -Preload mit esbuild. Workspace-Pakete (@studio/*, TypeScript-Quellen) werden
// eingebunden; alle übrigen npm-Pakete bleiben extern (werden mit der App ausgeliefert).
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const externalizeDeps = {
  name: 'externalize-deps',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@studio/')) return undefined; // bündeln
      if (args.path.startsWith('node:')) return { path: args.path, external: true };
      return { path: args.path, external: true };
    });
  },
};

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalizeDeps],
  loader: { '.md': 'text' },
};

const main = await build({
  ...common,
  entryPoints: [join(root, 'src/main/index.ts')],
  outfile: join(root, 'out/main/index.js'),
  format: 'esm',
  metafile: true,
  banner: {
    js: "import { createRequire as __studioCreateRequire } from 'node:module'; const require = __studioCreateRequire(import.meta.url);",
  },
});

// Liste der externen Importe (aus dem Metafile) für die Paketierung: stage-app.mjs nimmt genau diese Pakete samt
// Abhängigkeiten mit, verify-app.mjs prüft sie in der gepackten App.
const externals = new Map();
for (const output of Object.values(main.metafile.outputs)) {
  for (const imp of output.imports) {
    if (!imp.external) continue;
    const kinds = externals.get(imp.path) ?? new Set();
    kinds.add(imp.kind);
    externals.set(imp.path, kinds);
  }
}
await writeFile(
  join(root, 'out/main/externals.json'),
  `${JSON.stringify([...externals].sort(([a], [b]) => a.localeCompare(b)).map(([path, kinds]) => ({ path, kinds: [...kinds].sort() })), null, 2)}\n`,
);

await build({
  ...common,
  plugins: [],
  entryPoints: [join(root, 'src/preload/index.ts')],
  outfile: join(root, 'out/preload/index.cjs'),
  format: 'cjs',
  external: ['electron'],
});

if (watch) console.log('Watch-Modus wird nicht unterstützt – erneut ausführen.');
