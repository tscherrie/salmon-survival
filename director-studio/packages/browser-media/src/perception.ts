import { detectBeatsFromPcm } from '../../media/src/dsp/beats.ts';
import { rmsEnvelope, syncFeature, absDiff } from '../../media/src/dsp/signal.ts';
import { estimateOffset } from '../../media/src/dsp/xcorr.ts';
import type { AvSyncResult, Roi } from '../../media/src/types.ts';
import type { DocumentOp, Timeline } from '@studio/core';
import { analyzeAudio } from './audio.ts';
import { decodeAudio } from './media.ts';
import { withFFmpeg } from './ffmpeg.ts';
import { checkAbort } from './types.ts';

/** The same spectral-flux / dynamic-programming detector as the desktop toolkit. */
export async function analyzeAudioPerception(blob: Blob, options: { signal?: AbortSignal } = {}) {
  checkAbort(options.signal);
  const waveform = await analyzeAudio(blob, options);
  const pcm = await decodeAudio(blob, 16000, options.signal);
  const mono = new Float32Array(pcm.length);
  for (let channel=0; channel<pcm.numberOfChannels; channel++) {
    const data=pcm.getChannelData(channel);
    for (let i=0; i<data.length; i++) mono[i]=mono[i]!+data[i]!/pcm.numberOfChannels;
  }
  checkAbort(options.signal);
  const beats = { ...detectBeatsFromPcm(mono, pcm.sampleRate), sections: [] as Array<{start:number;label?:string}> };
  // The desktop detector also has no semantic section classifier. Preserve an empty
  // section list rather than inventing structure from song length or an inference call.
  return { durationMs:waveform.durationMs, sampleRate:waveform.sampleRate, channels:waveform.channels,
    peaks:{peaks:waveform.peaks,durationMs:waveform.durationMs}, beats,
    rmsDb:waveform.rmsDb, samplePeakDb:waveform.samplePeakDb, loudness:waveform.loudness };
}

export function beatMarkerOps(timeline: Timeline, assetId:string, analysis: Awaited<ReturnType<typeof analyzeAudioPerception>>['beats'], offsetSec=0): DocumentOp[] {
  if (!Number.isFinite(offsetSec) || offsetSec<0) throw new Error('Marker-Versatz muss positiv sein.');
  const existing=new Set(timeline.markers.map(m=>m.id)), prefix=assetId.replace(/[^A-Za-z0-9]/g,'').slice(-6), downbeats=new Set(analysis.downbeats.map(t=>t.toFixed(3))), ops:DocumentOp[]=[];
  const add=(id:string,time:number,kind:'beat'|'downbeat'|'section',label?:string)=>{
    if (!existing.has(id)) ops.push({op:'add_marker',marker:{id,frame:Math.round((time+offsetSec)*timeline.fps),kind,...(label?{label}:{})}});
  };
  analysis.beats.forEach((t,i)=>{if(!downbeats.has(t.toFixed(3)))add(`b_${prefix}_${i}`,t,'beat');});
  analysis.downbeats.forEach((t,i)=>add(`db_${prefix}_${i}`,t,'downbeat'));
  analysis.sections.forEach((s,i)=>add(`sec_${prefix}_${i}`,s.start,'section',s.label??`Abschnitt ${i+1}`));
  return ops;
}

async function syncPcm(blob:Blob,signal?:AbortSignal):Promise<Float32Array> {
  // Preserve a track's positive start timestamp by filling from PTS zero, as the
  // original toolkit does. Browser decodeAudioData alone discards this timing.
  return withFFmpeg(async ff=>{
    await ff.writeFile('source',new Uint8Array(await blob.arrayBuffer()));
    const code=await ff.exec(['-i','source','-map','0:a:0','-vn','-ac','1','-af','aresample=16000:async=1:min_hard_comp=0.01:first_pts=0','-f','f32le','-acodec','pcm_f32le','pcm.raw']);
    if(code)throw new Error('Medium hat keine dekodierbare Audiospur.');
    const raw=await ff.readFile('pcm.raw');if(typeof raw==='string')throw new Error('Ungültige PCM-Daten.');
    const bytes=new Uint8Array(raw), view=new DataView(bytes.buffer), values=new Float32Array(Math.floor(bytes.length/4));
    for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);
    return values;
  },signal);
}

function validRoi(roi?:Roi):Roi|undefined {
  if(!roi)return;
  if(!Object.values(roi).every(Number.isFinite)||roi.x<0||roi.y<0||roi.width<=0||roi.height<=0||roi.x+roi.width>1||roi.y+roi.height>1)throw new Error('Mundregion muss innerhalb des normierten Bilds 0..1 liegen.');
  return roi;
}

async function motionEnergy(blob:Blob,rate:number,roi:Roi|undefined,signal?:AbortSignal):Promise<Float32Array> {
  return withFFmpeg(async ff=>{
    await ff.writeFile('video',new Uint8Array(await blob.arrayBuffer()));
    const crop=roi?`crop=iw*${roi.width}:ih*${roi.height}:iw*${roi.x}:ih*${roi.y},`:'';
    const filter=`fps=${rate},${crop}scale=64:64:flags=area,format=gray`;
    const code=await ff.exec(['-i','video','-map','0:v:0','-an','-vf',filter,'-f','rawvideo','-pix_fmt','gray','motion.raw']);
    if(code)throw new Error('Bewegungsenergie konnte nicht gemessen werden.');
    const raw=await ff.readFile('motion.raw');if(typeof raw==='string')throw new Error('Ungültige Bilddaten.');
    const frameSize=64*64, count=Math.floor(raw.length/frameSize), values=new Float32Array(count);
    for(let frame=1;frame<count;frame++){
      if(frame%120===0)checkAbort(signal);
      let sum=0;for(let i=0;i<frameSize;i++)sum+=Math.abs(raw[frame*frameSize+i]!-raw[(frame-1)*frameSize+i]!);
      values[frame]=sum/frameSize/255;
    }
    return values;
  },signal);
}

/** Two owned sources, identical offset sign / audio-first / ROI fallback as desktop. */
export async function checkAvSync(video:Blob, referenceAudio:Blob, options:{roi?:Roi;fps?:number;maxLagMs?:number;signal?:AbortSignal}={}):Promise<AvSyncResult & {correlation:number;roi?:Roi}> {
  const roi=validRoi(options.roi), maxLagMs=options.maxLagMs??1000;
  if(!Number.isFinite(maxLagMs)||maxLagMs<0||maxLagMs>10000)throw new Error('Ungültiger Sync-Suchbereich.');
  checkAbort(options.signal);
  const reference=await syncPcm(referenceAudio,options.signal);
  let embedded:Float32Array|undefined;
  try{embedded=await syncPcm(video,options.signal);}catch{checkAbort(options.signal);}
  let audioResult:(AvSyncResult & {correlation:number})|undefined;
  if(embedded){
    const rate=200, estimate=estimateOffset(syncFeature(rmsEnvelope(reference,16000,rate),rate),syncFeature(rmsEnvelope(embedded,16000,rate),rate),rate,maxLagMs);
    audioResult={...estimate,method:'audio',note:`Audio↔Referenz-Kreuzkorrelation (${rate} Hz); positiv bedeutet, dass die Videotonspur später ist. Korrelation ${estimate.correlation.toFixed(2)}.`};
    if(estimate.confidence>=.2)return audioResult;
  }
  const rate=Math.max(10,Math.min(60,Math.round(options.fps??25))), motion=await motionEnergy(video,rate,roi,options.signal), level=syncFeature(rmsEnvelope(reference,16000,rate),rate);
  const candidates=[estimateOffset(level,motion,rate,maxLagMs),estimateOffset(absDiff(level),motion,rate,maxLagMs)], best=candidates[0]!.confidence>=candidates[1]!.confidence?candidates[0]!:candidates[1]!;
  const result={...best,method:'motion' as const,...(roi?{roi}:{}),note:`Bewegungsenergie${roi?' in der Mundregion':''}↔Referenz-Stimmhüllkurve (${rate} Hz), Auflösung etwa ein Frame. Kein semantischer Nachweis der Lippenbewegung.`};
  return audioResult&&audioResult.confidence>=result.confidence?audioResult:result;
}
