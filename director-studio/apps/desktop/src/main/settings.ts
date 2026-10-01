import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DIRECTOR_EFFORTS, parsePickerState, type AppSettings } from '@studio/core';
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

/**
 * App-Einstellungen als JSON im App-Datenordner (unbekannte/ungültige Werte fallen auf Defaults zurück).
 * Eine unlesbare `settings.json` (z. B. von Hand bearbeitet, mit Syntaxfehler) blockiert die App nicht:
 * Sie wird als `settings.json.corrupt-<Zeit>` beiseitegelegt, es gelten die Defaults. Änderungen laufen
 * nacheinander, damit parallele `update()`-Aufrufe sich nicht gegenseitig überschreiben.
 */
export class SettingsStore {
  private cache: AppSettings | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly defaults: AppSettings,
  ) {}

  private get file(): string {
    return join(this.dir, 'settings.json');
  }

  async get(): Promise<AppSettings> {
    if (this.cache) return structuredClone(this.cache);
    let stored: Record<string, unknown> = {};
    let text: string | null = null;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('settings.json ist nicht lesbar – es gelten die Standardwerte:', (error as Error).message);
    }
    if (text !== null) {
      let raw: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        stored = raw as Record<string, unknown>;
      } else {
        console.warn('settings.json ist beschädigt – es gelten die Standardwerte');
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined);
      }
    }
    this.cache ??= sanitize({ ...this.defaults, ...stored } as AppSettings, this.defaults);
    return structuredClone(this.cache);
  }

  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const run = this.chain.then(async () => {
      const safePatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
      const next = sanitize({ ...(await this.get()), ...safePatch }, this.defaults);
      await writeJsonAtomic(this.file, next);
      this.cache = next;
      return structuredClone(next);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

function sanitize(value: AppSettings, defaults: AppSettings): AppSettings {
  const defaultPickers = parsePickerState(value.defaultPickers);
  const ffmpegPath = typeof value.ffmpegPath === 'string' ? value.ffmpegPath.trim() : '';
  return {
    language: value.language === 'en' ? 'en' : 'de',
    defaultEffort: (DIRECTOR_EFFORTS as readonly string[]).includes(value.defaultEffort) ? value.defaultEffort : defaults.defaultEffort,
    preferredRuntime: ['auto', 'anthropic', 'fal', 'agent-sdk'].includes(value.preferredRuntime) ? value.preferredRuntime : 'auto',
    projectsDir: typeof value.projectsDir === 'string' && value.projectsDir ? value.projectsDir : defaults.projectsDir,
    allowClaudeSubscription: value.allowClaudeSubscription === true,
    ...(Object.keys(defaultPickers).length > 0 ? { defaultPickers } : {}),
    // Leerer Wert = automatisch suchen (siehe ffmpeg.ts); ein leerer String im Patch löscht die Angabe.
    ...(ffmpegPath ? { ffmpegPath } : {}),
  };
}
