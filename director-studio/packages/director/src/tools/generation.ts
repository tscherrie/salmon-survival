import { z } from 'zod';
import {
  assetKindFromMime,
  formatUsd,
  isTerminal,
  mimeFromExtension,
  type Asset,
  type AssetKind,
  type Generation,
  type GenerationQueueHandle,
  type IdGenerator,
  type LineageRelation,
  type Modality,
  type StudioEvent,
} from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { budgetGate, emitBudget, pickerGate } from '../gates.ts';
import { normalizeProbe } from '../normalize.ts';
import type { Clock, GenerationPort, GenerationRunOptions, MediaOutput, MediaPort, ModelCatalogPort, QueueHandle } from '../ports.ts';
import { errorMessage, formatSec, isAbortError, projectTempDir, raceAbort, truncate } from '../util.ts';
import { defineTool, errorResult, textResult, type ToolContext, type ToolResult } from './registry.ts';

/** Wie die Ergebnisse einer Generierung als Assets abgelegt werden (Standard: wie bei `generate`). */
export interface GenerationIngestOptions {
  /** Lineage-Beziehung der Ergebnisse zu den Eingabe-Assets (Standard `input`; Extraktionen: `extracted`). */
  parentRelation?: LineageRelation | undefined;
  /** Subtyp der Medien-Ergebnisse, z. B. `rotoscope-mask`. */
  subtype?: string | undefined;
  /** Zusätzliche Metadaten an jedem Ergebnis-Asset. */
  metadata?: Record<string, unknown> | undefined;
  /**
   * Zusätzlich die Rohantwort des Modells (Medien-URLs durch `asset:<id>` ersetzt) als Daten-Asset sichern –
   * z. B. Keypoints einer Pose-Erkennung neben dem Vorschauvideo.
   */
  dataAsset?: { subtype: string } | undefined;
}

/**
 * Journal-Eintrag einer Generierung. `queueHandle` und `billableUnits` sind typisierte Felder von
 * {@link Generation}. Ältere Einträge trugen zusätzlich `requestId`/`endpointId` im `queueHandle` – sie werden
 * beim Lesen weiter berücksichtigt (siehe {@link resumeHandleOf}). `ingest` hält die Ablage-Optionen für die
 * Wiederaufnahme nach einem Absturz fest.
 */
export type JournaledGeneration = Omit<Generation, 'queueHandle'> & {
  queueHandle?: (GenerationQueueHandle & Partial<Pick<QueueHandle, 'requestId' | 'endpointId'>>) | undefined;
  ingest?: GenerationIngestOptions | undefined;
};

/** Handle für `GenerationPort.resume` aus einem (ggf. alten) Journal-Eintrag; `undefined` ohne request_id. */
export function resumeHandleOf(gen: JournaledGeneration): (Pick<QueueHandle, 'requestId' | 'endpointId'> & Partial<QueueHandle>) | undefined {
  const legacy = gen.queueHandle;
  const requestId = gen.requestId ?? legacy?.requestId;
  if (!requestId) return undefined;
  return {
    requestId,
    endpointId: gen.endpointId,
    ...(typeof legacy?.statusUrl === 'string' ? { statusUrl: legacy.statusUrl } : {}),
    ...(typeof legacy?.responseUrl === 'string' ? { responseUrl: legacy.responseUrl } : {}),
    ...(typeof legacy?.cancelUrl === 'string' ? { cancelUrl: legacy.cancelUrl } : {}),
  };
}

/** Öffentliche Sicht (Ereignisse an die UI): nur die typisierten Felder von {@link Generation}. */
export function publicGeneration(gen: JournaledGeneration): Generation {
  const { queueHandle, ingest: _ingest, ...rest } = gen;
  const handle =
    queueHandle && typeof queueHandle.statusUrl === 'string' && typeof queueHandle.responseUrl === 'string' && typeof queueHandle.cancelUrl === 'string'
      ? { statusUrl: queueHandle.statusUrl, responseUrl: queueHandle.responseUrl, cancelUrl: queueHandle.cancelUrl }
      : undefined;
  return { ...rest, ...(handle ? { queueHandle: handle } : {}) };
}

export interface GenerationJobInput {
  endpointId: string;
  modality: Modality;
  input: Record<string, unknown>;
  purpose: string;
  estimateUsd: number;
  checkpointId: string;
  inputAssetIds: string[];
  outputTitle?: string | undefined;
  outputTags?: string[] | undefined;
  /** Ablage der Ergebnisse (Subtyp, Lineage-Beziehung, Daten-Asset); Standard wie `generate`. */
  ingest?: GenerationIngestOptions | undefined;
}

export interface GenerationOutcome {
  generation: Generation;
  assets: Asset[];
}

export interface GenerationManagerDeps {
  project: ProjectStore;
  generation: GenerationPort;
  media?: MediaPort | undefined;
  emit: (event: StudioEvent) => void;
  projectId: string;
  clock: Clock;
  ids: IdGenerator;
  /** Für exakte Ist-Kosten aus `billableUnits` × Einheitspreis. */
  catalog?: ModelCatalogPort | undefined;
}

type Runner = (opts: GenerationRunOptions) => Promise<{ output: unknown; billableUnits?: number }>;

/**
 * Hintergrund-Generierungen: Journal VOR dem Absenden (Status `queued`), Reservierung im Ledger,
 * Statusfortschreibung, Ingest der Ergebnisse in den Projektspeicher (fal-URLs sind nicht dauerhaft),
 * Ist-Buchung bzw. Freigabe der Reservierung.
 */
export class GenerationManager {
  private readonly jobs = new Map<string, { promise: Promise<GenerationOutcome>; controller: AbortController }>();

  constructor(private readonly deps: GenerationManagerDeps) {}

  isRunning(id: string): boolean {
    return this.jobs.has(id);
  }

  runningIds(): string[] {
    return [...this.jobs.keys()];
  }

  async submit(job: GenerationJobInput): Promise<string> {
    const { project, clock, ids } = this.deps;
    const id = ids('gen');
    const gen: JournaledGeneration = {
      id,
      endpointId: job.endpointId,
      modality: job.modality,
      status: 'queued',
      input: job.input,
      purpose: job.purpose,
      estimateUsd: job.estimateUsd,
      checkpointId: job.checkpointId,
      inputAssetIds: job.inputAssetIds,
      outputAssetIds: [],
      outputTitle: job.outputTitle,
      outputTags: job.outputTags,
      ...(job.ingest ? { ingest: job.ingest } : {}),
      createdAt: clock(),
    };
    // Absturzsicherheit: Journal + Reservierung, bevor irgendetwas an fal geht.
    await project.saveGeneration(gen);
    await project.budgetReserve(id, job.estimateUsd, { source: 'fal', checkpointId: job.checkpointId, note: job.purpose });
    this.emitGeneration(gen);
    emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
    this.start(gen, (opts) => this.deps.generation.run(job.endpointId, job.input, opts));
    return id;
  }

  /** Wartet auf eine Generierung (höchstens `timeoutMs`); `undefined` bei Zeitüberschreitung. */
  async wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<GenerationOutcome | undefined> {
    const job = this.jobs.get(id);
    if (!job) {
      const gen = this.deps.project.getGeneration(id);
      if (!gen) throw new Error(`Generierung „${id}“ existiert nicht`);
      return { generation: publicGeneration(gen), assets: gen.outputAssetIds.map((a) => this.deps.project.getAsset(a)).filter((a): a is Asset => !!a) };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    try {
      return await raceAbort(Promise.race([job.promise, timeout]), signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async cancel(id: string): Promise<Generation | undefined> {
    const job = this.jobs.get(id);
    if (job) {
      job.controller.abort();
      return (await job.promise).generation;
    }
    const gen = this.deps.project.getGeneration(id) as JournaledGeneration | undefined;
    if (!gen || isTerminal(gen.status)) return gen && publicGeneration(gen);
    await this.deps.project.budgetRelease(id);
    const canceled: JournaledGeneration = { ...gen, status: 'canceled', finishedAt: this.deps.clock(), error: 'Abgebrochen', etaSec: undefined };
    await this.saveJournal(canceled);
    this.emitGeneration(canceled);
    return publicGeneration(canceled);
  }

  /** Bricht alle laufenden Jobs ab (z. B. beim Schließen ohne Wiederaufnahme). */
  abortAll(): void {
    for (const job of this.jobs.values()) job.controller.abort();
  }

  /** Wartet, bis alle laufenden Jobs beendet sind (Tests, geordnetes Herunterfahren). */
  async drain(): Promise<void> {
    while (this.jobs.size) await Promise.allSettled([...this.jobs.values()].map((j) => j.promise));
  }

  /**
   * Absturz-Wiederaufnahme: Journal-Einträge `queued`/`running` mit request_id werden über
   * `GenerationPort.resume` weiter gepollt; Einträge ohne request_id (vor dem Absenden abgestürzt)
   * oder ohne Resume-Unterstützung werden als fehlgeschlagen markiert und ihre Reservierung freigegeben.
   */
  async resumePending(): Promise<{ resumed: string[]; failed: string[] }> {
    const { project } = this.deps;
    const resumed: string[] = [];
    const failed: string[] = [];
    for (const gen of project.listGenerations(['queued', 'running']) as JournaledGeneration[]) {
      if (this.jobs.has(gen.id)) continue;
      const resume = this.deps.generation.resume?.bind(this.deps.generation);
      const handle = resumeHandleOf(gen);
      if (handle && resume) {
        this.start(gen, (opts) => resume(handle, { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onStatus ? { onStatus: opts.onStatus } : {}) }));
        resumed.push(gen.id);
      } else {
        await project.budgetRelease(gen.id);
        const next: JournaledGeneration = {
          ...gen,
          status: 'failed',
          finishedAt: this.deps.clock(),
          etaSec: undefined,
          error: handle ? 'Nach Neustart nicht fortsetzbar (kein Resume im fal-Adapter)' : 'Vor dem Absenden unterbrochen (App-Neustart)',
        };
        await this.saveJournal(next);
        this.emitGeneration(next);
        failed.push(gen.id);
      }
    }
    if (failed.length) emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
    return { resumed, failed };
  }

  private start(gen: JournaledGeneration, runner: Runner): void {
    const controller = new AbortController();
    const promise = this.execute(gen, controller.signal, runner).finally(() => this.jobs.delete(gen.id));
    this.jobs.set(gen.id, { promise, controller });
  }

  private async execute(initial: JournaledGeneration, signal: AbortSignal, runner: Runner): Promise<GenerationOutcome> {
    const { project, clock } = this.deps;
    let current: JournaledGeneration = initial;
    let chain: Promise<unknown> = Promise.resolve();
    const save = (patch: Partial<JournaledGeneration>): Promise<unknown> => {
      chain = chain.then(async () => {
        current = { ...current, ...patch };
        await this.saveJournal(current);
        this.emitGeneration(current);
      });
      return chain;
    };
    try {
      const { output, billableUnits } = await runner({
        signal,
        onSubmitted: async (handle) => {
          // Nur die typisierten Queue-URLs journalisieren (request_id hat ein eigenes Feld).
          await save({
            requestId: handle.requestId,
            queueHandle: { statusUrl: handle.statusUrl, responseUrl: handle.responseUrl, cancelUrl: handle.cancelUrl },
            submittedAt: clock(),
          });
        },
        onStatus: (status) => {
          const state = status.state.toUpperCase();
          const nextStatus = state.includes('PROGRESS') || state === 'RUNNING' ? 'running' : state.includes('QUEUE') ? 'queued' : current.status;
          const etaSec = status.etaSec !== undefined && Number.isFinite(status.etaSec) && status.etaSec >= 0 ? status.etaSec : undefined;
          const changed = nextStatus !== current.status || status.queuePosition !== current.queuePosition || etaSec !== current.etaSec;
          if (changed) {
            void save({ status: nextStatus, queuePosition: status.queuePosition, etaSec, logs: status.logs.slice(-20) });
          }
        },
      });
      await chain;
      const units = billableUnits !== undefined && Number.isFinite(billableUnits) && billableUnits >= 0 ? billableUnits : undefined;
      const exact = this.exactCost(current.endpointId, units);
      const actualUsd = exact ?? current.estimateUsd;
      const assets = await this.ingest(current, output, actualUsd);
      await project.budgetSettle(current.id, actualUsd, {
        source: 'fal',
        checkpointId: current.checkpointId,
        note: exact !== undefined ? `Ist laut fal: ${units} Einheiten` : 'Ist = Schätzung (exakte Kosten nicht gemeldet)',
      });
      await save({
        status: 'completed',
        outputAssetIds: assets.map((a) => a.id),
        costUsd: actualUsd,
        ...(units !== undefined ? { billableUnits: units } : {}),
        finishedAt: clock(),
        queuePosition: undefined,
        etaSec: undefined,
      });
      await chain;
      emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
      return { generation: publicGeneration(current), assets };
    } catch (error) {
      await chain.catch(() => undefined);
      const canceled = signal.aborted || isAbortError(error);
      await project.budgetRelease(current.id);
      await save({ status: canceled ? 'canceled' : 'failed', error: canceled ? 'Abgebrochen' : truncate(errorMessage(error), 2000), finishedAt: clock(), queuePosition: undefined, etaSec: undefined });
      await chain.catch(() => undefined);
      emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
      return { generation: publicGeneration(current), assets: [] };
    }
  }

  /** Schreibt einen Journal-Eintrag (inkl. Ablage-Optionen, die {@link Generation} nicht kennt). */
  private saveJournal(gen: JournaledGeneration): Promise<unknown> {
    return this.deps.project.saveGeneration(gen as Generation);
  }

  /** Exakte Kosten aus abgerechneten Einheiten × Einheitspreis (nur USD-Preise). */
  private exactCost(endpointId: string, billableUnits: number | undefined): number | undefined {
    if (billableUnits === undefined || !Number.isFinite(billableUnits) || billableUnits < 0) return undefined;
    const price = this.deps.catalog?.get(endpointId)?.price;
    if (!price || price.currency !== 'USD') return undefined;
    return billableUnits * price.unitPrice;
  }

  /** Lädt alle Ausgaben herunter und registriert sie als Assets mit Lineage und Kostenanteil. */
  private async ingest(gen: JournaledGeneration, output: unknown, costUsd: number): Promise<Asset[]> {
    const { project, generation, media } = this.deps;
    const opts = gen.ingest ?? {};
    let outputs: MediaOutput[] = generation.extractMediaOutputs(output);
    if (outputs.length === 0 && output !== undefined) outputs = generation.extractMediaOutputs({ output });
    const prompt = typeof gen.input.prompt === 'string' ? gen.input.prompt : typeof gen.input.text === 'string' ? gen.input.text : undefined;
    const relation: LineageRelation = opts.parentRelation ?? 'input';
    const parents = gen.inputAssetIds.map((assetId) => ({ assetId, relation }));
    const baseTitle = gen.outputTitle ?? truncate(gen.purpose, 80);
    const tags = gen.outputTags ?? [];
    const metadata = opts.metadata ? { metadata: opts.metadata } : {};
    const assets: Asset[] = [];
    if (outputs.length === 0) {
      // Kein Medium erkannt: Rohantwort als Daten-Asset sichern, damit nichts verloren geht.
      const asset = await project.addAssetFromBuffer(JSON.stringify(output ?? null, null, 2), {
        fileName: 'output.json',
        kind: 'data',
        subtype: opts.dataAsset?.subtype ?? opts.subtype ?? 'model-output',
        title: baseTitle,
        tags,
        source: 'generated',
        modelId: gen.endpointId,
        generationId: gen.id,
        costUsd,
        description: gen.purpose,
        parents,
        ...metadata,
        ...(prompt ? { prompt } : {}),
      });
      this.deps.emit({ type: 'asset', projectId: this.deps.projectId, asset });
      return [asset];
    }
    const share = outputs.length ? costUsd / outputs.length : 0;
    const tmp = await projectTempDir(project.dir, gen.id);
    for (const [i, out] of outputs.entries()) {
      const title = outputs.length > 1 ? `${baseTitle} (${i + 1}/${outputs.length})` : baseTitle;
      const common = {
        title,
        tags,
        source: 'generated' as const,
        modelId: gen.endpointId,
        generationId: gen.id,
        costUsd: share,
        description: gen.purpose,
        parents,
        ...(opts.subtype ? { subtype: opts.subtype } : {}),
        ...metadata,
        ...(prompt ? { prompt } : {}),
      };
      let asset: Asset;
      if (out.kind === 'text' && !out.url && out.text !== undefined) {
        asset = await project.addAssetFromBuffer(out.text, { ...common, fileName: 'output.txt', kind: 'text' });
      } else {
        const file = await generation.download(out.url, tmp);
        const mime = normalizeMime(file.contentType || out.contentType || mimeFromExtension(out.fileName ?? file.path));
        const kind = assetKindFor(out, mime);
        let width = out.width;
        let height = out.height;
        let durationMs = out.durationSec !== undefined ? Math.round(out.durationSec * 1000) : undefined;
        let fps: number | undefined;
        if (media && (kind === 'video' || kind === 'audio' || (kind === 'image' && (!width || !height)))) {
          try {
            const probe = normalizeProbe(await media.probe(file.path));
            width ??= probe.width;
            height ??= probe.height;
            if (probe.durationSec !== undefined && kind !== 'image') durationMs ??= Math.round(probe.durationSec * 1000);
            fps = probe.fps;
          } catch {
            // Probe ist optional; das Asset entsteht trotzdem.
          }
        }
        asset = await project.addAssetFromFile(file.path, {
          ...common,
          move: true,
          kind,
          mime,
          sourceUrl: out.url,
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(fps ? { fps } : {}),
        });
      }
      assets.push(asset);
      this.deps.emit({ type: 'asset', projectId: this.deps.projectId, asset });
    }
    if (opts.dataAsset) {
      // Rohantwort mit Verweisen auf die soeben abgelegten Medien (fal-URLs sind nicht dauerhaft).
      const byUrl = new Map<string, string>();
      outputs.forEach((out, i) => {
        if (out.url && assets[i]) byUrl.set(out.url, `asset:${assets[i]!.id}`);
      });
      const data = {
        generationId: gen.id,
        endpointId: gen.endpointId,
        sourceAssetIds: gen.inputAssetIds,
        outputs: assets.map((a) => ({ assetId: a.id, kind: a.kind, ...(a.mime ? { mime: a.mime } : {}) })),
        output: replaceStrings(output ?? null, byUrl),
      };
      const asset = await project.addAssetFromBuffer(JSON.stringify(data, null, 2), {
        fileName: `${opts.dataAsset.subtype}.json`,
        kind: 'data',
        subtype: opts.dataAsset.subtype,
        title: `${baseTitle} (Daten)`,
        tags,
        source: 'generated',
        modelId: gen.endpointId,
        generationId: gen.id,
        costUsd: 0,
        description: gen.purpose,
        parents,
        ...metadata,
      });
      assets.push(asset);
      this.deps.emit({ type: 'asset', projectId: this.deps.projectId, asset });
    }
    return assets;
  }

  private emitGeneration(gen: JournaledGeneration): void {
    this.deps.emit({ type: 'generation', projectId: this.deps.projectId, generation: publicGeneration(gen) });
  }
}

/** Ersetzt Strings, die exakt einem Schlüssel von `map` entsprechen (rekursiv, ohne die Eingabe zu verändern). */
function replaceStrings(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceStrings(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceStrings(v, map)]));
  return value;
}

function normalizeMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}

function assetKindFor(out: MediaOutput, mime: string): AssetKind {
  switch (out.kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'text':
      return 'text';
    default:
      return assetKindFromMime(mime);
  }
}

// ───────────────────────── Asset-Referenzen in Modelleingaben ─────────────────────────

const ASSET_REF = /^asset:([A-Za-z0-9_.-]+)$/;

/** Sammelt alle `asset:<id>`-Strings (rekursiv). */
export function collectAssetRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const m = ASSET_REF.exec(value.trim());
    if (m) out.add(m[1]!);
  } else if (Array.isArray(value)) {
    for (const v of value) collectAssetRefs(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectAssetRefs(v, out);
  }
  return out;
}

/** Ersetzt `asset:<id>`-Strings durch `urls[id]` (rekursiv, ohne die Eingabe zu verändern). */
export function replaceAssetRefs<T>(value: T, urls: Record<string, string>): T {
  if (typeof value === 'string') {
    const m = ASSET_REF.exec(value.trim());
    return (m && urls[m[1]!] !== undefined ? urls[m[1]!] : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => replaceAssetRefs(v, urls)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceAssetRefs(v, urls)])) as T;
  }
  return value;
}

// ───────────────────────── Vorabprüfung (auch für den Agent-SDK-Hook) ─────────────────────────

export const generateInputSchema = z.object({
  endpointId: z.string().describe('fal endpoint_id, z. B. "minimax/h3-max/text-to-video".'),
  input: z.record(z.string(), z.unknown()).describe('Modelleingabe exakt nach dem Schema von get_model_schema. Lokale Dateien als "asset:<id>".'),
  purpose: z.string().describe('Zweck in einem Satz (Panel, Asset-Beschreibung), z. B. "Shot 07: Mira rennt durch den Regen, Test 768p".'),
  outputTitle: z.string().optional().describe('Titel des Ergebnis-Assets (sonst aus dem Zweck).'),
  tags: z.array(z.string()).optional().describe('Tags für das Ergebnis, z. B. ["shot-07","mira","test"].'),
  inputAssetIds: z.array(z.string()).optional().describe('Weitere Assets, die als Vorlage dienten (nur Lineage, kein Upload).'),
  wait: z.boolean().optional().describe('true = auf das Ergebnis warten (Standard false).'),
});

/** Eine geplante Generierung – gemeinsam für `generate` und spezialisierte Tools wie `extract_rotoscope`. */
export interface GenerationRequest {
  endpointId: string;
  input: Record<string, unknown>;
  purpose: string;
  outputTitle?: string | undefined;
  tags?: string[] | undefined;
  inputAssetIds?: string[] | undefined;
  wait?: boolean | undefined;
  ingest?: GenerationIngestOptions | undefined;
  /** Zusätzliche Zeile im Ergebnis (z. B. welches Modell bei „Auto“ gewählt wurde). */
  note?: string | undefined;
}

export type PreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Picker- und Budget-Gate für eine geplante Generierung, ohne etwas auszuführen. Fordert bei Bedarf die
 * Budgetfreigabe an (und bucht sie). Wird vom `canUseTool`-Hook des Agent SDK genutzt; das Tool selbst
 * prüft beim Ausführen erneut (dann ohne erneute Rückfrage, da die Freigabe schon gebucht ist).
 */
export async function preflightGenerationRequest(request: GenerationRequest, ctx: ToolContext): Promise<PreflightResult> {
  const model = ctx.catalog.get(request.endpointId);
  const gate = pickerGate(ctx.project, model, request.endpointId);
  if (!gate.ok) return gate;
  const refIds = [...collectAssetRefs(request.input)];
  const probeInput = replaceAssetRefs(request.input, Object.fromEntries(refIds.map((id) => [id, `https://upload.pending.invalid/${id}`])));
  const estimate = await ctx.catalog.estimate(request.endpointId, probeInput);
  const budget = await budgetGate(ctx, estimate.usd, `${request.purpose} (${request.endpointId}, ≈ ${formatUsd(estimate.usd)})`);
  return budget.ok ? { ok: true } : budget;
}

/** Vorabprüfung für das `generate`-Tool (Eingabe ungeprüft wie vom Modell). */
export async function preflightGenerate(input: unknown, ctx: ToolContext): Promise<PreflightResult> {
  const parsed = generateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: `Ungültige Eingabe: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  return preflightGenerationRequest(parsed.data, ctx);
}

/**
 * Führt eine Generierung mit allen Gates aus: Picker, Schema-Validierung, Budget (ggf. Freigabekarte),
 * zweckgebundener Upload der `asset:<id>`-Dateien, Journal + Reservierung, Hintergrundjob.
 */
export async function runGenerationRequest(request: GenerationRequest, ctx: ToolContext): Promise<ToolResult> {
  const model = ctx.catalog.get(request.endpointId);
  const gate = pickerGate(ctx.project, model, request.endpointId);
  if (!gate.ok) return errorResult(gate.reason);

  const refIds = [...collectAssetRefs(request.input)];
  const files: Record<string, { path: string; mime?: string | undefined; asset: Asset }> = {};
  for (const id of refIds) {
    const asset = ctx.project.getAsset(id);
    const path = asset && ctx.project.assetFilePath(asset);
    if (!asset || !path) return errorResult(`Asset „${id}“ existiert nicht oder hat keine Datei (in "asset:${id}").`);
    files[id] = { path, mime: asset.mime, asset };
  }
  const placeholders = Object.fromEntries(refIds.map((id) => [id, `https://upload.pending.invalid/${id}`]));
  const probeInput = replaceAssetRefs(request.input, placeholders);

  const validation = await ctx.catalog.validate(request.endpointId, probeInput);
  if (!validation.ok) {
    return errorResult(`Eingabe passt nicht zum Schema von ${request.endpointId}:\n- ${validation.errors.join('\n- ')}\nLies das Schema mit get_model_schema und korrigiere die Parameter.`);
  }
  const estimate = await ctx.catalog.estimate(request.endpointId, probeInput);
  const budget = await budgetGate(ctx, estimate.usd, `${request.purpose} (${request.endpointId}, ≈ ${formatUsd(estimate.usd)})`);
  if (!budget.ok) return errorResult(budget.reason);

  const urls: Record<string, string> = {};
  for (const [id, file] of Object.entries(files)) {
    ctx.emitProgress(`Lade ${file.asset.title} für ${request.endpointId} hoch …`);
    try {
      urls[id] = await ctx.generation.uploadFile(file.path, file.mime);
    } catch (error) {
      return errorResult(`Upload von ${id} fehlgeschlagen: ${errorMessage(error)}`);
    }
    const previous = Array.isArray(file.asset.metadata?.falUploads) ? (file.asset.metadata!.falUploads as unknown[]) : [];
    // Uploads werden am Asset protokolliert (Privatsphäre nachvollziehbar).
    await ctx.project.updateAsset(id, { metadata: { falUploads: [...previous, { at: ctx.clock(), endpointId: request.endpointId, purpose: request.purpose }] } });
  }
  const input = replaceAssetRefs(request.input, urls);
  const inputAssetIds = [...new Set([...refIds, ...(request.inputAssetIds ?? [])])];
  const id = await ctx.jobs.submit({
    endpointId: request.endpointId,
    modality: gate.modality,
    input,
    purpose: request.purpose,
    estimateUsd: estimate.usd,
    checkpointId: budget.checkpointId,
    inputAssetIds,
    outputTitle: request.outputTitle,
    outputTags: request.tags,
    ...(request.ingest ? { ingest: request.ingest } : {}),
  });
  const head = [
    request.note,
    `Generierung ${id} gestartet: ${model?.displayName ?? request.endpointId} · Schätzung ${formatUsd(estimate.usd)} (${estimate.basis}${estimate.exact ? '' : ', geschätzt'}) · Budget ${budget.checkpointId}${budget.approvedExtraUsd ? ` (+${formatUsd(budget.approvedExtraUsd)} nachfreigegeben)` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
  if (!request.wait) return textResult(`${head}\nLäuft im Hintergrund – arbeite weiter und hole das Ergebnis mit await_generations(["${id}"]).`);
  try {
    const outcome = await ctx.jobs.wait(id, 30 * 60_000, ctx.signal);
    if (!outcome) return textResult(`${head}\nNoch nicht fertig (Zeitlimit). Später mit await_generations(["${id}"]) abholen.`);
    const result = describeOutcome(outcome.generation, outcome.assets);
    return outcome.generation.status === 'completed' ? textResult(`${head}\n${result}`) : errorResult(`${head}\n${result}`);
  } catch (error) {
    if (isAbortError(error)) return textResult(`${head}\nWarten unterbrochen; die Generierung läuft im Hintergrund weiter.`);
    throw error;
  }
}

// ───────────────────────── Tools ─────────────────────────

function describeOutcome(gen: Generation, assets: Asset[]): string {
  if (gen.status === 'completed') {
    const list = assets
      .map((a) => `  - ${a.id} ${a.kind}${a.subtype ? `/${a.subtype}` : ''}${a.durationMs ? ` ${formatSec(a.durationMs / 1000)}` : ''}${a.width ? ` ${a.width}×${a.height}` : ''} „${a.title}“`)
      .join('\n');
    const units = gen.billableUnits !== undefined ? `, ${gen.billableUnits} abgerechnete Einheiten` : '';
    return `${gen.id}: fertig (${gen.endpointId}, gebucht ${formatUsd(gen.costUsd ?? gen.estimateUsd)}${units}).\n${list || '  (keine Ausgaben)'}\nPrüfe das Ergebnis (get_asset/frames/contact_sheet), bevor du es verwendest.`;
  }
  if (gen.status === 'failed') return `${gen.id}: FEHLGESCHLAGEN (${gen.endpointId}): ${gen.error ?? 'unbekannter Fehler'}. Reservierung freigegeben.`;
  if (gen.status === 'canceled') return `${gen.id}: abgebrochen. Reservierung freigegeben.`;
  const eta = gen.etaSec !== undefined ? `, noch ca. ${Math.max(1, Math.round(gen.etaSec))} s` : '';
  return `${gen.id}: ${gen.status === 'queued' ? `in der Warteschlange${gen.queuePosition !== undefined ? ` (Position ${gen.queuePosition})` : ''}` : 'läuft'} (${gen.endpointId}${eta}).`;
}

export const generateTool = defineTool({
  name: 'generate',
  description: [
    'Startet eine kostenpflichtige Generierung auf fal.ai (Bild, Video, Stimme, Musik, Sound, Lipsync, Werkzeuge wie Upscale/Stems/STT).',
    'Vorher: Modell mit search_models wählen, Schema mit get_model_schema lesen (und den Modell-Skill laden, falls vorhanden), Kosten mit estimate_cost prüfen.',
    'Lokale Dateien übergibst du als String "asset:<assetId>" an der Stelle, an der das Schema eine URL erwartet (z. B. "image_url": "asset:ast_12"); sie werden zweckgebunden hochgeladen.',
    'Im Code durchgesetzt: Der Modell-Picker ist bindend (andere Modelle derselben Modalität werden abgelehnt), die Eingabe wird gegen das Schema validiert, und wenn die Schätzung das freigegebene Budget übersteigt, wird der Nutzer um Freigabe gebeten.',
    'Läuft im Hintergrund: Du bekommst sofort die Generierungs-ID und arbeitest weiter; Ergebnisse holst du mit await_generations. Mit wait=true wartet das Tool selbst (nur für einzelne, kurze Jobs).',
    'Jede Ausgabe wird als Asset mit Lineage (Eingabe-Assets), Prompt, Modell und Kostenanteil gespeichert.',
  ].join(' '),
  input: generateInputSchema,
  sideEffect: 'paid',
  preflight: preflightGenerate,
  run: (args, ctx) => runGenerationRequest(args, ctx),
});

export const awaitGenerationsTool = defineTool({
  name: 'await_generations',
  description:
    'Wartet auf laufende Generierungen (IDs aus generate) und liefert Status, erzeugte Asset-IDs oder Fehler. Rufe es auf, wenn du die Ergebnisse brauchst – nicht sofort nach jedem generate; starte erst alle unabhängigen Jobs eines Batches. Nach dem Zeitlimit kommen die bis dahin bekannten Stände zurück.',
  input: z.object({
    ids: z.array(z.string()).min(1).describe('Generierungs-IDs, z. B. ["gen_12","gen_13"].'),
    timeoutSec: z.number().int().min(1).max(1800).optional().describe('Maximale Wartezeit in Sekunden (Standard 600).'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const timeoutMs = (args.timeoutSec ?? 600) * 1000;
    const lines: string[] = [];
    let anyFailed = false;
    const results = await Promise.all(
      args.ids.map(async (id) => {
        try {
          return { id, outcome: await ctx.jobs.wait(id, timeoutMs, ctx.signal) };
        } catch (error) {
          if (isAbortError(error)) throw error;
          return { id, error: errorMessage(error) };
        }
      }),
    );
    for (const r of results) {
      if ('error' in r) {
        anyFailed = true;
        lines.push(`${r.id}: ${r.error}`);
      } else if (!r.outcome) {
        const gen = ctx.project.getGeneration(r.id);
        lines.push(gen ? describeOutcome(gen, []) : `${r.id}: unbekannt`);
      } else {
        if (r.outcome.generation.status !== 'completed') anyFailed = true;
        lines.push(describeOutcome(r.outcome.generation, r.outcome.assets));
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }], ...(anyFailed && results.length === 1 ? { isError: true } : {}) };
  },
});

export const cancelGenerationTool = defineTool({
  name: 'cancel_generation',
  description: 'Bricht eine laufende oder wartende Generierung ab (z. B. falscher Parameter bemerkt, Nutzer hat umentschieden). Die Reservierung wird freigegeben.',
  input: z.object({ id: z.string().describe('Generierungs-ID') }),
  sideEffect: 'local',
  async run(args, ctx) {
    const gen = await ctx.jobs.cancel(args.id);
    if (!gen) return errorResult(`Generierung „${args.id}“ existiert nicht.`);
    return textResult(`${gen.id}: Status ${gen.status}.`);
  },
});
