import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIRECTOR_EFFORTS, type AppSettings } from '@studio/core';
import { writeJsonAtomic } from '@studio/project';

export function defaultSettings(documentsDir: string): AppSettings {
  return {
    language: 'de',
    defaultEffort: 'xhigh',
    preferredRuntime: 'auto',
    projectsDir: join(documentsDir, 'Director Studio'),
    allowClaudeSubscription: false,
  };
}

/** App-Einstellungen als JSON im App-Datenordner (unbekannte/ungültige Werte fallen auf Defaults zurück). */
export class SettingsStore {
  private cache: AppSettings | null = null;

  constructor(
    private readonly dir: string,
    private readonly defaults: AppSettings,
  ) {}

  private get file(): string {
    return join(this.dir, 'settings.json');
  }

  async get(): Promise<AppSettings> {
    if (this.cache) return { ...this.cache };
    let stored: Partial<AppSettings> = {};
    try {
      stored = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AppSettings>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.cache = sanitize({ ...this.defaults, ...stored }, this.defaults);
    return { ...this.cache };
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = sanitize({ ...(await this.get()), ...patch }, this.defaults);
    await writeJsonAtomic(this.file, next);
    this.cache = next;
    return { ...next };
  }
}

function sanitize(value: AppSettings, defaults: AppSettings): AppSettings {
  return {
    language: value.language === 'en' ? 'en' : 'de',
    defaultEffort: (DIRECTOR_EFFORTS as readonly string[]).includes(value.defaultEffort) ? value.defaultEffort : defaults.defaultEffort,
    preferredRuntime: ['auto', 'anthropic', 'fal', 'agent-sdk'].includes(value.preferredRuntime) ? value.preferredRuntime : 'auto',
    projectsDir: typeof value.projectsDir === 'string' && value.projectsDir ? value.projectsDir : defaults.projectsDir,
    allowClaudeSubscription: value.allowClaudeSubscription === true,
  };
}
