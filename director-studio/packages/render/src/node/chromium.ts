import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/**
 * Gemeinsamer, verzögert gestarteter Chromium (Playwright) für HTML→PNG/PDF, Deck/Leinwand und
 * Website-Screenshots. Pfad zur Chromium-Binärdatei: Option `executablePath`, sonst Umgebungsvariable
 * `STUDIO_CHROMIUM_PATH`, sonst Playwrights Standard. In der App wird die Headless-Shell gesetzt, die
 * zu Electrons Chromium passt (gleiches Rendering wie Bühne und Remotion).
 */

export const CHROMIUM_ENV_VAR = 'STUDIO_CHROMIUM_PATH';

export function resolveChromiumExecutable(explicit?: string): string | undefined {
  return explicit || process.env[CHROMIUM_ENV_VAR] || undefined;
}

export interface BrowserPoolOptions {
  executablePath?: string;
  /** Zusätzliche Chromium-Argumente. */
  args?: string[];
}

export interface PageOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  /** Anfragen an fremde Hosts (nicht localhost/127.0.0.1) blockieren. Standard: false. */
  blockRemote?: boolean;
  /** JavaScript der Seite ausführen. Standard: true. */
  javaScriptEnabled?: boolean;
}

export class BrowserPool {
  private launching: Promise<Browser> | undefined;
  private readonly opts: BrowserPoolOptions;

  constructor(opts: BrowserPoolOptions = {}) {
    this.opts = opts;
  }

  /** Startet Chromium beim ersten Aufruf (und nach einem Absturz erneut). */
  async browser(): Promise<Browser> {
    if (this.launching) {
      const b = await this.launching.catch(() => undefined);
      if (b?.isConnected()) return b;
    }
    const executablePath = resolveChromiumExecutable(this.opts.executablePath);
    this.launching = chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ['--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', ...(this.opts.args ?? [])],
    });
    return this.launching;
  }

  /** Neue isolierte Seite (eigener Kontext), wird nach `fn` geschlossen. */
  async withPage<T>(opts: PageOptions, fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
    const browser = await this.browser();
    const context = await browser.newContext({
      viewport: { width: Math.max(1, Math.round(opts.width)), height: Math.max(1, Math.round(opts.height)) },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
      isMobile: opts.isMobile ?? false,
      hasTouch: opts.hasTouch ?? false,
      javaScriptEnabled: opts.javaScriptEnabled ?? true,
      locale: 'de-DE',
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    try {
      if (opts.blockRemote) {
        await context.route(/^https?:\/\//, (route) => {
          const host = new URL(route.request().url()).hostname;
          if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return route.continue();
          return route.abort('blockedbyclient');
        });
      }
      const page = await context.newPage();
      return await fn(page, context);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const pending = this.launching;
    this.launching = undefined;
    if (!pending) return;
    const browser = await pending.catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

let defaultPool: BrowserPool | undefined;

/** Geteilter Standard-Pool (Pfad aus `STUDIO_CHROMIUM_PATH`). */
export function getDefaultBrowserPool(): BrowserPool {
  defaultPool ??= new BrowserPool();
  return defaultPool;
}

/** Schließt den Standard-Pool (z. B. beim Beenden des Workers). */
export async function closeDefaultBrowserPool(): Promise<void> {
  const pool = defaultPool;
  defaultPool = undefined;
  await pool?.close();
}
