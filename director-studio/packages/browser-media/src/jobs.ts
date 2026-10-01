import type { ExportRequest } from './types.ts';
import { exportProject } from './export.ts';
import { fetchAsset, blobToDataUrl } from './assets.ts';
import { frames, contactSheet, cutAudio, probeMedia, canvasBlob } from './media.ts';
import { analyzeAudioPerception, beatMarkerOps, checkAvSync } from './perception.ts';
import { checkAbort } from './types.ts';
import { buildSitePreview, inlineSiteAssets } from './compiler.ts';
import { assertComponentSandbox } from './timeline.tsx';
import { MediaSandboxClient } from './sandbox-client.tsx';
import { loadMediaSandbox } from './runtime.ts';
import { renderOpaqueSiteHtml } from './documents.ts';

type MediaJob = { kind: string; input: Record<string, unknown> };
export type MediaJobContext = Omit<ExportRequest, 'format'>;
export interface MediaJobOutput { files: Array<{ filename: string; blob: Blob }>; result: unknown }
export async function renderSiteScreenshot(files: Record<string, string | Uint8Array>, options: { width?: number; height?: number; framework?: 'html' | 'vite-react'; signal?: AbortSignal } = {}): Promise<Blob> {
  assertComponentSandbox(); const width = options.width ?? 1440, height = options.height ?? 900;
  const html = await buildSitePreview(files, options.framework);
  return renderOpaqueSiteHtml(html, { width, height, signal: options.signal });
}
export async function executeMediaJob(job: MediaJob, context: MediaJobContext): Promise<MediaJobOutput> {
  checkAbort(context.signal);
  const input = (job.input.params && typeof job.input.params === 'object' ? { ...job.input, ...job.input.params as Record<string, unknown> } : job.input), files: MediaJobOutput['files'] = [];
  if (job.kind === 'frames' && input.source === 'timeline') {
    if (context.document.kind !== 'timeline') throw new Error('Timeline fehlt.');
    const times=Array.isArray(input.timesSec)?input.timesSec.map(Number):Array.isArray(input.times)?input.times.map(Number):[Number(input.time??0)];
    if(!times.length||times.some(t=>!Number.isFinite(t)||t<0))throw new Error('Ungültige Framezeiten.');
    for(const [i,time]of times.entries()) { checkAbort(context.signal); const output=await exportProject({...context,format:'png',options:{...context.options,frame:Math.round(time*context.document.fps),formatId:typeof input.formatId==='string'?input.formatId:context.options?.formatId}}); files.push({filename:`timeline-frame-${i+1}-${time.toFixed(3)}s.png`,blob:output.blob}); }
    return {files,result:{source:'timeline',timesSec:times}};
  }
  if(job.kind==='check_av_sync') {
    const videoId=String(input.videoAssetId??input.assetId??''), referenceId=String(input.referenceAudioAssetId??'');
    const video=context.assets[videoId], reference=context.assets[referenceId];
    if(!video||!reference)throw new Error('Video und das exakte Referenz-Audiosegment müssen im Projekt vorhanden sein.');
    const [v,a]=await Promise.all([fetchAsset(video,context.signal),fetchAsset(reference,context.signal)]);
    const result=await checkAvSync(v,a,{fps:video.fps,maxLagMs:input.maxLagMs===undefined?undefined:Number(input.maxLagMs),roi:input.roi as {x:number;y:number;width:number;height:number}|undefined,signal:context.signal});
    return {files:[],result:{...result,videoAssetId:videoId,referenceAudioAssetId:referenceId}};
  }
  if (job.kind === 'export_project' || job.kind === 'render_still') { const format = String(input.target ?? (job.kind === 'render_still' ? 'png' : input.format ?? 'mp4')); const output = await exportProject({ ...context, format, options: { ...context.options, formatId: typeof input.format === 'string' && input.target ? input.format : context.options?.formatId, frame: Number(input.frame ?? input.time ?? 0) } }); return { files: [{ filename: output.filename, blob: output.blob }], result: { filename: output.filename, warnings: output.warnings, bytes: output.blob.size, mime: output.mimeType } }; }
  if (job.kind === 'screenshot_site') {
    if (!context.siteFiles) throw new Error('Website-Dateisnapshot fehlt'); const request = { files: await inlineSiteAssets(context.siteFiles, context.assets), options: { width: Number(input.width ?? 1440), height: Number(input.height ?? 900), framework: context.document.kind === 'site' ? context.document.framework : 'html' } };
    let blob: Blob; try { assertComponentSandbox(); blob = await renderSiteScreenshot(request.files, request.options as { width: number; height: number; framework: 'html' | 'vite-react' }); }
    catch (error) { if ((error as Error).name !== 'BrowserCapabilityError') throw error; const iframe = document.createElement('iframe'); iframe.sandbox.add('allow-scripts'); iframe.style.cssText = `position:fixed;left:0;top:0;width:${request.options.width}px;height:${request.options.height}px;opacity:.001;pointer-events:none;border:0`;  const client = new MediaSandboxClient(iframe); try { await loadMediaSandbox(iframe, undefined, context.signal); document.body.append(iframe); blob = await client.request<Blob>('site-screenshot', request,undefined,context.signal); } finally { client.dispose(); iframe.remove(); } }
    return { files: [{ filename: 'website.png', blob }], result: { width: request.options.width, height: request.options.height } };
  }
  if (job.kind === 'extract_rotoscope') return {files:[],result:{status:'handoff_required',hostAction:'Mit dem nativen Fal-Plugin Live-Schema und Preis ermitteln, Freigabe einholen, Maske/Pose/Tiefe/Konturen erzeugen und den tatsächlichen Beleg importieren. Es wurde keine Maske erzeugt.'}};
  const assetId = String(input.assetId ?? input.asset ?? ''), asset = context.assets[assetId]; if (!asset) throw new Error(`Asset ${assetId} fehlt`); const blob = await fetchAsset(asset,context.signal);
  if (job.kind === 'frames') {
    const times = Array.isArray(input.timesSec)?input.timesSec.map(Number):Array.isArray(input.times) ? input.times.map(Number) : [Number(input.time ?? 0)];
    let extracted:Array<{time:number;blob:Blob}>;
    if(asset.kind==='image') { const bitmap=await createImageBitmap(blob), canvas=document.createElement('canvas'); canvas.width=Math.min(Number(input.width??640),bitmap.width);canvas.height=Math.round(canvas.width*bitmap.height/bitmap.width);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const still=await canvasBlob(canvas);extracted=times.map(time=>({time,blob:still})); }
    else extracted=await frames(blob, { times, width: Number(input.width ?? 640),signal:context.signal });
    for (const [i, f] of extracted.entries()) files.push({ filename: `frame-${i + 1}-${f.time.toFixed(3)}s.png`, blob: f.blob }); return { files, result: { timesSec: extracted.map((f) => f.time),sourceAssetId:assetId } };
  }
  if (job.kind === 'contact_sheet') return { files: [{ filename: 'contact-sheet.png', blob: await contactSheet(blob, { count: Number(input.count ?? 12), columns: Number(input.columns ?? 4), tileWidth: Number(input.width ?? 240),signal:context.signal }) }], result: { sourceAssetId:assetId } };
  if (job.kind === 'analyze_audio') { const a=await analyzeAudioPerception(blob,{signal:context.signal});if(input.writeMarkers&&context.document.kind!=='timeline')throw new Error('Marker benötigen eine Timeline.');return {files:[{filename:'beat-map.json',blob:new Blob([JSON.stringify({sourceAssetId:assetId,...a.beats},null,2)],{type:'application/json'})}],result:{...a,sourceAssetId:assetId,...(input.writeMarkers&&context.document.kind==='timeline'?{markerOps:beatMarkerOps(context.document,assetId,a.beats,Number(input.offsetSec??0))}:{})}}; }
  if (job.kind === 'cut_audio') {
    const probe=await probeMedia(blob,context.signal), duration=(probe.durationMs??0)/1000, handles=Number(input.handlesSec??.25), from=Number(input.fromSec??input.start??input.from??0), to=Number(input.toSec??input.end??input.to??1);
    if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(handles)||handles<0||handles>5||to<=from)throw new Error('Ungültiger Audioabschnitt.');
    const start=Math.max(0,Math.min(duration,from)-handles), end=Math.min(duration,Math.min(duration,to)+handles);
    return { files: [{ filename: 'audio-cut.wav', blob: await cutAudio(blob, { start, end,signal:context.signal }) }], result: { sourceAssetId:assetId,fromSec:start,toSec:end,handlesSec:handles,contentStartSec:Math.max(0,from)-start } };
  }
  throw new Error(`Browserjob ${job.kind} unbekannt`);
}
