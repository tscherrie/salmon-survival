import type { DirectorRuntime, LoopEvent, RuntimeSetup, RuntimeTurnInput, TurnResult, TurnStopReason } from '../runtime.ts';
import { preflightGenerate } from '../tools/generation.ts';
import { parseToolInput, errorResult, resultText, type AnyDirectorTool, type ToolResult, type ToolContext } from '../tools/registry.ts';
import { replayTranscript, type TranscriptStore } from '../transcript.ts';
import type { CanonicalBlock } from '../transports/types.ts';
import { errorMessage, firstLine, isAbortError } from '../util.ts';

/**
 * Optionale Laufzeit über das Claude Agent SDK (nur für die Anmeldung mit Claude-Abo bei
 * Eigennutzung). Gleiche Tool-Registry (In-Process-MCP-Server), gleiche Gates (`canUseTool`), gleiche
 * Ereignisse. Das SDK wird erst bei Bedarf dynamisch importiert, die App läuft auch ohne.
 */

/** Minimale Sicht auf das SDK-Modul (strukturell; erleichtert Tests mit vi.mock). */
export interface AgentSdkModule {
  query(params: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }): AsyncIterable<Record<string, unknown>>;
  createSdkMcpServer(options: { name: string; version?: string; tools?: unknown[] }): unknown;
  tool(name: string, description: string, shape: Record<string, unknown>, handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>): unknown;
}

export interface AgentSdkRuntimeOptions {
  /** Standard: `import('@anthropic-ai/claude-agent-sdk')`. */
  loadSdk?: () => Promise<AgentSdkModule>;
  pathToClaudeCodeExecutable?: string;
  /** Isolation von der eigenen Claude-Code-Konfiguration des Nutzers (`CLAUDE_CONFIG_DIR`). */
  configDir?: string;
  /** Zusätzliche Umgebungsvariablen (das SDK ersetzt die Umgebung, daher wird process.env gespreizt). */
  env?: Record<string, string | undefined>;
  /** Eingebaute WebSearch/WebFetch erlauben (Standard: an). */
  allowWebTools?: boolean;
  mcpServerName?: string;
}

/** Eingebaute Claude-Code-Tools, die im Studio nie laufen (keine Shell, Dateizugriff nur über Studio-Tools). */
export const AGENT_SDK_DISALLOWED_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'KillBash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Task', 'Agent', 'ExitPlanMode', 'Skill'];
const WEB_TOOLS = ['WebSearch', 'WebFetch'];

async function defaultLoadSdk(): Promise<AgentSdkModule> {
  return (await import('@anthropic-ai/claude-agent-sdk')) as unknown as AgentSdkModule;
}

function toCallToolResult(result: ToolResult): { content: unknown[]; isError?: boolean } {
  return {
    content: result.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', data: c.data, mimeType: c.mediaType })),
    ...(result.isError ? { isError: true } : {}),
  };
}

export class AgentSdkRuntime implements DirectorRuntime {
  readonly id = 'agent-sdk' as const;
  private sessionId: string | undefined;
  private totalCostUsd = 0;
  private readonly store: TranscriptStore;
  private readonly serverName: string;
  private readonly toolsByName: Map<string, AnyDirectorTool>;

  constructor(
    private readonly setup: RuntimeSetup,
    private readonly options: AgentSdkRuntimeOptions = {},
  ) {
    this.store = setup.store('agent-sdk');
    this.serverName = options.mcpServerName ?? 'studio';
    this.toolsByName = new Map(setup.tools.map((t) => [t.name, t]));
  }

  /** MCP-Namen der Studio-Tools: `mcp__studio__<tool>`. */
  mcpName(tool: string): string {
    return `mcp__${this.serverName}__${tool}`;
  }

  async load(): Promise<void> {
    const { meta } = replayTranscript(await this.store.load());
    const sessionId = meta.get('sessionId');
    const total = meta.get('totalCostUsd');
    if (typeof sessionId === 'string') this.sessionId = sessionId;
    if (typeof total === 'number') this.totalCostUsd = total;
  }

  private emit(event: LoopEvent): void {
    this.setup.onEvent(event);
  }

  private buildServer(sdk: AgentSdkModule, ctx: ToolContext): unknown {
    const tools = this.setup.tools.map((tool) =>
      sdk.tool(tool.name, tool.description, tool.input.shape as Record<string, unknown>, async (args) => {
        const id = `${tool.name}_${Math.random().toString(36).slice(2, 10)}`;
        this.emit({ type: 'tool_start', id, name: tool.name, input: args });
        let result: ToolResult;
        const parsed = parseToolInput(tool, args);
        if (!parsed.ok) result = errorResult(parsed.error);
        else {
          try {
            result = await tool.run(parsed.value, ctx);
          } catch (error) {
            result = errorResult(`Tool-Fehler in ${tool.name}: ${errorMessage(error)}`);
          }
        }
        this.emit({ type: 'tool_end', id, name: tool.name, ok: !result.isError, summary: firstLine(resultText(result)) });
        return toCallToolResult(result);
      }),
    );
    return sdk.createSdkMcpServer({ name: this.serverName, version: '1.0.0', tools });
  }

  /** Optionen für `query()` (öffentlich für Tests/Diagnose). */
  buildOptions(ctx: ToolContext, server: unknown, abortController: AbortController): Record<string, unknown> {
    const allowWeb = this.options.allowWebTools ?? true;
    // Nicht-kostenpflichtige Studio-Tools sind vorab erlaubt; kostenpflichtige NIE (sonst übergeht das
    // SDK canUseTool) – sie laufen durch dieselben Gates wie im eigenen Loop.
    const allowedTools = [...this.setup.tools.filter((t) => t.sideEffect !== 'paid').map((t) => this.mcpName(t.name)), ...(allowWeb ? WEB_TOOLS : [])];
    const canUseTool = async (toolName: string, input: Record<string, unknown>, opts: { signal: AbortSignal }) => {
      const prefix = `mcp__${this.serverName}__`;
      if (toolName.startsWith(prefix)) {
        const tool = this.toolsByName.get(toolName.slice(prefix.length));
        if (!tool) return { behavior: 'deny' as const, message: `Unbekanntes Studio-Tool ${toolName}` };
        if (tool.sideEffect === 'paid' && tool.name === 'generate') {
          const gate = await preflightGenerate(input, { ...ctx, signal: opts.signal });
          if (!gate.ok) return { behavior: 'deny' as const, message: gate.reason };
        }
        return { behavior: 'allow' as const, updatedInput: input };
      }
      if (allowWeb && WEB_TOOLS.includes(toolName)) return { behavior: 'allow' as const, updatedInput: input };
      return { behavior: 'deny' as const, message: `${toolName} ist im Studio nicht erlaubt – nutze die Studio-Tools.` };
    };
    return {
      model: this.setup.model,
      effort: this.setup.effort,
      systemPrompt: this.setup.system,
      cwd: this.setup.projectDir,
      // Keine Nutzer-/Projekt-Einstellungen von Claude Code laden (Isolation).
      settingSources: [],
      // Seit 0.3.286 kann ein fehlender permissionMode im „auto“-Modus starten → explizit „default“.
      permissionMode: 'default',
      mcpServers: { [this.serverName]: server },
      strictMcpConfig: true,
      allowedTools,
      disallowedTools: [...AGENT_SDK_DISALLOWED_TOOLS, ...(allowWeb ? [] : WEB_TOOLS)],
      canUseTool,
      includePartialMessages: true,
      maxTurns: this.setup.maxIterations,
      abortController,
      env: {
        ...process.env,
        ...(this.options.env ?? {}),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ...(this.options.configDir ? { CLAUDE_CONFIG_DIR: this.options.configDir } : {}),
      },
      ...(this.options.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable } : {}),
      ...(this.sessionId ? { resume: this.sessionId } : {}),
    };
  }

  async runTurn(input: RuntimeTurnInput): Promise<TurnResult> {
    const { runId, signal } = input;
    let sdk: AgentSdkModule;
    try {
      sdk = await (this.options.loadSdk ?? defaultLoadSdk)();
    } catch (error) {
      return { stopReason: 'error', text: '', iterations: 0, costUsd: 0, error: `Claude Agent SDK nicht verfügbar: ${errorMessage(error)}` };
    }
    const ctx = this.setup.makeToolContext(runId, signal);
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    const blocks: CanonicalBlock[] = typeof input.content === 'string' ? [{ type: 'text', text: input.content }] : [...input.content];
    if (input.context?.trim()) blocks.unshift({ type: 'text', text: `<studio-context>\n${input.context.trim()}\n</studio-context>` });
    const hasImages = blocks.some((b) => b.type === 'image');
    const prompt: string | AsyncIterable<unknown> = hasImages
      ? (async function* (sessionId: string | undefined) {
          yield { type: 'user', message: { role: 'user', content: blocks }, parent_tool_use_id: null, session_id: sessionId ?? '', origin: { kind: 'human' } };
        })(this.sessionId)
      : blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n\n');

    const texts: string[] = [];
    const thinking = new Map<number, string>();
    let stopReason: TurnStopReason = 'end_turn';
    let error: string | undefined;
    let iterations = 0;
    let costUsd = 0;
    try {
      const server = this.buildServer(sdk, ctx);
      const stream = sdk.query({ prompt, options: this.buildOptions(ctx, server, abortController) });
      for await (const message of stream) {
        const type = message.type;
        if (type === 'system' && message.subtype === 'init' && typeof message.session_id === 'string') {
          if (message.session_id !== this.sessionId) {
            this.sessionId = message.session_id;
            await this.store.append([{ type: 'meta', key: 'sessionId', value: this.sessionId, at: this.setup.clock() }]);
          }
        } else if (type === 'stream_event' && message.parent_tool_use_id == null) {
          this.onStreamEvent(message.event as Record<string, unknown>, thinking);
        } else if (type === 'assistant' && message.parent_tool_use_id == null) {
          iterations += 1;
          const content = ((message.message as { content?: unknown[] } | undefined)?.content ?? []) as CanonicalBlock[];
          for (const block of content) if (block.type === 'text' && block.text.trim()) texts.push(block.text);
          this.emit({ type: 'assistant', content });
        } else if (type === 'result') {
          const total = typeof message.total_cost_usd === 'number' ? message.total_cost_usd : this.totalCostUsd;
          // total_cost_usd ist kumuliert über die (fortgesetzte) Session → nur die Differenz buchen.
          const delta = total >= this.totalCostUsd ? total - this.totalCostUsd : total;
          this.totalCostUsd = total;
          costUsd += delta;
          await this.store.append([{ type: 'meta', key: 'totalCostUsd', value: total, at: this.setup.clock() }]);
          if (delta > 0) await this.setup.recordUsage(runId, delta, `${this.setup.model} (agent-sdk)`);
          if (message.subtype === 'error_max_turns') stopReason = 'max_iterations';
          else if (message.subtype === 'error_max_budget_usd') stopReason = 'budget';
          else if (message.is_error) {
            stopReason = 'error';
            error = typeof message.result === 'string' ? message.result : String(message.subtype ?? 'Fehler');
          }
        }
      }
      if (signal.aborted) stopReason = 'interrupted';
    } catch (e) {
      if (signal.aborted || isAbortError(e)) stopReason = 'interrupted';
      else {
        stopReason = 'error';
        error = errorMessage(e);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    return { stopReason, text: texts.join('\n\n'), iterations, costUsd, ...(error ? { error } : {}) };
  }

  private onStreamEvent(event: Record<string, unknown>, thinking: Map<number, string>): void {
    const index = typeof event.index === 'number' ? event.index : 0;
    if (event.type === 'content_block_start') {
      const block = event.content_block as { type?: string } | undefined;
      if (block?.type === 'thinking') thinking.set(index, '');
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) this.emit({ type: 'text_delta', text: delta.text });
      else if (delta?.type === 'thinking_delta' && delta.thinking) thinking.set(index, (thinking.get(index) ?? '') + delta.thinking);
    } else if (event.type === 'content_block_stop') {
      const text = thinking.get(index);
      if (text?.trim()) this.emit({ type: 'progress', text: text.trim() });
      thinking.delete(index);
    }
  }
}

/** Fabrik für `DirectorSession({ runtime })`. */
export function agentSdkRuntimeFactory(options: AgentSdkRuntimeOptions = {}): (setup: RuntimeSetup) => AgentSdkRuntime {
  return (setup) => new AgentSdkRuntime(setup, options);
}
