import {
  composerToDisplayText,
  defaultIdGenerator,
  type ChatMessage,
  type ComposerMessage,
  type DirectorEffort,
  type IdGenerator,
  type RunState,
  type StudioEvent,
  type ToolActivity,
} from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { buildContextBlockList, ContextTracker, renderContextBlocks, resolveReferences } from './context.ts';
import { emitBudget } from './gates.ts';
import { DirectorLoop, type ClientCompactionOptions } from './loop.ts';
import { systemClock, type Clock, type GenerationPort, type MediaPort, type ModelCatalogPort, type RenderPort, type TranscribePort, type UiPort, type WebPort } from './ports.ts';
import { DIRECTOR_SYSTEM_PROMPT, SUBAGENT_SYSTEM_PROMPT } from './prompt.ts';
import type { DirectorRuntime, LoopEvent, RuntimeSetup, TurnResult, UserContent } from './runtime.ts';
import { defaultSkillLibrary, SkillLibrary } from './skills.ts';
import { buildDirectorTools, GenerationManager, type AnyDirectorTool, type SubagentRunner, type ToolContext } from './tools/index.ts';
import { MemoryTranscriptStore, projectTranscriptStore } from './transcript.ts';
import type { CanonicalBlock, ModelTransport } from './transports/types.ts';
import { errorMessage } from './util.ts';

export interface DirectorSessionOptions {
  /** Director-Modell (Standard: Picker „Director“ bzw. claude-opus-5-5). */
  model?: string;
  /** Effort (Standard: manifest.director.effort, sonst xhigh). */
  effort?: DirectorEffort;
  maxIterations?: number;
  maxTokens?: number;
  maxTurnCostUsd?: number;
  /** Clientseitige Kompaktierung für Transporte ohne Serverkompaktierung (Standard ab ~150k Tokens). */
  compaction?: ClientCompactionOptions | false;
  skills?: SkillLibrary;
  /** Höchstzahl Bilder aus Referenzen je Nachricht (Standard 4). */
  maxReferenceImages?: number;
}

export interface DirectorSessionDeps {
  project: ProjectStore;
  catalog: ModelCatalogPort;
  generation: GenerationPort;
  media?: MediaPort | undefined;
  render?: RenderPort | undefined;
  transcribe?: TranscribePort | undefined;
  web?: WebPort | undefined;
  ui: UiPort;
  /** Modell-Transport (eigener Tool-Loop); auch lazy als Fabrik. */
  transport?: ModelTransport | (() => Promise<ModelTransport>);
  /** Alternative Laufzeit (z. B. {@link agentSdkRuntimeFactory}); bekommt Tools/Prompt/Kontext von der Session. */
  runtime?: (setup: RuntimeSetup) => DirectorRuntime | Promise<DirectorRuntime>;
  /** Kennung des Transkripts (`conversation/transcript-<runtimeId>.jsonl`). */
  runtimeId: string;
  clock?: Clock;
  ids?: IdGenerator;
  options?: DirectorSessionOptions;
}

type QueueItem = { kind: 'message'; message: ComposerMessage } | { kind: 'notify'; text: string };

/**
 * Eine Director-Session je Projekt: nimmt Composer-Nachrichten an (eingereiht, solange ein Turn läuft),
 * löst Referenzen auf, hängt geänderte Kontextblöcke an, führt den Turn über die Laufzeit aus und meldet
 * alles als StudioEvents.
 */
export class DirectorSession {
  readonly jobs: GenerationManager;
  readonly skills: SkillLibrary;
  private runState: RunState = 'idle';
  private runId: string | null = null;
  private controller: AbortController | null = null;
  private readonly queue: Array<{ item: QueueItem; resolve: () => void; reject: (error: unknown) => void }> = [];
  private processing = false;
  private runtimePromise: Promise<DirectorRuntime> | null = null;
  private transport: ModelTransport | null = null;
  private tools: AnyDirectorTool[] = [];
  private readonly tracker = new ContextTracker();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly sessionUi: UiPort;
  private readonly activities = new Map<string, ToolActivity>();
  private streamMessageId: string | null = null;

  constructor(private readonly deps: DirectorSessionDeps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? defaultIdGenerator;
    this.skills = deps.options?.skills ?? defaultSkillLibrary();
    this.sessionUi = {
      emit: (event) => deps.ui.emit(event),
      askUser: async (questions, signal) => {
        this.setState('waiting_user');
        try {
          return await deps.ui.askUser(questions, signal);
        } finally {
          if (this.runState === 'waiting_user') this.setState('running');
        }
      },
      requestApproval: async (request, signal) => {
        this.setState('waiting_user');
        try {
          return await deps.ui.requestApproval(request, signal);
        } finally {
          if (this.runState === 'waiting_user') this.setState('running');
        }
      },
    };
    this.jobs = new GenerationManager({
      project: deps.project,
      generation: deps.generation,
      media: deps.media,
      emit: (event) => deps.ui.emit(event),
      projectId: this.projectId,
      clock: this.clock,
      ids: this.ids,
    });
  }

  get projectId(): string {
    return this.deps.project.manifest.id;
  }

  get state(): RunState {
    return this.runState;
  }

  get currentRunId(): string | null {
    return this.runId;
  }

  /** Persistiert die Nutzernachricht sofort und führt den Turn aus (eingereiht, falls einer läuft). */
  async send(message: ComposerMessage): Promise<void> {
    const chat: ChatMessage = {
      id: this.ids('msg'),
      role: 'user',
      segments: message.segments,
      text: composerToDisplayText(message.segments),
      createdAt: this.clock(),
    };
    await this.deps.project.appendMessage(chat);
    this.emit({ type: 'message', projectId: this.projectId, message: chat });
    return this.enqueue({ kind: 'message', message });
  }

  /**
   * Operator-Ereignis ohne Nutzernachricht (z. B. „Checkpoint Treatment freigegeben, Budget $40“) –
   * startet einen Turn, damit der Director reagiert.
   */
  notify(text: string): Promise<void> {
    return this.enqueue({ kind: 'notify', text });
  }

  /** Bricht den laufenden Turn ab (eingereihte Nachrichten laufen danach weiter). */
  interrupt(): void {
    this.controller?.abort();
  }

  /** Absturz-Wiederaufnahme journalisierter Generierungen. */
  resumePendingGenerations(): Promise<{ resumed: string[]; failed: string[] }> {
    return this.jobs.resumePending();
  }

  /** Beendet die Session; laufende fal-Jobs werden standardmäßig NICHT abgebrochen (Wiederaufnahme). */
  async close(options: { cancelGenerations?: boolean } = {}): Promise<void> {
    this.interrupt();
    for (const pending of this.queue.splice(0)) pending.reject(new Error('Session geschlossen'));
    if (options.cancelGenerations) this.jobs.abortAll();
  }

  private enqueue(item: QueueItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        const next = this.queue.shift();
        if (!next) break;
        try {
          await this.processTurn(next.item);
          next.resolve();
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private emit(event: StudioEvent): void {
    this.deps.ui.emit(event);
  }

  private setState(state: RunState, error?: string): void {
    this.runState = state;
    this.emit({ type: 'run_state', projectId: this.projectId, runId: this.runId, state, ...(error ? { error } : {}) });
  }

  private get model(): string {
    const picker = this.deps.project.manifest.pickers.director;
    return this.deps.options?.model ?? (picker?.mode === 'model' ? picker.modelId : 'claude-opus-5-5');
  }

  private get effort(): DirectorEffort {
    return this.deps.options?.effort ?? this.deps.project.manifest.director.effort ?? 'xhigh';
  }

  private async recordUsage(runId: string, usd: number, note: string): Promise<void> {
    await this.deps.project.budgetRecordUsage(runId, usd, 'director', note);
    emitBudget(this.deps.project, this.projectId, this.deps.ui);
  }

  private async postMessage(text: string, role: ChatMessage['role'] = 'director'): Promise<ChatMessage> {
    const message: ChatMessage = { id: this.ids('msg'), role, text, createdAt: this.clock(), ...(this.runId ? { runId: this.runId } : {}) };
    await this.deps.project.appendMessage(message);
    this.emit({ type: 'message', projectId: this.projectId, message });
    return message;
  }

  private makeToolContext(runId: string, signal: AbortSignal, runSubagent?: SubagentRunner): ToolContext {
    const { deps } = this;
    return {
      project: deps.project,
      catalog: deps.catalog,
      generation: deps.generation,
      media: deps.media,
      render: deps.render,
      transcribe: deps.transcribe,
      web: deps.web,
      ui: this.sessionUi,
      runId,
      signal,
      emitProgress: (text) => this.emit({ type: 'progress', projectId: this.projectId, runId, text }),
      projectDir: deps.project.dir,
      projectId: this.projectId,
      clock: this.clock,
      ids: this.ids,
      jobs: this.jobs,
      skills: this.skills,
      runSubagent,
      postMessage: (text) => this.postMessage(text),
    };
  }

  private onRuntimeEvent(event: LoopEvent): void {
    const runId = this.runId ?? '';
    switch (event.type) {
      case 'text_delta':
        if (this.streamMessageId) this.emit({ type: 'message_delta', projectId: this.projectId, messageId: this.streamMessageId, delta: event.text });
        break;
      case 'progress':
        if (event.text) this.emit({ type: 'progress', projectId: this.projectId, runId, text: event.text });
        break;
      case 'tool_start': {
        const activity: ToolActivity = { id: event.id, runId, name: event.name, status: 'started', startedAt: this.clock() };
        this.activities.set(event.id, activity);
        this.emit({ type: 'tool', projectId: this.projectId, activity });
        break;
      }
      case 'tool_end': {
        const started = this.activities.get(event.id);
        const activity: ToolActivity = {
          id: event.id,
          runId,
          name: event.name,
          status: event.ok ? 'finished' : 'failed',
          summary: event.summary,
          startedAt: started?.startedAt ?? this.clock(),
          finishedAt: this.clock(),
        };
        this.activities.delete(event.id);
        this.emit({ type: 'tool', projectId: this.projectId, activity });
        break;
      }
      case 'notice':
        void this.postMessage(event.text, 'system');
        break;
      case 'compaction':
        this.emit({ type: 'progress', projectId: this.projectId, runId, text: 'Ältere Gesprächsteile wurden zusammengefasst.' });
        break;
      default:
        break;
    }
  }

  private runtimeSetup(): RuntimeSetup {
    return {
      tools: this.tools,
      system: DIRECTOR_SYSTEM_PROMPT,
      model: this.model,
      effort: this.effort,
      maxIterations: this.deps.options?.maxIterations ?? 60,
      makeToolContext: (runId, signal) => this.makeToolContext(runId, signal),
      onEvent: (event) => this.onRuntimeEvent(event),
      recordUsage: (runId, usd, note) => this.recordUsage(runId, usd, note),
      store: (runtimeId) => projectTranscriptStore(this.deps.project, runtimeId),
      projectDir: this.deps.project.dir,
      clock: this.clock,
    };
  }

  private getRuntime(): Promise<DirectorRuntime> {
    this.runtimePromise ??= (async () => {
      const { deps } = this;
      const options = deps.options ?? {};
      let runtime: DirectorRuntime;
      if (deps.runtime) {
        // Agent SDK bringt eigene Websuche mit; delegate braucht den eigenen Loop.
        this.tools = buildDirectorTools({ webFallback: false, delegate: false });
        runtime = await deps.runtime(this.runtimeSetup());
      } else {
        const transport = typeof deps.transport === 'function' ? await deps.transport() : deps.transport;
        if (!transport) throw new Error('Keine Director-Laufzeit konfiguriert (Transport fehlt).');
        this.transport = transport;
        this.tools = buildDirectorTools({ webFallback: !transport.caps.serverWebSearch && !!(deps.web?.search || deps.web?.fetch), delegate: true });
        const runSubagent = this.subagentRunner(transport);
        runtime = new DirectorLoop({
          transport,
          tools: this.tools,
          system: DIRECTOR_SYSTEM_PROMPT,
          model: this.model,
          effort: () => this.effort,
          maxIterations: options.maxIterations ?? 60,
          ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
          ...(options.maxTurnCostUsd ? { maxTurnCostUsd: options.maxTurnCostUsd } : {}),
          store: projectTranscriptStore(deps.project, deps.runtimeId),
          makeToolContext: (runId, signal) => this.makeToolContext(runId, signal, runSubagent),
          onEvent: (event) => this.onRuntimeEvent(event),
          recordUsage: (runId, usd, note) => this.recordUsage(runId, usd, note),
          compaction: transport.caps.serverCompaction ? false : (options.compaction ?? { thresholdTokens: 150_000 }),
          clock: this.clock,
        });
      }
      await runtime.load();
      return runtime;
    })().catch((error) => {
      this.runtimePromise = null;
      throw error;
    });
    return this.runtimePromise;
  }

  /** `delegate`: verschachtelter Loop auf einem günstigeren Modell mit nur lesenden Tools. */
  private subagentRunner(transport: ModelTransport): SubagentRunner {
    return async (request, { runId, signal }) => {
      const tools = this.tools.filter((t) => request.toolNames.includes(t.name) && t.name !== 'delegate');
      const loop = new DirectorLoop({
        transport,
        tools,
        system: SUBAGENT_SYSTEM_PROMPT,
        model: request.model,
        effort: request.model.includes('haiku') ? 'medium' : 'high',
        maxIterations: request.maxIterations ?? 20,
        maxTokens: 32000,
        store: new MemoryTranscriptStore(),
        makeToolContext: (rid, sig) => this.makeToolContext(rid, sig),
        onEvent: (event) => {
          if (event.type === 'tool_start') this.emit({ type: 'progress', projectId: this.projectId, runId, text: `Subagent: ${event.name}` });
        },
        recordUsage: (rid, usd, note) => this.recordUsage(rid, usd, `delegate ${note}`),
        compaction: false,
        serverTools: request.toolNames.includes('web_search') || request.toolNames.includes('web_fetch'),
        clock: this.clock,
      });
      const result = await loop.runTurn({ content: request.task, runId, signal });
      if (result.stopReason === 'error') throw new Error(result.error ?? 'Subagent-Fehler');
      return { text: result.text || '(keine Antwort)', costUsd: result.costUsd, iterations: result.iterations };
    };
  }

  private async buildUserContent(item: QueueItem): Promise<UserContent> {
    if (item.kind === 'notify') return [{ type: 'text', text: `<studio_event>\n${item.text}\n</studio_event>` }];
    const resolved = await resolveReferences(item.message, this.deps.project, { render: this.deps.render, media: this.deps.media }, { maxImages: this.deps.options?.maxReferenceImages ?? 4 });
    const blocks: CanonicalBlock[] = [{ type: 'text', text: resolved.contexts ? `${resolved.text}\n\n${resolved.contexts}` : resolved.text || '(leere Nachricht)' }];
    for (const { refId, label, image } of resolved.images) {
      blocks.push({ type: 'text', text: `[Bild zu ${refId}: ${label}]` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
    }
    return blocks;
  }

  private async processTurn(item: QueueItem): Promise<TurnResult | undefined> {
    this.runId = this.ids('run');
    const runId = this.runId;
    const controller = new AbortController();
    this.controller = controller;
    this.streamMessageId = this.ids('msg');
    this.setState('running');
    let result: TurnResult | undefined;
    try {
      const runtime = await this.getRuntime();
      const content = await this.buildUserContent(item);
      const blocks = await buildContextBlockList(this.deps.project, this.deps.catalog, { skills: this.skills });
      const changed = this.tracker.diff(blocks);
      const context = changed.length ? renderContextBlocks(changed) : undefined;
      result = await runtime.runTurn({ content, context, runId, signal: controller.signal });
      if (result.text.trim()) {
        const message: ChatMessage = { id: this.streamMessageId, role: 'director', text: result.text, createdAt: this.clock(), runId };
        await this.deps.project.appendMessage(message);
        this.emit({ type: 'message', projectId: this.projectId, message });
      }
      switch (result.stopReason) {
        case 'interrupted':
          this.setState('interrupted');
          break;
        case 'error':
          this.setState('failed', result.error);
          break;
        case 'refusal':
          this.setState('failed', 'Anfrage abgelehnt');
          break;
        default:
          this.setState('idle');
      }
    } catch (error) {
      if (controller.signal.aborted) this.setState('interrupted');
      else {
        this.setState('failed', errorMessage(error));
        await this.postMessage(`Fehler im Director-Lauf: ${errorMessage(error)}`, 'system').catch(() => undefined);
      }
    } finally {
      this.controller = null;
      this.streamMessageId = null;
      emitBudget(this.deps.project, this.projectId, this.deps.ui);
    }
    return result;
  }
}
