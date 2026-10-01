// Bündelt Electron-Main und -Preload mit esbuild. Workspace-Pakete (@studio/*, TypeScript-Quellen) werden
// eingebunden; alle übrigen npm-Pakete bleiben extern (werden mit der App ausgeliefert).
import { build } from 'esbuild';
import { cp, readdir, rm, writeFile } from 'node:fs/promises';
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

// Zwei Einstiege: der Hauptprozess und der Hilfsprozess, der Remotions Chromium lädt (chromium-worker.ts, läuft als
// utilityProcess – siehe dort, warum nicht im Hauptprozess).
const main = await build({
  ...common,
  entryPoints: { index: join(root, 'src/main/index.ts'), 'chromium-worker': join(root, 'src/main/chromium-worker.ts') },
  outdir: join(root, 'out/main'),
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

// Director-Skills (packages/director/skills/<name>/SKILL.md): `defaultSkillsDir()` sucht sie relativ zum Modul
// (`../skills/`), im Bündel out/main/index.js also unter out/skills/. Von dort landen sie mit out/ im app.asar
// (Electrons fs liest Ordner und Dateien im asar wie gewohnt).
const skillsSrc = join(root, '..', '..', 'packages', 'director', 'skills');
const skillsOut = join(root, 'out', 'skills');
await rm(skillsOut, { recursive: true, force: true });
await cp(skillsSrc, skillsOut, { recursive: true });
const skillCount = (await readdir(skillsOut, { withFileTypes: true })).filter((e) => e.isDirectory()).length;
if (skillCount === 0) throw new Error(`Keine Director-Skills in ${skillsSrc}`);
console.log(`Director-Skills: ${skillCount} nach out/skills kopiert`);

await build({
  ...common,
  plugins: [],
  entryPoints: [join(root, 'src/preload/index.ts')],
  outfile: join(root, 'out/preload/index.cjs'),
  format: 'cjs',
  external: ['electron'],
});

if (watch) console.log('Watch-Modus wird nicht unterstützt – erneut ausführen.');
