// Mach-O-Binaries (macOS) für die Paketierung: Ladebefehle lesen (ohne Werkzeuge von Apple, läuft überall) und
// relative Bibliotheksnamen auf @loader_path umstellen (mit install_name_tool aus den Xcode Command Line Tools).
//
// Hintergrund: Remotions Compositor (@remotion/compositor-darwin-*) verweist in `remotion`, `ffmpeg`, `ffprobe` und
// den FFmpeg-dylibs nur mit dem Dateinamen auf seine Bibliotheken („libavcodec.dylib“, ohne Pfad, ohne LC_RPATH).
// Remotion startet die Programme deshalb mit cwd = Programmordner und DYLD_LIBRARY_PATH. electron-builder signiert
// aber jedes Binary mit Hardened Runtime – und dann verweigert dyld relative Pfade („relative path not allowed in
// hardened program“) und ignoriert DYLD_LIBRARY_PATH. Ohne Korrektur scheitert jedes Rendern mit „Library not
// loaded: libavcodec.dylib“. Die Ausnahme-Berechtigung allow-dyld-environment-variables wäre keine Lösung: Sie
// öffnete jeden Helfer für DYLD_INSERT_LIBRARIES.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

// `>>> 0`: Bitoperationen in JavaScript liefern vorzeichenbehaftete 32-Bit-Zahlen, gelesen wird vorzeichenlos.
const LC_REQ_DYLD = 0x80000000;
const LC_LOAD_DYLIB = 0xc;
const LC_ID_DYLIB = 0xd;
const LC_LOAD_WEAK_DYLIB = (0x18 | LC_REQ_DYLD) >>> 0;
const LC_RPATH = (0x1c | LC_REQ_DYLD) >>> 0;
const LC_REEXPORT_DYLIB = (0x1f | LC_REQ_DYLD) >>> 0;
const LC_LAZY_LOAD_DYLIB = 0x20;
const LC_LOAD_UPWARD_DYLIB = (0x23 | LC_REQ_DYLD) >>> 0;
const DEPENDENCY_COMMANDS = new Set([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LAZY_LOAD_DYLIB, LC_LOAD_UPWARD_DYLIB]);

/** Erste vier Bytes: Mach-O (thin, 32/64 Bit, beide Byte-Reihenfolgen) oder Universal-Binary? */
export function isMachOHeader(buffer) {
  if (buffer.length < 8) return false;
  const le = buffer.readUInt32LE(0);
  const be = buffer.readUInt32BE(0);
  if (le === MH_MAGIC || le === MH_MAGIC_64 || be === MH_MAGIC || be === MH_MAGIC_64) return true;
  // 0xcafebabe teilen sich Universal-Binaries und Java-Klassendateien; Universal-Binaries haben nur wenige Slices.
  if (be === FAT_MAGIC || be === FAT_MAGIC_64) {
    const count = buffer.readUInt32BE(4);
    return count > 0 && count < 20;
  }
  return false;
}

function readCString(buffer, start, end) {
  let stop = start;
  while (stop < end && buffer[stop] !== 0) stop++;
  return buffer.toString('utf8', start, stop);
}

/** Ladebefehle eines einzelnen Mach-O-Slices ab `offset`. */
function parseSlice(buffer, offset) {
  const magicLE = buffer.readUInt32LE(offset);
  const little = magicLE === MH_MAGIC || magicLE === MH_MAGIC_64;
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const magic = u32(offset);
  if (magic !== MH_MAGIC && magic !== MH_MAGIC_64) throw new Error(`Kein Mach-O-Slice bei Offset ${offset}`);
  const is64 = magic === MH_MAGIC_64;
  const cputype = u32(offset + 4);
  const ncmds = u32(offset + 16);
  let cursor = offset + (is64 ? 32 : 28);
  const slice = { cputype, id: null, dependencies: [], rpaths: [] };
  for (let i = 0; i < ncmds; i++) {
    if (cursor + 8 > buffer.length) throw new Error('Mach-O-Ladebefehle abgeschnitten');
    const cmd = u32(cursor);
    const size = u32(cursor + 4);
    if (size < 8 || cursor + size > buffer.length) throw new Error('Ungültige Größe eines Mach-O-Ladebefehls');
    if (cmd === LC_ID_DYLIB || DEPENDENCY_COMMANDS.has(cmd)) {
      const name = readCString(buffer, cursor + u32(cursor + 8), cursor + size);
      if (cmd === LC_ID_DYLIB) slice.id = name;
      else slice.dependencies.push(name);
    } else if (cmd === LC_RPATH) {
      slice.rpaths.push(readCString(buffer, cursor + u32(cursor + 8), cursor + size));
    }
    cursor += size;
  }
  return slice;
}

/**
 * Liest ID, Abhängigkeiten und rpaths eines Mach-O-Binaries (bei Universal-Binaries je Slice).
 * @param {Buffer} buffer
 * @returns {{ slices: Array<{ cputype: number, id: string | null, dependencies: string[], rpaths: string[] }> } | null}
 */
export function parseMachO(buffer) {
  if (!isMachOHeader(buffer)) return null;
  const be = buffer.readUInt32BE(0);
  if (be === FAT_MAGIC || be === FAT_MAGIC_64) {
    const count = buffer.readUInt32BE(4);
    const slices = [];
    for (let i = 0; i < count; i++) {
      const entry = 8 + i * (be === FAT_MAGIC_64 ? 32 : 20);
      const offset = be === FAT_MAGIC_64 ? Number(buffer.readBigUInt64BE(entry + 8)) : buffer.readUInt32BE(entry + 8);
      slices.push(parseSlice(buffer, offset));
    }
    return { slices };
  }
  return { slices: [parseSlice(buffer, 0)] };
}

/** Ein Bibliotheksname, den dyld relativ zum Arbeitsordner (bzw. über DYLD_*-Variablen) auflösen müsste. */
export function isRelativeInstallName(name) {
  return !name.startsWith('/') && !name.startsWith('@');
}

/** Liest nur so viel, wie nötig ist, um ein Mach-O zu erkennen. */
function looksLikeMachO(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    return readSync(fd, head, 0, 8, 0) === 8 && isMachOHeader(head);
  } finally {
    closeSync(fd);
  }
}

/** Alle Mach-O-Dateien unter `root` (ausführbare Dateien sowie .dylib/.node/.so; Symlinks werden übersprungen). */
export function findMachOFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const candidate = /\.(dylib|node|so)$/.test(entry.name) || (statSync(full).mode & 0o111) !== 0;
        if (candidate && looksLikeMachO(full)) out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Mach-O-Dateien unter `root` mit relativen Bibliotheksnamen (Abhängigkeiten oder eigene ID).
 * @returns {Array<{ file: string, id: string | null, relative: string[] }>}
 */
export function findRelativeInstallNames(root) {
  const out = [];
  for (const file of findMachOFiles(root)) {
    const info = parseMachO(readFileSync(file));
    if (!info) continue;
    const relative = new Set();
    let id = null;
    for (const slice of info.slices) {
      for (const dep of slice.dependencies) if (isRelativeInstallName(dep)) relative.add(dep);
      if (slice.id && isRelativeInstallName(slice.id)) id = slice.id;
    }
    if (relative.size > 0 || id) out.push({ file, id, relative: [...relative].sort() });
  }
  return out;
}

/**
 * Argumente für install_name_tool: relative Abhängigkeiten → `@loader_path/<name>` (die Bibliothek muss neben der
 * Datei liegen), relative eigene ID → `@loader_path/<Dateiname>`.
 */
export function installNameToolArgs({ file, id, relative }) {
  const dir = path.dirname(file);
  const args = [];
  for (const dep of relative) {
    if (dep.includes('/')) throw new Error(`${file}: verweist auf „${dep}“ (relativer Pfad mit Ordner) – nicht unterstützt`);
    if (!existsFile(path.join(dir, dep))) throw new Error(`${file}: verweist auf „${dep}“, die Datei liegt aber nicht daneben`);
    args.push('-change', dep, `@loader_path/${dep}`);
  }
  if (id) args.push('-id', `@loader_path/${path.basename(file)}`);
  return args;
}

function existsFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** install_name_tool: `INSTALL_NAME_TOOL` (z. B. llvm-install-name-tool zum Testen) oder aus den Command Line Tools. */
export function findInstallNameTool(env = process.env) {
  if (env.INSTALL_NAME_TOOL) return env.INSTALL_NAME_TOOL;
  const found = spawnSync('xcrun', ['--find', 'install_name_tool'], { encoding: 'utf8' });
  const tool = found.status === 0 ? found.stdout.trim() : '';
  if (!tool) {
    throw new Error('install_name_tool fehlt (Xcode Command Line Tools). Installieren mit: xcode-select --install – danach erneut bauen.');
  }
  return tool;
}

/**
 * Stellt alle relativen Bibliotheksnamen unter `root` auf @loader_path um. Danach signiert electron-builder neu.
 * install_name_tool wird nur gesucht, wenn es etwas zu ändern gibt.
 * @param {string} root
 * @param {{ tool?: string, log?: (msg: string) => void }} [options]
 * @returns {Array<{ file: string, args: string[] }>} die geänderten Dateien
 */
export function fixRelativeInstallNames(root, { tool, log = () => {} } = {}) {
  const changed = [];
  const entries = findRelativeInstallNames(root);
  if (entries.length === 0) return changed;
  tool ??= findInstallNameTool();
  for (const entry of entries) {
    const args = installNameToolArgs(entry);
    const result = spawnSync(tool, [...args, entry.file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${path.basename(tool)} für ${entry.file} fehlgeschlagen: ${result.error?.message ?? result.stderr}`);
    changed.push({ file: entry.file, args });
    log(`  @loader_path: ${path.relative(root, entry.file)} (${entry.relative.length} Bibliotheken${entry.id ? ', ID' : ''})`);
  }
  const left = findRelativeInstallNames(root);
  if (left.length > 0) throw new Error(`Weiterhin relative Bibliotheksnamen: ${left.map((e) => e.file).join(', ')}`);
  return changed;
}
