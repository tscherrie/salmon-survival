import { afterEach, expect, it, vi } from 'vitest';
import { MessageChannel as NativeMessageChannel, type MessagePort as NativeMessagePort } from 'node:worker_threads';
import { configureBrowserRuntime } from '../src/runtime.ts';
import { MediaSandboxClient } from '../src/sandbox-client.tsx';

afterEach(() => { configureBrowserRuntime(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('waits for authenticated transfer before starting the iframe boot deadline', async () => {
  vi.useFakeTimers(); configureBrowserRuntime(async () => ({ bytes: new Uint8Array(1), mime: 'text/html' }));
  const channels: Array<{ port1: { onmessage?: (event: unknown) => void; postMessage: (data: { id: string }) => void; close: () => void }; port2: object }> = [];
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: undefined as ((event: unknown) => void) | undefined, postMessage: (data: { id: string }) => { this.port1.onmessage?.({ data: { id: data.id, type: 'result', value: 'ready-result' } }); }, close: () => undefined };
    port2 = {};
    constructor() { channels.push(this); }
  });
  class Frame extends EventTarget {
    transferred = false;
    hasAttribute() { return this.transferred; }
    contentWindow = { postMessage: () => channels.at(-1)?.port1.onmessage?.({ data: { type: 'ready' } }) };
  }
  const frame = new Frame(), client = new MediaSandboxClient(frame as unknown as HTMLIFrameElement);
  let settled = false; const pending = client.request('fixture').finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(20000); expect(settled).toBe(false);
  frame.transferred = true; frame.dispatchEvent(new Event('load'));
  await expect(pending).resolves.toBe('ready-result'); client.dispose();
});

it('transfers fresh detached copies on repeated and parallel runtime reads while retaining the owner cache', async () => {
  const cached = { bytes: Uint8Array.of(7, 11, 255, 0, 83), mime: 'application/wasm' };
  const expected = [...cached.bytes], transferredByteLengths: number[] = [], channels: NativeMessageChannel[] = [];
  const read = vi.fn(async () => cached); configureBrowserRuntime(read);
  vi.stubGlobal('document', { baseURI: 'https://runtime-fixture.invalid/' });
  vi.stubGlobal('MessageChannel', class extends NativeMessageChannel {
    constructor() {
      super(); channels.push(this);
      const original = this.port1.postMessage.bind(this.port1);
      vi.spyOn(this.port1, 'postMessage').mockImplementation((...args: Parameters<typeof this.port1.postMessage>) => {
        const transferred = args[1]?.find(item => item instanceof ArrayBuffer) as ArrayBuffer | undefined;
        original(...args);
        if (args[0]?.type === 'runtime-file-result' && transferred) transferredByteLengths.push(transferred.byteLength);
      });
    }
  });
  type Reply = { id: string; bytes: Uint8Array; mime: string; error?: string };
  const waiting = new Map<string, (reply: Reply) => void>(); let peer: NativeMessagePort | undefined;
  class Frame extends EventTarget {
    hasAttribute() { return true; }
    contentWindow = { postMessage: (_message: unknown, _origin: string, ports: NativeMessagePort[]) => {
      const port = ports[0]; if (!port) throw new Error('Fixture did not receive a MessagePort');
      peer = port; port.on('message', (reply: Reply) => waiting.get(reply.id)?.(reply)); port.postMessage({ type: 'ready' });
    } };
  }
  const frame = new Frame(), client = new MediaSandboxClient(frame as unknown as HTMLIFrameElement);
  const requestRuntime = (id: string) => new Promise<Reply>((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Runtime relay did not reply')); }, 2000);
    waiting.set(id, reply => { clearTimeout(timer); waiting.delete(id); resolve(reply); });
    peer!.postMessage({ type: 'runtime-file', id, path: '/runtime/esbuild.wasm' });
  });
  try {
    frame.dispatchEvent(new Event('load'));
    const first = await requestRuntime('first'); expect([...first.bytes]).toEqual(expected);
    expect(transferredByteLengths).toEqual([0]); expect([...cached.bytes]).toEqual(expected);
    const repeated = await Promise.all([requestRuntime('second'), requestRuntime('parallel')]);
    for (const reply of repeated) { expect(reply.error).toBeUndefined(); expect([...reply.bytes]).toEqual(expected); expect(reply.mime).toBe(cached.mime); }
    expect(transferredByteLengths).toEqual([0, 0, 0]);
    expect(cached.bytes.byteLength).toBe(expected.length); expect([...cached.bytes]).toEqual(expected);
    expect(read).toHaveBeenCalledTimes(3);
  } finally { client.dispose(); peer?.close(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } }
});
