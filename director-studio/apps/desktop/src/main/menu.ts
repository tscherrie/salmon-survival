import type { MenuItemConstructorOptions } from 'electron';

/**
 * Anwendungsmenü. Electrons Standardmenü belegt ⌘0/Strg+0 (Originalgröße), ⌘+/⌘− (Zoom) und ⌘M (Minimieren) –
 * genau die Kürzel, die die Oberfläche selbst braucht (Fokusmodus, Panels, Modelle; DESIGN.md §2, §6). Dieses
 * Menü enthält nur Einträge ohne solche Kollisionen: das macOS-App-Menü, „Bearbeiten“ mit den Standardrollen
 * (Kopieren/Einsetzen/Rückgängig in Textfeldern), „Fenster“ und „Hilfe“. Entwicklerwerkzeuge nur im Dev-Modus.
 */

export interface MenuActions {
  /** App-Datenordner (Einstellungen, Schlüssel, Caches) im Dateimanager zeigen. */
  openDataFolder(): void;
  /** Ordner mit den Projekten öffnen. */
  openProjectsFolder(): void;
  /** Systemprüfung (ffmpeg, Chromium) als Dialog. */
  showSystemCheck(): void;
}

export interface MenuOptions {
  platform: NodeJS.Platform;
  /** Dev-Modus: Neu laden und Entwicklerwerkzeuge. */
  isDev: boolean;
  appName: string;
  actions: MenuActions;
}

/**
 * Tastenkürzel der Oberfläche, die kein Menüeintrag belegen darf (`mod` = ⌘ unter macOS, sonst Strg).
 * Quelle: DESIGN.md (Tastenkürzel-Übersicht) und die Handler in `src/renderer`.
 */
export const RESERVED_RENDERER_SHORTCUTS: readonly string[] = [
  'mod+0',
  'mod+1',
  'mod+2',
  'mod+3',
  'mod+M',
  'mod+K',
  'mod+N',
  'mod+O',
  'mod+Enter',
  'mod+Space',
  'mod+Shift+Space',
  'mod+Plus',
  'mod+Shift+Plus',
  'mod+=',
  'mod+-',
  'Plus',
  'Shift+Plus',
  '=',
  '-',
  'Shift+Z',
  'Space',
  'Enter',
  'F6',
  'Shift+F6',
  'J',
  'K',
  'L',
];

/**
 * Standardkürzel der Electron-Rollen (lib/browser/api/menu-item-roles.ts), damit die Kollisionsprüfung auch
 * Rollen ohne ausdrückliches `accelerator` erfasst.
 */
export function roleAccelerator(role: string, platform: NodeJS.Platform): string | undefined {
  const mac = platform === 'darwin';
  const table: Record<string, string | undefined> = {
    undo: 'CommandOrControl+Z',
    redo: platform === 'win32' ? 'Control+Y' : 'Shift+CommandOrControl+Z',
    cut: 'CommandOrControl+X',
    copy: 'CommandOrControl+C',
    paste: 'CommandOrControl+V',
    pasteandmatchstyle: mac ? 'Cmd+Option+Shift+V' : 'Shift+CommandOrControl+V',
    selectall: 'CommandOrControl+A',
    minimize: 'CommandOrControl+M',
    close: 'CommandOrControl+W',
    quit: platform === 'win32' ? undefined : 'CommandOrControl+Q',
    reload: 'CmdOrCtrl+R',
    forcereload: 'Shift+CmdOrCtrl+R',
    toggledevtools: mac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
    resetzoom: 'CommandOrControl+0',
    zoomin: 'CommandOrControl+Plus',
    zoomout: 'CommandOrControl+-',
    togglefullscreen: mac ? 'Control+Command+F' : 'F11',
    hide: 'Command+H',
    hideothers: 'Command+Alt+H',
  };
  return table[role.toLowerCase()];
}

/** Rollen, die ganze Untermenüs mit Electrons Standardkürzeln erzeugen (u. a. ⌘0, ⌘+/−, ⌘M) – hier verboten. */
export const FORBIDDEN_ROLES: readonly string[] = ['viewmenu', 'windowmenu', 'editmenu', 'filemenu', 'appmenu', 'resetzoom', 'zoomin', 'zoomout'];

export function buildMenuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const { platform, isDev, appName, actions } = options;
  const isMac = platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: 'about', label: `Über ${appName}` },
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: `${appName} ausblenden` },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: `${appName} beenden` },
      ],
    });
  } else {
    template.push({
      label: 'Datei',
      submenu: [{ role: 'quit', label: 'Beenden' }],
    });
  }

  template.push({
    label: 'Bearbeiten',
    submenu: [
      { role: 'undo', label: 'Rückgängig' },
      { role: 'redo', label: 'Wiederholen' },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einsetzen' },
      ...(isMac ? [{ role: 'pasteAndMatchStyle', label: 'Einsetzen und Stil anpassen' } as const] : []),
      { role: 'delete', label: 'Löschen' },
      { role: 'selectAll', label: 'Alles auswählen' },
    ],
  });

  template.push({
    label: 'Fenster',
    ...(isMac ? { role: 'window' as const } : {}),
    submenu: [
      // Kein `role: 'minimize'`: dessen Standardkürzel ⌘M öffnet in der Oberfläche die Modellauswahl.
      { label: 'Minimieren', click: (_item, window) => window?.minimize() },
      ...(isMac ? [{ role: 'zoom', label: 'Zoomen' } as const] : []),
      { role: 'togglefullscreen', label: 'Vollbild' },
      ...(isMac
        ? ([
            { type: 'separator' },
            { role: 'front', label: 'Alle nach vorne bringen' },
            { type: 'separator' },
            { role: 'close', label: 'Fenster schließen' },
          ] as const)
        : []),
    ],
  });

  if (isDev) {
    template.push({
      label: 'Entwicklung',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Neu laden (ohne Cache)' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
      ],
    });
  }

  template.push({
    label: 'Hilfe',
    ...(isMac ? { role: 'help' as const } : {}),
    submenu: [
      { label: 'Systemprüfung (ffmpeg, Chromium) …', click: () => actions.showSystemCheck() },
      { type: 'separator' },
      { label: 'Projektordner öffnen', click: () => actions.openProjectsFolder() },
      { label: 'Datenordner öffnen', click: () => actions.openDataFolder() },
    ],
  });

  return template;
}

/** Alle wirksamen Kürzel einer Vorlage (ausdrückliche und Rollen-Standards), normalisiert. */
export function effectiveAccelerators(template: readonly MenuItemConstructorOptions[], platform: NodeJS.Platform): Array<{ label: string; accelerator: string; normalized: string }> {
  const out: Array<{ label: string; accelerator: string; normalized: string }> = [];
  const walk = (items: readonly MenuItemConstructorOptions[]) => {
    for (const item of items) {
      const accelerator = item.accelerator ?? (item.role ? roleAccelerator(item.role, platform) : undefined);
      if (accelerator && item.registerAccelerator !== false) {
        out.push({ label: item.label ?? item.role ?? '?', accelerator, normalized: normalizeAccelerator(accelerator, platform) });
      }
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

/** Verbotene Rollen in einer Vorlage (siehe {@link FORBIDDEN_ROLES}). */
export function forbiddenRoles(template: readonly MenuItemConstructorOptions[]): string[] {
  const out: string[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[]) => {
    for (const item of items) {
      if (item.role && FORBIDDEN_ROLES.includes(item.role.toLowerCase())) out.push(item.role);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

/** Kollisionen der Menükürzel mit {@link RESERVED_RENDERER_SHORTCUTS}. */
export function acceleratorCollisions(template: readonly MenuItemConstructorOptions[], platform: NodeJS.Platform): string[] {
  const reserved = new Set(RESERVED_RENDERER_SHORTCUTS.map((s) => normalizeAccelerator(s, platform)));
  return effectiveAccelerators(template, platform)
    .filter((a) => reserved.has(a.normalized))
    .map((a) => `${a.label}: ${a.accelerator}`);
}

/**
 * Normalisiert ein Electron-Kürzel bzw. `mod+…` zu „Modifikatoren sortiert + Taste“ in der Sicht der Plattform:
 * `CommandOrControl`/`mod` wird unter macOS zu `Cmd`, sonst zu `Ctrl`.
 */
export function normalizeAccelerator(accelerator: string, platform: NodeJS.Platform): string {
  const mac = platform === 'darwin';
  const parts = accelerator.split('+');
  // „Ctrl++“ bzw. „mod++“: das letzte leere Teilstück steht für die Plus-Taste.
  let key = parts.pop() ?? '';
  if (key === '' && parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
    key = 'Plus';
  }
  const mods = new Set<string>();
  for (const raw of parts) {
    const m = raw.toLowerCase();
    if (m === 'commandorcontrol' || m === 'cmdorctrl' || m === 'mod') mods.add(mac ? 'Cmd' : 'Ctrl');
    else if (m === 'command' || m === 'cmd' || m === 'super' || m === 'meta') mods.add('Cmd');
    else if (m === 'control' || m === 'ctrl') mods.add('Ctrl');
    else if (m === 'alt' || m === 'option' || m === 'altgr') mods.add('Alt');
    else if (m === 'shift') mods.add('Shift');
    else if (m) mods.add(raw);
  }
  const keyName = key === '+' ? 'Plus' : key.length === 1 ? key.toUpperCase() : key.replace(/^space$/i, 'Space').replace(/^return$/i, 'Enter').replace(/^plus$/i, 'Plus');
  return [...[...mods].sort(), keyName].join('+');
}
