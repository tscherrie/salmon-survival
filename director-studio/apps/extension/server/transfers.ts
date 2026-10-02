import { sha256 as incrementalSha256 } from '@noble/hashes/sha256';
import { assetKindFromMime, assetSchema, type Asset } from '@studio/core';
import { z } from 'zod';
import { ApiError, id, sha256, type CloudStore, type WorkerEnv } from './storage.ts';
export interface PersistentUpload {
 id: string; name: string; mime: string; bytes: number; received: number; metadata: Record<string,unknown>;
 createdAt: string; expiresAt: string; chunks: Array<{key:string;offset:number;bytes:number;hash:string}>;
 assetId?: string; completingUntil?: string;
}
const PART_SIZE=5*1024*1024;
function find(uploads: PersistentUpload[],uploadId:string) { const upload=uploads.find(u=>u.id===uploadId);if(!upload)throw new ApiError(404,'UPLOAD_NOT_FOUND','Upload not found.');if(upload.expiresAt<new Date().toISOString())throw new ApiError(410,'UPLOAD_EXPIRED','Upload expired. Start a new upload.');return upload; }
export async function beginUpload(store:CloudStore,env:WorkerEnv,projectId:string,value:unknown) {
 const data=z.object({name:z.string().min(1).max(300),mime:z.string().min(1),bytes:z.number().int().nonnegative().max(Number(env.MAX_IMPORT_BYTES??134217728)),metadata:z.record(z.string(),z.unknown()).default({})}).parse(value);
 const provenance=data.metadata.metadata as Record<string,unknown>|undefined;if(provenance&&('fal' in provenance||'musicProvider' in provenance))throw new ApiError(400,'PROTECTED_ASSET_FIELD','Provider provenance requires its dedicated recording tool.');
 const loaded=await store.load(projectId);const createdAt=new Date().toISOString();const upload:PersistentUpload={...data,id:id('upload'),received:0,chunks:[],createdAt,expiresAt:new Date(Date.now()+24*3600*1000).toISOString()};
 loaded.state.uploads??=[];loaded.state.uploads.push(upload);await store.save(projectId,loaded.state,loaded.revision);return {uploadId:upload.id,offset:0,chunkBytes:262144};
}
export async function uploadChunk(store:CloudStore,env:WorkerEnv,projectId:string,uploadId:string,value:unknown) {
 const input=z.object({offset:z.number().int().nonnegative(),base64:z.string().max(349528)}).parse(value);const loaded=await store.load(projectId);const upload=find(loaded.state.uploads??[],uploadId);
 if(upload.assetId)return {uploadId,offset:upload.received,complete:true};if(upload.completingUntil&&upload.completingUntil>new Date().toISOString())throw new ApiError(409,'UPLOAD_COMPLETING','Upload is being finalized.');
 const bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>262144)throw new ApiError(400,'CHUNK_INVALID','A chunk must contain 1..262144 bytes.');const hash=await sha256(bytes);
 const prior=upload.chunks.find(c=>c.offset===input.offset);if(prior){if(prior.hash!==hash)throw new ApiError(409,'CHUNK_CONFLICT','Different bytes were supplied for this chunk.');return {uploadId,offset:upload.received};}
 if(input.offset!==upload.received||input.offset+bytes.length>upload.bytes)throw new ApiError(409,'CHUNK_OFFSET','Chunk offset differs from the persisted upload.');
 const key=`temporary/${await sha256(new TextEncoder().encode(store.owner.id))}/${projectId}/${uploadId}/${input.offset}`;await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 upload.chunks.push({key,offset:input.offset,bytes:bytes.length,hash});upload.received+=bytes.length;await store.save(projectId,loaded.state,loaded.revision);return {uploadId,offset:upload.received};
}
export async function completeUpload(store:CloudStore,env:WorkerEnv,projectId:string,uploadId:string):Promise<Asset> {
 let loaded=await store.load(projectId);let upload=find(loaded.state.uploads??[],uploadId);if(upload.assetId){const a=loaded.state.assets.find(a=>a.id===upload.assetId);if(a)return a;}
 if(upload.received!==upload.bytes)throw new ApiError(409,'UPLOAD_INCOMPLETE','Upload has missing chunks.');if(upload.completingUntil&&upload.completingUntil>new Date().toISOString())throw new ApiError(409,'UPLOAD_COMPLETING','Another editor is finalizing this upload.');
 upload.completingUntil=new Date(Date.now()+300000).toISOString();await store.save(projectId,loaded.state,loaded.revision);
 const key=`${await sha256(new TextEncoder().encode(store.owner.id))}/${projectId}/uploads/${uploadId}`;const hash=incrementalSha256.create();
 const multipart=env.MEDIA.createMultipartUpload&&upload.bytes>0?await env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:upload.mime}}):null;
 const parts:Array<{partNumber:number;etag:string}>=[];let buffers:Uint8Array[]=[];let bufferLength=0;let total=0;
 const flush=async()=>{const bytes=new Uint8Array(bufferLength);let offset=0;for(const b of buffers){bytes.set(b,offset);offset+=b.length;}if(multipart)parts.push(await multipart.uploadPart(parts.length+1,bytes));else await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:upload.mime}});buffers=[];bufferLength=0;};
 try {
  for(const chunk of upload.chunks){const object=await env.MEDIA.get(chunk.key);if(!object)throw new ApiError(409,'CHUNK_MISSING','Upload chunk is missing; start a new upload.');const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(await sha256(bytes)!==chunk.hash)throw new ApiError(409,'CHUNK_CORRUPT','Upload chunk checksum failed.');hash.update(bytes);total+=bytes.length;buffers.push(bytes);bufferLength+=bytes.length;
   // Native R2 multipart uses >=5MiB parts except the final part. Buffers remain bounded.
   if(multipart&&bufferLength>=PART_SIZE)await flush();if(!multipart&&bufferLength>PART_SIZE)throw new ApiError(503,'MULTIPART_UNAVAILABLE','This storage binding does not support multipart uploads larger than 5 MiB.');
  }
  if(bufferLength||total===0)await flush();if(multipart)await multipart.complete(parts);
 } catch(error){if(multipart)await multipart.abort().catch(()=>undefined);loaded=await store.load(projectId);upload=find(loaded.state.uploads??[],uploadId);delete upload.completingUntil;await store.save(projectId,loaded.state,loaded.revision).catch(()=>undefined);throw error;}
 const digest=[...hash.digest()].map(v=>v.toString(16).padStart(2,'0')).join('');loaded=await store.load(projectId);upload=find(loaded.state.uploads??[],uploadId);
 const existing=loaded.state.assets.find(a=>a.sha256===digest);const replacement=typeof upload.metadata.replaceAssetId==='string'?loaded.state.assets.find(a=>a.id===upload.metadata.replaceAssetId):undefined;
 const m=upload.metadata;const item=existing&&!replacement&&!upload.metadata.forceNewAssetRecord?existing:assetSchema.parse({...replacement,id:replacement?.id??id('ast'),kind:m.kind??assetKindFromMime(upload.mime),title:typeof m.title==='string'?m.title:upload.name,mime:upload.mime,path:key,bytes:total,sha256:digest,source:replacement?.source??(m.source==='derived'?'derived':'imported'),createdAt:replacement?.createdAt??new Date().toISOString(),tags:m.tags??[],subtype:m.subtype,metadata:{...replacement?.metadata,...typeof m.metadata==='object'&&m.metadata!==null?m.metadata:{}},durationMs:m.durationMs,width:m.width,height:m.height,fps:m.fps});
 if(!existing||replacement||upload.metadata.forceNewAssetRecord){if(replacement)loaded.state.assets=loaded.state.assets.map(a=>a.id===replacement.id?item:a);else loaded.state.assets.push(item);}upload.assetId=item.id;delete upload.completingUntil;await store.save(projectId,loaded.state,loaded.revision);
 if(env.MEDIA.delete)for(const chunk of upload.chunks)await env.MEDIA.delete(chunk.key).catch(()=>undefined);return item;
}
