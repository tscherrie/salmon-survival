import { describe, expect, it } from 'vitest';
import {
  alignClicksToWords,
  BudgetLedger,
  checkModelAllowed,
  createCheckpoints,
  currentCheckpoint,
  decideCheckpoint,
  DEFAULT_PICKERS,
  exampleCost,
  formatPrice,
  formatUsd,
  initialPickers,
  mergeCheckpoints,
  modelFamily,
  parseManifest,
  parsePickerState,
  parsePriceUnit,
  parseRefTag,
  proposeCheckpoint,
  PROJECT_SCHEMA_VERSION,
  refEquals,
  refLabel,
  sequentialIds,
  serializeRef,
  type AuthStatus,
  type Generation,
  type ModelInfo,
  type PickerState,
  type ProjectSnapshot,
  type Ref,
  type StudioApi,
  type TimedWord,
  type TranscriptWord,
} from '../src/index.ts';

const pinned = (modality: 'image' | 'video' | 'voice', modelId: string): PickerState => ({ [modality]: { mode: 'model', modelId } });

describe('modelFamily & Picker-Bindung', () => {
  it('streift nur Aufgaben-Segmente ab und behält mindestens owner/app', () => {
    expect(modelFamily('minimax/h3-max/text-to-video')).toBe('minimax/h3-max');
    expect(modelFamily('minimax/h3-max/director')).toBe('minimax/h3-max');
    expect(modelFamily('minimax/h3-max-turbo/text-to-video')).toBe('minimax/h3-max');
    expect(modelFamily('minimax/h3-max-turbo')).toBe('minimax/h3-max');
    expect(modelFamily('fal-ai/flux/dev')).toBe('fal-ai/flux/dev');
    expect(modelFamily('fal-ai/flux/dev/image-to-image')).toBe('fal-ai/flux/dev');
    expect(modelFamily('fal-ai/flux/schnell')).toBe('fal-ai/flux/schnell');
    expect(modelFamily('fal-ai/kling-video/v3/pro/text-to-video')).toBe('fal-ai/kling-video/v3/pro');
    expect(modelFamily('fal-ai/ltx-video/image-to-video')).toBe('fal-ai/ltx-video');
    expect(modelFamily('owner/app/edit/upscale')).toBe('owner/app');
    expect(modelFamily('fal-ai/edit')).toBe('fal-ai/edit');
    expect(modelFamily('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('erlaubt die ganze h3-max-Familie inkl. turbo beim Default-Video-Picker', () => {
    for (const id of ['minimax/h3-max/reference-to-video', 'minimax/h3-max/extend-video', 'minimax/h3-max/director', 'minimax/h3-max/3d-to-video', 'minimax/h3-max-turbo/text-to-video']) {
      expect(checkModelAllowed(DEFAULT_PICKERS, 'video', id).ok, id).toBe(true);
    }
  });

  it('verweigert andere Modelle/Stufen desselben Anbieters, erlaubt Aufgaben-Varianten des gewählten Modells', () => {
    const flux = pinned('image', 'fal-ai/flux/dev');
    expect(checkModelAllowed(flux, 'image', 'fal-ai/flux/schnell').ok).toBe(false);
    expect(checkModelAllowed(flux, 'image', 'fal-ai/flux/krea').ok).toBe(false);
    expect(checkModelAllowed(flux, 'image', 'fal-ai/flux/dev/image-to-image').ok).toBe(true);

    const veoFast = pinned('video', 'fal-ai/veo3/fast');
    expect(checkModelAllowed(veoFast, 'video', 'fal-ai/veo3').ok).toBe(false);
    expect(checkModelAllowed(veoFast, 'video', 'fal-ai/veo3/fast/image-to-video').ok).toBe(true);
    expect(checkModelAllowed(pinned('video', 'fal-ai/veo3'), 'video', 'fal-ai/veo3/fast').ok).toBe(false);

    const speech = pinned('voice', 'fal-ai/minimax/speech-02-hd');
    expect(checkModelAllowed(speech, 'voice', 'fal-ai/minimax/speech-02-turbo').ok).toBe(false);
    expect(checkModelAllowed(speech, 'voice', 'fal-ai/minimax/voice-clone').ok).toBe(false);

    const kontext = pinned('image', 'fal-ai/flux-pro/kontext');
    expect(checkModelAllowed(kontext, 'image', 'fal-ai/flux-pro/v1.1-ultra').ok).toBe(false);
  });

  it('liest Nutzer-Defaults für Picker defensiv', () => {
    expect(parsePickerState({ video: { mode: 'model', modelId: ' fal-ai/veo3 ' }, text: { mode: 'auto' }, bogus: { mode: 'auto' }, image: { mode: 'model' }, voice: 'x' })).toEqual({
      video: { mode: 'model', modelId: 'fal-ai/veo3' },
      text: { mode: 'auto' },
    });
    expect(parsePickerState(null)).toEqual({});
    expect(initialPickers({ video: { mode: 'model', modelId: 'fal-ai/veo3' } })).toEqual({ ...DEFAULT_PICKERS, video: { mode: 'model', modelId: 'fal-ai/veo3' } });
    expect(initialPickers()).toEqual(DEFAULT_PICKERS);
    expect(initialPickers()).not.toBe(DEFAULT_PICKERS);
  });
});

describe('Preise', () => {
  it.each([
    ['seconds', 'second', 1],
    ['second', 'second', 1],
    ['5 seconds', 'second', 5],
    ['minutes', 'minute', 1],
    ['images', 'image', 1],
    ['megapixels', 'megapixel', 1],
    ['megapixel of generated video data', 'other', 1],
    ['1k characters', 'character', 1000],
    ['1000 characters', 'character', 1000],
    ['1M characters', 'character', 1_000_000],
    ['characters', 'character', 1],
    ['compute seconds', 'compute-second', 1],
    ['1M input tokens', 'token', 1_000_000],
    ['videos', 'video', 1],
    ['requests', 'request', 1],
    ['units', 'other', 1],
    ['', 'other', 1],
  ])('parsePriceUnit(%j) → %s je %d', (unit, kind, per) => {
    expect(parsePriceUnit(unit)).toEqual({ kind, per });
  });

  it('formatiert Einheiten aus freiem Text', () => {
    expect(formatPrice({ unitPrice: 0.3, unit: '1k characters', currency: 'USD' })).toBe('$0.30 / 1k Zeichen');
    expect(formatPrice({ unitPrice: 0.3, unit: '1000 characters', currency: 'USD' })).toBe('$0.30 / 1k Zeichen');
    expect(formatPrice({ unitPrice: 0.5, unit: '5 seconds', currency: 'USD' })).toBe('$0.50 / 5 s');
    expect(formatPrice({ unitPrice: 0.002, unit: 'compute seconds', currency: 'USD' })).toBe('$0.002 / Rechensek.');
    expect(formatPrice({ unitPrice: 0.04, unit: 'images', currency: 'USD' })).toBe('$0.040 / Bild');
    expect(formatPrice({ unitPrice: 0.1, unit: 'units', currency: 'USD' })).toBe('$0.10 / units');
    expect(formatPrice({ unitPrice: 4, unit: '1M input tokens', currency: 'USD' })).toBe('$4.00 / 1M input tokens');
  });

  it('zeigt Kleinstpreise nicht als $0.000', () => {
    expect(formatPrice({ unitPrice: 0.00003, unit: 'character', currency: 'USD' })).toBe('$0.00003 / Zeichen');
    expect(formatPrice({ unitPrice: 0.0004, unit: 'second', currency: 'USD' })).toBe('$0.0004 / s');
    expect(formatPrice({ unitPrice: 0.0004, unit: 'second', currency: 'EUR' })).toBe('0.0004 EUR / s');
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.000123)).toBe('$0.00012');
    expect(formatUsd(-0.00005)).toBe('-$0.00005');
    expect(formatUsd(1e-7)).toBe('$0.0000001');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0423)).toBe('$0.042');
    expect(formatUsd(12)).toBe('$12.00');
  });

  it('rechnet Beispielkosten mit der Einheitengröße', () => {
    const cost = (unitPrice: number, unit: string, capabilities: ModelInfo['capabilities'] = {}) =>
      exampleCost({ modality: 'voice', price: { unitPrice, unit, currency: 'USD' }, capabilities });
    expect(cost(30, '1M characters')).toBe('500 Zeichen ≈ $0.015');
    expect(cost(0.0003, 'characters')).toBe('500 Zeichen ≈ $0.15');
    expect(cost(0.3, '1k characters')).toBe('500 Zeichen ≈ $0.15');
    expect(cost(0.3, '1000 characters')).toBe('500 Zeichen ≈ $0.15');
    expect(cost(0.5, '5 seconds', { durations: [5, 10] })).toBe('5 s ≈ $0.50');
    expect(cost(0.16, 'seconds', { durations: [6, 10] })).toBe('6 s ≈ $0.96');
    expect(cost(0.04, 'images')).toBe('4 Bilder ≈ $0.16');
    expect(cost(0.02, 'megapixels')).toBe('1024² ≈ $0.021');
    expect(cost(0.1, 'minutes')).toBe('1 min ≈ $0.10');
    expect(cost(0.5, 'requests')).toBe('1 Aufruf ≈ $0.50');
    expect(cost(0.002, 'compute seconds')).toBeUndefined();
    expect(cost(4, '1M input tokens')).toBeUndefined();
    expect(cost(0.1, 'units')).toBeUndefined();
  });
});

describe('Budget-Ledger (Review-Befunde)', () => {
  const ledger = () => {
    const ids = sequentialIds();
    return new BudgetLedger({}, () => '2026-10-01T00:00:00Z', () => ids('led'));
  };

  it('zählt Ausgaben ohne Checkpoint bei der Checkpoint-Prüfung mit', () => {
    const l = ledger();
    l.approve('cp', 10);
    l.recordUsage('run_1', 8);
    expect(l.summary().availableUsd).toBe(2);
    const check = l.check(5, 'cp');
    expect(check).toMatchObject({ ok: false, availableUsd: 2, shortfallUsd: 3 });
    // Nachfreigabe des Fehlbetrags auf den Checkpoint deckt die Ausgabe genau.
    if (!check.ok) l.approve('cp', check.shortfallUsd);
    expect(l.check(5, 'cp')).toEqual({ ok: true, availableUsd: 5 });
  });

  it('prüft weiterhin die Restfreigabe des Checkpoints', () => {
    const l = ledger();
    l.approve('cp_a', 10);
    l.approve('cp_b', 50);
    l.reserve('g1', 8, { checkpointId: 'cp_a' });
    expect(l.check(3, 'cp_a')).toMatchObject({ ok: false, availableUsd: 2, shortfallUsd: 1 });
    expect(l.check(3, 'cp_b').ok).toBe(true);
    expect(l.check(3).ok).toBe(true);
    expect(l.check(3, 'cp_unbekannt')).toMatchObject({ ok: false, availableUsd: 0 });
  });

  it('bucht Director-Nutzung auf einen Checkpoint', () => {
    const l = ledger();
    l.approve('cp', 20);
    const entry = l.recordUsage('run_1', 6, 'director', 'claude-opus-5-5', 'cp');
    expect(entry).toMatchObject({ kind: 'actual', checkpointId: 'cp', source: 'director', note: 'claude-opus-5-5' });
    expect(l.summary().byCheckpoint.cp).toEqual({ approvedUsd: 20, spentUsd: 6, reservedUsd: 0 });
    expect(l.check(15, 'cp').ok).toBe(false);
    expect(l.check(14, 'cp').ok).toBe(true);
  });

  it('settle() ist idempotent und bucht nicht doppelt', () => {
    const l = ledger();
    l.approve('cp', 20);
    l.reserve('g', 4, { checkpointId: 'cp' });
    const first = l.settle('g', 4);
    const count = l.listEntries().length;
    const second = l.settle('g', 4);
    expect(second).toBe(first);
    expect(l.listEntries()).toHaveLength(count);
    expect(l.summary()).toMatchObject({ spentUsd: 4, reservedUsd: 0 });
    expect(l.summary().byCheckpoint._).toBeUndefined();
    // Ohne vorherige Reservierung bucht der erste settle() normal …
    l.settle('h', 1, { checkpointId: 'cp' });
    l.settle('h', 1, { checkpointId: 'cp' });
    expect(l.summary().spentUsd).toBe(5);
    // … und eine neue Reservierung (erneuter Versuch) wird wieder abgerechnet.
    l.reserve('g', 2, { checkpointId: 'cp' });
    l.settle('g', 2);
    expect(l.summary()).toMatchObject({ spentUsd: 7, reservedUsd: 0 });
  });

  it('settle() bleibt nach dem Wiederherstellen aus dem Journal idempotent', () => {
    const a = ledger();
    a.reserve('g', 3);
    a.settle('g', 3);
    const b = new BudgetLedger({ entries: [...a.listEntries()] });
    b.settle('g', 3);
    expect(b.listEntries()).toHaveLength(a.listEntries().length);
    expect(b.summary().spentUsd).toBe(3);
  });

  it('weist nicht endliche Freigaben und Beträge zurück', () => {
    const l = ledger();
    expect(() => l.approve('cp', Infinity)).toThrow(/endlich/);
    expect(() => l.approve('cp', Number.NaN)).toThrow();
    expect(() => l.approve('cp', -1)).toThrow();
    expect(l.listApprovals()).toHaveLength(0);
    l.approve('cp', 10);
    const check = l.check(Infinity, 'cp');
    expect(check).toMatchObject({ ok: false, invalid: true, shortfallUsd: 0 });
    expect(l.check(Number.NaN).ok).toBe(false);
    expect(l.check(-1).ok).toBe(false);
  });

  it('ignoriert kaputte gespeicherte Freigaben (null/Infinity)', () => {
    const l = new BudgetLedger({
      approvals: [
        { checkpointId: 'cp', amountUsd: null as unknown as number, approvedAt: 't' },
        { checkpointId: 'cp', amountUsd: Infinity, approvedAt: 't' },
        { checkpointId: 'cp', amountUsd: 5, approvedAt: 't' },
      ],
    });
    expect(l.summary().approvedUsd).toBe(5);
    expect(l.check(6, 'cp').ok).toBe(false);
  });
});

describe('Wort-Alignment mit Anführungszeichen', () => {
  const w = (...texts: string[]): TimedWord[] => texts.map((text, i) => ({ text, start: i, end: i + 0.5 }));
  const text = (words: TimedWord[]) => alignClicksToWords(words, []).map((s) => (s.type === 'text' ? s.text : '')).join('');

  it('behält das Leerzeichen vor öffnenden Anführungszeichen', () => {
    expect(text(w('Er', 'sagte', '»Hallo«'))).toBe('Er sagte »Hallo«');
    expect(text(w('Er', 'sagte', '"Hallo"'))).toBe('Er sagte "Hallo"');
    expect(text(w('hab', "'ne", 'Idee'))).toBe("hab 'ne Idee");
    expect(text(w('Er', 'sagte', '“Hallo”'))).toBe('Er sagte “Hallo”');
  });

  it('hängt Satzzeichen und alleinstehende schließende Zeichen weiter an', () => {
    expect(text(w('Hallo', '«', ',', 'sagte', 'er', '.'))).toBe('Hallo«, sagte er.');
    expect(text(w('Mach', 'es', '"', '!'))).toBe('Mach es"!');
    expect(text(w('(', 'siehe', 'oben', ')'))).toBe('(siehe oben)');
    expect(text(w('Er', 'sagte', '„', 'Hallo', '“'))).toBe('Er sagte „Hallo“');
    expect(text(w('100', '%'))).toBe('100%');
  });

  it('setzt nach einer öffnenden Klammer mit Klick ein normales Leerzeichen', () => {
    const ref: Ref = { kind: 'time', frame: 1 };
    const segs = alignClicksToWords(w('(', 'hier'), [{ atMs: 200, ref }]);
    expect(segs).toEqual([{ type: 'text', text: '( ' }, { type: 'ref', ref }, { type: 'text', text: ' hier' }]);
  });

  it('TranscriptWord ist ein Alias von TimedWord', () => {
    const word: TranscriptWord = { text: 'a', start: 0, end: 1 };
    const timed: TimedWord = word;
    expect(timed).toBe(word);
  });
});

describe('Element-Referenzen mit Text und Tag', () => {
  it('serialisiert text/tag und liest sie zurück', () => {
    const ref: Ref = { kind: 'element', doc: 'site', page: '/about', selector: 'main > h1', tag: 'h1', text: 'Über „uns“ & <mehr> "Zitat"' };
    const tag = serializeRef(ref, 'r1');
    expect(tag).toContain('tag="h1"');
    expect(tag).toContain('text="Über „uns“ &amp; &lt;mehr&gt; &quot;Zitat&quot;"');
    const parsed = parseRefTag(tag);
    expect(parsed.ref).toEqual(ref);
    expect(refEquals(parsed.ref, ref)).toBe(true);
  });

  it('kürzt langen oder mehrzeiligen Text auf eine Zeile mit höchstens 120 Zeichen', () => {
    const long = `${'Wort '.repeat(40)}Ende`;
    const tag = serializeRef({ kind: 'element', doc: 'site', text: long }, 'r1');
    const parsed = parseRefTag(tag).ref;
    expect(parsed.kind === 'element' && parsed.text).toBeTruthy();
    if (parsed.kind !== 'element') throw new Error('falscher Typ');
    expect(Array.from(parsed.text!).length).toBe(120);
    expect(parsed.text!.endsWith('…')).toBe(true);
    const multi = parseRefTag(serializeRef({ kind: 'element', doc: 'site', text: '  Zeile 1\n\tZeile 2 ', tag: 'P' }, 'r2')).ref;
    expect(multi).toMatchObject({ text: 'Zeile 1 Zeile 2', tag: 'p' });
  });

  it('beschriftet Chips mit Tag und Text statt Selektor', () => {
    expect(refLabel({ kind: 'element', doc: 'site', page: '/', selector: 'body > main > section:nth-child(2) > h2', tag: 'h2', text: 'Unsere Leistungen' })).toBe('◳ / · h2 „Unsere Leistungen“');
    expect(refLabel({ kind: 'element', doc: 'site', selector: 'main > h1' })).toBe('◳ main > h1');
    expect(refLabel({ kind: 'element', doc: 'site', tag: 'img' })).toBe('◳ img');
  });
});

describe('mergeCheckpoints', () => {
  it('legt offene Checkpoints zusammen und behält die erste ID', () => {
    let list = createCheckpoints('video');
    list = mergeCheckpoints(list, ['cp_1_treatment', 'cp_2_style_bible'], 'Treatment & Style Bible');
    expect(list.map((c) => c.id)).toEqual(['cp_1_treatment', 'cp_3_storyboard', 'cp_4_production', 'cp_5_finishing']);
    expect(list[0]).toMatchObject({
      id: 'cp_1_treatment',
      kind: 'treatment',
      title: 'Treatment & Style Bible',
      status: 'pending',
      mergedFrom: [{ id: 'cp_2_style_bible', kind: 'style_bible', title: 'Style Bible' }],
    });
    list = proposeCheckpoint(list, 'cp_1_treatment', { summary: 'Idee + Look', budgetRequestedUsd: 5 }, 't1');
    list = decideCheckpoint(list, 'cp_1_treatment', { decision: 'approve' }, 't2');
    expect(currentCheckpoint(list)?.id).toBe('cp_3_storyboard');
  });

  it('nimmt Position und ID des in der Reihenfolge ersten Checkpoints, unabhängig von der Argument-Reihenfolge', () => {
    const list = mergeCheckpoints(createCheckpoints('web'), ['cp_4_qa', 'cp_3_implementation'], 'Umsetzung & QA');
    expect(list.map((c) => [c.id, c.title])).toEqual([
      ['cp_1_sitemap', 'Sitemap & Inhalte'],
      ['cp_2_mockups', 'Mockups & Style Bible'],
      ['cp_3_implementation', 'Umsetzung & QA'],
    ]);
  });

  it('übernimmt offenes Änderungs-Feedback und Belege, verwirft alte Vorlagen', () => {
    let list = createCheckpoints('slides');
    list = proposeCheckpoint(list, 'cp_1_outline', { summary: 'Gliederung', assetIds: ['ast_1'], budgetRequestedUsd: 2 }, 't1');
    list = decideCheckpoint(list, 'cp_1_outline', { decision: 'request_changes', feedback: 'kürzer' }, 't2');
    list = mergeCheckpoints(list, ['cp_1_outline', 'cp_2_theme'], 'Gliederung & Theme');
    expect(list[0]).toMatchObject({ id: 'cp_1_outline', status: 'changes_requested', feedback: 'Storyline & Gliederung: kürzer', assetIds: ['ast_1'] });
    expect(list[0]!.summary).toBeUndefined();
    expect(list[0]!.budgetRequestedUsd).toBeUndefined();
    expect(list[0]!.proposedAt).toBeUndefined();
    // Erneutes Zusammenlegen sammelt die Herkunft weiter.
    list = mergeCheckpoints(list, ['cp_1_outline', 'cp_3_full_deck'], 'Gliederung, Theme & Deck');
    expect(list[0]!.mergedFrom?.map((m) => m.id)).toEqual(['cp_2_theme', 'cp_3_full_deck']);
    expect(list).toHaveLength(2);
  });

  it('verweigert ungültige Zusammenlegungen', () => {
    let list = createCheckpoints('audio');
    expect(() => mergeCheckpoints(list, ['cp_1_concept'], 'X')).toThrow(/mindestens zwei/);
    expect(() => mergeCheckpoints(list, ['cp_1_concept', 'cp_1_concept'], 'X')).toThrow(/doppelt/);
    expect(() => mergeCheckpoints(list, ['cp_1_concept', 'cp_9'], 'X')).toThrow(/Unbekannte.*cp_9/);
    expect(() => mergeCheckpoints(list, ['cp_1_concept', 'cp_2_rough_cut'], '  ')).toThrow(/Titel/);
    list = proposeCheckpoint(list, 'cp_1_concept', { summary: 'Plan' }, 't1');
    expect(() => mergeCheckpoints(list, ['cp_1_concept', 'cp_2_rough_cut'], 'X')).toThrow(/Nur offene/);
    list = decideCheckpoint(list, 'cp_1_concept', { decision: 'approve' }, 't2');
    expect(() => mergeCheckpoints(list, ['cp_1_concept', 'cp_2_rough_cut'], 'X')).toThrow(/Nur offene/);
    list = decideCheckpoint(list, 'cp_2_rough_cut', { decision: 'skip' }, 't3');
    expect(() => mergeCheckpoints(list, ['cp_2_rough_cut', 'cp_3_mix_master'], 'X')).toThrow(/Nur offene/);
  });
});

describe('Vertrags-Typen (api/generation)', () => {
  it('erlaubt Projekte ohne Dokument und neue Felder', () => {
    const doc: ProjectSnapshot['document'] = null;
    const auth: AuthStatus = { runtimes: [], active: null, falConfigured: false, anthropic: { apiKey: true, oauthProfile: false } };
    const gen: Pick<Generation, 'queueHandle' | 'billableUnits' | 'etaSec'> = {
      queueHandle: { statusUrl: 'https://queue/s', responseUrl: 'https://queue/r', cancelUrl: 'https://queue/c' },
      billableUnits: 10,
      etaSec: 42,
    };
    type Methods = Pick<StudioApi, 'getLineage' | 'previewNavigate' | 'relinkAsset'>;
    const api: Methods = {
      getLineage: async (_p, assetId) => ({ parents: [{ parentId: 'a0', childId: assetId, relation: 'derived' }], children: [] }),
      previewNavigate: async () => undefined,
      relinkAsset: async (_p, id, path) => ({ id, kind: 'audio', title: 'Song', tags: [], status: 'active', source: 'linked', path, createdAt: 't' }),
    };
    expect(doc).toBeNull();
    expect(auth.anthropic.apiKey).toBe(true);
    expect(gen.queueHandle?.cancelUrl).toContain('/c');
    expect(typeof api.getLineage).toBe('function');
  });
});

describe('parseManifest mit defekten Budget-Freigaben', () => {
  it('öffnet Projekte, deren Freigabe als null gespeichert wurde', () => {
    const manifest = parseManifest({
      schema: PROJECT_SCHEMA_VERSION,
      id: 'prj_1',
      title: 'Test',
      category: 'video',
      createdAt: 't',
      updatedAt: 't',
      formats: [],
      brief: null,
      pickers: {},
      checkpoints: [],
      budgetApprovals: [
        { checkpointId: 'cp', amountUsd: null, approvedAt: 't' },
        { checkpointId: 'cp', amountUsd: 5, approvedAt: 't' },
      ],
      director: { effort: 'high' },
      phase: 'planning',
    });
    expect(manifest.budgetApprovals).toEqual([{ checkpointId: 'cp', amountUsd: 5, approvedAt: 't' }]);
    expect(new BudgetLedger({ approvals: manifest.budgetApprovals }).summary().approvedUsd).toBe(5);
  });
});
