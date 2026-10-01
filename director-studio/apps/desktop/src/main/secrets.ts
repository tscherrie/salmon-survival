import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '@studio/project';

/** Verschlüsselung über den OS-Schlüsselbund (Electron `safeStorage`: Keychain / DPAPI / libsecret). */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export type SecretName = 'anthropic' | 'fal';

interface SecretState {
  /** Entschlüsselte Werte (nur Einträge, die sich entschlüsseln ließen). */
  plain: Partial<Record<SecretName, string>>;
  /** Gespeicherte Chiffrate (base64) wie auf der Platte – auch nicht entschlüsselbare bleiben erhalten. */
  stored: Record<string, string>;
}

/**
 * Speichert API-Keys verschlüsselt im App-Datenordner. Keys verlassen den Main-Prozess nie
 * (nicht an den Renderer, nicht in Umgebungsvariablen von Dev-Servern/Workern).
 *
 * Robustheit: Ein Eintrag, der sich nicht entschlüsseln lässt (Schlüsselbund gesperrt/gewechselt, Profil
 * auf neuem Rechner), gilt als „nicht hinterlegt“, blockiert aber weder die übrigen Keys noch `set()`; sein
 * Chiffrat bleibt erhalten, bis der Nutzer diesen Key neu setzt oder löscht. Eine kaputte `secrets.json`
 * zählt als leer. Schreibvorgänge laufen nacheinander, damit parallele `set()`-Aufrufe keinen Key verlieren.
 */
export class SecretStore {
  private state: SecretState | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly cipher: SecretCipher,
  ) {}

  private get file(): string {
    return join(this.dir, 'secrets.json');
  }

  private async load(): Promise<SecretState> {
    if (this.state) return this.state;
    let text: string | null = null;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      // Nur „Datei fehlt“ heißt „noch keine Keys“; andere E/A-Fehler beim nächsten Zugriff erneut versuchen.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const stored: Record<string, string> = {};
    if (text !== null) {
      try {
        const raw: unknown = JSON.parse(text);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [name, value] of Object.entries(raw)) if (typeof value === 'string') stored[name] = value;
        } else {
          console.warn('secrets.json hat ein unerwartetes Format – gespeicherte Keys werden ignoriert');
        }
      } catch (error) {
        console.warn('secrets.json ist beschädigt – gespeicherte Keys werden ignoriert:', (error as Error).message);
      }
    }
    const plain: Partial<Record<SecretName, string>> = {};
    for (const [name, value] of Object.entries(stored)) {
      if (!isSecretName(name)) continue;
      try {
        plain[name] = this.cipher.decrypt(Buffer.from(value, 'base64'));
      } catch (error) {
        console.warn(`Key „${name}“ lässt sich nicht entschlüsseln (Schlüsselbund?) und wird ignoriert:`, (error as Error).message);
      }
    }
    this.state = { plain, stored };
    return this.state;
  }

  async get(name: SecretName): Promise<string | null> {
    return (await this.load()).plain[name] ?? null;
  }

  async has(name: SecretName): Promise<boolean> {
    return Boolean(await this.get(name));
  }

  /** Setzt (oder löscht mit `null`/leer) einen Key. Aufrufe werden serialisiert. */
  set(name: SecretName, value: string | null): Promise<void> {
    const run = this.queue.then(() => this.write(name, value));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(name: SecretName, value: string | null): Promise<void> {
    const trimmed = value?.trim() ?? '';
    if (trimmed && !this.cipher.isAvailable()) {
      throw new Error('Sichere Ablage ist auf diesem System nicht verfügbar (Schlüsselbund gesperrt?)');
    }
    const current = await this.load();
    const plain = { ...current.plain };
    const stored = { ...current.stored };
    if (!trimmed) {
      delete plain[name];
      delete stored[name];
    } else {
      stored[name] = this.cipher.encrypt(trimmed).toString('base64');
      plain[name] = trimmed;
    }
    await writeJsonAtomic(this.file, stored);
    this.state = { plain, stored };
  }
}

function isSecretName(name: string): name is SecretName {
  return name === 'anthropic' || name === 'fal';
}
