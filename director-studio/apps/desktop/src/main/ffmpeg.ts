import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { MediaToolSource, MediaToolsStatus } from '@studio/core';

/**
 * Sucht ffmpeg und ffprobe für den Hauptprozess. Reihenfolge:
 *
 * 1. ausdrückliche Angabe: Einstellung `ffmpegPath`, dann `FFMPEG_PATH` (ffprobe: `FFPROBE_PATH`)
 * 2. mit der App ausgelieferte Binaries (`<resources>/ffmpeg/`, siehe `extraResources` in electron-builder.yml)
 * 3. bekannte Installationsorte: Homebrew/MacPorts (macOS); winget, Chocolatey, Scoop (Windows)
 * 4. PATH
 *
 * ffprobe wird zuerst neben dem gefundenen ffmpeg gesucht, damit beide aus derselben Installation stammen.
 * Eine aus Finder/Dock gestartete macOS-App erbt nur `PATH=/usr/bin:/bin:/usr/sbin:/sbin`; deshalb die
 * bekannten Orte vor dem PATH und {@link extendGuiPath} für Kindprozesse.
 */

export interface LocateFfmpegInput {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  /** Einstellung `ffmpegPath` (Datei oder Ordner). */
  settingsPath?: string | undefined;
  /** Ordner mit ausgelieferten Binaries (`process.resourcesPath/ffmpeg`), nur in der gepackten App. */
  bundledDir?: string | undefined;
  /** Datei vorhanden und ausführbar? (in Tests ersetzbar) */
  isExecutable?: ((file: string) => boolean) | undefined;
  /** Unterordner eines Ordners (für die Paketordner von winget; in Tests ersetzbar). */
  listDir?: ((dir: string) => string[]) | undefined;
}

export interface FfmpegLocation extends MediaToolsStatus {
  /** Ausdrückliche Angaben, die ins Leere zeigen (die Suche ging trotzdem weiter). */
  warnings: string[];
}

interface SearchDir {
  dir: string;
  source: MediaToolSource;
}

/** Bekannte Installationsordner je Plattform (ohne PATH). */
export function wellKnownDirs(platform: NodeJS.Platform, env: Record<string, string | undefined>, homedir: string, listDir: (dir: string) => string[] = defaultListDir): string[] {
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
  if (platform === 'win32') {
    const p = path.win32;
    const localAppData = env.LOCALAPPDATA || p.join(homedir, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
    const programData = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    const wingetPackages = p.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    // `winget install Gyan.FFmpeg` entpackt nach Packages\Gyan.FFmpeg_<Quelle>\ffmpeg-<Version>-full_build\bin
    // und legt in Links\ Verknüpfungen an – die erreichen eine laufende Sitzung aber erst nach Neuanmeldung über PATH.
    const wingetBins: string[] = [];
    for (const pkg of safeList(listDir, wingetPackages)) {
      if (!/ffmpeg/i.test(pkg)) continue;
      for (const build of safeList(listDir, p.join(wingetPackages, pkg))) wingetBins.push(p.join(wingetPackages, pkg, build, 'bin'));
    }
    return [
      p.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      p.join(programFiles, 'WinGet', 'Links'),
      ...wingetBins,
      p.join(env.ChocolateyInstall || p.join(programData, 'chocolatey'), 'bin'),
      p.join(env.SCOOP || p.join(homedir, 'scoop'), 'shims'),
      p.join(env.SCOOP_GLOBAL || p.join(programData, 'scoop'), 'shims'),
      p.join(programFiles, 'ffmpeg', 'bin'),
      'C:\\ffmpeg\\bin',
    ];
  }
  return ['/usr/local/bin', '/usr/bin', '/snap/bin'];
}

/** PATH-Ordner aus der Umgebung (unter Windows heißt die Variable oft `Path`). */
export function pathDirs(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  return raw
    .split(delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

export function locateFfmpeg(input: LocateFfmpegInput): FfmpegLocation {
  const { platform, env } = input;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const isExec = input.isExecutable ?? defaultIsExecutable;
  const exe = (name: string) => (platform === 'win32' ? `${name}.exe` : name);
  const warnings: string[] = [];

  const searchDirs = uniqueDirs(platform, [
    ...(input.bundledDir ? [input.bundledDir, p.join(input.bundledDir, 'bin')].map((dir) => ({ dir, source: 'bundled' as const })) : []),
    ...wellKnownDirs(platform, env, input.homedir, input.listDir).map((dir) => ({ dir, source: 'system' as const })),
    ...pathDirs(platform, env).map((dir) => ({ dir, source: 'path' as const })),
  ]);
  const findIn = (dirs: SearchDir[], name: string): { file: string; source: MediaToolSource } | null => {
    for (const { dir, source } of dirs) {
      const file = p.join(dir, exe(name));
      if (isExec(file)) return { file, source };
    }
    return null;
  };
  /** Ausdrückliche Angabe: Datei, Ordner mit dem Programm oder bloßer Programmname (dann über PATH). */
  const explicit = (value: string, name: string): string | null => {
    if (!p.isAbsolute(value)) {
      const onPath = findIn(pathDirs(platform, env).map((dir) => ({ dir, source: 'path' as const })), value.replace(/\.exe$/i, ''));
      return onPath?.file ?? null;
    }
    if (isExec(value)) return value;
    const inside = p.join(value, exe(name));
    return isExec(inside) ? inside : null;
  };

  let ffmpeg: string | null = null;
  let source: MediaToolSource | null = null;
  const sources: Array<{ value: string | undefined; source: MediaToolSource; label: string }> = [
    { value: input.settingsPath, source: 'settings', label: 'Die Einstellung „ffmpegPath“' },
    { value: env.FFMPEG_PATH, source: 'env', label: 'FFMPEG_PATH' },
  ];
  for (const candidate of sources) {
    const value = candidate.value?.trim();
    if (!value) continue;
    const file = explicit(value, 'ffmpeg');
    if (file) {
      ffmpeg = file;
      source = candidate.source;
      break;
    }
    warnings.push(`${candidate.label} zeigt auf „${value}“, dort liegt kein ausführbares ffmpeg.`);
  }
  if (!ffmpeg) {
    const found = findIn(searchDirs, 'ffmpeg');
    if (found) {
      ffmpeg = found.file;
      source = found.source;
    }
  }

  let ffprobe: string | null = null;
  const probeValue = env.FFPROBE_PATH?.trim();
  if (probeValue) {
    ffprobe = explicit(probeValue, 'ffprobe');
    if (!ffprobe) warnings.push(`FFPROBE_PATH zeigt auf „${probeValue}“, dort liegt kein ausführbares ffprobe.`);
  }
  if (!ffprobe && ffmpeg) {
    const sibling = p.join(p.dirname(ffmpeg), exe('ffprobe'));
    if (isExec(sibling)) ffprobe = sibling;
  }
  ffprobe ??= findIn(searchDirs, 'ffprobe')?.file ?? null;

  const missing = !ffmpeg || !ffprobe ? ffmpegMissingMessage(platform, !ffmpeg && !ffprobe ? 'beide' : !ffmpeg ? 'ffmpeg' : 'ffprobe') : null;
  const message = [missing, ...warnings].filter(Boolean).join('\n\n') || null;
  return { ffmpeg, ffprobe, source, message, warnings };
}

/** Deutscher Hinweis mit dem passenden Installationsbefehl. */
export function ffmpegMissingMessage(platform: NodeJS.Platform, missing: 'ffmpeg' | 'ffprobe' | 'beide' = 'beide'): string {
  const what = missing === 'beide' ? 'ffmpeg und ffprobe wurden' : `${missing} wurde`;
  const install =
    platform === 'darwin'
      ? 'Im Terminal installieren: `brew install ffmpeg` (Homebrew: https://brew.sh).'
      : platform === 'win32'
        ? 'In PowerShell installieren: `winget install Gyan.FFmpeg`.'
        : 'Über die Paketverwaltung installieren, z. B. `sudo apt install ffmpeg`.';
  return (
    `**${what} nicht gefunden.** Director Studio braucht beide für Vorschaubilder, Ton, Lautheit und den Video-Export. ` +
    `${install} Danach Director Studio neu starten. Alternativ den Pfad über die Umgebungsvariable \`FFMPEG_PATH\` ` +
    'oder als `ffmpegPath` in der `settings.json` im Datenordner angeben.'
  );
}

/**
 * PATH für Kindprozesse einer GUI-App: unter macOS fehlen ohne Login-Shell die Homebrew-Ordner. Fehlende Ordner
 * werden vorne ergänzt (wie `brew shellenv`); andere Plattformen bleiben unverändert.
 */
export function extendGuiPath(platform: NodeJS.Platform, current: string | undefined): string | undefined {
  if (platform !== 'darwin') return current;
  const parts = (current ?? '').split(':').filter(Boolean);
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'].filter((dir) => !parts.includes(dir));
  return [...extra, ...(parts.length > 0 ? parts : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
}

function uniqueDirs(platform: NodeJS.Platform, dirs: SearchDir[]): SearchDir[] {
  const seen = new Set<string>();
  const out: SearchDir[] = [];
  for (const entry of dirs) {
    const key = platform === 'win32' ? entry.dir.toLowerCase().replace(/[\\/]+$/, '') : entry.dir.replace(/\/+$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function defaultIsExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultListDir(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function safeList(listDir: (dir: string) => string[], dir: string): string[] {
  try {
    return listDir(dir);
  } catch {
    return [];
  }
}
