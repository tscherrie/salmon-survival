import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { filterAssets, type Asset, type AssetQuery, type Generation, type LineageEdge } from '@studio/core';

/**
 * Abgeleiteter Suchindex (SQLite über `node:sqlite`, ohne native Abhängigkeit). Kanonisch sind die
 * JSONL-Logs im Projektordner; der Index lässt sich jederzeit daraus neu aufbauen.
 */
export class ProjectIndex {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        search TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_kind ON assets(kind, status);
      CREATE TABLE IF NOT EXISTS lineage (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id, relation)
      );
      CREATE INDEX IF NOT EXISTS lineage_child ON lineage(child_id);
      CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL
      );
    `);
  }

  clear(): void {
    this.db.exec('DELETE FROM assets; DELETE FROM lineage; DELETE FROM generations;');
  }

  upsertAsset(asset: Asset): void {
    const search = [asset.id, asset.title, asset.description ?? '', asset.prompt ?? '', asset.subtype ?? '', ...asset.tags].join(' ').toLowerCase();
    this.db
      .prepare(
        `INSERT INTO assets (id, kind, status, source, created_at, search, json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, status=excluded.status, source=excluded.source,
           created_at=excluded.created_at, search=excluded.search, json=excluded.json`,
      )
      .run(asset.id, asset.kind, asset.status, asset.source, asset.createdAt, search, JSON.stringify(asset));
  }

  getAsset(id: string): Asset | undefined {
    const row = this.db.prepare('SELECT json FROM assets WHERE id = ?').get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Asset) : undefined;
  }

  allAssets(): Asset[] {
    return (this.db.prepare('SELECT json FROM assets ORDER BY created_at DESC').all() as Array<{ json: string }>).map((r) => JSON.parse(r.json) as Asset);
  }

  searchAssets(query: AssetQuery): Asset[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (query.kinds?.length) {
      clauses.push(`kind IN (${query.kinds.map(() => '?').join(',')})`);
      params.push(...query.kinds);
    }
    const statuses = query.statuses ?? ['active'];
    if (statuses.length) {
      clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
    for (const term of (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean)) {
      clauses.push(`search LIKE ? ESCAPE '\\'`);
      params.push(`%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    }
    const sql = `SELECT json FROM assets ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<{ json: string }>;
    return filterAssets(
      rows.map((r) => JSON.parse(r.json) as Asset),
      query,
    );
  }

  addLineage(edge: LineageEdge): void {
    this.db.prepare('INSERT OR IGNORE INTO lineage (parent_id, child_id, relation) VALUES (?, ?, ?)').run(edge.parentId, edge.childId, edge.relation);
  }

  parentsOf(assetId: string): LineageEdge[] {
    return (this.db.prepare('SELECT parent_id, child_id, relation FROM lineage WHERE child_id = ?').all(assetId) as Array<Record<string, string>>).map(toEdge);
  }

  childrenOf(assetId: string): LineageEdge[] {
    return (this.db.prepare('SELECT parent_id, child_id, relation FROM lineage WHERE parent_id = ?').all(assetId) as Array<Record<string, string>>).map(toEdge);
  }

  upsertGeneration(gen: Generation): void {
    this.db
      .prepare(
        `INSERT INTO generations (id, status, created_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, json=excluded.json`,
      )
      .run(gen.id, gen.status, gen.createdAt, JSON.stringify(gen));
  }

  getGeneration(id: string): Generation | undefined {
    const row = this.db.prepare('SELECT json FROM generations WHERE id = ?').get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Generation) : undefined;
  }

  listGenerations(statuses?: Generation['status'][]): Generation[] {
    const rows = (statuses?.length
      ? this.db.prepare(`SELECT json FROM generations WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`).all(...statuses)
      : this.db.prepare('SELECT json FROM generations ORDER BY created_at').all()) as Array<{ json: string }>;
    return rows.map((r) => JSON.parse(r.json) as Generation);
  }

  close(): void {
    this.db.close();
  }
}

function toEdge(row: Record<string, string>): LineageEdge {
  return { parentId: row.parent_id!, childId: row.child_id!, relation: row.relation as LineageEdge['relation'] };
}
