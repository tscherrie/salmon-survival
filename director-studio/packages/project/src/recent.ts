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

  async list(): Promise<RecentProject[]> {
    if (!(await exists(this.file))) return [];
    const items = await readJson<RecentProject[]>(this.file);
    const alive: RecentProject[] = [];
    for (const item of items) if (await exists(join(item.path, 'project.json'))) alive.push(item);
    return alive;
  }

  async touch(entry: { path: string; title: string; category: ProjectCategory | null; updatedAt: string }): Promise<void> {
    const items = (await this.list()).filter((i) => i.path !== entry.path);
    items.unshift(entry);
    await writeJsonAtomic(this.file, items.slice(0, this.max));
  }

  async remove(path: string): Promise<void> {
    const items = (await this.list()).filter((i) => i.path !== path);
    await writeJsonAtomic(this.file, items);
  }
}
