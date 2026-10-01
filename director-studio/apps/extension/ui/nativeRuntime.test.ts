import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeRuntimeReader, type NativeRuntimeResponse } from './nativeRuntime.ts';

function response(bytes: Uint8Array, offset: number): NativeRuntimeResponse {
  const chunk = bytes.subarray(offset, offset + 262144);
  return { base64: Buffer.from(chunk).toString('base64'), mime: 'application/wasm', bytes: chunk.length, totalBytes: bytes.length, offset };
}
afterEach(() => vi.unstubAllGlobals());
describe('authenticated native runtime byte transport', () => {
  it('assembles bounded MCP ranges exactly, caches only the completed file, and never calls HTTP fetch', async () => {
    const bytes = Uint8Array.from({ length: 600003 }, (_, i) => i % 251);
    const fetch = vi.fn(() => { throw new Error('Private Site GET denied'); }); vi.stubGlobal('fetch', fetch);
    const request = vi.fn(async (path: string) => { const url = new URL(path, 'https://fixture.invalid'); expect(url.pathname).toBe('/api/runtime-file'); expect(url.searchParams.get('path')).toBe('/runtime/esbuild.wasm'); expect(url.searchParams.get('length')).toBe('262144'); return response(bytes, Number(url.searchParams.get('offset'))); });
    const read = createNativeRuntimeReader({ request: request as never });
    expect((await read('/runtime/esbuild.wasm')).bytes).toEqual(bytes);
    expect((await read('/runtime/esbuild.wasm')).bytes).toEqual(bytes);
    expect(request).toHaveBeenCalledTimes(3); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects mismatched ranges and truncated bytes before caching', async () => {
    const bytes = new Uint8Array(8);
    const read = createNativeRuntimeReader({ request: vi.fn(async () => ({ ...response(bytes, 0), offset: 1 })) as never });
    await expect(read('/runtime/esbuild.wasm')).rejects.toThrow('Bereichsantwort');
    const truncated = createNativeRuntimeReader({ request: vi.fn(async () => ({ ...response(bytes, 0), base64: 'AA==' })) as never });
    await expect(truncated('/runtime/esbuild.wasm')).rejects.toThrow('Byteanzahl');
  });
  it('aborts a pending host request promptly and never caches partial data', async () => {
    const request = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(response(new Uint8Array(4), 0));
    const read = createNativeRuntimeReader({ request }); const abort = new AbortController();
    const pending = read('/runtime/esbuild.wasm', abort.signal); abort.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    expect((await read('/runtime/esbuild.wasm')).bytes.length).toBe(4); expect(request).toHaveBeenCalledTimes(2);
  });
  it('denies private APIs, external URLs and traversal without calling the host', async () => {
    const request = vi.fn(); const read = createNativeRuntimeReader({ request });
    for (const path of ['/api/projects', '/runtime/../api/projects', '/runtime//esbuild.wasm', 'https://private.invalid/runtime/esbuild.wasm']) await expect(read(path)).rejects.toThrow('Runtime');
    expect(request).not.toHaveBeenCalled();
  });
});
