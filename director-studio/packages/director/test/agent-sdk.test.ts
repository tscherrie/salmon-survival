import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from '@studio/project';

/** Gemocktes Agent SDK: zeichnet Aufrufe auf und spielt ein Skript ab. */
const sdkState = vi.hoisted(() => ({
  queries: [] as Array<{ prompt: unknown; options: Record<string, unknown> }>,
  servers: [] as Array<{ name: string; tools: Array<{ name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }> }>,
  script: null as null | ((options: Record<string, unknown>, server: { tools: Array<{ name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }> }) => AsyncGenerator<Record<string, unknown>>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, description: string, shape: Record<string, unknown>, handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>) => ({ name, description, shape, handler }),
  createSdkMcpServer: (options: { name: string; tools: Array<{ name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }> }) => {
    sdkState.servers.push(options);
    return { type: 'sdk', name: options.name, instance: {}, tools: options.tools };
  },
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    sdkState.queries.push({ prompt, options });
    const server = (options.mcpServers as Record<string, { tools: Array<{ name: string; handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }> }>).studio!;
    return sdkState.script!(options, server);
  },
}));

import { AGENT_SDK_DISALLOWED_TOOLS, agentSdkRuntimeFactory, DirectorSession, isAgentSdkAvailable } from '../src/index.ts';
import { createProject, FakeCatalog, FakeGeneration, RecordingUi, tempRoot } from './helpers.ts';
import { sequentialIds } from '@studio/core';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, 'video');
  sdkState.queries.length = 0;
  sdkState.servers.length = 0;
});

afterEach(async () => {
  project.close();
  await cleanup();
});

describe('AgentSdkRuntime (gemocktes SDK)', () => {
  it('ist über dynamischen Import verfügbar', async () => {
    expect(await isAgentSdkAvailable()).toBe(true);
    expect(await isAgentSdkAvailable(async () => {
      throw new Error('nicht installiert');
    })).toBe(false);
  });

  it('konfiguriert query() sicher, führt Studio-Tools über MCP aus und bucht nur Kostendifferenzen', async () => {
    sdkState.script = async function* (options, server) {
      yield { type: 'system', subtype: 'init', session_id: 'sess_1' };
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } };
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Ich lege das Treatment an.' } } };
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } };
      const create = server.tools.find((t) => t.name === 'create_text_asset')!;
      const toolResult = (await create.handler({ title: 'Treatment', subtype: 'treatment', text: '# Idee' }, {})) as { content: Array<{ text: string }> };
      expect(toolResult.content[0]!.text).toContain('Gespeichert');
      // Kostenpflichtiges Tool: canUseTool prüft Picker/Budget
      const canUseTool = options.canUseTool as (name: string, input: Record<string, unknown>, o: { signal: AbortSignal }) => Promise<{ behavior: string; message?: string }>;
      const denied = await canUseTool('mcp__studio__generate', { endpointId: 'fal-ai/kling-video/v3/text-to-video', input: { prompt: 'x' }, purpose: 'Test' }, { signal: new AbortController().signal });
      expect(denied.behavior).toBe('deny');
      expect(denied.message).toContain('Picker');
      const budgetDenied = await canUseTool('mcp__studio__generate', { endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x', duration: 5 }, purpose: 'Test' }, { signal: new AbortController().signal });
      expect(budgetDenied.behavior).toBe('deny');
      expect(budgetDenied.message).toContain('Budget nicht freigegeben');
      expect((await canUseTool('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal })).behavior).toBe('deny');
      expect((await canUseTool('WebSearch', { query: 'x' }, { signal: new AbortController().signal })).behavior).toBe('allow');
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Treatment liegt bereit.' } } };
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Treatment liegt bereit.' }] } };
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.25, result: 'ok' };
    };

    const ui = new RecordingUi();
    ui.approve = false;
    const session = new DirectorSession({
      project,
      catalog: new FakeCatalog(),
      generation: new FakeGeneration(),
      ui,
      runtime: agentSdkRuntimeFactory({ configDir: '/app/claude' }),
      runtimeId: 'agent-sdk',
      ids: sequentialIds(),
    });
    await session.send({ segments: [{ type: 'text', text: 'Schreib das Treatment' }] });

    const { options, prompt } = sdkState.queries[0]!;
    expect(options).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      cwd: project.dir,
      settingSources: [],
      permissionMode: 'default',
      includePartialMessages: true,
      strictMcpConfig: true,
      maxTurns: 60,
    });
    expect(String(options.systemPrompt)).toContain('You are the Director of this studio');
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'Read']));
    expect(AGENT_SDK_DISALLOWED_TOOLS).toContain('Bash');
    const allowed = options.allowedTools as string[];
    expect(allowed).toContain('mcp__studio__search_assets');
    expect(allowed).not.toContain('mcp__studio__generate');
    expect((options.env as Record<string, string>).CLAUDE_CONFIG_DIR).toBe('/app/claude');
    expect(options.resume).toBeUndefined();
    expect(String(prompt)).toContain('<studio-context>');
    expect(String(prompt)).toContain('Schreib das Treatment');
    // Gleiche Tool-Registry (ohne delegate und Web-Fallback)
    expect(sdkState.servers[0]!.tools.map((t) => t.name)).toContain('generate');
    expect(sdkState.servers[0]!.tools.map((t) => t.name)).not.toContain('delegate');

    expect(project.listAssets({ subtypes: ['treatment'] })).toHaveLength(1);
    expect(ui.approvals).toHaveLength(1);
    expect(project.budgetSummary().bySource.director).toBeCloseTo(0.25);
    expect(ui.ofType('progress').map((e) => e.text)).toContain('Ich lege das Treatment an.');
    expect(ui.ofType('message_delta').map((e) => e.delta).join('')).toBe('Treatment liegt bereit.');
    expect(ui.ofType('message').at(-1)!.message.text).toBe('Treatment liegt bereit.');
    expect(ui.ofType('tool').map((e) => `${e.activity.name}:${e.activity.status}`)).toEqual(['create_text_asset:started', 'create_text_asset:finished']);
    expect(session.state).toBe('idle');

    // Zweiter Turn: Session wird fortgesetzt, nur die Kostendifferenz wird gebucht
    sdkState.script = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess_1' };
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Weiter.' }] } };
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.4, result: 'ok' };
    };
    await session.send({ segments: [{ type: 'text', text: 'Weiter' }] });
    expect(sdkState.queries[1]!.options.resume).toBe('sess_1');
    expect(project.budgetSummary().bySource.director).toBeCloseTo(0.4);

    // Neue Session (App-Neustart) liest Session-ID und Kostenstand aus dem Transkript
    sdkState.script = async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, result: 'ok' };
    };
    const restarted = new DirectorSession({ project, catalog: new FakeCatalog(), generation: new FakeGeneration(), ui, runtime: agentSdkRuntimeFactory(), runtimeId: 'agent-sdk', ids: sequentialIds() });
    await restarted.send({ segments: [{ type: 'text', text: 'Hallo' }] });
    expect(sdkState.queries[2]!.options.resume).toBe('sess_1');
    expect(project.budgetSummary().bySource.director).toBeCloseTo(0.5);
  });

  it('meldet Fehler und Abbruch', async () => {
    sdkState.script = async function* () {
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, result: 'kaputt' };
    };
    const ui = new RecordingUi();
    const session = new DirectorSession({ project, catalog: new FakeCatalog(), generation: new FakeGeneration(), ui, runtime: agentSdkRuntimeFactory(), runtimeId: 'agent-sdk', ids: sequentialIds() });
    await session.send({ segments: [{ type: 'text', text: 'x' }] });
    expect(ui.ofType('run_state').at(-1)).toMatchObject({ state: 'failed', error: 'kaputt' });

    sdkState.script = async function* (options) {
      const controller = options.abortController as AbortController;
      await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve()));
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const running = session.send({ segments: [{ type: 'text', text: 'lange Aufgabe' }] });
    await vi.waitFor(() => expect(sdkState.queries.length).toBe(2));
    session.interrupt();
    await running;
    expect(session.state).toBe('interrupted');
  });
});
