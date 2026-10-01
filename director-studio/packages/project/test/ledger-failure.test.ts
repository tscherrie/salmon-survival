import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Steuert simulierte Schreibfehler beim Anhängen an ledger.jsonl. */
const failure = vi.hoisted(() => ({ mode: 'none' as 'none' | 'before-write' | 'after-write', matchKind: '' }));

vi.mock('../src/fsutil.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/fsutil.ts')>();
  return {
    ...actual,
    appendJsonLine: async (path: string, value: unknown) => {
      const kind = (value as { kind?: string }).kind;
      if (path.endsWith('ledger.jsonl') && failure.mode !== 'none' && kind === failure.matchKind) {
        const mode = failure.mode;
        failure.mode = 'none';
        if (mode === 'before-write') throw new Error('ENOSPC (simuliert)');
        await actual.appendJsonLine(path, value);
        throw new Error('EIO beim fsync (simuliert)');
      }
      return actual.appendJsonLine(path, value);
    },
  };
});

const { ProjectStore } = await import('../src/index.ts');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-ledger-'));
  failure.mode = 'none';
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function ledgerLines(dir: string): Promise<Array<{ id: string; kind: string }>> {
  const text = await readFile(join(dir, 'log', 'ledger.jsonl'), 'utf8');
  return text.trim().split('\n').map((l) => JSON.parse(l) as { id: string; kind: string });
}

describe('Ledger bei Teil-Schreibfehlern', () => {
  it('hängt nach einem Fehler beim zweiten Eintrag den ersten nicht erneut an', async () => {
    const store = await ProjectStore.create(root, { title: 'L', category: 'video' }, { onWarning: () => undefined });
    await store.approveBudget('cp_1_treatment', 20);
    await store.budgetReserve('gen_1', 4, { checkpointId: 'cp_1_treatment' });
    failure.mode = 'before-write';
    failure.matchKind = 'actual';
    // settle schreibt „release“ (gelingt) und „actual“ (scheitert).
    await expect(store.budgetSettle('gen_1', 3)).rejects.toThrow(/ENOSPC/);
    await store.budgetRecordUsage('run_1', 0.5);
    const kinds = (await ledgerLines(store.dir)).map((e) => e.kind);
    expect(kinds).toEqual(['reservation', 'release', 'actual', 'actual']);
    await store.close();
    const reopened = await ProjectStore.open(store.dir, { onWarning: () => undefined });
    expect(reopened.budgetSummary()).toMatchObject({ spentUsd: 3.5, reservedUsd: 0, availableUsd: 16.5 });
    await reopened.close();
  });

  it('zählt einen trotz Fehlermeldung geschriebenen und wiederholten Eintrag nach dem Öffnen nur einmal', async () => {
    const store = await ProjectStore.create(root, { title: 'L2', category: 'video' }, { onWarning: () => undefined });
    await store.approveBudget('cp_1_treatment', 20);
    await store.budgetReserve('gen_1', 4, { checkpointId: 'cp_1_treatment' });
    failure.mode = 'after-write';
    failure.matchKind = 'release';
    await expect(store.budgetSettle('gen_1', 3)).rejects.toThrow(/EIO/);
    await store.budgetRecordUsage('run_1', 0.5);
    const lines = await ledgerLines(store.dir);
    // Die „release“-Zeile steht doppelt auf der Platte …
    expect(lines.filter((e) => e.kind === 'release')).toHaveLength(2);
    await store.close();
    // … wird beim Öffnen aber nur einmal gezählt (sonst würde reservedUsd negativ und das Budget größer).
    const reopened = await ProjectStore.open(store.dir, { onWarning: () => undefined });
    expect(reopened.budgetSummary()).toMatchObject({ spentUsd: 3.5, reservedUsd: 0, availableUsd: 16.5 });
    expect(reopened.ledgerEntries()).toHaveLength(4);
    await reopened.close();
  });
});
