import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Database, D1Statement, R2Bucket, WorkerEnv } from '../storage.ts';

/** Real SQLite, not string-matched SQL mocks. D1 batch semantics are transactional. */
export class SqliteD1 implements D1Database {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() { this.sqlite.exec(readFileSync(resolve(import.meta.dirname, '../../migrations/0001_projects.sql'),'utf8')); }
  prepare(sql: string): D1Statement {
    const statement = this.sqlite.prepare(sql); let values: SQLInputValue[] = [];
    const prepared: D1Statement = {
      bind: (...args) => { values = args as SQLInputValue[]; return prepared; },
      first: async <T>() => (statement.get(...values) ?? null) as T | null,
      all: async <T>() => ({ results: statement.all(...values) as T[] }),
      run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
    };
    return prepared;
  }
  async batch(statements: D1Statement[]) {
    this.sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
export class MemoryR2 implements R2Bucket {
  readonly objects = new Map<string, { bytes: Uint8Array; mime?: string }>();
  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, options?: { httpMetadata?: { contentType?: string } }) {
    const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key,{bytes,mime:options?.httpMetadata?.contentType});
  }
  async delete(key: string) { this.objects.delete(key); }
  async createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }) {
    const parts = new Map<number,Uint8Array>();
    return { uploadPart: async (partNumber: number, bytes: Uint8Array) => { parts.set(partNumber,bytes); return {partNumber,etag:`part-${partNumber}`}; }, complete: async (ordered: Array<{partNumber:number;etag:string}>) => { const length = ordered.reduce((n,p)=>n+parts.get(p.partNumber)!.length,0); const bytes = new Uint8Array(length);let offset=0;for(const p of ordered){const part=parts.get(p.partNumber)!;bytes.set(part,offset);offset+=part.length;}this.objects.set(key,{bytes,mime:options?.httpMetadata?.contentType}); }, abort: async () => {parts.clear();} };
  }
  async get(key: string, options?: { range?: Headers }) {
    const object = this.objects.get(key); if (!object) return null;
    const match = options?.range?.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
    const offset = match ? Number(match[1]) : 0; const end = match && match[2] ? Number(match[2]) + 1 : object.bytes.length; const bytes = object.bytes.slice(offset,end);
    return { body: new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close();}}), size: object.bytes.length, httpMetadata: { contentType: object.mime }, ...(match ? { range: { offset, length: bytes.length } } : {}) };
  }
}
export function environment(): WorkerEnv & { DB: SqliteD1; MEDIA: MemoryR2 } { return { DB: new SqliteD1(), MEDIA: new MemoryR2(), ASSETS: { fetch: async () => new Response('<html><head></head><body>Editor</body></html>',{headers:{'content-type':'text/html'}}) } }; }
export function request(path: string, method = 'GET', body?: unknown, owner?: string) { const headers: Record<string,string> = { 'content-type':'application/json' }; if (owner) { headers['oai-authenticated-user-id'] = owner; headers['oai-authenticated-user-email'] = `${owner}@example.test`; } return new Request(`https://director.example${path}`, { method, headers, ...(body === undefined ? {} : {body:JSON.stringify(body)}) }); }
