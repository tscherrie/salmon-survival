import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitInput, StudioDocument, Version, VersionMeta, VersionStore } from '@studio/core';
import { ensureDir, readJson, writeJsonAtomic } from './fsutil.ts';

/**
 * Versionen als unveränderliche Dateien `versions/000001.json`. `documents/main.json` spiegelt die
 * jeweils neueste Version für Menschen und Werkzeuge.
 */
export class FileVersionStore<D extends StudioDocument = StudioDocument> implements VersionStore<D> {
  private metas: VersionMeta[] | null = null;
  private headCache: Version<D> | null = null;

  constructor(
    private readonly projectDir: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get versionsDir(): string {
    return join(this.projectDir, 'versions');
  }

  private fileFor(number: number): string {
    return join(this.versionsDir, `${String(number).padStart(6, '0')}.json`);
  }

  private async loadMetas(): Promise<VersionMeta[]> {
    if (this.metas) return this.metas;
    await ensureDir(this.versionsDir);
    const files = (await readdir(this.versionsDir)).filter((f) => /^\d{6}\.json$/.test(f)).sort();
    const metas: VersionMeta[] = [];
    for (const file of files) {
      const v = await readJson<Version<D>>(join(this.versionsDir, file));
      const { document: _d, ops: _o, ...meta } = v;
      metas.push(meta);
    }
    this.metas = metas;
    return metas;
  }

  async list(): Promise<VersionMeta[]> {
    return [...(await this.loadMetas())];
  }

  async head(): Promise<Version<D> | null> {
    if (this.headCache) return structuredClone(this.headCache);
    const metas = await this.loadMetas();
    const last = metas[metas.length - 1];
    if (!last) return null;
    this.headCache = await readJson<Version<D>>(this.fileFor(last.number));
    return structuredClone(this.headCache);
  }

  async get(number: number): Promise<Version<D> | null> {
    const metas = await this.loadMetas();
    if (!metas.some((m) => m.number === number)) return null;
    return readJson<Version<D>>(this.fileFor(number));
  }

  async commit(input: CommitInput<D>): Promise<Version<D>> {
    const metas = await this.loadMetas();
    const parent = metas[metas.length - 1];
    const version: Version<D> = {
      number: (parent?.number ?? 0) + 1,
      parentNumber: parent?.number ?? null,
      note: input.note,
      author: input.author,
      runId: input.runId,
      createdAt: this.now(),
      opsCount: input.ops.length,
      restoredFrom: input.restoredFrom,
      document: structuredClone(input.document),
      ops: structuredClone(input.ops),
    };
    await writeJsonAtomic(this.fileFor(version.number), version);
    await writeJsonAtomic(join(this.projectDir, 'documents', 'main.json'), version.document);
    const { document: _d, ops: _o, ...meta } = version;
    metas.push(meta);
    this.headCache = version;
    return structuredClone(version);
  }
}
