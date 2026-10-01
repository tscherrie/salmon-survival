import { join } from 'node:path';
import type { ProjectCategory, RecentProject } from '@studio/core';
import { exists, readJson, writeJsonAtomic } from './fsutil.ts';

/** Liste zuletzt geöffneter Projekte im App-Datenordner. */
export class RecentProjects {
  constructor(
    private readonly appDataDir: string,
    private readonly max = 20,
  ) {}

  private get file(): string {
    return join(this.appDataDir, 'recent-projects.json');
  }

  /** Gespeicherte Liste ohne Filter – auch Projekte auf gerade nicht erreichbaren Laufwerken bleiben erhalten. */
  private async readRaw(): Promise<RecentProject[]> {
    if (!(await exists(this.file))) return [];
    const items = await readJson<unknown>(this.file);
    return Array.isArray(items) ? (items as RecentProject[]) : [];
  }

  /** Nur erreichbare Projekte (für die Anzeige); die gespeicherte Liste bleibt unverändert. */
  async list(): Promise<RecentProject[]> {
    const alive: RecentProject[] = [];
    for (const item of await this.readRaw()) if (await exists(join(item.path, 'project.json'))) alive.push(item);
    return alive;
  }

  async touch(entry: { path: string; title: string; category: ProjectCategory | null; updatedAt: string }): Promise<void> {
    const items = (await this.readRaw()).filter((i) => i.path !== entry.path);
    items.unshift(entry);
    await writeJsonAtomic(this.file, items.slice(0, this.max));
  }

  async remove(path: string): Promise<void> {
    const items = (await this.readRaw()).filter((i) => i.path !== path);
    await writeJsonAtomic(this.file, items);
  }
}
