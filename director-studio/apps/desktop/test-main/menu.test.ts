import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { acceleratorCollisions, buildMenuTemplate, effectiveAccelerators, forbiddenRoles, normalizeAccelerator, RESERVED_RENDERER_SHORTCUTS } from '../src/main/menu.ts';

const actions = { openDataFolder: vi.fn(), openProjectsFolder: vi.fn(), showSystemCheck: vi.fn() };
const PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32', 'linux'];

function labels(template: MenuItemConstructorOptions[]): string[] {
  return template.map((m) => m.label ?? m.role ?? '?');
}

function flatten(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

describe('Anwendungsmenü', () => {
  for (const platform of PLATFORMS) {
    for (const isDev of [false, true]) {
      it(`${platform}${isDev ? ' (dev)' : ''}: keine Kürzel, die die Oberfläche braucht`, () => {
        const template = buildMenuTemplate({ platform, isDev, appName: 'Director Studio', actions });
        expect(acceleratorCollisions(template, platform)).toEqual([]);
        expect(forbiddenRoles(template)).toEqual([]);
        // Kein Eintrag erzeugt Zoom-Kürzel (⌘0, ⌘+, ⌘−), auch nicht über Rollen.
        const roles = flatten(template).map((i) => i.role?.toLowerCase());
        expect(roles).not.toContain('resetzoom');
        expect(roles).not.toContain('zoomin');
        expect(roles).not.toContain('zoomout');
        expect(roles).not.toContain('minimize');
      });
    }
  }

  it('macOS: App-Menü, Bearbeiten mit Standardrollen, Fenster, Hilfe; Entwicklerwerkzeuge nur im Dev-Modus', () => {
    const prod = buildMenuTemplate({ platform: 'darwin', isDev: false, appName: 'Director Studio', actions });
    expect(labels(prod)).toEqual(['Director Studio', 'Bearbeiten', 'Fenster', 'Hilfe']);
    const edit = prod.find((m) => m.label === 'Bearbeiten')!.submenu as MenuItemConstructorOptions[];
    expect(edit.map((i) => i.role).filter(Boolean)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']);
    expect(flatten(prod).some((i) => i.role === 'toggleDevTools' || i.role === 'reload')).toBe(false);
    const dev = buildMenuTemplate({ platform: 'darwin', isDev: true, appName: 'Director Studio', actions });
    expect(labels(dev)).toEqual(['Director Studio', 'Bearbeiten', 'Fenster', 'Entwicklung', 'Hilfe']);
    expect(flatten(dev).some((i) => i.role === 'toggleDevTools')).toBe(true);
  });

  it('Windows: Datei/Bearbeiten/Fenster/Hilfe; Kopieren/Einsetzen/Rückgängig vorhanden', () => {
    const template = buildMenuTemplate({ platform: 'win32', isDev: false, appName: 'Director Studio', actions });
    expect(labels(template)).toEqual(['Datei', 'Bearbeiten', 'Fenster', 'Hilfe']);
    const roles = flatten(template).map((i) => i.role);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'quit']) expect(roles).toContain(role);
  });

  it('Standardkürzel bleiben für Bearbeiten erhalten (⌘C/⌘V/⌘Z)', () => {
    const accels = effectiveAccelerators(buildMenuTemplate({ platform: 'darwin', isDev: false, appName: 'X', actions }), 'darwin').map((a) => a.normalized);
    expect(accels).toEqual(expect.arrayContaining(['Cmd+C', 'Cmd+V', 'Cmd+X', 'Cmd+Z', 'Cmd+Shift+Z', 'Cmd+A', 'Cmd+Q']));
  });

  it('Hilfe-Einträge rufen die Aktionen auf; Minimieren ohne Kürzel', () => {
    const template = buildMenuTemplate({ platform: 'darwin', isDev: false, appName: 'X', actions });
    const items = flatten(template);
    const click = (label: string) => (items.find((i) => i.label?.startsWith(label))!.click as () => void)();
    click('Systemprüfung');
    click('Datenordner');
    click('Projektordner');
    expect(actions.showSystemCheck).toHaveBeenCalledTimes(1);
    expect(actions.openDataFolder).toHaveBeenCalledTimes(1);
    expect(actions.openProjectsFolder).toHaveBeenCalledTimes(1);
    const minimize = items.find((i) => i.label === 'Minimieren')!;
    expect(minimize.accelerator).toBeUndefined();
    expect(minimize.role).toBeUndefined();
    const win = { minimize: vi.fn() };
    (minimize.click as unknown as (item: unknown, w: typeof win) => void)({}, win);
    expect(win.minimize).toHaveBeenCalled();
  });

  it('die Prüfung erkennt Kollisionen tatsächlich (Gegenprobe mit Electrons Standardrollen)', () => {
    const bad: MenuItemConstructorOptions[] = [
      { label: 'Ansicht', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { label: 'Fenster', submenu: [{ role: 'minimize' }, { label: 'Fokus', accelerator: 'CmdOrCtrl+Enter' }, { label: 'PTT', accelerator: 'CommandOrControl+Shift+Space' }] },
      { label: 'Zoom', submenu: [{ label: 'Plus', accelerator: '+' }, { label: 'Minus', accelerator: '-' }] },
    ];
    for (const platform of PLATFORMS) {
      expect(acceleratorCollisions(bad, platform)).toHaveLength(8);
      expect(forbiddenRoles(bad)).toEqual(['resetZoom', 'zoomIn', 'zoomOut']);
    }
  });

  it('normalisiert Kürzel plattformabhängig', () => {
    expect(normalizeAccelerator('CommandOrControl+0', 'darwin')).toBe('Cmd+0');
    expect(normalizeAccelerator('CommandOrControl+0', 'win32')).toBe('Ctrl+0');
    expect(normalizeAccelerator('mod+m', 'darwin')).toBe('Cmd+M');
    expect(normalizeAccelerator('Shift+CmdOrCtrl+Z', 'darwin')).toBe('Cmd+Shift+Z');
    expect(normalizeAccelerator('Ctrl++', 'linux')).toBe('Ctrl+Plus');
    expect(normalizeAccelerator('CommandOrControl+Plus', 'linux')).toBe('Ctrl+Plus');
    expect(normalizeAccelerator('mod+Space', 'win32')).toBe('Ctrl+Space');
    expect(RESERVED_RENDERER_SHORTCUTS).toEqual(expect.arrayContaining(['mod+0', 'mod+1', 'mod+2', 'mod+3', 'mod+M', 'mod+Enter', 'mod+Space', 'Plus', '-']));
  });
});
