import { MODALITIES, parsePickerState, type AppSettings } from '@studio/core';
import { SEED_MODELS } from '../../../packages/fal/src/seed.ts';
import { beginUpload, uploadChunk, completeUpload } from './transfers.ts';
import { z } from 'zod';
import { ApiError, CloudStore, requireIdentity, type WorkerEnv } from './storage.ts';
import { DirectorService } from './service.ts';

export function json(value: unknown, status = 200): Response { return Response.json(value ?? null, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
export function failure(error: unknown): Response {
  const api = error instanceof ApiError ? error : error instanceof z.ZodError ? new ApiError(400, 'INVALID_INPUT', error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')) : new ApiError(400, 'ACTION_FAILED', error instanceof Error ? error.message : 'Action failed.');
  return json({ error: api.message, code: api.code }, api.status);
}
export function serviceFor(request: Request, env: WorkerEnv): DirectorService { return new DirectorService(new CloudStore(env.DB, requireIdentity(request)), env); }
export function models(modality?: string) { return SEED_MODELS.filter(m => m.provider === 'fal' && m.modality !== 'director' && (!modality || m.modality === modality || m.alsoModalities?.includes(modality as never))); }
export async function updateSettings(service: DirectorService, value: unknown): Promise<AppSettings> {
  const patch = z.object({ language: z.enum(['de','en']).optional(), defaultEffort: z.enum(['low','medium','high','xhigh','max']).optional(), defaultPickers: z.record(z.string(), z.unknown()).optional() }).strict().parse(value);
  const settings = { ...await service.store.settings(), ...patch, ...(patch.defaultPickers ? { defaultPickers: Object.fromEntries(Object.entries(parsePickerState(patch.defaultPickers)).filter(([k]) => k !== 'director')) } : {}) } as AppSettings;
  await service.store.saveSettings(settings); return settings;
}
export async function handleApi(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    const service = serviceFor(request, env); const url = new URL(request.url); const path = url.pathname; const method = request.method;
    // Auth comes before all API discovery and reads.
    if (path === '/api/settings') { if (method === 'GET') return json(await service.store.settings()); if (method === 'PATCH') return json(await updateSettings(service, await request.json())); }
    if (path === '/api/models' && method === 'GET') return json(models(url.searchParams.get('modality') ?? undefined));
    if (path === '/api/projects') { if (method === 'GET') return json(await service.list()); if (method === 'POST') return json(await service.create(await request.json()), 201); }
    const route = path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
    if (!route) throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found.');
    const projectId = decodeURIComponent(route[1]!); const tail = route[2];
    if (!tail && method === 'GET') return json(await service.get(projectId));
    if (tail === 'events' && method === 'GET') { const current = await service.get(projectId); return json({ revision: current.cloudRevision, changed: current.cloudRevision !== Number(url.searchParams.get('after')), snapshot: current.cloudRevision !== Number(url.searchParams.get('after')) ? current : null }); }
    if (tail === 'actions' && method === 'POST') { const { method: action, params } = z.object({ method: z.string(), params: z.unknown().optional() }).parse(await request.json()); return json(await service.action(projectId, action, params)); }
    if (tail === 'assets' && method === 'POST') {
      await service.store.load(projectId); // authorize before buffering an upload
      const cap = Number(env.MAX_IMPORT_BYTES ?? 134217728); if (Number(request.headers.get('content-length') ?? 0) > cap + 1048576) throw new ApiError(413, 'IMPORT_TOO_LARGE', 'Upload too large.');
      const form = await request.formData(); const file = form.get('file'); if (!file || typeof file === 'string') throw new ApiError(400, 'FILE_REQUIRED', 'Upload requires a file.');
      const metadata = form.get('metadata'); return json(await service.upload(projectId, new Uint8Array(await file.arrayBuffer()), file.name, file.type || 'application/octet-stream', typeof metadata === 'string' ? JSON.parse(metadata) : {}), 201);
    }
    if (tail === 'assets-upload/begin' && method === 'POST') return json(await beginUpload(service.store,env,projectId,await request.json()));
    const transferRoute=tail?.match(/^assets-upload\/([^/]+)\/(chunk|complete)$/);
    if(transferRoute&&method==='POST') return json(transferRoute[2]==='chunk'?await uploadChunk(service.store,env,projectId,transferRoute[1]!,await request.json()):await completeUpload(service.store,env,projectId,transferRoute[1]!));
    if (tail === 'assets-json' && method === 'POST') {
      await service.store.load(projectId);
      const input = z.object({ name: z.string(), mime: z.string(), base64: z.string().max(180000000), metadata: z.record(z.string(), z.unknown()).optional() }).parse(await request.json());
      const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0)); return json(await service.upload(projectId, bytes, input.name, input.mime, input.metadata), 201);
    }
    const assetRoute = tail?.match(/^assets\/([^/]+)$/);
    if (assetRoute && (method === 'GET' || method === 'HEAD')) {
      const loaded = await service.store.load(projectId); const a = loaded.state.assets.find(a => a.id === decodeURIComponent(assetRoute[1]!)); if (!a) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
      const variant = url.searchParams.get('variant') || 'original'; const variantPath = variant === 'original' ? a.path : a.metadata?.[`${variant}Path`];
      if (typeof variantPath !== 'string') { if (variant !== 'original' && a.path) return handleApi(new Request(new URL(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(a.id)}?variant=original`, url), request), env); throw new ApiError(409, 'ASSET_MISSING', 'Asset has no stored content. Import or relink it.'); }
      const variantAsset = loaded.state.assets.find(item => item.path === variantPath); if (!variantAsset) throw new ApiError(404, 'VARIANT_NOT_FOUND', 'This variant is not stored in the owned project.');
      const rangeHeaders = new Headers(request.headers); if (url.searchParams.has('offset')) { const offset = z.coerce.number().int().nonnegative().parse(url.searchParams.get('offset')); const length = z.coerce.number().int().positive().max(1048576).parse(url.searchParams.get('length') ?? 262144); if (variantAsset.bytes !== undefined && offset >= variantAsset.bytes) throw new ApiError(416, 'RANGE_INVALID', 'Range starts beyond the asset.'); rangeHeaders.set('range', `bytes=${offset}-${offset + length - 1}`); }
      const object = await env.MEDIA.get(variantPath, { range: rangeHeaders }); if (!object) throw new ApiError(409, 'ASSET_MISSING', 'Asset bytes missing. Repair this asset before preview or export.');
      const headers = new Headers({ 'content-type': object.httpMetadata?.contentType ?? a.mime ?? 'application/octet-stream', 'content-length': String(object.range?.length ?? object.size), 'cache-control': 'private, no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.title.replace(/[\r\n]/g,''))}` });
      if (object.httpEtag) headers.set('etag', object.httpEtag);
      let status = 200; if (object.range?.length !== undefined) { status = 206; const offset = object.range.offset ?? 0; headers.set('content-range', `bytes ${offset}-${offset + object.range.length - 1}/${object.size}`); }
      return new Response(method === 'HEAD' ? null : object.body, { status, headers });
    }
    const siteRoute = tail?.match(/^site-preview\/(.*)$/);
    if (siteRoute && method === 'GET') { const loaded = await service.store.load(projectId); const name = decodeURIComponent(siteRoute[1] || 'index.html'); const content = loaded.state.siteFiles[name]; if (content === undefined) throw new ApiError(404, 'FILE_NOT_FOUND', 'Site preview file not found.');
      // Defense in depth: site code cannot make authenticated project requests.
      return new Response(content, { headers: { 'content-type': name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript', 'content-security-policy': "sandbox allow-scripts; default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'", 'cache-control': 'private,no-store', 'x-content-type-options': 'nosniff' } }); }
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found.');
  } catch (error) { return failure(error); }
}
