import { describe, expect, it } from 'vitest';
import { EDITOR_RESOURCE, handleMcp, MCP_TOOLS } from '../mcp.ts';
import worker from '../worker.ts';
import { environment, request } from './emulator.ts';

const protocolKey = 'io.modelcontextprotocol/protocolVersion';
const capabilitiesKey = 'io.modelcontextprotocol/clientCapabilities';
const modernMeta = { [protocolKey]: '2026-07-28', [capabilitiesKey]: {} };

function modernRequest(method: string, params: Record<string, unknown> = {}, who?: string) {
  const req = request('/mcp', 'POST', { jsonrpc: '2.0', id: 7, method, params: { _meta: modernMeta, ...params } }, who);
  req.headers.set('MCP-Protocol-Version', '2026-07-28');
  req.headers.set('Mcp-Method', method);
  if (method === 'tools/call') req.headers.set('Mcp-Name', String(params.name));
  if (method === 'resources/read') req.headers.set('Mcp-Name', String(params.uri));
  return req;
}
async function read(req: Request, env = environment()) {
  const response = await worker.fetch(req, env);
  return { response, body: await response.json() as any };
}

describe('MCP legacy and per-request protocol versions', () => {
  it('preserves the legacy null-id error envelope when JSON or RPC parsing fails', async () => {
    for (const body of ['{', JSON.stringify({ jsonrpc: '1.0', id: 7, method: 'ping' })]) {
      const req = new Request('https://director.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const result = await read(req);
      expect(result.response.status).toBe(200);
      expect(result.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32602, message: expect.any(String) } });
    }
  });

  it.each(['2025-11-25', '2026-07-28', '2099-01-01'])('negotiates the legacy era for initialize requesting %s', async version => {
    const env = environment();
    const { response, body } = await read(request('/mcp', 'POST', { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: version, clientInfo: { name: 'legacy-fixture', version: '1' }, capabilities: {} } }), env);
    expect(response.status).toBe(200);
    expect(body.result.protocolVersion).toBe('2025-11-25');
    expect(body.result.serverInfo).toEqual({ name: 'director-studio', version: '0.1.5' });
    expect(body.result.resultType).toBeUndefined();
    const initialized = await handleMcp(request('/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' }), env);
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe('');
    const listed = request('/mcp', 'POST', { jsonrpc: '2.0', id: 8, method: 'tools/list' });
    listed.headers.set('MCP-Protocol-Version', '2025-11-25');
    const legacy = await read(listed, env);
    expect(legacy.response.status).toBe(200);
    expect(legacy.body.result.tools).toHaveLength(50);
    expect(legacy.body.result.resultType).toBeUndefined();
    expect(legacy.body.result.ttlMs).toBeUndefined();
  });

  it('processes each modern request independently and retains the native discovery contract', async () => {
    const env = environment();
    const modern = await read(modernRequest('server/discover'), env);
    expect(modern.response.status).toBe(200);
    expect(modern.body).toMatchObject({ id: 7, result: { resultType: 'complete', ttlMs: 0, cacheScope: 'private', supportedVersions: ['2026-07-28', '2025-11-25'] } });
    const legacy = await read(request('/mcp', 'POST', { jsonrpc: '2.0', id: 9, method: 'ping' }), env);
    expect(legacy.body.result).toEqual({});
    expect((await read(modernRequest('ping'), env)).body.result).toEqual({ resultType: 'complete' });
    const listed = (await read(modernRequest('tools/list'), env)).body.result;
    expect(listed.tools).toHaveLength(50);
    expect(listed.tools.find((tool: { name: string }) => tool.name === 'director_open')._meta.ui.resourceUri).toBe(EDITOR_RESOURCE);
  });

  it.each(['2099-01-01', '1900-01-01', 'draft'])('rejects unsupported per-request version %s with its supported versions', async version => {
    const req = modernRequest('ping', { _meta: { ...modernMeta, [protocolKey]: version } });
    req.headers.set('MCP-Protocol-Version', version);
    const { response, body } = await read(req);
    expect(response.status).toBe(400);
    expect(body).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28', '2025-11-25'], requested: version } } });
  });

  it('rejects an unsupported version header without inferring connection state', async () => {
    const req = request('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'ping' });
    req.headers.set('MCP-Protocol-Version', '2099-01-01');
    const { response, body } = await read(req);
    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: -32022, data: { requested: '2099-01-01' } });
  });

  it.each([
    ['missing metadata', undefined],
    ['missing version', { [capabilitiesKey]: {} }],
    ['non-string version', { ...modernMeta, [protocolKey]: 2026 }],
    ['missing capabilities', { [protocolKey]: '2026-07-28' }],
    ['non-object capabilities', { ...modernMeta, [capabilitiesKey]: [] }],
  ])('rejects malformed modern params: %s', async (_label, meta) => {
    const { response, body } = await read(modernRequest('ping', { _meta: meta }));
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32602);
  });

  it.each([
    ['missing protocol', 'MCP-Protocol-Version', null],
    ['mismatched protocol', 'MCP-Protocol-Version', '2025-11-25'],
    ['missing method', 'Mcp-Method', null],
    ['mismatched method', 'Mcp-Method', 'tools/call'],
    ['method value case differs', 'Mcp-Method', 'PING'],
  ])('rejects %s header before dispatch', async (_label, header, value) => {
    const req = modernRequest('ping');
    if (value === null) req.headers.delete(header); else req.headers.set(header, value!);
    const { response, body } = await read(req);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it.each([null, 'get_project', '=?base64?%%%?=', '=?base64?/w==?='])('rejects missing, mismatched or malformed tool-name header %s', async value => {
    const req = modernRequest('tools/call', { name: 'list_projects' }, 'alice');
    if (value === null) req.headers.delete('Mcp-Name'); else req.headers.set('Mcp-Name', value);
    const { response, body } = await read(req);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it('decodes the Base64 sentinel and treats header names case-insensitively', async () => {
    const req = modernRequest('tools/call', { name: 'list_projects' }, 'alice');
    req.headers.set('mcp-name', `=?base64?${btoa('list_projects')}?=`);
    const called = await read(req);
    expect(called.response.status).toBe(200);
    expect(called.body.result.resultType).toBe('complete');
    expect(called.body.result).not.toHaveProperty('isError');
    const env = environment();
    env.ASSETS = { fetch: async () => new Response('<html><head></head><body>Editor</body></html>') };
    const resource = modernRequest('resources/read', { uri: EDITOR_RESOURCE });
    resource.headers.set('Mcp-Name', `=?base64?${btoa(EDITOR_RESOURCE)}?=`);
    expect((await read(resource, env)).body.result.contents[0].uri).toBe(EDITOR_RESOURCE);
  });

  it('checks resource headers before loading static content and preserves authentication', async () => {
    const resource = modernRequest('resources/read', { uri: EDITOR_RESOURCE });
    resource.headers.set('Mcp-Name', 'ui://other/editor.html');
    expect((await read(resource)).body.error.code).toBe(-32020);
    const anonymous = await read(modernRequest('tools/call', { name: 'list_projects' }));
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.body.error.code).toBe(-32001);
  });

  it('does not use client metadata or a prior modern request as an owner identity', async () => {
    const env = environment();
    const created = await read(modernRequest('tools/call', { name: 'create_project', arguments: { title: 'Private project', category: 'video' }, _meta: { ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: 'shared-client', version: '1' } } }, 'alice'), env);
    const projectId = created.body.result.structuredContent.manifest.id;
    const denied = await read(modernRequest('tools/call', { name: 'get_project', arguments: { projectId }, _meta: { ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: 'shared-client', version: '1' } } }, 'bob'), env);
    expect(denied.body.result.isError).toBe(true);
    expect(denied.body.result.structuredContent).not.toHaveProperty('document');
    const owned = await read(modernRequest('tools/call', { name: 'get_project', arguments: { projectId } }, 'alice'), env);
    expect(owned.body.result.structuredContent.manifest.id).toBe(projectId);
  });

  it('returns the modern HTTP status for an unsupported method', async () => {
    const { response, body } = await read(modernRequest('unknown/method'));
    expect(response.status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  it('omits an id from rejected notification HTTP errors', async () => {
    const req = request('/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized', params: { _meta: modernMeta } });
    const { response, body } = await read(req);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32020);
    expect(body).not.toHaveProperty('id');
  });
});

describe('MCP tool side-effect annotations', () => {
  it('distinguishes recoverable replacement from additive component history using actual tool calls', async () => {
    const env = environment();
    async function call(name: string, arguments_: Record<string, unknown>) {
      const { body } = await read(modernRequest('tools/call', { name, arguments: arguments_ }, 'alice'), env);
      expect(body.result.isError, name).not.toBe(true);
      return body.result.structuredContent;
    }
    const projectId = (await call('create_project', { title: 'Versioned site', category: 'web' })).manifest.id;
    await call('write_site_file', { projectId, path: 'index.html', content: '<h1>One</h1>' });
    await call('write_site_file', { projectId, path: 'index.html', content: '<h1>Two</h1>' });
    expect((await call('read_site_file', { projectId, path: 'index.html' })).content).toBe('<h1>Two</h1>');
    await call('restore_version', { projectId, number: 2 });
    expect((await call('read_site_file', { projectId, path: 'index.html' })).content).toBe('<h1>One</h1>');
    expect((await call('get_project', { projectId })).versions.map((version: { number: number }) => version.number)).toEqual([1, 2, 3, 4]);
    const first = await call('write_component', { projectId, componentId: 'title', code: 'export default () => "old";' });
    const second = await call('write_component', { projectId, componentId: 'title', code: 'export default () => "new";' });
    expect(second.id).not.toBe(first.id);
    expect((await call('get_project', { projectId })).assets.map((asset: { id: string }) => asset.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(MCP_TOOLS.find(tool => tool.name === 'write_site_file')?.annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.find(tool => tool.name === 'restore_version')?.annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.find(tool => tool.name === 'write_component')?.annotations.destructiveHint).toBe(false);
  });

  it('marks only current-data removal/replacement paths as destructive', () => {
    const nonAdditive = ['apply_document_ops', 'restore_version', 'write_site_file', 'merge_checkpoints', 'update_asset', 'reject_asset', 'set_brief', 'propose_checkpoint', 'record_generation', 'record_analysis', 'analyze_audio', 'cancel_job', 'import_url', 'import_fal_result', 'settings.update', 'director_ui_request'];
    expect(MCP_TOOLS).toHaveLength(50);
    expect(MCP_TOOLS.filter(tool => tool.annotations.destructiveHint).map(tool => tool.name).sort()).toEqual(nonAdditive.sort());
    for (const tool of MCP_TOOLS) {
      for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) expect(typeof tool.annotations[key], `${tool.name}.${key}`).toBe('boolean');
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      if (tool.annotations.destructiveHint) expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
    }
    for (const name of ['ask_user', 'write_component', 'prepare_generation', 'post_update', 'frames', 'contact_sheet', 'check_av_sync', 'cut_audio', 'render_still', 'screenshot_site', 'export_project']) expect(MCP_TOOLS.find(tool => tool.name === name)?.annotations).toMatchObject({ destructiveHint: false, idempotentHint: false });
    expect(MCP_TOOLS.filter(tool => tool.annotations.openWorldHint).map(tool => tool.name).sort()).toEqual(['director_ui_request', 'import_fal_result', 'import_url']);
    expect(MCP_TOOLS.find(tool => tool.name === 'import_fal_result')?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(MCP_TOOLS.find(tool => tool.name === 'analyze_audio')?.annotations.idempotentHint).toBe(false);
    expect(MCP_TOOLS.find(tool => tool.name === 'director_ui_request')?._meta?.ui).toEqual({ visibility: ['app'] });
  });
});
