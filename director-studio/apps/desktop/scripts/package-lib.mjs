// Bausteine für die Paketierung (Staging und Prüfung). Ohne Abhängigkeiten, damit sie auch in der gepackten App
// (Electron als Node) laufen.
import { cpSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

/**
 * Pakete, die erst zur Laufzeit gebraucht werden, ohne im Main-Bündel als Import aufzutauchen: Remotion bündelt die
 * Komposition (`@studio/render/browser`) mit webpack und braucht dafür `react-dom` (Peer von `remotion`).
 */
export const RUNTIME_EXTRA_PACKAGES = ['react-dom'];

/**
 * Workspace-Pakete, deren QUELLTEXT die gepackte App braucht: Remotion übersetzt `packages/render/src/browser.ts`
 * (und dessen Importe aus `@studio/core`) zur Laufzeit. Alles andere aus `@studio/*` steckt im Main-Bündel.
 */
export const SOURCE_WORKSPACE_PACKAGES = ['@studio/render', '@studio/core'];

/** `@scope/name/unterpfad` → `@scope/name`, `name/unterpfad` → `name`. */
export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function isBuiltinSpecifier(specifier) {
  if (specifier.startsWith('node:')) return true;
  return builtinModules.includes(specifier) || builtinModules.includes(specifier.split('/')[0]);
}

/** Externe npm-Importe (ohne Node-Module und `electron`) aus der Liste, die build-main.mjs schreibt. */
export function npmExternals(externals) {
  return externals.filter((e) => !isBuiltinSpecifier(e.path) && e.path !== 'electron' && !e.path.startsWith('.') && !path.isAbsolute(e.path));
}

/** Paketordner von `name` aus Sicht von `fromDir` (Node-Auflösung, höchstens bis `rootDir`). */
export function resolvePackageDir(name, fromDir, rootDir) {
  const stop = path.resolve(rootDir);
  let dir = path.resolve(fromDir);
  for (;;) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Unter Linux mit glibc: musl-Varianten optionaler Plattformpakete weglassen (npm installiert beide). */
export function isForeignLibcPackage(name, platform = process.platform) {
  return platform === 'linux' && /-musl(?:-|$)/.test(name) && isGlibc();
}

/**
 * Abhängigkeitshülle der Laufzeitpakete: alles, was von `roots` aus über `dependencies`, `optionalDependencies` und
 * vorhandene `peerDependencies` erreichbar ist – mit genau den installierten Versionen (aus dem Lockfile) und nur den
 * Plattformpaketen des Build-Rechners. Ergebnis: relativer Pfad (`node_modules/a/node_modules/b`) → Paket.
 *
 * @param {{ rootDir: string, roots: string[], skip?: (name: string) => boolean }} options
 * @returns {{ packages: Map<string, { name: string, version: string, dir: string }>, missing: Array<{ name: string, requiredBy: string, kind: string }> }}
 */
export function collectClosure({ rootDir, roots, skip = () => false }) {
  const packages = new Map();
  const missing = [];
  const queue = [];
  /** Echter Pfad von <rootDir>/node_modules (erst gebraucht, wenn ein Paket gefunden wurde – dann existiert er). */
  let nodeModulesReal;
  const enqueue = (name, fromDir, kind, requiredBy) => {
    if (skip(name)) return;
    const dir = resolvePackageDir(name, fromDir, rootDir);
    if (!dir) {
      if (kind !== 'optional') missing.push({ name, requiredBy, kind });
      return;
    }
    const rel = path.relative(rootDir, dir).split(path.sep).join('/');
    if (packages.has(rel)) return;
    // Workspace-Pakete sind Symlinks aus node_modules heraus (packages/*) – die bündelt esbuild bzw. kopiert stage-app.
    nodeModulesReal ??= realpathSync(path.join(rootDir, 'node_modules')) + path.sep;
    if (!(realpathSync(dir) + path.sep).startsWith(nodeModulesReal)) return;
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    packages.set(rel, { name, version: pkg.version, dir });
    queue.push({ dir, pkg });
  };
  for (const name of roots) enqueue(name, rootDir, 'required', '(App)');
  while (queue.length > 0) {
    const { dir, pkg } = queue.shift();
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    for (const dep of Object.keys(pkg.dependencies ?? {})) if (!optional.has(dep)) enqueue(dep, dir, 'required', pkg.name);
    for (const dep of optional) enqueue(dep, dir, 'optional', pkg.name);
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) enqueue(dep, dir, pkg.peerDependenciesMeta?.[dep]?.optional ? 'optional' : 'peer', pkg.name);
  }
  return { packages, missing };
}

/** Kopiert die Pakete der Hülle nach `destRoot` (gleiche Verschachtelung, ohne verschachtelte node_modules/.bin). */
export function copyClosure(packages, destRoot) {
  for (const [rel, { dir }] of packages) {
    const dest = path.join(destRoot, ...rel.split('/'));
    cpSync(dir, dest, {
      recursive: true,
      dereference: true,
      filter: (src) => {
        const first = path.relative(dir, src).split(path.sep)[0];
        return first !== 'node_modules' && first !== '.bin';
      },
    });
  }
}

/** Plattform-Kennung, wie sie Remotion (`@remotion/compositor-*`) und der Claude-Agent-SDK verwenden. */
export function nativePackageNames(platform = process.platform, arch = process.arch) {
  const musl = platform === 'linux' && !isGlibc();
  const compositor =
    platform === 'win32' ? `@remotion/compositor-win32-${arch}-msvc` : platform === 'darwin' ? `@remotion/compositor-darwin-${arch}` : `@remotion/compositor-linux-${arch}-${musl ? 'musl' : 'gnu'}`;
  const agentSdk = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}${musl ? '-musl' : ''}`;
  return { compositor, agentSdk, esbuild: `@esbuild/${platform}-${arch}` };
}

let glibc;
/** Läuft dieser Linux-Prozess mit glibc (nicht musl)? */
function isGlibc() {
  if (glibc === undefined) {
    try {
      glibc = Boolean(/** @type {any} */ (process.report?.getReport?.() ?? {}).header?.glibcVersionRuntime);
    } catch {
      glibc = true;
    }
  }
  return glibc;
}
