import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Chromium-Headless-Shell der ausgelieferten App (Remotion rendert damit, Playwright nutzt dieselbe Datei).
 *
 * Geladen wird sie von Remotions `ensureBrowser` – aber NIE im Hauptprozess: Remotion hängt jeden Aufruf an ein
 * modulweites Promise an (`currentEnsureBrowserOperation = currentEnsureBrowserOperation.then(…)`), und auch jedes
 * Rendern läuft darüber (`internalOpenBrowser`). Scheitert ein Download einmal (offline, Proxy), bliebe dieses Promise
 * abgelehnt, und jedes weitere Rendern scheiterte bis zum Neustart mit demselben Fehler. Deshalb lädt ein eigener
 * Hilfsprozess (`chromium-worker.ts`, in Electron ein utilityProcess); ein erneuter Versuch startet einen neuen.
 */

/** Antwort des Hilfsprozesses. */
export type ChromiumWorkerResult = { ok: true; path: string } | { ok: false; message: string };

/** Minimale Sicht auf den Hilfsprozess (Electron-utilityProcess oder – in Tests – `child_process.fork`). */
export interface WorkerProcess {
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type ForkWorker = (modulePath: string, options: { cwd: string }) => WorkerProcess;

/**
 * Startet den Hilfsprozess im Arbeitsordner `cwd` (Remotions Cache liegt relativ dazu) und liefert den Pfad zur
 * Headless-Shell. Lehnt mit der Meldung des Hilfsprozesses ab; der Zustand des Hauptprozesses bleibt unberührt.
 */
export function runChromiumWorker(fork: ForkWorker, workerPath: string, cwd: string, timeoutMs = 20 * 60_000): Promise<string> {
  return new Promise((resolvePath, reject) => {
    let done = false;
    const child = fork(workerPath, { cwd });
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // schon beendet
      }
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs / 60_000)} min`))), timeoutMs);
    child.onMessage((message) =>
      finish(() => {
        const result = message as Partial<ChromiumWorkerResult> | null;
        if (result?.ok === true && typeof result.path === 'string') resolvePath(result.path);
        else reject(new Error(result && result.ok === false && typeof result.message === 'string' ? result.message : 'Unerwartete Antwort des Hilfsprozesses'));
      }),
    );
    child.onExit((code) => finish(() => reject(new Error(`Der Hilfsprozess wurde vorzeitig beendet (Code ${code ?? '–'})`))));
  });
}

/** Plattform-Kennung, unter der Remotion die Headless-Shell ablegt (wie `BrowserFetcher.getPlatform`). */
export function remotionBrowserPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux64';
  if (platform === 'win32') return 'win64';
  return null;
}

/**
 * Remotions Cache-Ordner für einen Arbeitsordner: der nächste Ordner mit `package.json` (aufwärts) +
 * `node_modules/.remotion` – wie `getDownloadsCacheDir` in @remotion/renderer. In der gepackten App ist das
 * `<userData>/runtime/node_modules/.remotion` (siehe `prepareRuntimeDir`).
 */
export function remotionCacheDir(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    try {
      if (statSync(join(dir, 'package.json')).isFile()) return join(dir, 'node_modules', '.remotion');
    } catch {
      // weiter nach oben
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd, '.remotion');
    dir = parent;
  }
}

/** Erwarteter Ort der Headless-Shell in Remotions Cache (ausführbare Datei und VERSION-Datei). */
export function headlessShellLocation(cwd: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): { executable: string; versionFile: string } | null {
  const id = remotionBrowserPlatform(platform, arch);
  if (!id) return null;
  const folder = join(remotionCacheDir(cwd), 'chrome-headless-shell');
  const binary = id === 'win64' ? 'chrome-headless-shell.exe' : id === 'linux-arm64' ? 'headless_shell' : 'chrome-headless-shell';
  return { executable: join(folder, id, `chrome-headless-shell-${id}`, binary), versionFile: join(folder, 'VERSION') };
}

/**
 * Bereits geladene Headless-Shell (aus einer früheren Sitzung) – nur zur Anzeige (Hilfe → Systemprüfung). Ob die
 * Version zu Remotion passt, entscheidet beim Rendern der Hilfsprozess (lädt bei Bedarf neu).
 */
export function cachedHeadlessShell(cwd: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): { path: string; version: string | null } | null {
  const location = headlessShellLocation(cwd, platform, arch);
  if (!location || !existsSync(location.executable)) return null;
  let version: string | null = null;
  try {
    version = readFileSync(location.versionFile, 'utf8').trim() || null;
  } catch {
    // ohne VERSION-Datei
  }
  return { path: location.executable, version };
}
