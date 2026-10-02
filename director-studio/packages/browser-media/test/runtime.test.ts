import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWasmRuntime } from '../src/ffmpeg.ts';
const manifestUrl = new URL('https://runtime.example/runtime/ffmpeg/ffmpeg-core.wasm.json');
const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
async function hash(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (v) => v.toString(16).padStart(2, '0')).join(''); }
async function fixture() {
  const parts = [binary.slice(0, 4), binary.slice(4)], manifest = { version: 1, bytes: binary.length, sha256: await hash(binary), chunks: await Promise.all(parts.map(async (part, i) => ({ url: `ffmpeg-core.wasm.part${i}`, bytes: part.length, sha256: await hash(part) }))) };
  const values = new Map<string, () => Response>([[manifestUrl.href, () => Response.json(manifest)], ...parts.map((part, i): [string, () => Response] => [new URL(manifest.chunks[i]!.url, manifestUrl).href, () => new Response(part)])]);
  const fetcher = vi.fn(async (input: URL, options?: RequestInit) => { options?.signal?.throwIfAborted(); const response = values.get(String(input)); return response ? response() : new Response(null, { status: 404 }); });
  vi.stubGlobal('fetch', fetcher); return { manifest, values, fetcher };
}
afterEach(() => vi.unstubAllGlobals());
describe('chunked owned WASM runtime', () => {
  it('reassembles the exact binary and omits credentials on every owned request', async () => {
    const f = await fixture(), blob = await loadWasmRuntime(manifestUrl);
    expect(blob.type).toBe('application/wasm'); expect(new Uint8Array(await blob.arrayBuffer())).toEqual(binary);
    expect(f.fetcher).toHaveBeenCalledTimes(3); for (const [, options] of f.fetcher.mock.calls) expect(options?.credentials).toBe('omit');
  });
  it('rejects truncated and corrupted chunks before executing any WASM', async () => {
    const f = await fixture(), chunk = new URL(f.manifest.chunks[0]!.url, manifestUrl).href;
    f.values.set(chunk, () => new Response(new Uint8Array([0, 97])));
    await expect(loadWasmRuntime(manifestUrl)).rejects.toThrow('Länge 2 statt 4');
    f.values.set(chunk, () => new Response(new Uint8Array([0, 97, 115, 110])));
    await expect(loadWasmRuntime(manifestUrl)).rejects.toThrow('SHA-256 stimmt nicht überein');
  });
  it('rejects a mismatched complete checksum even when each chunk is correct', async () => {
    const f = await fixture(); f.manifest.sha256 = '0'.repeat(64);
    await expect(loadWasmRuntime(manifestUrl)).rejects.toThrow('WASM-Laufzeit: SHA-256');
  });
  it('does not fetch after cancellation and rejects paths outside the owned runtime directory', async () => {
    const f = await fixture(), abort = new AbortController(); abort.abort();
    await expect(loadWasmRuntime(manifestUrl, abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.fetcher).not.toHaveBeenCalled();
    f.manifest.chunks[0]!.url = '../other.wasm'; await expect(loadWasmRuntime(manifestUrl)).rejects.toThrow('Ungültiges WASM-Teilstück');
  });
});
