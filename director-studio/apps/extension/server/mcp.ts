import { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { Validator, type Schema } from '@cfworker/json-schema';
import { ApiError, type WorkerEnv } from './storage.ts';
import { handleApi, json, models, serviceFor, updateSettings } from './http.ts';
import { NATIVE_UI_BUILD_ID } from './generated/ui-build.ts';

export const LEGACY_EDITOR_RESOURCE = 'ui://director-studio/editor.html';
export const EDITOR_RESOURCE = `ui://director-studio/editor-${NATIVE_UI_BUILD_ID}.html`;
// MCP 2026-07-28 requires explicit caching hints on discovery and resource results.
// Re-fetch within the requesting authorization context while native UI changes ship.
const cacheHints = { ttlMs: 0, cacheScope: 'private' } as const;
const s = { type: 'string' };
const o = { type: 'object', additionalProperties: true };
const a = { type: 'array', items: s };
const n = { type: 'number', minimum: 0 };
interface Tool { name: string; title: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations: Record<string, boolean>; _meta?: Record<string, unknown>; icons?: Array<{ src: string; mimeType: string }> }
const tools: Tool[] = [];
function tool(name: string, description: string, props: Record<string, unknown>, required: string[] = [], read = false, extra: Partial<Tool> = {}) {
  tools.push({ name, title: name.replaceAll('_', ' '), description, inputSchema: { type: 'object', properties: props, required, additionalProperties: false }, annotations: { readOnlyHint: read, destructiveHint: false, idempotentHint: read, openWorldHint: false }, ...extra });
}
const project = { projectId: s };
const p = ['projectId'];
const displayToolMeta = OpenAIUiToolMetadataSchema.parse({ entrypoints: [{ type: 'global' }, { type: 'thread' }], preferredModelDisplayMode: 'fullscreen' });
tool('director_open', 'Open the Director Studio project editor. The native host conversation and model are the Director. Accepts empty arguments from navigation.', { projectId: s }, [], true, { title: 'Studio Editor', _meta: { ui: { resourceUri: EDITOR_RESOURCE, visibility: ['model','app'] }, 'openai/ui': displayToolMeta }, icons: [{ src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PHJlY3QgeD0iMyIgeT0iNCIgd2lkdGg9IjE0IiBoZWlnaHQ9IjEyIiByeD0iMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS4zMyIvPjxwYXRoIGQ9Im04IDcgNSAzLTUgM3oiIGZpbGw9ImN1cnJlbnRDb2xvciIvPjwvc3ZnPg==', mimeType: 'image/svg+xml' }] });
tool('list_projects', 'List only projects owned by the current authenticated user.', {}, [], true);
tool('create_project', 'Create a video, audio, slides, graphic or web project. A null category starts the brief conversation.', { title: s, category: { type: ['string','null'], enum: ['video','audio','slides','graphic','web',null] }, formats: { type: 'array', items: o } }, ['title','category']);
tool('get_project', 'Read project document, immutable versions, assets, jobs, approvals and budget.', project, p, true);
tool('set_brief', 'Persist the agreed brief and category. This does not start paid generation.', { ...project, brief: o, category: { type: 'string', enum: ['video','audio','slides','graphic','web'] } }, [...p,'brief']);
tool('ask_user', 'Persist concise project questions in the editor for the user to answer. Use native host questions when available; the editor preserves unanswered decisions across reopening.', { ...project, questions: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: { id: s, question: s, header: s, options: { type: 'array', items: { type: 'object', properties: { label: s, description: s }, required: ['label'] } }, multiSelect: { type: 'boolean' } }, required: ['id','question','options'] } } }, [...p,'questions']);
tool('propose_checkpoint', 'Present a checkpoint and requested budget for user approval. The host cannot approve its own proposal.', { ...project, checkpointId: s, summary: s, assetIds: a, budgetRequestedUsd: n }, [...p,'checkpointId','summary']);
tool('merge_checkpoints', 'Merge at least two pending checkpoints while preserving their provenance.', { ...project, ids: a, title: s }, [...p,'ids','title']);
tool('post_update', 'Add a project progress note without sending a chat message or using an inference API.', { ...project, text: s }, [...p,'text']);
tool('get_document', 'Read document, version head and readable summary. Use the head for optimistic edits.', project, p, true);
tool('apply_document_ops', 'Apply an atomic validated document operation batch. Always pass the last observed expectedHead; stale edits return conflict and change nothing.', { ...project, ops: { type: 'array', items: o, minItems: 1, maxItems: 1000 }, note: s, expectedHead: { type: 'integer', minimum: 1 }, expectedRevision: { type: 'integer', minimum: 1 } }, [...p,'ops','expectedHead']);
tool('restore_version', 'Restore an immutable earlier version by creating a new version, keeping history.', { ...project, number: { type: 'integer', minimum: 1 }, expectedRevision: { type: 'integer', minimum: 1 } }, [...p,'number']);
tool('get_version', 'Read an immutable document version.', { ...project, number: { type: 'integer', minimum: 1 } }, [...p,'number'], true);
tool('search_assets', 'Search this project material. Director assets, native host Library and Fal Library are separate systems.', { ...project, query: o }, p, true);
tool('get_asset', 'Read an owned asset and provenance; storage paths are never public capabilities.', { ...project, assetId: s }, [...p,'assetId'], true);
tool('update_asset', 'Update title, status, tags and descriptive/media metadata. Storage and Fal provenance are immutable here.', { ...project, assetId: s, patch: o }, [...p,'assetId','patch']);
tool('reject_asset', 'Mark an asset as rejected without deleting the user material.', { ...project, assetId: s }, [...p,'assetId']);
tool('get_lineage', 'Read input/reference relationships of an asset.', { ...project, assetId: s }, [...p,'assetId'], true);
tool('create_text_asset', 'Store text, transcript, word timing data or a written project document.', { ...project, content: s, title: s, mime: s, subtype: s, tags: a }, [...p,'content','title']);
tool('import_url', 'Import public HTTPS media into owned project storage. For Fal outputs, record_generation links the imported asset to the actual approved request and billing receipt.', { ...project, url: s, title: s, metadata: o }, [...p,'url']);
tool('import_fal_result', 'Import an already completed official Fal plugin result and its original request/model/quoted estimate, without generating again or creating a new payment approval. Omit actualCostUsd when billing is unknown.', { ...project, url: s, endpointId: s, requestId: s, estimateUsd: n, actualCostUsd: n, title: s, metadata: o }, [...p,'url','endpointId','requestId','estimateUsd']);
tool('write_component', 'Store a React/code component for isolated browser rendering. Code runs in a sandbox, never in the authenticated server.', { ...project, componentId: s, code: s, title: s }, [...p,'componentId','code']);
tool('read_component', 'Read the exact component asset referenced by a document version. Pass assetId for immutable preview/export; without it, returns the latest source for componentId.', { ...project, componentId: s, assetId: s }, [...p,'componentId'], true);
tool('write_site_file', 'Write an owned website source file and create a versioned file snapshot. Traversal, secrets paths and generated dependency folders are rejected.', { ...project, path: s, content: s }, [...p,'path','content']);
tool('read_site_file', 'Read a project website source file.', { ...project, path: s }, [...p,'path'], true);
tool('list_site_files', 'List this project website source files.', project, p, true);
tool('search_models', 'Read the bundled Fal model discovery catalog. Seed prices are unverified. Obtain live schemas and quotes using the installed official Fal plugin.', { modality: { type: 'string', enum: ['text','image','video','lipsync','voice','music','sound','tools'] }, text: s }, [], true);
tool('get_model_schema', 'Direct the host to the installed official Fal plugin for a live schema; this server has no Fal token and does not invent schemas.', { endpointId: s }, ['endpointId'], true);
tool('estimate_cost', 'Record no charge. Obtain a current quote through the official Fal plugin, then prepare_generation with that quote and input.', { endpointId: s, input: o }, ['endpointId','input'], true);
tool('prepare_generation', 'Persist a quoted Fal generation before submission and present user approval. No Fal request is made. The host submits via the official installed Fal plugin only after approval.', { ...project, endpointId: s, modality: { type: 'string', enum: ['text','image','video','lipsync','voice','music','sound','tools'] }, estimateUsd: n, purpose: s, input: o, checkpointId: s, inputAssetIds: a }, [...p,'endpointId','modality','estimateUsd','purpose','input']);
tool('record_generation', 'Record the official native Fal plugin request status and imported output IDs. actualCostUsd must be omitted when billing was not returned; estimated and actual costs remain distinct.', { ...project, generationId: s, requestId: s, status: { type: 'string', enum: ['running','completed','failed','canceled'] }, actualCostUsd: n, outputAssetIds: a, error: s }, [...p,'generationId','status']);
tool('await_generations', 'Read persistent generation receipts after editor reopening. Poll actual Fal job status with the native Fal plugin and record its receipt.', { ...project, ids: a }, p, true);
tool('cancel_generation', 'Read the exact generation to cancel. The host must cancel with the native Fal plugin and record its confirmed receipt.', { ...project, generationId: s }, [...p,'generationId'], true);
tool('record_analysis', 'Persist measured browser analysis or host Fal transcript/word timings on an owned asset.', { ...project, assetId: s, kind: { type: 'string', enum: ['peaks','beats','loudness','transcript','avSync','frames','rotoscope','pose'] }, result: {} }, [...p,'assetId','kind','result']);
tool('transcribe', 'Request a transcription handoff through the native Fal plugin with current schema, quote and project approval. This tool performs no hidden paid transcription.', { ...project, assetId: s }, [...p,'assetId'], true);
tool('extract_rotoscope', 'Read an owned source and immediately return an official Fal plugin handoff for mask, pose, depth or contours. Creates no job, approval, paid request or extracted asset. The host obtains a current schema and quote, prepares project approval, then records the actual Fal receipt.', { ...project, input: o }, [...p,'input'], true);
for (const [name, description] of Object.entries({ frames: 'Extract project video frames', contact_sheet: 'Compose a contact sheet', analyze_audio: 'Measure audio peaks, spectral beats, downbeats, confidence and loudness; input.writeMarkers persists deterministic timeline markers', check_av_sync: 'Measure video timing against input.referenceAudioAssetId, audio first with optional normalized mouth ROI motion fallback', cut_audio: 'Export an audio region with optional handlesSec', render_still: 'Render a document frame', screenshot_site: 'Capture a sandboxed website viewport', export_project: 'Export all validated document content in the requested format' })) tool(name, `${description}. Persist a browser processing job; the open editor executes the job and stores its output receipt. No Worker codec or hidden cloud runtime is claimed.`, { ...project, input: o }, [...p,'input']);
tool('list_jobs', 'Read persistent browser render/export jobs, including output receipts and failures.', project, p, true);
tool('cancel_job', 'Cancel an owned queued or running browser processing job. Its editor aborts local work, and cancellation persists across reopening. This does not cancel a paid Fal generation.', { ...project, jobId: s }, [...p,'jobId']);
tool('retry_job', 'Create a new attempt of a failed or canceled owned browser job, preserving its exact historical document/source version and linking retryOf. Does not retry or charge a Fal generation.', { ...project, jobId: s }, [...p,'jobId']);
tool('director_ui_request', 'Authenticated private UI bridge to this server only. Host model and external plugins cannot be called through this tool.', { path: s, method: { type: 'string', enum: ['GET','POST','PATCH'] }, body: {} }, ['path','method'], false, { _meta: { ui: { visibility: ['app'] } } });
const settingsProperties = { language: { type: 'string', title: 'Language', enum: ['de','en'] }, defaultEffort: { type: 'string', title: 'Default project effort', enum: ['low','medium','high','xhigh','max'] } };
tool('settings.read', 'Read the authenticated user settings.', {}, [], true, { outputSchema: { type: 'object', properties: { schema: o, values: o, layout: { type: 'array', items: o } }, required: ['schema','values'] } });
tool('settings.update', 'Persist partial authenticated user setting changes.', { set: { type: 'object', properties: settingsProperties, additionalProperties: false, minProperties: 1 } }, ['set'], false, { outputSchema: { type: 'object', properties: { values: o }, required: ['values'] } });
for (const entry of tools) { if (['import_url','import_fal_result','director_ui_request'].includes(entry.name)) entry.annotations.openWorldHint = true; if (entry.name === 'import_fal_result') entry.annotations.idempotentHint = true; }
export const MCP_TOOLS: readonly Tool[] = tools;
const argumentValidators = new Map(tools.map(tool => [tool.name, new Validator(tool.inputSchema as Schema, '2020-12')]));
const actions: Record<string, string> = { set_brief: 'setBrief', ask_user: 'askUser', propose_checkpoint: 'proposeCheckpoint', merge_checkpoints: 'mergeCheckpoints', post_update: 'postUpdate', get_document: 'getDocument', apply_document_ops: 'applyDocumentOps', restore_version: 'restoreVersion', get_version: 'getVersion', search_assets: 'searchAssets', get_asset: 'getAsset', update_asset: 'updateAsset', reject_asset: 'rejectAsset', get_lineage: 'getLineage', create_text_asset: 'createTextAsset', import_url: 'importUrl', import_fal_result: 'importFalResult', write_component: 'writeComponent', read_component: 'readComponent', write_site_file: 'writeSiteFile', read_site_file: 'readSiteFile', list_site_files: 'listSiteFiles', prepare_generation: 'prepareGeneration', record_generation: 'recordGeneration', await_generations: 'awaitGenerations', cancel_generation: 'cancelGeneration', record_analysis: 'recordAnalysis', transcribe: 'requestTranscription', list_jobs: 'listJobs', cancel_job: 'cancelJob', retry_job: 'retryJob' };
const capabilities = { tools: {}, resources: {}, extensions: { 'openai/settings': { readTool: 'settings.read', updateTool: 'settings.update' } } };
function toolResult(value: unknown, appOnly = false) { const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value ?? null }; return { content: appOnly ? [] : [{ type: 'text', text: JSON.stringify(value ?? null) }], structuredContent }; }
export async function handleMcp(request: Request, env: WorkerEnv): Promise<Response> {
  let rpcId: unknown = null;
  try {
    const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(),z.number(),z.null()]).optional(), method: z.string(), params: z.record(z.string(),z.unknown()).optional() }).parse(await request.json()); rpcId = rpc.id ?? null;
    const args = rpc.params ?? {}; let result: unknown;
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    switch (rpc.method) {
      case 'initialize': result = { protocolVersion: args.protocolVersion === '2026-07-28' ? '2026-07-28' : '2025-11-25', serverInfo: { name: 'director-studio', version: '0.1.0' }, capabilities, instructions: 'You are the Director through this native host model and conversation. Read the project brief and current document/head before editing. Preserve questions and checkpoints; only the user approves them. Apply validated operations with expectedHead. Media generations use the separately installed official Fal plugin: obtain its current schema and quote, prepare_generation, wait for explicit user approval, submit through Fal, import outputs and record actual request receipts. Never substitute quoted estimates for actual billing. Do not read host Fal credentials, run a separate inference loop, or invent native Library/catalog access. Queued browser render jobs require the open editor; read their persistent completion/error receipts.' }; break;
      case 'server/discover': result = { ...cacheHints, supportedVersions: ['2026-07-28','2025-11-25'], _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'director-studio', version: '0.1.0' } }, capabilities }; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { ...cacheHints, tools: MCP_TOOLS }; break;
      case 'resources/list': result = { ...cacheHints, resources: [{ uri: EDITOR_RESOURCE, name: 'Studio Editor', mimeType: 'text/html;profile=mcp-app' }] }; break;
      case 'resources/read': {
        if (args.uri !== EDITOR_RESOURCE && args.uri !== LEGACY_EDITOR_RESOURCE) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
        const staticBinding = env.ASSETS ?? env.UI; if (!staticBinding) throw new ApiError(503, 'UI_UNAVAILABLE', 'The deployed UI static binding is unavailable.');
        const url = new URL(request.url); const response = await staticBinding.fetch(new Request(new URL('/native.html', url))); if (!response.ok) throw new ApiError(503, 'UI_UNAVAILABLE', 'The deployed self-contained editor HTML is unavailable.');
        // The base only resolves package paths; no boot asset is fetched from it.
        const html = (await response.text()).replace(/<head>/i, `<head><base href="${url.origin}/">`);
        console.info('director.ui.resource', {uri:args.uri,buildId:NATIVE_UI_BUILD_ID,bytes:new TextEncoder().encode(html).byteLength,delivery:'self-contained'});
        result = { ...cacheHints, contents: [{ uri: args.uri, mimeType: 'text/html;profile=mcp-app', text: html, _meta: { 'openai/ui': OpenAIUiResourceMetadataSchema.parse({ availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' }), ui: { csp: { connectDomains: ['https://esm.sh', 'https://www.remotion.pro'], resourceDomains: ['https://esm.sh'], frameDomains: [url.origin], baseUriDomains:[url.origin] } } } }] }; break;
      }
      case 'tools/call': {
        const name = z.string().parse(args.name); const params = z.record(z.string(),z.unknown()).parse(args.arguments ?? {});
        if (!MCP_TOOLS.some(t => t.name === name)) throw new ApiError(404, 'TOOL_NOT_FOUND', 'Tool not found.');
        const service = serviceFor(request, env);
        try {
          const validation = argumentValidators.get(name)!.validate(params); if (!validation.valid) throw new ApiError(400, 'INVALID_INPUT', validation.errors.map(error => error.error).join('; '));
          let value: unknown;
          if (name === 'director_open') value = params.projectId ? { projectId: params.projectId, snapshot: await service.get(z.string().parse(params.projectId)), projects: await service.list() } : { projects: await service.list() };
          else if (name === 'list_projects') value = await service.list();
          else if (name === 'create_project') value = await service.create(params);
          else if (name === 'get_project') value = await service.get(z.string().parse(params.projectId));
          else if (name === 'search_models') { const text = z.string().parse(params.text ?? '').toLowerCase(); value = { models: models(params.modality as string | undefined).filter(m => `${m.displayName} ${m.id} ${m.description}`.toLowerCase().includes(text)), catalog: 'bundled seed; prices unverified', hostAction: 'Use the official Fal plugin for current discovery, schema and quote.' }; }
          else if (name === 'get_model_schema' || name === 'estimate_cost') value = { endpointId: z.string().parse(params.endpointId), hostAction: `Use the installed official Fal plugin to ${name === 'get_model_schema' ? 'read the live schema' : 'quote the validated input'}. Director Studio has no cross-plugin credentials or private model transport.` };
          else if (name === 'director_ui_request') {
            const path = z.string().startsWith('/api/').parse(params.path); if (path.includes('://') || path.includes('..')) throw new ApiError(400, 'UNSAFE_UI_PATH', 'Only this Site API is allowed.');
            const method = z.enum(['GET','POST','PATCH']).parse(params.method); const headers = new Headers(request.headers); headers.set('content-type','application/json');
            const response = await handleApi(new Request(new URL(path, request.url), { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(params.body ?? {}) }) }), env);
            if (!response.ok) { const error = await response.json() as { error: string; code: string }; throw new ApiError(response.status, error.code, error.error); }
            if (response.headers.get('content-type')?.includes('application/json')) value = await response.json();
            else { const bytes = new Uint8Array(await response.arrayBuffer()); let raw = ''; for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384)); value = { base64: btoa(raw), mime: response.headers.get('content-type'), bytes: bytes.length }; }
          }
          else if (name === 'settings.read') { const settings = await service.store.settings(); value = { schema: { type: 'object', properties: settingsProperties }, values: { language: settings.language, defaultEffort: settings.defaultEffort }, layout: [{ kind: 'group', title: 'Editor', items: [{ kind: 'property', property: 'language' }, { kind: 'property', property: 'defaultEffort' }] }] }; }
          else if (name === 'extract_rotoscope') {
            const input = z.record(z.string(),z.unknown()).parse(params.input ?? {}), assetId=z.string().parse(input.assetId ?? input.asset);
            const sourceAsset=await service.action(z.string().parse(params.projectId),'getAsset',{assetId});
            value={status:'handoff_required',sourceAsset,kind:input.kind??'mask',endpointId:input.endpointId??null,hostAction:'Use the separately installed official Fal plugin to discover a current compatible mask/pose/depth/contours model, obtain its schema and quote, prepare_generation with this input asset, await the user approval, then submit through Fal and import/record its actual receipt. No extraction or paid request has run.'};
          }
          else if (name === 'settings.update') { const settings = await updateSettings(service, params.set); value = { values: { language: settings.language, defaultEffort: settings.defaultEffort } }; }
          else if (actions[name]) value = await service.action(z.string().parse(params.projectId), actions[name]!, params);
          else value = await service.action(z.string().parse(params.projectId), 'createJob', { kind: name, input: params.input ?? {} });
          // The app reads structuredContent. Duplicating binary ranges in a text block
          // doubles native runtime traffic without providing model-visible content.
          result = toolResult(value, name === 'director_ui_request');
        } catch (error) { if (error instanceof ApiError && error.status === 401) throw error; result = { ...toolResult({ error: error instanceof Error ? error.message : 'Tool failed.', code: error instanceof ApiError ? error.code : 'INVALID_INPUT' }), isError: true }; }
        break;
      }
      default: return json({ jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: 'Method not found.' } });
    }
    return json({ jsonrpc: '2.0', id: rpcId, result: { resultType: 'complete', ...result as Record<string, unknown> } });
  } catch (error) {
    const auth = error instanceof ApiError && error.status === 401;
    return json({ jsonrpc: '2.0', id: rpcId, error: { code: auth ? -32001 : -32602, message: error instanceof Error ? error.message : 'Invalid MCP request.' } }, auth ? 401 : 200);
  }
}
