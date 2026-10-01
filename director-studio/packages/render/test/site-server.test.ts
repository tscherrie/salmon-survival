import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool, buildSiteZip, createZip, readPngSize, scrubEnv, screenshotSite, SiteServer, spawnNodeLauncher, type NodeChild, type NodeLauncher } from '../src/index.ts';
import { HAS_CHROMIUM, solidPng, testChromiumPath, tmpDir } from './helpers.ts';

let base: string;
let site: string;
const pool = new BrowserPool({ executablePath: testChromiumPath() });

/** Rohe HTTP-Anfrage (ohne URL-Normalisierung, damit `..` wirklich beim Server ankommt). */
function rawGet(url: string, rawPath: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: rawPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  base = await tmpDir();
  site = path.join(base, 'site');
  await mkdir(path.join(site, 'css'), { recursive: true });
  await mkdir(path.join(site, 'assets'), { recursive: true });
  await mkdir(path.join(site, 'node_modules', 'paket'), { recursive: true });
  await writeFile(
    path.join(site, 'index.html'),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Test</title><link rel="stylesheet" href="/css/app.css"></head>
<body><main data-sid="hero" data-src="index.html:2:1"><h1>Hallo Website</h1><img src="/assets/logo.png" width="40" height="40"><img src="/assets/fehlt.png"></main>
<script>console.error('Absichtlicher Konsolenfehler'); setTimeout(() => { throw new Error('Absichtlicher Seitenfehler'); }, 0);</script>
</body></html>`,
  );
  await writeFile(path.join(site, 'about.html'), '<!doctype html><html><body><p>Über uns</p></body></html>');
  await writeFile(path.join(site, 'css', 'app.css'), 'body { margin: 0; font-family: sans-serif; background: #f6f1e7; } h1 { color: #ff5a36; font-size: 48px; }');
  await writeFile(path.join(site, 'assets', 'logo.png'), solidPng(40, 40, [255, 90, 54]));
  await writeFile(path.join(site, '.env'), 'GEHEIM=1');
  await writeFile(path.join(site, 'node_modules', 'paket', 'index.js'), 'module.exports = 1;');
  await writeFile(path.join(base, 'secret.txt'), 'STRENG GEHEIM');
  await symlink(path.join(base, 'secret.txt'), path.join(site, 'link.txt'));
});

afterAll(async () => {
  await pool.close();
  await rm(base, { recursive: true, force: true });
});

describe('SiteServer (html)', () => {
  it('liefert Dateien mit MIME-Typen, Range, Fallbacks und Picker', async () => {
    const server = await SiteServer.start(site, { injectPicker: true });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const index = await fetch(server.url);
      expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const html = await index.text();
      expect(html).toContain('Hallo Website');
      expect(html).toMatch(/<script data-studio-picker-script>[\s\S]*__studioPicker[\s\S]*<\/script>\n<\/body>/);
      const css = await fetch(new URL('/css/app.css', server.url));
      expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
      const png = await fetch(new URL('/assets/logo.png', server.url));
      expect(png.headers.get('content-type')).toBe('image/png');
      expect(readPngSize(new Uint8Array(await png.arrayBuffer()))).toEqual({ width: 40, height: 40 });
      const range = await fetch(new URL('/assets/logo.png', server.url), { headers: { Range: 'bytes=0-7' } });
      expect(range.status).toBe(206);
      expect(range.headers.get('content-range')).toMatch(/^bytes 0-7\/\d+$/);
      expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect((await fetch(new URL('/assets/logo.png', server.url), { headers: { Range: 'bytes=99999-' } })).status).toBe(416);
      expect(await (await fetch(new URL('/about', server.url))).text()).toContain('Über uns');
      expect(await (await fetch(new URL('/irgendwo/tief', server.url))).text()).toContain('Hallo Website');
      expect((await fetch(new URL('/fehlt.js', server.url))).status).toBe(404);
      expect((await fetch(new URL('/.env', server.url))).status).toBe(404);
      expect((await fetch(server.url, { method: 'POST' })).status).toBe(405);
    } finally {
      await server.stop();
    }
  });

  it('blockiert Pfad-Traversal und Symlinks nach außen', async () => {
    const server = await SiteServer.start(site);
    try {
      for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/css/../../secret.txt', '/link.txt', '/..\\secret.txt']) {
        const res = await rawGet(server.url, p);
        expect([400, 403, 404], p).toContain(res.status);
        expect(res.body.toString(), p).not.toContain('STRENG GEHEIM');
      }
      expect((await rawGet(server.url, '/%00')).status).toBe(400);
      const head = await rawGet(server.url, '/index.html', {}, 'HEAD');
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      // ohne injectPicker kein Skript
      expect(await (await fetch(server.url)).text()).not.toContain('data-studio-picker-script');
    } finally {
      await server.stop();
    }
  });

  it('scrubEnv entfernt Schlüssel, Tokens und Geheimnisse', () => {
    const env = scrubEnv({ PATH: '/usr/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'a', FAL_KEY: 'b', GITHUB_TOKEN: 'c', MY_SECRET: 'd', db_password: 'e', NODE_OPTIONS: '--require x', LANG: 'de_DE.UTF-8' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'de_DE.UTF-8' });
  });
});

describe.skipIf(!HAS_CHROMIUM)('screenshotSite', () => {
  it('zwei Viewports, Konsolen- und Seitenfehler, fehlgeschlagene Anfragen', async () => {
    const server = await SiteServer.start(site, { injectPicker: true });
    try {
      const outDir = path.join(base, 'shots');
      const result = await screenshotSite(server.url, { viewports: ['mobile', { width: 1280, height: 800 }], outDir, pool, settleMs: 50 });
      expect(result.shots.map((s) => s.viewport)).toEqual(['mobile', '1280x800']);
      // mobile: 390×844 @2x (Chromium rundet die Höhe bei Mobil-Emulation ggf. um 1 px ab)
      const mobile = readPngSize(await readFile(result.shots[0]!.path));
      expect(mobile.width).toBe(780);
      expect(Math.abs(mobile.height - 1688)).toBeLessThanOrEqual(2);
      expect(readPngSize(await readFile(result.shots[1]!.path))).toEqual({ width: 1280, height: 800 });
      expect(result.consoleErrors.some((e) => e.includes('Absichtlicher Konsolenfehler'))).toBe(true);
      expect(result.pageErrors.some((e) => e.includes('Absichtlicher Seitenfehler'))).toBe(true);
      expect(result.failedRequests.some((e) => e.includes('/assets/fehlt.png') && e.includes('404'))).toBe(true);
      const full = await screenshotSite(new URL('/about', server.url).href, { viewports: ['desktop'], outDir: path.join(base, 'full'), pool, fullPage: true });
      expect(full.consoleErrors).toEqual([]);
      expect(readPngSize(await readFile(full.shots[0]!.path)).width).toBe(1440);
    } finally {
      await server.stop();
    }
  });
});

describe('SiteServer (vite-react)', () => {
  it('startet Vite mit bereinigter Umgebung, Nutzerkonfiguration und Picker', async () => {
    const vsite = path.join(base, 'vite-site');
    await mkdir(path.join(vsite, 'src'), { recursive: true });
    await writeFile(path.join(vsite, 'index.html'), '<!doctype html><html><head><title>Vite</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>');
    await writeFile(path.join(vsite, 'src', 'main.js'), "document.getElementById('app').textContent = 'Hallo aus Vite';\n");
    await writeFile(
      path.join(vsite, 'vite.config.js'),
      `export default { plugins: [{ name: 'nutzer-plugin', transformIndexHtml: (html) => html.replace('</head>', '<meta name="nutzer-plugin" content="ja"><meta name="env-key" content="' + (process.env.STUDIO_TEST_API_KEY ?? 'keiner') + '"></head>') }] };\n`,
    );
    process.env.STUDIO_TEST_API_KEY = 'sk-geheim';
    let server: SiteServer | undefined;
    try {
      server = await SiteServer.start(vsite, { framework: 'vite-react', injectPicker: true });
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const html = await (await fetch(server.url)).text();
      expect(html).toContain('<meta name="nutzer-plugin" content="ja">');
      expect(html).toContain('<meta name="env-key" content="keiner">');
      expect(html).not.toContain('sk-geheim');
      expect(html).toContain('data-studio-picker-script');
      expect(html).toContain('__studioPicker');
      const js = await (await fetch(new URL('/src/main.js', server.url))).text();
      expect(js).toContain('Hallo aus Vite');
      // fs.strict: Dateien außerhalb des Projekts werden nicht ausgeliefert
      const outside = await fetch(new URL(`/@fs${path.join(base, 'secret.txt')}`, server.url));
      expect(await outside.text()).not.toContain('STRENG GEHEIM');
    } finally {
      delete process.env.STUDIO_TEST_API_KEY;
      await server?.stop();
    }
  }, 60000);

  it('startet Vite über einen übergebenen Launcher (in der App: utilityProcess) und beendet ihn mit stop()', async () => {
    const vsite = path.join(base, 'vite-launcher');
    await mkdir(vsite, { recursive: true });
    await writeFile(path.join(vsite, 'index.html'), '<!doctype html><html><head><title>Launcher</title></head><body>Über den Launcher</body></html>');
    const calls: Array<{ script: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
    const inner = spawnNodeLauncher();
    let child: NodeChild | undefined;
    const launcher: NodeLauncher = (script, args, options) => {
      calls.push({ script, args, cwd: options.cwd, env: options.env });
      child = inner(script, args, options);
      return child;
    };
    process.env.STUDIO_TEST_TOKEN = 'geheim';
    const server = await SiteServer.start(vsite, { framework: 'vite-react', launcher });
    try {
      expect(calls).toHaveLength(1);
      expect(calls[0]!.script).toMatch(/vite\.js$/);
      expect(calls[0]!.args).toEqual(expect.arrayContaining(['--strictPort', '--host', '127.0.0.1']));
      expect(calls[0]!.cwd).toBe(path.resolve(vsite));
      // Bereinigte Umgebung; ELECTRON_RUN_AS_NODE setzt nur der Standard-Launcher in Electron.
      expect(calls[0]!.env.STUDIO_TEST_TOKEN).toBeUndefined();
      expect(calls[0]!.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(await (await fetch(server.url)).text()).toContain('Über den Launcher');
    } finally {
      delete process.env.STUDIO_TEST_TOKEN;
      await server.stop();
    }
    const state = await Promise.race([child!.exited.then(() => 'beendet'), new Promise((resolve) => setTimeout(() => resolve('läuft noch'), 5000))]);
    expect(state).toBe('beendet');
  }, 60000);
});

describe('buildSiteZip', () => {
  it('packt die Site ohne node_modules/.env/Symlinks als gültiges ZIP', async () => {
    const out = path.join(base, 'site.zip');
    const info = await buildSiteZip(site, out);
    expect(info.files).toBe(4);
    const list = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    expect(list).toEqual(['about.html', 'assets/logo.png', 'css/app.css', 'index.html']);
    const test = execFileSync('unzip', ['-t', out], { encoding: 'utf8' });
    expect(test).toContain('No errors detected');
    expect(execFileSync('unzip', ['-p', out, 'css/app.css'], { encoding: 'utf8' })).toContain('#ff5a36');
    const png = execFileSync('unzip', ['-p', out, 'assets/logo.png']);
    expect(readPngSize(png)).toEqual({ width: 40, height: 40 });
  });

  it('createZip: UTF-8-Namen, gespeicherte und komprimierte Einträge, Schutz vor ..', async () => {
    const zip = createZip([
      { name: 'grüße/text.txt', data: Buffer.from('Hallo '.repeat(200)) },
      { name: 'bin.dat', data: new Uint8Array([1, 2, 3]) },
    ]);
    const file = path.join(base, 'u.zip');
    await writeFile(file, zip);
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toContain('No errors detected');
    expect(execFileSync('unzip', ['-p', file, 'grüße/text.txt'], { encoding: 'utf8' })).toBe('Hallo '.repeat(200));
    expect(() => createZip([{ name: '../böse', data: new Uint8Array(1) }])).toThrow('Ungültiger Archivpfad');
  });
});
