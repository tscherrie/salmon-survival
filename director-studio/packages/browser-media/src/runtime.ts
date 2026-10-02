import { checkAbort } from './types.ts';

export interface RuntimeFile { bytes: Uint8Array; mime: string }
export type RuntimeFileReader = (path: string, signal?: AbortSignal) => Promise<RuntimeFile>;
let reader: RuntimeFileReader | undefined;

/** Native widgets receive only owned runtime bytes, never credentials or a general API proxy. */
export function configureBrowserRuntime(readFile?: RuntimeFileReader): void { reader = readFile; }
export function hasBrowserRuntimeReader(): boolean { return !!reader; }
export function ownedRuntimePath(raw: string): string {
  if (!/^\/runtime\/[\w./-]+$/.test(raw) && raw !== '/native-sandbox.html') throw new Error('Unzulässige Runtime-Datei');
  if (raw.includes('//') || raw.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('Unzulässiger Runtime-Pfad');
  return raw;
}
export async function readRuntimeFile(raw: string | URL, signal?: AbortSignal): Promise<RuntimeFile> {
  checkAbort(signal);
  const url = raw instanceof URL ? raw : new URL(raw, document.baseURI);
  if (reader) { const file = await reader(ownedRuntimePath(url.pathname), signal); checkAbort(signal); return file; }
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok) throw new Error(`Runtime HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer()); checkAbort(signal);
  return { bytes, mime: response.headers.get('content-type') ?? 'application/octet-stream' };
}

/** The authenticated native sandbox is a self-contained document with an opaque origin. */
export async function loadMediaSandbox(frame: HTMLIFrameElement, sandboxUrl = '/media-sandbox.html', signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (reader) { const html = await readRuntimeFile('/native-sandbox.html', signal); frame.srcdoc = new TextDecoder().decode(html.bytes); }
  else frame.src = new URL(sandboxUrl, document.baseURI).href;
}
