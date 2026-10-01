import { applyDocumentOps, type DocumentOp, type StudioDocument } from './documents/index.ts';
import type { OpContext } from './documents/common.ts';

/** Unveränderliche Versionen eines Dokuments. Jede Änderung des Directors erzeugt genau eine Version. */

export type VersionAuthor = 'director' | 'user' | 'system';

export interface VersionMeta {
  number: number;
  parentNumber: number | null;
  note: string;
  author: VersionAuthor;
  runId?: string | undefined;
  createdAt: string;
  opsCount: number;
  /** Gesetzt, wenn diese Version eine Wiederherstellung ist. */
  restoredFrom?: number | undefined;
}

export interface Version<D extends StudioDocument = StudioDocument> extends VersionMeta {
  document: D;
  ops: DocumentOp[];
}

export interface CommitInput<D extends StudioDocument> {
  document: D;
  ops: DocumentOp[];
  note: string;
  author: VersionAuthor;
  runId?: string | undefined;
  restoredFrom?: number | undefined;
}

export interface VersionStore<D extends StudioDocument = StudioDocument> {
  head(): Promise<Version<D> | null>;
  get(number: number): Promise<Version<D> | null>;
  list(): Promise<VersionMeta[]>;
  commit(input: CommitInput<D>): Promise<Version<D>>;
}

export class VersionConflictError extends Error {
  constructor(expected: number | null, actual: number | null) {
    super(`Versionskonflikt: erwartet Basis v${expected ?? 0}, aktuell v${actual ?? 0}`);
    this.name = 'VersionConflictError';
  }
}

/**
 * Wendet Operationen auf die aktuelle Version an und committet das Ergebnis.
 * `expectedHead` schützt vor parallelen Änderungen (optimistische Sperre).
 */
export async function commitOps<D extends StudioDocument>(
  store: VersionStore<D>,
  ops: DocumentOp[],
  options: { note: string; author: VersionAuthor; runId?: string; expectedHead?: number | null; ctx?: OpContext },
): Promise<Version<D>> {
  const head = await store.head();
  if (!head) throw new Error('Dokument hat noch keine Version');
  if (options.expectedHead !== undefined && options.expectedHead !== head.number) {
    throw new VersionConflictError(options.expectedHead, head.number);
  }
  if (ops.length === 0) throw new Error('Keine Operationen übergeben');
  const document = applyDocumentOps(head.document, ops, options.ctx ?? {});
  return store.commit({ document, ops, note: options.note, author: options.author, runId: options.runId });
}

/** „Wiederherstellen“ = neue Version mit dem Inhalt einer alten. Keine Geschichte geht verloren. */
export async function restoreVersion<D extends StudioDocument>(
  store: VersionStore<D>,
  number: number,
  options: { note?: string; author?: VersionAuthor } = {},
): Promise<Version<D>> {
  const target = await store.get(number);
  if (!target) throw new Error(`Version ${number} existiert nicht`);
  return store.commit({
    document: structuredClone(target.document),
    ops: [],
    note: options.note ?? `Wiederhergestellt aus v${number}`,
    author: options.author ?? 'user',
    restoredFrom: number,
  });
}

/** Referenzimplementierung im Speicher (Tests, Renderer-Vorschau). */
export class InMemoryVersionStore<D extends StudioDocument = StudioDocument> implements VersionStore<D> {
  private readonly versions: Version<D>[] = [];
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async head(): Promise<Version<D> | null> {
    const v = this.versions[this.versions.length - 1];
    return v ? structuredClone(v) : null;
  }

  async get(number: number): Promise<Version<D> | null> {
    const v = this.versions.find((x) => x.number === number);
    return v ? structuredClone(v) : null;
  }

  async list(): Promise<VersionMeta[]> {
    return this.versions.map(({ document: _d, ops: _o, ...meta }) => meta);
  }

  async commit(input: CommitInput<D>): Promise<Version<D>> {
    const parent = this.versions[this.versions.length - 1];
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
    this.versions.push(version);
    return structuredClone(version);
  }
}
