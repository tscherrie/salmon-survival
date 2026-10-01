import { z } from 'zod';
import { assetKindFromMime, formatUsd, isTerminal, mimeFromExtension, type Asset, type AssetKind, type Generation, type IdGenerator, type Modality, type StudioEvent } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { budgetGate, emitBudget, pickerGate } from '../gates.ts';
import { normalizeProbe } from '../normalize.ts';
import type { Clock, GenerationPort, GenerationRunOptions, MediaOutput, MediaPort, QueueHandle } from '../ports.ts';
import { errorMessage, formatSec, isAbortError, projectTempDir, raceAbort, truncate } from '../util.ts';
import { defineTool, errorResult, textResult, type ToolContext } from './registry.ts';

/** Journal-Eintrag mit fal-Queue-Handle (für die Wiederaufnahme nach einem Absturz). */
export type JournaledGeneration = Generation & { queueHandle?: QueueHandle | undefined };

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
}

type Runner = (opts: GenerationRunOptions) => Promise<{ output: unknown }>;

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
      return { generation: gen, assets: gen.outputAssetIds.map((a) => this.deps.project.getAsset(a)).filter((a): a is Asset => !!a) };
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
    const gen = this.deps.project.getGeneration(id);
    if (!gen || isTerminal(gen.status)) return gen;
    await this.deps.project.budgetRelease(id);
    const canceled: Generation = { ...gen, status: 'canceled', finishedAt: this.deps.clock(), error: 'Abgebrochen' };
    await this.deps.project.saveGeneration(canceled);
    this.emitGeneration(canceled);
    return canceled;
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
      if (gen.requestId && resume) {
        const handle = { ...(gen.queueHandle ?? {}), requestId: gen.requestId, endpointId: gen.endpointId };
        this.start(gen, (opts) => resume(handle, { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onStatus ? { onStatus: opts.onStatus } : {}) }));
        resumed.push(gen.id);
      } else {
        await project.budgetRelease(gen.id);
        const next: Generation = {
          ...gen,
          status: 'failed',
          finishedAt: this.deps.clock(),
          error: gen.requestId ? 'Nach Neustart nicht fortsetzbar (kein Resume im fal-Adapter)' : 'Vor dem Absenden unterbrochen (App-Neustart)',
        };
        await project.saveGeneration(next);
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
        await project.saveGeneration(current);
        this.emitGeneration(current);
      });
      return chain;
    };
    try {
      const { output } = await runner({
        signal,
        onSubmitted: async (handle) => {
          await save({ requestId: handle.requestId, queueHandle: handle, submittedAt: clock() });
        },
        onStatus: (status) => {
          const state = status.state.toUpperCase();
          const nextStatus = state.includes('PROGRESS') || state === 'RUNNING' ? 'running' : state.includes('QUEUE') ? 'queued' : current.status;
          const changed = nextStatus !== current.status || status.queuePosition !== current.queuePosition;
          if (changed) {
            void save({ status: nextStatus, queuePosition: status.queuePosition, logs: status.logs.slice(-20) });
          }
        },
      });
      await chain;
      const assets = await this.ingest(current, output);
      await project.budgetSettle(current.id, current.estimateUsd, { source: 'fal', checkpointId: current.checkpointId, note: 'Ist = Schätzung (exakte Kosten nicht gemeldet)' });
      await save({ status: 'completed', outputAssetIds: assets.map((a) => a.id), costUsd: current.estimateUsd, finishedAt: clock(), queuePosition: undefined });
      await chain;
      emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
      return { generation: current, assets };
    } catch (error) {
      await chain.catch(() => undefined);
      const canceled = signal.aborted || isAbortError(error);
      await project.budgetRelease(current.id);
      await save({ status: canceled ? 'canceled' : 'failed', error: canceled ? 'Abgebrochen' : truncate(errorMessage(error), 2000), finishedAt: clock(), queuePosition: undefined });
      await chain.catch(() => undefined);
      emitBudget(project, this.deps.projectId, { emit: this.deps.emit });
      return { generation: current, assets: [] };
    }
  }

  /** Lädt alle Ausgaben herunter und registriert sie als Assets mit Lineage und Kostenanteil. */
  private async ingest(gen: Generation, output: unknown): Promise<Asset[]> {
    const { project, generation, media } = this.deps;
    let outputs: MediaOutput[] = generation.extractMediaOutputs(output);
    if (outputs.length === 0 && output !== undefined) outputs = generation.extractMediaOutputs({ output });
    const prompt = typeof gen.input.prompt === 'string' ? gen.input.prompt : typeof gen.input.text === 'string' ? gen.input.text : undefined;
    const parents = gen.inputAssetIds.map((assetId) => ({ assetId, relation: 'input' as const }));
    const baseTitle = gen.outputTitle ?? truncate(gen.purpose, 80);
    const tags = gen.outputTags ?? [];
    const assets: Asset[] = [];
    if (outputs.length === 0) {
      // Kein Medium erkannt: Rohantwort als Daten-Asset sichern, damit nichts verloren geht.
      const asset = await project.addAssetFromBuffer(JSON.stringify(output ?? null, null, 2), {
        fileName: 'output.json',
        kind: 'data',
        subtype: 'model-output',
        title: baseTitle,
        tags,
        source: 'generated',
        modelId: gen.endpointId,
        generationId: gen.id,
        costUsd: gen.estimateUsd,
        description: gen.purpose,
        parents,
        ...(prompt ? { prompt } : {}),
      });
      this.deps.emit({ type: 'asset', projectId: this.deps.projectId, asset });
      return [asset];
    }
    const share = outputs.length ? gen.estimateUsd / outputs.length : 0;
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
    return assets;
  }

  private emitGeneration(gen: Generation): void {
    const { queueHandle: _handle, ...plain } = gen as JournaledGeneration;
    this.deps.emit({ type: 'generation', projectId: this.deps.projectId, generation: plain });
  }
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

// ───────────────────────── Tools ─────────────────────────

function describeOutcome(ctx: ToolContext, gen: Generation, assets: Asset[]): string {
  if (gen.status === 'completed') {
    const list = assets.map((a) => `  - ${a.id} ${a.kind}${a.durationMs ? ` ${formatSec(a.durationMs / 1000)}` : ''}${a.width ? ` ${a.width}×${a.height}` : ''} „${a.title}“`).join('\n');
    return `${gen.id}: fertig (${gen.endpointId}, gebucht ${formatUsd(gen.costUsd ?? gen.estimateUsd)}).\n${list || '  (keine Ausgaben)'}\nPrüfe das Ergebnis (get_asset/frames/contact_sheet), bevor du es verwendest.`;
  }
  if (gen.status === 'failed') return `${gen.id}: FEHLGESCHLAGEN (${gen.endpointId}): ${gen.error ?? 'unbekannter Fehler'}. Reservierung freigegeben.`;
  if (gen.status === 'canceled') return `${gen.id}: abgebrochen. Reservierung freigegeben.`;
  void ctx;
  return `${gen.id}: ${gen.status === 'queued' ? `in der Warteschlange${gen.queuePosition !== undefined ? ` (Position ${gen.queuePosition})` : ''}` : 'läuft'} (${gen.endpointId}).`;
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
  input: z.object({
    endpointId: z.string().describe('fal endpoint_id, z. B. "minimax/h3-max/text-to-video".'),
    input: z.record(z.string(), z.unknown()).describe('Modelleingabe exakt nach dem Schema von get_model_schema. Lokale Dateien als "asset:<id>".'),
    purpose: z.string().describe('Zweck in einem Satz (Panel, Asset-Beschreibung), z. B. "Shot 07: Mira rennt durch den Regen, Test 768p".'),
    outputTitle: z.string().optional().describe('Titel des Ergebnis-Assets (sonst aus dem Zweck).'),
    tags: z.array(z.string()).optional().describe('Tags für das Ergebnis, z. B. ["shot-07","mira","test"].'),
    inputAssetIds: z.array(z.string()).optional().describe('Weitere Assets, die als Vorlage dienten (nur Lineage, kein Upload).'),
    wait: z.boolean().optional().describe('true = auf das Ergebnis warten (Standard false).'),
  }),
  sideEffect: 'paid',
  async run(args, ctx) {
    const model = ctx.catalog.get(args.endpointId);
    const gate = pickerGate(ctx.project, model, args.endpointId);
    if (!gate.ok) return errorResult(gate.reason);

    const refIds = [...collectAssetRefs(args.input)];
    const files: Record<string, { path: string; mime?: string | undefined; asset: Asset }> = {};
    for (const id of refIds) {
      const asset = ctx.project.getAsset(id);
      const path = asset && ctx.project.assetFilePath(asset);
      if (!asset || !path) return errorResult(`Asset „${id}“ existiert nicht oder hat keine Datei (in "asset:${id}").`);
      files[id] = { path, mime: asset.mime, asset };
    }
    const placeholders = Object.fromEntries(refIds.map((id) => [id, `https://upload.pending.invalid/${id}`]));
    const probeInput = replaceAssetRefs(args.input, placeholders);

    const validation = await ctx.catalog.validate(args.endpointId, probeInput);
    if (!validation.ok) {
      return errorResult(`Eingabe passt nicht zum Schema von ${args.endpointId}:\n- ${validation.errors.join('\n- ')}\nLies das Schema mit get_model_schema und korrigiere die Parameter.`);
    }
    const estimate = await ctx.catalog.estimate(args.endpointId, probeInput);
    const budget = await budgetGate(ctx, estimate.usd, `${args.purpose} (${args.endpointId}, ≈ ${formatUsd(estimate.usd)})`);
    if (!budget.ok) return errorResult(budget.reason);

    const urls: Record<string, string> = {};
    for (const [id, file] of Object.entries(files)) {
      ctx.emitProgress(`Lade ${file.asset.title} für ${args.endpointId} hoch …`);
      try {
        urls[id] = await ctx.generation.uploadFile(file.path, file.mime);
      } catch (error) {
        return errorResult(`Upload von ${id} fehlgeschlagen: ${errorMessage(error)}`);
      }
      const previous = Array.isArray(file.asset.metadata?.falUploads) ? (file.asset.metadata!.falUploads as unknown[]) : [];
      // Uploads werden am Asset protokolliert (Privatsphäre nachvollziehbar).
      await ctx.project.updateAsset(id, { metadata: { falUploads: [...previous, { at: ctx.clock(), endpointId: args.endpointId, purpose: args.purpose }] } });
    }
    const input = replaceAssetRefs(args.input, urls);
    const inputAssetIds = [...new Set([...refIds, ...(args.inputAssetIds ?? [])])];
    const id = await ctx.jobs.submit({
      endpointId: args.endpointId,
      modality: gate.modality,
      input,
      purpose: args.purpose,
      estimateUsd: estimate.usd,
      checkpointId: budget.checkpointId,
      inputAssetIds,
      outputTitle: args.outputTitle,
      outputTags: args.tags,
    });
    const head = `Generierung ${id} gestartet: ${model?.displayName ?? args.endpointId} · Schätzung ${formatUsd(estimate.usd)} (${estimate.basis}${estimate.exact ? '' : ', geschätzt'}) · Budget ${budget.checkpointId}${budget.approvedExtraUsd ? ` (+${formatUsd(budget.approvedExtraUsd)} nachfreigegeben)` : ''}.`;
    if (!args.wait) return textResult(`${head}\nLäuft im Hintergrund – arbeite weiter und hole das Ergebnis mit await_generations(["${id}"]).`);
    try {
      const outcome = await ctx.jobs.wait(id, 30 * 60_000, ctx.signal);
      if (!outcome) return textResult(`${head}\nNoch nicht fertig (Zeitlimit). Später mit await_generations(["${id}"]) abholen.`);
      const result = describeOutcome(ctx, outcome.generation, outcome.assets);
      return outcome.generation.status === 'completed' ? textResult(`${head}\n${result}`) : errorResult(`${head}\n${result}`);
    } catch (error) {
      if (isAbortError(error)) return textResult(`${head}\nWarten unterbrochen; die Generierung läuft im Hintergrund weiter.`);
      throw error;
    }
  },
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
        lines.push(gen ? describeOutcome(ctx, gen, []) : `${r.id}: unbekannt`);
      } else {
        if (r.outcome.generation.status !== 'completed') anyFailed = true;
        lines.push(describeOutcome(ctx, r.outcome.generation, r.outcome.assets));
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
