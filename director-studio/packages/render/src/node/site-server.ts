import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VIEWPORTS } from '@studio/core';
import { PICKER_SCRIPT } from '../picker/picker-script.ts';
import { escapeScriptContent } from '../util/html.ts';
import { getDefaultBrowserPool, type BrowserPool } from './chromium.ts';
import { waitForPageAssets } from './html-render.ts';
import { PathError, resolveSafePath, sendFile } from './static-server.ts';

/**
 * Vorschau-Server für Websites.
 *
 * - `html`: eigener kleiner Node-HTTP-Server (nur 127.0.0.1): korrekte MIME-Typen, Range, `index.html`
 *   für Verzeichnisse, `.html`-Endung optional, SPA-Fallback auf `/index.html` für Pfade ohne Endung,
 *   Schutz gegen Pfad-Traversal/Symlinks/versteckte Dateien. Mit `injectPicker` wird `PICKER_SCRIPT`
 *   vor `</body>` jeder HTML-Antwort eingefügt.
 * - `vite-react`: startet das lokale `vite` (aus `node_modules` des Site-Ordners oder des Monorepos)
 *   als Kindprozess mit BEREINIGTER Umgebung (keine Variablen mit KEY/TOKEN/SECRET/PASSWORD/…) und
 *   einer app-eigenen Konfigurationsdatei in einem Temp-Ordner. Diese lädt die Konfiguration der Site
 *   (falls vorhanden), erzwingt `host: 127.0.0.1`, festen Port, `server.fs.strict` und hängt ein kleines
 *   Vite-Plugin an, das den Picker per `transformIndexHtml` einfügt. Die URL wird aus stdout gelesen.
 *   In Electron: `nodePath` auf eine Node-Laufzeit setzen (oder `ELECTRON_RUN_AS_NODE` erlauben) –
 *   langfristig im `utilityProcess` über die Vite-JS-API starten.
 */

export interface SiteServerOptions {
  port?: number;
  injectPicker?: boolean;
  framework?: 'html' | 'vite-react';
  /** Nur `vite-react`: Node-Binary (Standard: `process.execPath`). */
  nodePath?: string;
  /** Nur `vite-react`: Pfad zu `vite/bin/vite.js` (Standard: automatisch gesucht). */
  viteBin?: string;
  /** Nur `vite-react`: Startzeitlimit in ms (Standard 30000). */
  startTimeoutMs?: number;
  /** Zusätzliche (unkritische) Umgebungsvariablen für den Dev-Server. */
  env?: Record<string, string>;
}

const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|SESSION|COOKIE/i;
const SECRET_PREFIXES = ['ANTHROPIC_', 'FAL_', 'OPENAI_', 'AWS_', 'AZURE_', 'GOOGLE_', 'GCP_', 'GH_', 'GITHUB_', 'NPM_CONFIG_', 'VERCEL_', 'NETLIFY_', 'CLOUDFLARE_'];

/** Entfernt Geheimnisse aus einer Umgebung (Schlüssel, Tokens, Passwörter, Anbieter-Präfixe, NODE_OPTIONS). */
export function scrubEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_ENV.test(key)) continue;
    if (SECRET_PREFIXES.some((p) => key.toUpperCase().startsWith(p))) continue;
    if (key === 'NODE_OPTIONS' || key === 'NODE_PATH' || key.startsWith('npm_')) continue;
    out[key] = value;
  }
  return out;
}

/** Fügt das Picker-Skript vor `</body>` ein (oder ans Ende). Idempotent. */
export function injectPickerIntoHtml(html: string): string {
  if (html.includes('data-studio-picker-script')) return html;
  const tag = `<script data-studio-picker-script>${escapeScriptContent(PICKER_SCRIPT)}</script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  return idx >= 0 ? `${html.slice(0, idx)}${tag}\n${html.slice(idx)}` : `${html}\n${tag}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Sucht `vite/bin/vite.js`: erst aufwärts ab dem Site-Ordner, dann im Monorepo. */
export function findViteBin(siteDir: string): string | undefined {
  let dir = path.resolve(siteDir);
  for (;;) {
    const bin = path.join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
    const js = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
    if (existsSync(js)) return js;
    if (existsSync(bin) && process.platform !== 'win32') {
      try {
        return realpathSync(bin);
      } catch {
        // weiter suchen
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('vite/package.json');
    const js = path.join(path.dirname(pkg), 'bin', 'vite.js');
    return existsSync(js) ? js : undefined;
  } catch {
    return undefined;
  }
}

const VITE_CONFIG_NAMES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cts', 'vite.config.cjs'];

function viteWrapperConfig(siteDir: string, port: number, injectPicker: boolean): string {
  const userConfig = VITE_CONFIG_NAMES.map((n) => path.join(siteDir, n)).find((p) => existsSync(p));
  return `// Automatisch erzeugt von @studio/render (SiteServer) – nicht bearbeiten.
${userConfig ? `import userConfig from ${JSON.stringify(pathToFileURL(userConfig).href)};` : 'const userConfig = {};'}
const PICKER = ${JSON.stringify(injectPicker ? PICKER_SCRIPT : '')};
const ROOT = ${JSON.stringify(siteDir)};
const studioPicker = {
  name: 'studio-picker',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler() {
      return PICKER ? [{ tag: 'script', attrs: { 'data-studio-picker-script': '' }, children: PICKER, injectTo: 'body' }] : [];
    },
  },
};
export default async function studioConfig(env) {
  let user = userConfig;
  if (typeof user === 'function') user = await user(env);
  user = (await user) || {};
  const server = user.server || {};
  return {
    ...user,
    root: user.root || ROOT,
    clearScreen: false,
    logLevel: 'info',
    plugins: [...(user.plugins || []), studioPicker],
    server: { ...server, host: '127.0.0.1', port: ${port}, strictPort: true, open: false, fs: { ...(server.fs || {}), strict: true } },
  };
}
`;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export class SiteServer {
  readonly url: string;
  readonly framework: 'html' | 'vite-react';
  /** Ausgaben des Dev-Servers (nur `vite-react`). */
  readonly logs: string[] = [];
  private readonly httpServer: Server | undefined;
  private readonly child: ChildProcess | undefined;
  private readonly tmpDir: string | undefined;

  private constructor(init: { url: string; framework: 'html' | 'vite-react'; httpServer?: Server; child?: ChildProcess; tmpDir?: string; logs?: string[] }) {
    this.url = init.url;
    this.framework = init.framework;
    this.httpServer = init.httpServer;
    this.child = init.child;
    this.tmpDir = init.tmpDir;
    if (init.logs) this.logs = init.logs;
  }

  static async start(siteDir: string, opts: SiteServerOptions = {}): Promise<SiteServer> {
    const root = path.resolve(siteDir);
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`Site-Ordner „${root}“ existiert nicht`);
    return (opts.framework ?? 'html') === 'vite-react' ? SiteServer.startVite(root, opts) : SiteServer.startStatic(root, opts);
  }

  private static async startStatic(root: string, opts: SiteServerOptions): Promise<SiteServer> {
    const server = createServer((req, res) => {
      void handleStatic(root, req, res, !!opts.injectPicker);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    return new SiteServer({ url: `http://127.0.0.1:${port}/`, framework: 'html', httpServer: server });
  }

  private static async startVite(root: string, opts: SiteServerOptions): Promise<SiteServer> {
    const viteBin = opts.viteBin ?? findViteBin(root);
    if (!viteBin) throw new Error('Vite wurde nicht gefunden (weder im Site-Ordner noch im Monorepo)');
    const port = opts.port ?? (await freePort());
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'studio-vite-'));
    const configFile = path.join(tmpDir, 'vite.config.studio.mjs');
    await writeFile(configFile, viteWrapperConfig(root, port, !!opts.injectPicker), 'utf8');
    const env = {
      ...scrubEnv(process.env),
      ...scrubEnv(opts.env ?? {}),
      BROWSER: 'none',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      ...(process.versions.electron && !opts.nodePath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    };
    const child = spawn(opts.nodePath ?? process.execPath, [viteBin, '--config', configFile, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const logs: string[] = [];
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Vite ist nicht rechtzeitig gestartet:\n${logs.join('').slice(-2000)}`)), opts.startTimeoutMs ?? 30000);
        let buffer = '';
        const onData = (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          logs.push(text);
          if (logs.length > 500) logs.splice(0, logs.length - 500);
          buffer += text.replace(ANSI, '');
          const m = /Local:\s+(https?:\/\/[^\s]+)/.exec(buffer);
          if (m) {
            clearTimeout(timer);
            resolve(m[1]!.endsWith('/') ? m[1]! : `${m[1]}/`);
          }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Vite wurde beendet (Code ${code}):\n${logs.join('').slice(-2000)}`));
        });
        child.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return new SiteServer({ url, framework: 'vite-react', child, tmpDir, logs });
    } catch (error) {
      child.kill('SIGKILL');
      await rm(tmpDir, { recursive: true, force: true });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.closeAllConnections?.();
        this.httpServer!.close(() => resolve());
      });
    }
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    if (this.tmpDir) await rm(this.tmpDir, { recursive: true, force: true });
  }
}

async function handleStatic(root: string, req: IncomingMessage, res: ServerResponse, injectPicker: boolean): Promise<void> {
  const security = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...security }).end();
      return;
    }
    const rawPath = (req.url ?? '/').split('?')[0]!.split('#')[0]!;
    const { path: resolved, realRoot } = await resolveSafePath(root, rawPath);
    let file = resolved;
    let info = await stat(file).catch(() => undefined);
    if (info?.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => undefined);
    }
    if (!info && !path.extname(resolved)) {
      const withHtml = `${resolved}.html`;
      info = await stat(withHtml).catch(() => undefined);
      if (info) file = withHtml;
      else {
        file = path.join(realRoot, 'index.html');
        info = await stat(file).catch(() => undefined);
      }
    }
    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...security }).end('Nicht gefunden');
      return;
    }
    if (/\.html?$/i.test(file)) {
      let html = await readFile(file, 'utf8');
      if (injectPicker) html = injectPickerIntoHtml(html);
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, ...security });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    await sendFile(req, res, file, security);
  } catch (error) {
    const status = error instanceof PathError ? error.status : 500;
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...security });
    res.end(status === 403 ? 'Verboten' : status === 404 ? 'Nicht gefunden' : status === 400 ? 'Ungültige Anfrage' : 'Serverfehler');
  }
}

export type SiteViewport = 'mobile' | 'tablet' | 'desktop' | { width: number; height: number; name?: string };

export interface ScreenshotSiteOptions {
  viewports: SiteViewport[];
  outDir: string;
  fullPage?: boolean;
  pool?: BrowserPool;
  /** Zusätzliche Wartezeit nach dem Laden (ms), z. B. für Animationen. */
  settleMs?: number;
  /** Navigationszeitlimit (Standard 30000 ms). */
  timeoutMs?: number;
  /** Fremde Hosts erlauben (Standard: true – Websites dürfen z. B. Fonts laden; für strikt lokal `false`). */
  allowRemote?: boolean;
}

export interface ScreenshotSiteResult {
  shots: Array<{ viewport: string; path: string; width: number; height: number }>;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/** Screenshots einer URL in mehreren Viewports + Konsolen-/Seitenfehler und fehlgeschlagene Anfragen. */
export async function screenshotSite(url: string, opts: ScreenshotSiteOptions): Promise<ScreenshotSiteResult> {
  await mkdir(opts.outDir, { recursive: true });
  const pool = opts.pool ?? getDefaultBrowserPool();
  const result: ScreenshotSiteResult = { shots: [], consoleErrors: [], pageErrors: [], failedRequests: [] };
  const push = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  for (const vp of opts.viewports) {
    const spec = typeof vp === 'string' ? { name: vp, ...VIEWPORTS[vp] } : { name: vp.name ?? `${vp.width}x${vp.height}`, width: vp.width, height: vp.height };
    const mobile = spec.name === 'mobile';
    const file = path.join(opts.outDir, `${spec.name.replace(/[^\w.-]/g, '_')}.png`);
    await pool.withPage(
      { width: spec.width, height: spec.height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, blockRemote: opts.allowRemote === false },
      async (page) => {
        page.on('console', (msg) => {
          if (msg.type() === 'error') push(result.consoleErrors, msg.text());
        });
        page.on('pageerror', (err) => push(result.pageErrors, err.message));
        page.on('requestfailed', (req) => push(result.failedRequests, `${req.url()} (${req.failure()?.errorText ?? 'Fehler'})`));
        page.on('response', (res) => {
          if (res.status() >= 400) push(result.failedRequests, `${res.url()} (HTTP ${res.status()})`);
        });
        await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 30000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        await waitForPageAssets(page, 5000);
        if (opts.settleMs) await page.waitForTimeout(opts.settleMs);
        await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, animations: 'disabled', caret: 'hide' });
      },
    );
    result.shots.push({ viewport: spec.name, path: file, width: spec.width, height: spec.height });
  }
  return result;
}
