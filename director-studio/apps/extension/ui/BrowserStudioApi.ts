import type { AppSettings, AuthStatus, StudioApi, StudioEvent, ProjectSnapshot, RecentProject, CreateProjectInput, ComposerMessage, CheckpointDecision, DirectorEffort, Modality, PickerSelection, ModelInfo, Asset, AssetQuery, LineageEdge, Version, TranscriptWord, PreviewViewport, Rect, ExportOptions } from '@studio/core';
import { mimeFromExtension, assetKindFromMime, refSchema } from '@studio/core';
import { DirectorHostBridge } from './hostBridge.ts';
import { SITE_PICKER_SCRIPT } from './sitePicker.ts';

export interface BrowserJob { id: string; kind: string; input: Record<string, unknown>; status: 'queued'|'running'|'completed'|'failed'|'canceled'; createdAt: string; updatedAt: string; error?: string; output?: Record<string,unknown>; executorId?:string; leaseUntil?:string }
type CloudSnapshot = ProjectSnapshot & { cloudRevision?: number; siteFiles?: Record<string, string>; jobs?: BrowserJob[] };
export class BrowserStudioApi implements StudioApi {
  readonly isNative = true;
  private listeners = new Set<(event: StudioEvent) => void>();
  private files = new Map<string, File>();
  private objectUrls = new Set<string>();
  private assetUrls = new Map<string, string>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private current: CloudSnapshot | null = null;
  private disposed = false;
  readonly missingAssets = new Map<string, string>();
  private bounds: Rect | null = null;
  private jobs: BrowserJob[] = [];
  private jobListeners = new Set<() => void>();
  private activeJobs = new Set<string>();
  private jobControllers = new Map<string,AbortController>();
  readonly executorId = crypto.randomUUID();
  getJobs = (): BrowserJob[] => this.jobs;
  subscribeJobs = (listener: () => void): (() => void) => { this.jobListeners.add(listener); return () => this.jobListeners.delete(listener); };
  private setJobs(jobs: BrowserJob[]) {
    for (const job of jobs) if(job.status === 'canceled') this.jobControllers.get(job.id)?.abort(new DOMException('Medienjob abgebrochen','AbortError'));
    if (JSON.stringify(jobs) === JSON.stringify(this.jobs)) return; this.jobs = jobs; for (const listener of this.jobListeners) listener(); }
  private pickMode = false;
  private webClient: import('@studio/browser-media').MediaSandboxClient | null = null;
  private webFrame: HTMLIFrameElement | null = null;
  private webPages = new Map<string,Record<string,string>>();
  private webPath = '/';
  private webRender = 0;
  onExportProgress?: (phase: string, progress: number) => void;
  saveExportsToLibrary = false;
  exportJobId:string|null = null;
  constructor(readonly host: DirectorHostBridge, readonly baseUrl = '') {
    if (typeof window !== 'undefined') window.addEventListener('message', this.previewMessage);
  }
  private previewMessage = (event: MessageEvent) => {
    // Messages are accepted only from the mounted sandbox preview frame; unrelated frames cannot inject refs.
    const frame = document.querySelector<HTMLIFrameElement>('.web-frame');
    if (!frame || event.source !== frame.contentWindow || !this.current) return;
    const data = event.data;
    if (data?.type === 'studio-navigate' && typeof data.path === 'string') { void this.previewNavigate(this.current.manifest.id,data.path).catch((error)=>this.emit({type:'preview_state',projectId:this.current!.manifest.id,url:null,status:'error',error:String(error)})); return; }
    if (!data || data.type !== 'studio-pick' || !this.pickMode) return;
    const parsed = refSchema.safeParse({ kind: 'element', doc: 'site', page: this.webPath, selector: data.selector, text: data.text, tag: data.tag, bbox: data.bbox });
    if (parsed.success) this.emit({ type: 'preview_pick', projectId: this.current.manifest.id, ref: parsed.data });
  };
  dispose() {
    this.disposed = true; this.webClient?.dispose(); if (this.pollTimer) clearTimeout(this.pollTimer);
    window.removeEventListener('message', this.previewMessage);
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (this.host.getStatus().connected) return this.host.request<T>(path, method, body);
    if (window.parent !== window) throw new Error(this.host.getStatus().error ?? 'Der Plugin-Host ist noch nicht verbunden.');
    const response = await fetch(`${this.baseUrl}${path}`, { method, credentials: 'include', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message ?? data?.error ?? `Projektserver: HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  action<T>(projectId: string, method: string, params: unknown = {}): Promise<T> {
    return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/actions`, 'POST', { method, params });
  }
  getSettings() { return this.request<AppSettings>('/api/settings'); }
  updateSettings(patch: Partial<AppSettings>) { return this.request<AppSettings>('/api/settings', 'PATCH', patch); }
  async setSecret(_name: 'anthropic' | 'fal', _value: string | null): Promise<void> { throw new Error('Director verwendet das ausgewählte Hostmodell. Fal wird über das separat installierte Fal-Plugin autorisiert.'); }
  async getAuthStatus(): Promise<AuthStatus> { return { runtimes: [], active: null, falConfigured: false, anthropic: { apiKey: false, oauthProfile: false } }; }
  listRecentProjects() { return this.request<RecentProject[]>('/api/projects'); }
  async createProject(input: CreateProjectInput) { const data = await this.request<CloudSnapshot>('/api/projects', 'POST', input); this.watch(data); return data; }
  async openProject(path: string) { const data = await this.getSnapshot(path); this.watch(data); return data; }
  async getSnapshot(projectId: string) {
    const snapshot = await this.request<CloudSnapshot>(`/api/projects/${encodeURIComponent(projectId)}`);
    if (this.host.getStatus().connected) await Promise.all(snapshot.assets.filter((asset) => asset.path && !this.assetUrls.has(`${projectId}:${asset.id}`)).map(async (asset) => {
      try {
        const parts:BlobPart[]=[]; let mime=asset.mime ?? 'application/octet-stream'; const chunkSize=262144;
        for(let offset=0; offset<Math.max(1,asset.bytes ?? 1); offset+=chunkSize){
          const data=await this.host.request<{base64:string;mime:string}>(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}?offset=${offset}&length=${chunkSize}`);
          parts.push(Uint8Array.from(atob(data.base64),(c)=>c.charCodeAt(0)));mime=data.mime;
        }
        this.cacheAssetUrl(projectId,asset.id,new Blob(parts,{type:mime}));this.missingAssets.delete(asset.id);
      } catch (error) { this.missingAssets.set(asset.id, error instanceof Error ? error.message : String(error)); }
    }));
    for (const asset of snapshot.assets) {
      const thumb = snapshot.assets.find((candidate) => candidate.path === asset.metadata?.thumbPath);
      const url = thumb && this.assetUrls.get(`${projectId}:${thumb.id}`);
      if (url) this.assetUrls.set(`${projectId}:${asset.id}:thumb`,url);
    }
    this.setJobs(snapshot.jobs ?? []);
    return snapshot;
  }
  private cacheAssetUrl(projectId: string, assetId: string, blob: Blob) {
    const key = `${projectId}:${assetId}`; const previous = this.assetUrls.get(key); if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob); this.objectUrls.add(url); this.assetUrls.set(key, url);
  }
  async chooseDirectory(): Promise<string | null> { throw new Error('Cloudprojekte werden im Projektbrowser geöffnet. Ein lokaler Ordner ist für die Extension nicht erforderlich.'); }
  registerFile(file: File): string { const id = `browser-file:${crypto.randomUUID()}`; this.files.set(id, file); return id; }
  pathForFile = (file: File): string => this.registerFile(file);
  async chooseFiles(): Promise<string[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
      input.style.display = 'none'; document.body.append(input);
      const finish = (files: File[]) => { input.remove(); resolve(files.map((file) => this.registerFile(file))); };
      input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
      input.addEventListener('cancel', () => finish([]), { once: true }); input.click();
    });
  }
  async sendMessage(_projectId: string, _message: ComposerMessage): Promise<void> { throw new Error('Bitte den nativen ChatGPT-/Codex-Composer verwenden. Die Extension sendet keine eigene Director-Nachricht.'); }
  async interrupt(_projectId: string): Promise<void> { throw new Error('Hostläufe werden über den Stop-Knopf des nativen Chats unterbrochen. Gespeicherte Medienjobs können separat abgebrochen werden.'); }
  answerQuestion(projectId: string, questionId: string, answers: Record<string, string>) { return this.action<void>(projectId, 'answerQuestion', { questionId, answers }); }
  decideCheckpoint(projectId: string, checkpointId: string, decision: CheckpointDecision) { return this.action<void>(projectId, 'decideCheckpoint', { checkpointId, decision }); }
  decideApproval(projectId: string, approvalId: string, approved: boolean) { return this.action<void>(projectId, 'decideApproval', { approvalId, approved }); }
  async setEffort(_projectId: string, _effort: DirectorEffort): Promise<void> { throw new Error('Modell und Denkaufwand werden im nativen Host eingestellt.'); }
  listModels(modality?: Modality) { return this.request<ModelInfo[]>(`/api/models${modality ? `?modality=${encodeURIComponent(modality)}` : ''}`); }
  async refreshModels() { const models = await this.listModels(); return { count: models.length, updatedAt: new Date().toISOString() }; }
  setPicker(projectId: string, modality: Modality, selection: PickerSelection) { return this.action<void>(projectId, 'setPicker', { modality, selection }); }
  async uploadFile(projectId: string, file: File, metadata: Record<string, unknown> = {}): Promise<Asset> {
    const { probeMedia, frames } = await import('@studio/browser-media');
    const mime = file.type || mimeFromExtension(file.name);
    const probe = /^(image|video|audio)\//.test(mime) ? await probeMedia(file).catch(() => ({})) : {};
    const meta = { ...probe, title: file.name, mime, source: 'imported', kind: assetKindFromMime(mime), ...metadata };
    let asset: Asset;
    if (this.host.getStatus().connected) {
      // Own-server RPC preserves authenticated MCP identity; no credential is placed in the iframe.
      const chunkSize=262144;
      const base64=(bytes:Uint8Array)=>{let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);};
      if(file.size > chunkSize){
        const base=`/api/projects/${encodeURIComponent(projectId)}/assets-upload`;
        const started=await this.request<{uploadId:string}>(`${base}/begin`,'POST',{name:file.name,mime,bytes:file.size,metadata:meta});
        for(let offset=0;offset<file.size;offset+=chunkSize){const bytes=new Uint8Array(await file.slice(offset,offset+chunkSize).arrayBuffer());await this.request(`${base}/${encodeURIComponent(started.uploadId)}/chunk`,'POST',{offset,base64:base64(bytes)});}
        asset=await this.request<Asset>(`${base}/${encodeURIComponent(started.uploadId)}/complete`,'POST',{});
      }else{
        asset=await this.request<Asset>(`/api/projects/${encodeURIComponent(projectId)}/assets-json`,'POST',{name:file.name,mime,base64:base64(new Uint8Array(await file.arrayBuffer())),metadata:meta});
      }
    } else {
      const body = new FormData(); body.append('file', file); body.append('metadata', JSON.stringify(meta));
      const response = await fetch(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/assets`, { method: 'POST', body, credentials: 'include' });
      if (!response.ok) throw new Error(`Import fehlgeschlagen (${response.status}).`); asset = await response.json() as Asset;
    }
    if (this.host.getStatus().connected) this.cacheAssetUrl(projectId, asset.id, file);
    if (meta.source === 'imported' && asset.kind === 'video') {
      const thumbnail = (await frames(file,{times:[Math.min(1,(asset.durationMs ?? 1000)/2000)],width:320}))[0];
      if (thumbnail) {
        const derived = await this.uploadFile(projectId,new File([thumbnail.blob],`${file.name}.thumbnail.png`,{type:'image/png'}),{source:'derived',subtype:'thumbnail',parents:[{assetId:asset.id,relation:'derived'}],metadata:{sourceAssetId:asset.id}});
        await this.action(projectId,'updateAsset',{assetId:derived.id,patch:{status:'archived'}});
        asset = await this.action<Asset>(projectId,'updateAsset',{assetId:asset.id,patch:{metadata:{thumbPath:derived.path}}});
        const thumbUrl = this.assetUrls.get(`${projectId}:${derived.id}`);
        if (thumbUrl) this.assetUrls.set(`${projectId}:${asset.id}:thumb`,thumbUrl);
      }
    }
    this.emit({ type: 'asset', projectId, asset });
    if (meta.source === 'imported' && (asset.kind === 'audio' || asset.kind === 'video')) await this.action(projectId,'createJob',{kind:'analyze_audio',input:{assetId:asset.id}});
    return asset;
  }
  async importFiles(projectId: string, paths: string[], _mode: 'link' | 'import'): Promise<Asset[]> {
    const imported: Asset[] = [];
    for (const token of paths) {
      const file = this.files.get(token); if (!file) throw new Error('Die ausgewählte Datei ist nicht mehr verfügbar. Bitte erneut auswählen.');
      imported.push(await this.uploadFile(projectId, file)); this.files.delete(token);
    }
    return imported;
  }
  async importLibraryFiles(projectId: string): Promise<Asset[]> {
    const files = await this.host.selectLibraryFiles();
    if (files === null) throw new Error('Die native Dateibibliothek wird von diesem Host nicht angeboten. Bitte Dateiimport verwenden.');
    return this.importFiles(projectId, files.map((file) => this.registerFile(file)), 'import');
  }
  searchAssets(projectId: string, query: AssetQuery) { return this.action<Asset[]>(projectId, 'searchAssets', { query }); }
  assetUrl(projectId: string, assetId: string, variant: 'original' | 'proxy' | 'thumb' = 'original') { return this.assetUrls.get(`${projectId}:${assetId}:${variant}`) ?? this.assetUrls.get(`${projectId}:${assetId}`) ?? `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}?variant=${variant}`; }
  async revealAsset(projectId: string, assetId: string) { await this.openExternal(this.assetUrl(projectId, assetId)); }
  getLineage(projectId: string, assetId: string) { return this.action<{ parents: LineageEdge[]; children: LineageEdge[] }>(projectId, 'getLineage', { assetId }); }
  async relinkAsset(projectId: string, assetId: string, newPath: string) {
    const file = this.files.get(newPath); if (!file) throw new Error('Bitte die Ersatzdatei erneut auswählen.');
    // Upload replacement through the same authenticated route; backend preserves asset ID and document uses.
    const replacement = await this.uploadFile(projectId, file, { replaceAssetId: assetId }); this.files.delete(newPath); return replacement;
  }
  getVersion(projectId: string, number: number) { return this.action<Version>(projectId, 'getVersion', { number }); }
  restoreVersion(projectId: string, number: number) { return this.action<void>(projectId, 'restoreVersion', { number }); }
  async transcribe(projectId: string, audio: ArrayBuffer, mime: string): Promise<{ text: string; words: TranscriptWord[] }> {
    const asset = await this.uploadFile(projectId, new File([audio], 'transcription-input.webm', { type: mime }));
    await this.action(projectId, 'requestTranscription', { assetId: asset.id });
    throw new Error('Audio gespeichert. Bitte im nativen Chat die Transkription über das Fal-Plugin anfordern; Modell, Kostenvorschlag und Freigabe werden im Projektjournal erfasst.');
  }
  assetPeaks(projectId: string, assetId: string) { return this.action<{ peaks: number[]; durationMs: number } | null>(projectId, 'assetPeaks', { assetId }); }
  async previewOpen(projectId: string, _options: { viewport: PreviewViewport }) {
    const snapshot = await this.getSnapshot(projectId);
    if(snapshot.document?.kind !== 'site') throw new Error('Dieses Projekt besitzt keine Website.');
    this.emit({type:'preview_state',projectId,url:null,status:'starting'});
    try {
      const {buildSitePreviews}=await import('@studio/browser-media');
      const assets=Object.fromEntries(snapshot.assets.map((asset)=>[asset.id,{...asset,url:this.assetUrl(projectId,asset.id)}]));
      if(!this.webPages.has(projectId))this.webPath='/';
      this.webPages.set(projectId,await buildSitePreviews(snapshot.siteFiles ?? {},snapshot.document.framework,assets));
      void this.renderSitePage(projectId,this.webPath).catch((error)=>this.emit({type:'preview_state',projectId,url:null,status:'error',error:String(error)}));
      return {url:new URL('/media-sandbox.html',window.document.baseURI).href};
    }catch(error){this.emit({type:'preview_state',projectId,url:null,status:'error',error:error instanceof Error ? error.message:String(error)});throw error;}
  }
  private async renderSitePage(projectId:string,path:string) {
    const render = ++this.webRender;
    const parsed = new URL(path,'https://director.invalid');
    if(parsed.origin !== 'https://director.invalid')throw new Error('Nur lokale Projektseiten können in der Vorschau geöffnet werden.');
    const pagePath = parsed.pathname;
    const pages = this.webPages.get(projectId);
    const html = pages?.[pagePath] ?? pages?.[`${pagePath.replace(/\/$/,'')}/`] ?? pages?.['/'];
    if(!html)throw new Error(`Vorschauseite ${pagePath} fehlt.`);
    const frame = await new Promise<HTMLIFrameElement>((resolve,reject)=>{
      const current=document.querySelector<HTMLIFrameElement>('.web-frame');if(current){resolve(current);return;}
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Website-Vorschau konnte nicht geöffnet werden.'));},15000);
      const observer=new MutationObserver(()=>{const frame=document.querySelector<HTMLIFrameElement>('.web-frame');if(frame){clearTimeout(timer);observer.disconnect();resolve(frame);}});observer.observe(document.body,{subtree:true,childList:true});
    });
    if(render !== this.webRender || this.disposed)return;
    if(frame !== this.webFrame || !this.webClient) {
      this.webClient?.dispose();const {MediaSandboxClient}=await import('@studio/browser-media');
      this.webFrame=frame;this.webClient=new MediaSandboxClient(frame);frame.src=new URL('/media-sandbox.html',window.document.baseURI).href;
    }
    this.webPath=pagePath;
    const preview = html.replace(/<\/body>/i,`${SITE_PICKER_SCRIPT}</body>`);
    await this.webClient.request('website-preview',{html:preview,path:pagePath});
    frame.contentWindow?.postMessage({type:'studio-pick-mode',enabled:this.pickMode},'*');
    this.emit({type:'preview_state',projectId,url:new URL('/media-sandbox.html',window.document.baseURI).href,status:'ready'});
  }
  async previewSetBounds(_projectId: string, bounds: Rect | null) { this.bounds = bounds; }
  async previewSetPickMode(_projectId: string, enabled: boolean) { this.pickMode = enabled; this.webFrame?.contentWindow?.postMessage({type:'studio-pick-mode',enabled},'*'); }
  async previewOpenExternal(projectId: string) { const pages=this.webPages.get(projectId);const html=pages?.[this.webPath]??pages?.['/'];if(!html)throw new Error('Website-Vorschau zuerst öffnen.');const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));this.objectUrls.add(url);await this.openExternal(url); }
  async previewNavigate(projectId: string, path: string) { await this.renderSitePage(projectId,path); }
  async exportProject(projectId: string, options: ExportOptions): Promise<{ path: string }> {
    const snapshot = await this.getSnapshot(projectId);
    const job = await this.action<BrowserJob>(projectId, 'createJob', { kind: 'export_project', input: { target: options.target, format: options.format, projectVersion: snapshot.versions.at(-1)?.number } });
    this.exportJobId=job.id;
    let output:Record<string,unknown>|null;
    try { output = await this.runMediaJob(projectId, job, true); } finally { this.exportJobId=null; }
    const delivery = (output?.deliveries as Array<{kind:string;filename:string;fileId?:string}> | undefined)?.[0];
    return { path: delivery?.kind === 'library' ? `Library: ${delivery.filename} (${delivery.fileId})` : delivery ? `Download gestartet: ${delivery.filename}` : String(output?.filename ?? output?.assetIds ?? job.id) };
  }
  async runMediaJob(projectId: string, job: BrowserJob, download = false): Promise<Record<string,unknown> | null> {
    if (this.activeJobs.has(job.id)) return null;
    this.activeJobs.add(job.id);
    const claim = await this.action<{claimed:boolean;job:BrowserJob}>(projectId, 'claimJob', { jobId: job.id, executorId: this.executorId, leaseMs: 60000 }).catch((error) => { this.activeJobs.delete(job.id); throw error; });
    if (!claim.claimed) { this.activeJobs.delete(job.id); throw new Error('Dieser Medienjob wird bereits in einem anderen Editor ausgeführt.'); }
    this.activeJobs.add(job.id);
    const controller = new AbortController(); this.jobControllers.set(job.id,controller); const signal = controller.signal;
    const heartbeat = setInterval(() => { void this.action<{claimed:boolean}>(projectId, 'claimJob', {jobId:job.id,executorId:this.executorId,leaseMs:60000}).then((claim)=>{if(!claim.claimed)controller.abort(new DOMException('Medienjob beendet oder Lease verloren','AbortError'));}).catch(() => undefined); }, 20000);
    try {
      const snapshot = await this.getSnapshot(projectId); signal.throwIfAborted();
      const version = Number(job.input.projectVersion ?? snapshot.versions.at(-1)?.number);
      const selectedVersion = version && version !== snapshot.versions.at(-1)?.number ? await this.getVersion(projectId,version) as Version & {siteFiles?:Record<string,string>} : null;
      const document = selectedVersion?.document ?? snapshot.document;
      const siteFiles = selectedVersion?.document.kind === 'site' ? selectedVersion.siteFiles : snapshot.siteFiles;
      if (document?.kind === 'site' && !siteFiles) throw new Error(`Website-Dateisnapshot für v${version} fehlt.`);
      if (!document) throw new Error('Das Projekt besitzt noch kein Dokument.');
      const media = await import('@studio/browser-media');
      const assets = Object.fromEntries(snapshot.assets.map((asset) => [asset.id, { ...asset, url: this.assetUrl(projectId,asset.id) }]));
      const components: Record<string,string> = {};
      if (document.kind === 'timeline') for (const [componentId,component] of Object.entries(document.components)) {
        // A historical component is the immutable asset pinned by this document version.
        const response = await fetch(this.assetUrl(projectId,component.assetId,'original'),{credentials:'include',signal});
        if(!response.ok)throw new Error(`Komponente ${componentId}: Datei ${component.assetId} fehlt (${response.status}).`);
        components[componentId] = await response.text();
      }
      const words = document.kind === 'timeline' ? media.wordsForTimeline(document,snapshot.assets) : [];
      const result = await media.executeMediaJob(job, { document, assets, components, words, siteFiles, signal, onProgress: this.onExportProgress });
      const input={...job.input,...(job.input.params && typeof job.input.params === 'object' ? job.input.params as Record<string,unknown> : {})};
      const sourceIds = [...new Set([input.assetId,input.videoAssetId,input.referenceAudioAssetId].filter((value):value is string=>typeof value==='string'))];
      const parents = (sourceIds.length ? sourceIds : (job.kind==='export_project'||job.kind==='render_still') ? media.usedAssets(document) : []).map(assetId=>({assetId,relation:job.kind==='frames'?'extracted':'derived'}));
      const outputMetadata=Object.fromEntries(Object.entries(result.result as Record<string,unknown>).filter(([key])=>['fromSec','toSec','handles','start','end','assetId','beatCount','bpm','method','warnings'].includes(key)));
      const assetIds: string[] = [];
      const deliveries: Array<{kind:'library'|'browser-download-started';filename:string;fileId?:string}> = [];
      for (const file of result.files) {
        signal.throwIfAborted();
        const uploaded = await this.uploadFile(projectId,new File([file.blob],file.filename,{type:file.blob.type}),{source:'derived',subtype:job.kind,parents,metadata:{jobId:job.id,projectVersion:version,...outputMetadata}});
        assetIds.push(uploaded.id); signal.throwIfAborted();
        if (download) {
          if (this.saveExportsToLibrary) {
            const fileId = await this.host.saveToLibrary(new File([file.blob],file.filename,{type:file.blob.type}));
            if (!fileId) throw new Error('Export im Projekt gespeichert. Die native Library ist hier nicht verfügbar; Download verwenden.');
            deliveries.push({kind:'library',filename:file.filename,fileId});
          } else {
            const url=URL.createObjectURL(file.blob); this.objectUrls.add(url); const anchor=documentGlobal().createElement('a'); anchor.href=url; anchor.download=file.filename; anchor.click();
            deliveries.push({kind:'browser-download-started',filename:file.filename});
          }
        }
      }
      const output = { ...result.result as Record<string,unknown>, assetIds, ...(deliveries.length ? {deliveries} : {}), ...(result.files[0] ? {filename:result.files[0].filename} : {}) };
      if (typeof job.input.assetId === 'string' && job.kind === 'analyze_audio') {
        const analysis = result.result as {peaks?:unknown;beats?:unknown;loudness?:unknown};
        for (const kind of ['peaks','beats','loudness'] as const) if (analysis[kind]) await this.action(projectId,'recordAnalysis',{assetId:job.input.assetId,kind,result:analysis[kind]});
      }
      const markerOps=(result.result as {markerOps?:Array<{op:string;marker?:{id:string}}>}).markerOps;
      if(markerOps?.length) {
        const latest=await this.getSnapshot(projectId);signal.throwIfAborted();
        const existing=new Set(latest.document?.kind==='timeline'?latest.document.markers.map((marker)=>marker.id):[]);
        const pending=markerOps.filter((op)=>op.op!=='add_marker'||!op.marker||!existing.has(op.marker.id));
        if(pending.length) {
          const head=latest.versions.at(-1)?.number;
          if(head!==version)throw new Error(`Beat-Marker wurden nicht angewendet: Job basiert auf v${version}, aktueller Stand ist v${head}.`);
          await this.action(projectId,'applyDocumentOps',{expectedHead:head,note:`Beat-Marker aus Medienjob ${job.id}`,ops:pending});
        }
      }
      signal.throwIfAborted();
      await this.action(projectId,'updateJob',{jobId:job.id,executorId:this.executorId,patch:{status:'completed',output}});
      this.setJobs((await this.getSnapshot(projectId)).jobs ?? []); return output;
    } catch(error) {
      await this.action(projectId,'updateJob',{jobId:job.id,executorId:this.executorId,patch:{status:signal.aborted?'canceled':'failed',error:error instanceof Error ? error.message : String(error)}}).catch(() => undefined);
      throw error;
    } finally { clearInterval(heartbeat); this.activeJobs.delete(job.id); this.jobControllers.delete(job.id); }
  }
  async cancelMediaJob(projectId:string,jobId:string) {
    await this.action(projectId,'cancelJob',{jobId});
    this.jobControllers.get(jobId)?.abort(new DOMException('Medienjob abgebrochen','AbortError'));
    this.setJobs((await this.getSnapshot(projectId)).jobs ?? []);
  }
  async retryMediaJob(projectId:string, jobId:string) {
    const old=this.jobs.find((job)=>job.id===jobId);if(!old)throw new Error('Medienjob nicht gefunden.');
    const job=await this.action<BrowserJob>(projectId,'retryJob',{jobId:old.id});
    return this.runMediaJob(projectId,job,job.kind==='export_project');
  }
  async resumeMediaJob(projectId: string, jobId: string) {
    const job = this.jobs.find((job) => job.id === jobId); if(!job) throw new Error('Medienjob nicht gefunden.');
    return this.runMediaJob(projectId,job,job.kind === 'export_project');
  }
  openExternal(url: string) { return this.host.openExternal(url); }
  onEvent(listener: (event: StudioEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: StudioEvent) { for (const listener of this.listeners) listener(event); }
  private watch(snapshot: CloudSnapshot) { this.current = snapshot; this.setJobs(snapshot.jobs ?? []); if (!this.pollTimer) this.pollTimer = setTimeout(() => void this.poll(), 1500); }
  private async poll() {
    this.pollTimer = null;
    if (this.disposed || !this.current) return;
    const old = this.current;
    try {
      const next = await this.getSnapshot(old.manifest.id);
      if (this.current?.manifest.id === old.manifest.id && JSON.stringify(next) !== JSON.stringify(old)) {
        this.current = next; const projectId = next.manifest.id;
        this.emit({ type: 'manifest', projectId, manifest: next.manifest });
        this.emit({ type: 'checkpoints', projectId, checkpoints: next.checkpoints });
        this.emit({ type: 'budget', projectId, summary: next.budget });
        for (const asset of next.assets) this.emit({ type: 'asset', projectId, asset });
        for (const generation of next.generations) this.emit({ type: 'generation', projectId, generation });
        const version = next.versions.at(-1); if (version && version.number !== old.versions.at(-1)?.number) this.emit({ type: 'document', projectId, version });
        if (next.pendingQuestion) this.emit({ type: 'question', projectId, runId: next.pendingQuestion.runId ?? 'host', ...next.pendingQuestion });
        else if (old.pendingQuestion) this.emit({ type: 'question_resolved', projectId, questionId: old.pendingQuestion.questionId });
        for (const request of next.pendingApprovals) this.emit({ type: 'approval', projectId, request });
        for (const request of old.pendingApprovals) if (!next.pendingApprovals.some((a) => a.id === request.id)) this.emit({ type: 'approval_resolved', projectId, approvalId: request.id, approved: false });
      }
    } catch (error) {
      this.emit({ type: 'progress', projectId: old.manifest.id, runId: 'cloud-sync', text: `Projektverbindung: ${error instanceof Error ? error.message : String(error)}` });
    }
    for (const job of (this.activeJobs.size ? [] : this.jobs.filter((job) => job.status === 'queued').slice(0,1))) {
      if (!this.activeJobs.has(job.id)) void this.runMediaJob(old.manifest.id,job).catch((error) => this.emit({type:'progress',projectId:old.manifest.id,runId:job.id,text:error instanceof Error ? error.message : String(error)}));
    }
    if (!this.disposed) this.pollTimer = setTimeout(() => void this.poll(), 2000);
  }
}

// Keeps the document model name separate from the browser document in export execution.
function documentGlobal(): Document { return window.document; }
