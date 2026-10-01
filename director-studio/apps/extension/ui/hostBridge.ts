import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import type { Ref, StudioDocument, Asset } from '@studio/core';
import { formatTimecode, refSchema } from '@studio/core';

export type HostFile = { fileId: string; fileName: string; mimeType: string };
type OptionalFileHost = {
  selectFiles?(): Promise<HostFile[]>;
  getFileDownloadUrl?(input: { fileId: string }): Promise<{ downloadUrl: string }>;
  uploadFile?(file: File, options?: { library?: boolean }): Promise<{ fileId: string }>;
  openExternal?(input: { href: string }): Promise<void>;
};
export interface HostStatus { connected: boolean; modelContext: boolean; libraryImport: boolean; libraryExport: boolean; displayMode: string; contextAttached: boolean; error: string | null }
export interface SelectionContext { projectId: string; title: string; version: number; document: StudioDocument | null; assets: Asset[]; refs: Ref[] }

/** Only documented optional file helpers are adapted here; this is not a library catalogue. */
function fileHost(): OptionalFileHost | undefined {
  return (window as Window & { openai?: OptionalFileHost }).openai;
}

export function selectionText(input: SelectionContext): string {
  const doc = input.document;
  const fps = doc?.kind === 'timeline' ? doc.fps : 30;
  const lines = input.refs.map((raw) => {
    const ref = refSchema.parse(raw);
    let selection: string;
    switch (ref.kind) {
      case 'clip': {
        const clip = doc?.kind === 'timeline' ? doc.tracks.flatMap((t) => t.clips.map((c) => ({ clip: c, track: t }))).find((c) => c.clip.id === ref.clipId) : undefined;
        selection = clip ? `Clip ${ref.clipId}, Spur ${clip.track.id}, ${formatTimecode(clip.clip.start, fps)}–${formatTimecode(clip.clip.start + clip.clip.duration, fps)}` : `Clip ${ref.clipId}${ref.trackId ? `, Spur ${ref.trackId}` : ''}`;
        break;
      }
      case 'time': selection = `Zeit ${formatTimecode(ref.frame, fps)}, Frame ${ref.frame}`; break;
      case 'range': selection = `Bereich ${formatTimecode(ref.from, fps)}–${formatTimecode(ref.to, fps)}${ref.trackId ? `, Spur ${ref.trackId}` : ''}`; break;
      case 'asset': selection = `Asset ${ref.assetId}, ${input.assets.find((a) => a.id === ref.assetId)?.title ?? ''}`; break;
      case 'marker': selection = `Marker ${ref.markerId}`; break;
      case 'slide': selection = `Folie ${ref.slideId}`; break;
      case 'version': selection = `Version ${ref.versionNumber}`; break;
      case 'element': selection = `Element ${ref.elementId ?? ref.selector ?? ref.tag ?? ''}, Dokument ${ref.doc}${ref.slideId ? `, Folie ${ref.slideId}` : ''}${ref.page ? `, Seite ${ref.page}` : ''}${ref.text ? `, Text ${ref.text}` : ''}`; break;
      case 'region': selection = `Region ${ref.rect.x},${ref.rect.y} ${ref.rect.width}×${ref.rect.height}, Dokument ${ref.doc}${ref.frame != null ? `, Frame ${ref.frame}` : ''}${ref.slideId ? `, Folie ${ref.slideId}` : ''}${ref.page ? `, Seite ${ref.page}` : ''}`; break;
    }
    return `[${selection}, Projektversion ${input.version}]`;
  });
  return [`[Director Studio, Projekt ${input.projectId}, ${input.title}, Projektversion ${input.version}]`, ...lines].join('\n');
}

export class DirectorHostBridge {
  readonly app = new App({ name: 'AI Director Studio', version: '0.1.0' });
  readonly extensions = new OpenAIExtensions(this.app);
  private listeners = new Set<() => void>();
  private ready: Promise<void> | undefined;
  private status: HostStatus = { connected: false, modelContext: false, libraryImport: false, libraryExport: false, displayMode: 'browser', contextAttached: false, error: null };
  private launchHandlers = new Set<(data: Record<string, unknown>) => void>();
  private initialLaunch: Record<string, unknown> | null = null;
  private lastContext = '';
  private lastSelectionKey = '';
  private contextRemoved = false;
  private lastUpdateId: string | undefined;
  getStatus = (): HostStatus => this.status;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  onLaunch(handler: (data: Record<string, unknown>) => void): () => void {
    this.launchHandlers.add(handler); if (this.initialLaunch) handler(this.initialLaunch);
    return () => this.launchHandlers.delete(handler);
  }
  private updateStatus(patch: Partial<HostStatus>) { this.status = { ...this.status, ...patch }; for (const listener of this.listeners) listener(); }
  connect(): Promise<void> {
    return this.ready ??= this.connectOnce();
  }
  private async connectOnce(): Promise<void> {
    if (window.parent === window) {
      this.updateStatus({ libraryImport: !!fileHost()?.selectFiles && !!fileHost()?.getFileDownloadUrl, libraryExport: !!fileHost()?.uploadFile });
      return;
    }
    this.app.ontoolresult = (result) => {
      const data = result.structuredContent;
      if (data && typeof data === 'object') {
        this.initialLaunch = data;
        for (const handler of this.launchHandlers) handler(data);
      }
    };
    const applyHost = () => {
      const context = this.app.getHostContext();
      if (context?.theme) applyDocumentTheme(context.theme);
      if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
      const currentContext = this.extensions.modelContext?.getCurrent();
      if (this.lastUpdateId && currentContext === null) this.contextRemoved = true;
      this.updateStatus({ contextAttached: !!currentContext && !this.contextRemoved, modelContext: !!this.extensions.modelContext, displayMode: context?.displayMode ?? 'inline', libraryImport: !!fileHost()?.selectFiles && !!fileHost()?.getFileDownloadUrl, libraryExport: !!fileHost()?.uploadFile });
    };
    this.app.addEventListener('hostcontextchanged', applyHost);
    try {
      await this.app.connect();
      this.updateStatus({ connected: true, error: null });
      applyHost();
      const host = this.app.getHostContext();
      if (host?.displayMode === 'inline' && host.availableDisplayModes?.includes('fullscreen')) {
        const displayed=await this.app.requestDisplayMode({ mode: 'fullscreen' });
        this.updateStatus({displayMode:displayed.mode});
      }
    } catch (error) {
      this.updateStatus({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  async updateSelection(context: SelectionContext | null): Promise<boolean> {
    const text = context ? selectionText(context) : '';
    const selectionKey = context ? JSON.stringify({projectId:context.projectId,refs:context.refs}) : '';
    if (this.contextRemoved && selectionKey === this.lastSelectionKey) return false;
    if (text === this.lastContext && this.status.modelContext) return !this.contextRemoved;
    if (!this.extensions.modelContext) return false;
    const result = await this.extensions.modelContext.update({
      content: text ? [{ type: 'text', text }] : [],
      structuredContent: context ? { projectId: context.projectId, projectVersion: context.version, selectedRefs: context.refs } : {},
    });
    this.lastContext = text; this.lastSelectionKey = selectionKey; this.contextRemoved = false; this.lastUpdateId = result?.updateId;
    this.updateStatus({contextAttached:!!text});
    return true;
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.status.connected) throw new Error('Der native Plugin-Host ist noch nicht verbunden.');
    const result = await this.app.callServerTool({ name: 'director_ui_request', arguments: { path, method, ...(body === undefined ? {} : { body }) } });
    if (result.isError) throw new Error(result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') || 'Projektanfrage fehlgeschlagen.');
    const structured = result.structuredContent;
    if (structured && 'result' in structured) return structured.result as T;
    if (structured) return structured as T;
    const entry = result.content.find((c) => c.type === 'text');
    if (entry?.type !== 'text') throw new Error('Der Projektserver hat keine Daten zurückgegeben.');
    return JSON.parse(entry.text) as T;
  }
  async selectLibraryFiles(): Promise<File[] | null> {
    const host = fileHost();
    if (!host?.selectFiles || !host.getFileDownloadUrl) return null;
    const refs = await host.selectFiles();
    return Promise.all(refs.map(async (file) => {
      const { downloadUrl } = await host.getFileDownloadUrl!({ fileId: file.fileId });
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Datei ${file.fileName} konnte nicht geladen werden (${response.status}).`);
      return new File([await response.blob()], file.fileName, { type: file.mimeType });
    }));
  }
  async saveToLibrary(file: File): Promise<string | null> {
    const host = fileHost(); if (!host?.uploadFile) return null;
    const { fileId } = await host.uploadFile(file, { library: true });
    return fileId;
  }
  async openExternal(url: string): Promise<void> {
    const parsed = new URL(url, location.href);
    if (!['https:', 'http:', 'blob:'].includes(parsed.protocol)) throw new Error('Dieses Link-Protokoll ist nicht unterstützt.');
    if (fileHost()?.openExternal && parsed.protocol !== 'blob:') await fileHost()!.openExternal!({ href: parsed.href });
    else window.open(parsed.href, '_blank', 'noopener,noreferrer');
  }
}
