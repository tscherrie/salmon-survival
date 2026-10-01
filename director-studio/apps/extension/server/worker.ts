import { handleApi, json } from './http.ts';
import { handleMcp } from './mcp.ts';
import type { WorkerEnv } from './storage.ts';
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/mcp') {
      if (request.method === 'POST') return handleMcp(request, env);
      // Stateless Streamable HTTP: no session or long lived SSE channel.
      return new Response(null, { status: 405, headers: { allow: 'POST' } });
    }
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    if (url.pathname === '/health') return json({ name: 'Director Studio', status: 'ok', director: 'native-host', storage: 'D1/R2' });
    const assets = env.ASSETS ?? env.UI;
    if (!assets) return json({ error: 'UI static binding unavailable.' }, 503);
    const response = await assets.fetch(request);
    if (url.pathname.startsWith('/runtime/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) { const headers = new Headers(response.headers); headers.set('access-control-allow-origin','*'); headers.set('cross-origin-resource-policy','cross-origin'); return new Response(response.body, { status: response.status, headers }); }
    if (url.pathname === '/media-sandbox.html') { const headers = new Headers(response.headers); headers.set('content-security-policy', `default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src ${url.origin}/runtime/ https://esm.sh data: blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'`); headers.set('referrer-policy','no-referrer'); return new Response(response.body, { status: response.status, headers }); }
    if (response.headers.get('content-type')?.includes('text/html')) { const headers = new Headers(response.headers); headers.set('content-security-policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self' blob: data:; connect-src 'self' https://esm.sh data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'"); headers.set('x-content-type-options','nosniff'); headers.set('referrer-policy','no-referrer'); return new Response(response.body, { status: response.status, headers }); }
    return response;
  },
};
