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

/**
 * Speichert API-Keys verschlüsselt im App-Datenordner. Keys verlassen den Main-Prozess nie
 * (nicht an den Renderer, nicht in Umgebungsvariablen von Dev-Servern/Workern).
 */
export class SecretStore {
  private cache: Partial<Record<SecretName, string>> | null = null;

  constructor(
    private readonly dir: string,
    private readonly cipher: SecretCipher,
  ) {}

  private get file(): string {
    return join(this.dir, 'secrets.json');
  }

  private async load(): Promise<Partial<Record<SecretName, string>>> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Record<SecretName, string>>;
      const out: Partial<Record<SecretName, string>> = {};
      for (const [name, value] of Object.entries(raw)) {
        if (typeof value === 'string') out[name as SecretName] = this.cipher.decrypt(Buffer.from(value, 'base64'));
      }
      this.cache = out;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.cache = {};
    }
    return this.cache;
  }

  async get(name: SecretName): Promise<string | null> {
    return (await this.load())[name] ?? null;
  }

  async has(name: SecretName): Promise<boolean> {
    return Boolean(await this.get(name));
  }

  async set(name: SecretName, value: string | null): Promise<void> {
    if (value !== null && !this.cipher.isAvailable()) {
      throw new Error('Sichere Ablage ist auf diesem System nicht verfügbar (Schlüsselbund gesperrt?)');
    }
    const current = { ...(await this.load()) };
    if (value === null || value.trim() === '') delete current[name];
    else current[name] = value.trim();
    const encoded: Record<string, string> = {};
    for (const [k, v] of Object.entries(current)) encoded[k] = this.cipher.encrypt(v).toString('base64');
    await writeJsonAtomic(this.file, encoded);
    this.cache = current;
  }
}
