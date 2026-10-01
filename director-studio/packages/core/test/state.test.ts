import { describe, expect, it } from 'vitest';
import {
  activeBudgetCheckpoint,
  assetMatches,
  BudgetLedger,
  checkModelAllowed,
  CLAUDE_MODELS,
  commitOps,
  createCheckpoints,
  createDocument,
  currentCheckpoint,
  decideCheckpoint,
  exampleCost,
  filterAssets,
  formatPrice,
  formatUsd,
  InMemoryVersionStore,
  mimeFromExtension,
  assetKindFromMime,
  modelFamily,
  proposeCheckpoint,
  restoreVersion,
  sequentialIds,
  tokenCostUsd,
  VersionConflictError,
  type Asset,
  type Deck,
} from '../src/index.ts';

describe('versioning', () => {
  it('commits ops, restores and guards against conflicts', async () => {
    let t = 0;
    const store = new InMemoryVersionStore<Deck>(() => `2026-10-01T00:00:0${t++}Z`);
    await store.commit({ document: createDocument('slides') as Deck, ops: [], note: 'Anlage', author: 'system' });
    const v2 = await commitOps(store, [{ op: 'add_slide', slide: { id: 's1', elements: [] } }], { note: 'Folie 1', author: 'director', runId: 'run_1' });
    expect(v2.number).toBe(2);
    expect(v2.parentNumber).toBe(1);
    expect(v2.document.slides).toHaveLength(1);
    await expect(commitOps(store, [{ op: 'add_slide', slide: { id: 's2', elements: [] } }], { note: 'x', author: 'director', expectedHead: 1 })).rejects.toBeInstanceOf(VersionConflictError);
    await expect(commitOps(store, [], { note: 'x', author: 'director' })).rejects.toThrow(/Keine Operationen/);
    const v3 = await restoreVersion(store, 1);
    expect(v3.number).toBe(3);
    expect(v3.restoredFrom).toBe(1);
    expect(v3.document.slides).toHaveLength(0);
    expect((await store.list()).map((v) => v.note)).toEqual(['Anlage', 'Folie 1', 'Wiederhergestellt aus v1']);
    // Gespeicherte Versionen sind gegen spätere Mutation geschützt.
    v2.document.slides.push({ id: 'hack', elements: [] });
    expect((await store.get(2))!.document.slides).toHaveLength(1);
  });
});

describe('budget ledger', () => {
  it('tracks approvals, reservations and actuals', () => {
    const ids = sequentialIds();
    const ledger = new BudgetLedger({}, () => '2026-10-01T00:00:00Z', () => ids('led'));
    expect(ledger.check(1).ok).toBe(false);
    ledger.approve('cp_treatment', 10);
    ledger.approve('cp_production', 100);
    expect(ledger.check(50)).toEqual({ ok: true, availableUsd: 110 });
    ledger.reserve('gen_1', 30, { checkpointId: 'cp_production' });
    expect(() => ledger.reserve('gen_1', 1)).toThrow(/bereits/);
    expect(ledger.summary().reservedUsd).toBe(30);
    ledger.settle('gen_1', 24.5);
    ledger.reserve('gen_2', 5, { checkpointId: 'cp_production' });
    ledger.release('gen_2');
    ledger.recordUsage('run_1', 1.25);
    const s = ledger.summary();
    expect(s).toMatchObject({ approvedUsd: 110, spentUsd: 25.75, reservedUsd: 0, availableUsd: 84.25 });
    expect(s.bySource).toEqual({ fal: 24.5, director: 1.25, other: 0 });
    expect(s.byCheckpoint.cp_production).toEqual({ approvedUsd: 100, spentUsd: 24.5, reservedUsd: 0 });
    const check = ledger.check(90);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.shortfallUsd).toBeCloseTo(5.75);
    expect(ledger.check(80, 'cp_production').ok).toBe(false);
    expect(ledger.check(75, 'cp_production').ok).toBe(true);
    expect(() => ledger.approve('x', 0)).toThrow();
    expect(formatUsd(0.0423)).toBe('$0.042');
    expect(formatUsd(12)).toBe('$12.00');
  });

  it('restores from persisted entries', () => {
    const a = new BudgetLedger();
    a.approve('cp', 20);
    a.reserve('g', 5);
    const b = new BudgetLedger({ entries: [...a.listEntries()], approvals: [...a.listApprovals()] });
    expect(b.summary().availableUsd).toBe(15);
    expect(b.openReservation('g')?.amountUsd).toBe(5);
  });
});

describe('checkpoints', () => {
  it('runs the propose/decide state machine', () => {
    let list = createCheckpoints('video');
    expect(list.map((c) => c.kind)).toEqual(['treatment', 'style_bible', 'storyboard', 'production', 'finishing']);
    expect(currentCheckpoint(list)?.kind).toBe('treatment');
    expect(() => decideCheckpoint(list, list[0]!.id, { decision: 'approve' }, 'now')).toThrow(/nicht zur Freigabe/);
    list = proposeCheckpoint(list, list[0]!.id, { summary: 'Idee', budgetRequestedUsd: 12 }, 't1');
    list = decideCheckpoint(list, list[0]!.id, { decision: 'request_changes', feedback: 'mutiger' }, 't2');
    expect(list[0]!.status).toBe('changes_requested');
    list = proposeCheckpoint(list, list[0]!.id, { summary: 'Idee v2', budgetRequestedUsd: 12 }, 't3');
    list = decideCheckpoint(list, list[0]!.id, { decision: 'approve' }, 't4');
    expect(list[0]).toMatchObject({ status: 'approved', budgetApprovedUsd: 12 });
    expect(currentCheckpoint(list)?.kind).toBe('style_bible');
    expect(activeBudgetCheckpoint(list)?.kind).toBe('treatment');
    list = decideCheckpoint(list, list[1]!.id, { decision: 'skip' }, 't5');
    expect(currentCheckpoint(list)?.kind).toBe('storyboard');
    expect(createCheckpoints('web').map((c) => c.kind)).toEqual(['sitemap', 'mockups', 'implementation', 'qa']);
  });
});

describe('models & pickers', () => {
  it('enforces picker bindings with family tolerance', () => {
    const picker = { video: { mode: 'model' as const, modelId: 'minimax/h3-max/text-to-video' }, image: { mode: 'auto' as const } };
    expect(checkModelAllowed(picker, 'video', 'minimax/h3-max/reference-to-video').ok).toBe(true);
    const denied = checkModelAllowed(picker, 'video', 'fal-ai/kling-video/v3/pro/text-to-video');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.expected).toBe('minimax/h3-max/text-to-video');
    expect(checkModelAllowed(picker, 'image', 'anything').ok).toBe(true);
    expect(checkModelAllowed(picker, 'music', 'anything').ok).toBe(true);
    expect(modelFamily('fal-ai/flux')).toBe('fal-ai/flux');
  });

  it('formats prices and example costs', () => {
    expect(formatPrice({ unitPrice: 0.16, unit: 'second', currency: 'USD' })).toBe('$0.16 / s');
    expect(formatPrice(undefined)).toBe('Preis unbekannt');
    expect(exampleCost({ modality: 'video', price: { unitPrice: 0.16, unit: 'second', currency: 'USD' }, capabilities: { durations: [5, 10] } })).toBe('5 s ≈ $0.80');
    expect(exampleCost({ modality: 'image', price: { unitPrice: 0.04, unit: 'image', currency: 'USD' }, capabilities: {} })).toBe('4 Bilder ≈ $0.16');
    expect(CLAUDE_MODELS[0]!.id).toBe('claude-opus-5-5');
    expect(tokenCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000 })).toBeCloseTo(4 + 2 + 0.2);
    expect(tokenCostUsd('unknown', { inputTokens: 1, outputTokens: 1 })).toBe(0);
  });
});

describe('assets', () => {
  const base: Asset = { id: 'a1', kind: 'image', title: 'Mira Charakterblatt', tags: ['character', 'mira'], status: 'active', source: 'generated', createdAt: '2026-10-01T10:00:00Z', prompt: 'paper cut sunflower girl' };
  it('matches queries', () => {
    expect(assetMatches(base, { text: 'mira paper' })).toBe(true);
    expect(assetMatches(base, { text: 'robot' })).toBe(false);
    expect(assetMatches(base, { kinds: ['video'] })).toBe(false);
    expect(assetMatches({ ...base, status: 'rejected' }, {})).toBe(false);
    expect(assetMatches({ ...base, status: 'rejected' }, { statuses: ['rejected'] })).toBe(true);
    expect(assetMatches(base, { tags: ['character', 'mira'] })).toBe(true);
    const sorted = filterAssets([base, { ...base, id: 'a2', createdAt: '2026-10-02T00:00:00Z' }], { limit: 1 });
    expect(sorted.map((a) => a.id)).toEqual(['a2']);
  });
  it('maps mime types', () => {
    expect(mimeFromExtension('song.MP3')).toBe('audio/mpeg');
    expect(assetKindFromMime('video/mp4')).toBe('video');
    expect(assetKindFromMime('application/pdf')).toBe('document');
  });
});
