import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('Electron-App startet, Preload-API und IPC funktionieren', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'dstudio-electron-'));
  const app = await electron.launch({
    executablePath: require('electron') as unknown as string,
    args: [appDir, '--no-sandbox'],
    env: { ...process.env, STUDIO_SMOKE_TEST: '1', STUDIO_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
  });
  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (e) => errors.push(e.message));
    await window.waitForLoadState('domcontentloaded');
    expect(await window.title()).toContain('Director Studio');

    // Sicherheit: Renderer hat keinen Node-Zugriff.
    expect(await window.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    expect(await window.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');

    // Preload-API vorhanden, IPC-Rundreise funktioniert.
    const settings = await window.evaluate(() => (window as unknown as { studio: { getSettings(): Promise<{ language: string }> } }).studio.getSettings());
    expect(settings.language).toBe('de');
    const auth = await window.evaluate(() => (window as unknown as { studio: { getAuthStatus(): Promise<{ active: string | null }> } }).studio.getAuthStatus());
    expect(auth).toHaveProperty('active');
    const projectsDir = join(userData, 'projects');
    const snapshot = await window.evaluate(
      (dir) => (window as unknown as { studio: { createProject(i: unknown): Promise<{ manifest: { title: string; id: string }; document: { kind: string } }> } }).studio.createProject({ title: 'Smoke', category: 'slides', directory: dir }),
      projectsDir,
    );
    expect(snapshot.manifest.title).toBe('Smoke');
    expect(snapshot.document.kind).toBe('deck');
    // Fehler aus dem Main-Prozess kommen als echte Errors im Renderer an.
    const err = await window.evaluate(() =>
      (window as unknown as { studio: { openProject(p: string): Promise<unknown> } }).studio.openProject('/gibt/es/nicht').then(
        () => 'ok',
        (e: Error) => e.message,
      ),
    );
    expect(err).toContain('Kein Director-Studio-Projekt');
    // Asset-Protokoll antwortet (404 für unbekannte Assets, kein Absturz).
    const status = await window.evaluate((id) => fetch(`studio-asset://${id}/unbekannt`).then((r) => r.status, () => -1), snapshot.manifest.id);
    expect(status).toBe(404);
    await window.screenshot({ path: join(appDir, 'test-results', 'electron-smoke.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyStudio = { studio: Record<string, (...args: any[]) => Promise<any>> & { onEvent(listener: (e: any) => void): () => void } };

test('Hauptfenster und Web-Vorschau sind abgeschottet, Picks nur über den abgesicherten Kanal', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'dstudio-electron-'));
  // Fremder lokaler Server als Exfiltrationsziel: darf von der Vorschau nie erreicht werden.
  let leaked = 0;
  const other = createServer((_req, res) => {
    leaked++;
    res.end('ok');
  });
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const leakUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/leak`;
  const app = await electron.launch({
    executablePath: require('electron') as unknown as string,
    args: [appDir, '--no-sandbox'],
    env: { ...process.env, STUDIO_SMOKE_TEST: '1', STUDIO_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const appUrl = window.url();

    // Externe Links: ohne Nutzergeste lehnt der Main-Prozess ab.
    await app.evaluate(({ shell }) => {
      (globalThis as any).__opened = [];
      shell.openExternal = async (url: string) => {
        (globalThis as any).__opened.push(url);
      };
    });
    const noGesture = await window.evaluate(() => (window as unknown as AnyStudio).studio.openExternal!('https://example.com/').then(() => 'ok', (e: Error) => e.message));
    expect(noGesture).toContain('Klick');

    // Navigationssperre: Das Hauptfenster verlässt den App-Einstieg nicht (auch nicht zu anderen file://-Seiten).
    await window.evaluate(() => {
      setTimeout(() => {
        location.href = 'file:///etc/hosts';
      }, 0);
    });
    await window.waitForTimeout(800);
    expect(window.url().split('#')[0]).toBe(appUrl.split('#')[0]);
    expect(await window.evaluate(() => typeof (window as unknown as AnyStudio).studio)).toBe('object');

    // Website-Projekt mit einer Seite, die Daten nach außen schicken will.
    const snapshot = await window.evaluate(
      (dir) => (window as unknown as AnyStudio).studio.createProject!({ title: 'Web', category: 'web', directory: dir }),
      join(userData, 'projects'),
    );
    const id = snapshot.manifest.id as string;
    await mkdir(join(snapshot.path, 'site'), { recursive: true });
    await writeFile(
      join(snapshot.path, 'site', 'index.html'),
      `<!doctype html><html><body style="margin:0">
<h1 data-sid="hero" style="margin:0;height:200px;font-size:40px">Hallo Vorschau</h1>
<a id="ext" href="https://example.com/klick" style="display:block;height:100px">extern</a>
<script>window.__leak = fetch(${JSON.stringify(leakUrl)}).then(() => 'ok', () => 'blocked');</script>
</body></html>`,
    );
    await window.evaluate((pid) => {
      const w = window as unknown as AnyStudio & { __picks: unknown[] };
      w.__picks = [];
      w.studio.onEvent((e) => {
        if (e.type === 'preview_pick') w.__picks.push(e);
      });
      return w.studio.previewOpen!(pid, { viewport: 'desktop' });
    }, id);
    await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewSetBounds!(pid, { x: 0, y: 0, width: 720, height: 450 }), id);
    const { url } = await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewOpen!(pid, { viewport: 'desktop' }), id);

    // Läuft im Main-Prozess: Skript im Vorschau-WebContents ausführen.
    const inPreview = (code: string) =>
      app.evaluate(async ({ webContents }, args) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(args.url));
        if (!wc) throw new Error('Vorschau-WebContents nicht gefunden');
        return wc.executeJavaScript(args.code);
      }, { url, code });
    const sendClick = (x: number, y: number) =>
      app.evaluate(({ webContents }, args) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(args.url))!;
        wc.sendInputEvent({ type: 'mouseDown', x: args.x, y: args.y, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x: args.x, y: args.y, button: 'left', clickCount: 1 });
      }, { url, x, y });

    // Netzwerk: nur der eigene Vorschau-Server.
    expect(await inPreview('window.__leak')).toBe('blocked');
    expect(leaked).toBe(0);
    // Der Picker lebt in einer isolierten Welt: Die Seite sieht weder Picker noch Melde-Kanal.
    await expect.poll(() => inPreview('typeof window.__studioPicker + "/" + typeof window.__studioPickerReport')).toBe('undefined/undefined');

    // Seiten-Skripte können keine Picks vortäuschen – weder per Konsole noch per synthetischem Klick.
    await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewSetPickMode!(pid, true), id);
    await inPreview(
      `console.debug('__STUDIO_PICK__' + JSON.stringify({ selector: '#x', bbox: { x: 0, y: 0, width: 1, height: 1 }, text: 'SPOOF', page: '/' })); document.querySelector('h1').click(); 1`,
    );
    await window.waitForTimeout(300);
    expect(await window.evaluate(() => (window as unknown as { __picks: unknown[] }).__picks.length)).toBe(0);
    // Echter Klick im Pick-Modus erzeugt genau einen Pick.
    await sendClick(40, 40);
    await expect.poll(() => window.evaluate(() => (window as unknown as { __picks: Array<{ label?: string; ref: { kind: string; selector?: string } }> }).__picks)).toEqual([
      expect.objectContaining({ label: 'Hallo Vorschau', ref: expect.objectContaining({ kind: 'element', selector: '[data-sid="hero"]' }) }),
    ]);
    await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewSetPickMode!(pid, false), id);

    // Fremde Protokolle und Popups ohne Geste öffnen nichts; ein echter Klick auf einen http(s)-Link schon.
    await inPreview(`window.open('smb://attacker/share'); window.open('https://example.com/ohne-klick'); location.href = 'zoommtg://attacker'; 1`);
    await window.waitForTimeout(300);
    expect(await app.evaluate(() => (globalThis as any).__opened)).toEqual([]);
    expect(await inPreview('location.href')).toBe(url);
    await sendClick(40, 140); // Link liegt bei 200–300 CSS-px; Vorschau ist auf 720/1440 skaliert
    await expect.poll(() => app.evaluate(() => (globalThis as any).__opened)).toEqual(['https://example.com/klick']);

    // Seitenpfade der Site lassen sich ansteuern, fremde Ziele nicht.
    await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewNavigate!(pid, '/about'), id);
    expect(await inPreview('location.pathname')).toBe('/about');
    const bad = await window.evaluate((pid) => (window as unknown as AnyStudio).studio.previewNavigate!(pid, 'https://evil.example/').then(() => 'ok', (e: Error) => e.message), id);
    expect(bad).toContain('Seitenpfad');
  } finally {
    await app.close();
    other.close();
    await rm(userData, { recursive: true, force: true });
  }
});
