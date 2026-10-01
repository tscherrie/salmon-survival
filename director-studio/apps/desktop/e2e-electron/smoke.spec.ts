import { mkdtemp, rm } from 'node:fs/promises';
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
