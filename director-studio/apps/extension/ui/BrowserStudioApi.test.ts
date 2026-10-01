// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserStudioApi } from './BrowserStudioApi.ts';
import type { Asset, ProjectSnapshot, StudioDocument, Version } from '@studio/core';
const media=vi.hoisted(()=>({executeMediaJob:vi.fn(),wordsForTimeline:vi.fn(()=>[]),usedAssets:vi.fn(()=>[]),probeMedia:vi.fn(async()=>({width:128,height:128})),frames:vi.fn(async()=>[])}));
vi.mock('@studio/browser-media',()=>media);
import type { DirectorHostBridge } from './hostBridge.ts';
const host = { getStatus:()=>({connected:false,error:null}),openExternal:vi.fn(),selectLibraryFiles:vi.fn() } as unknown as DirectorHostBridge;
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('browser persistence transport',() => {
  it('uses authenticated server requests and reads the persisted project on reopening',async () => {
    const snapshot={path:'project-1',manifest:{id:'project-1'},document:null,versions:[],assets:[],jobs:[],cloudRevision:1};
    const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>snapshot}); vi.stubGlobal('fetch',fetch);
    const api=new BrowserStudioApi(host,'https://director.example');
    const reopened=await api.openProject('project-1'); expect(reopened.manifest.id).toBe('project-1');
    expect(fetch).toHaveBeenCalledWith('https://director.example/api/projects/project-1',expect.objectContaining({credentials:'include',method:'GET'})); api.dispose();
  });
  it('reports authentication failure rather than seeding fake project data',async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'Connect Director Studio with your host account.'})}));
    const api=new BrowserStudioApi(host);
    await expect(api.listRecentProjects()).rejects.toThrow('Connect Director Studio'); expect((window as unknown as {__studioFake?:unknown}).__studioFake).toBeUndefined(); api.dispose();
  });
  it('passes question answers and approvals as project-scoped durable actions',async () => {
    const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>null});vi.stubGlobal('fetch',fetch);
    const api=new BrowserStudioApi(host);
    await api.answerQuestion('p1','q7',{framing:'Portrait'}); await api.decideApproval('p1','approval9',true);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({method:'answerQuestion',params:{questionId:'q7',answers:{framing:'Portrait'}}});
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({method:'decideApproval',params:{approvalId:'approval9',approved:true}});api.dispose();
  });
  it('routes embedded host traffic exclusively through its own MCP server',async () => {
    const request=vi.fn().mockResolvedValue([{path:'host-project'}]); const connected={...host,getStatus:()=>({connected:true}),request} as unknown as DirectorHostBridge;
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch); const api=new BrowserStudioApi(connected);
    await expect(api.listRecentProjects()).resolves.toEqual([{path:'host-project'}]); expect(request).toHaveBeenCalledWith('/api/projects','GET',undefined); expect(fetch).not.toHaveBeenCalled();api.dispose();
  });
});

describe('confirmed missing file recovery',()=>{
  const asset={id:'image1',path:'owned/image.png',sha256:'old',source:'imported',kind:'image',bytes:3,mime:'image/png',metadata:{provenance:'retained'}} as unknown as Asset;
  const snapshot={manifest:{id:'p1'},versions:[],document:null,assets:[asset],jobs:[]} as unknown as ProjectSnapshot;
  it('marks an imported asset missing after a real transport 409, then clears local repair state on replacement without changing its ID',async()=>{
    let missing=true;const replacement={...asset,path:'owned/replacement.png',sha256:'new'};
    const fetch=vi.fn(async(_url,options)=>options?.method==='HEAD'?{ok:!missing,status:missing?409:200}:options?.body instanceof FormData?{ok:true,status:201,json:async()=>{missing=false;return structuredClone(replacement);}}:{ok:true,status:200,json:async()=>structuredClone(snapshot)});
    vi.stubGlobal('fetch',fetch);const api=new BrowserStudioApi(host);const events:unknown[]=[];api.onEvent(event=>events.push(event));await api.openProject('p1');
    expect(await api.probeAssetFile('p1','image1')).toBe('missing');expect((await api.getSnapshot('p1')).assets[0]?.metadata).toEqual({provenance:'retained',missing:true});
    const token=api.registerFile(new File(['png'],'replacement.png',{type:'image/png'}));const recovered=await api.relinkAsset('p1','image1',token);
    expect(recovered.id).toBe('image1');expect(recovered.metadata).toEqual({provenance:'retained'});expect(api.missingAssets.size).toBe(0);expect(await api.probeAssetFile('p1','image1')).toBe('ok');
    const upload=fetch.mock.calls.find(([,options])=>options?.body instanceof FormData)?.[1]?.body as FormData;
    expect(JSON.parse(String(upload.get('metadata'))).replaceAssetId).toBe('image1');expect(events).toContainEqual(expect.objectContaining({type:'asset',asset:expect.objectContaining({id:'image1',metadata:{provenance:'retained',missing:true}})}));expect(asset.metadata).toEqual({provenance:'retained'});api.dispose();
  });
  it('propagates native MCP missing-byte responses without probing a private Site URL',async()=>{
    const request=vi.fn(async(path)=>path.endsWith('/p1')?structuredClone(snapshot):Promise.reject(Error('ASSET_MISSING: Asset bytes missing. Repair this asset before preview or export.')));
    const connected={...host,getStatus:()=>({connected:true}),request} as unknown as DirectorHostBridge;
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const api=new BrowserStudioApi(connected);const opened=await api.openProject('p1');
    expect(opened.assets[0]?.metadata?.missing).toBe(true);expect(await api.probeAssetFile('p1','image1')).toBe('missing');expect(fetch).not.toHaveBeenCalled();api.dispose();
  });
  it('keeps authentication and connection failures separate from confirmed missing bytes',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>options?.method==='HEAD'?{ok:false,status:401}:{ok:true,status:200,json:async()=>structuredClone(snapshot)}));
    const api=new BrowserStudioApi(host);await api.openProject('p1');expect(await api.probeAssetFile('p1','image1')).toBe('unknown');expect(api.missingAssets.size).toBe(0);expect((await api.getSnapshot('p1')).assets[0]?.metadata?.missing).toBeUndefined();api.dispose();
  });
  it('refreshes only the changed native asset after a remote same-ID replacement',async()=>{
    const other={...asset,id:'image2',path:'owned/other.png',sha256:'other'};let changed=false;
    const request=vi.fn(async(path)=>path.endsWith('/p1')?{...structuredClone(snapshot),assets:[changed?{...asset,path:'owned/new.png',sha256:'new'}:asset,other]}:{base64:btoa(changed?'new':'old'),mime:'image/png'});
    const connected={...host,getStatus:()=>({connected:true}),request} as unknown as DirectorHostBridge;
    class TestURL extends URL {static override createObjectURL=vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:other').mockReturnValueOnce('blob:new');static override revokeObjectURL=vi.fn();}
    vi.stubGlobal('URL',TestURL);const api=new BrowserStudioApi(connected);await api.openProject('p1');expect(api.assetUrl('p1','image1')).toBe('blob:old');
    changed=true;await api.getSnapshot('p1');expect(api.assetUrl('p1','image1')).toBe('blob:new');expect(api.assetUrl('p1','image2')).toBe('blob:other');
    expect(TestURL.revokeObjectURL).toHaveBeenCalledWith('blob:old');expect(TestURL.revokeObjectURL).not.toHaveBeenCalledWith('blob:other');expect(request.mock.calls.filter(([path])=>path.includes('/assets/image1?'))).toHaveLength(2);expect(request.mock.calls.filter(([path])=>path.includes('/assets/image2?'))).toHaveLength(1);api.dispose();
  });
  it('clears standalone repair metadata when the persisted source is replaced remotely',async()=>{
    let changed=false;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>options?.method==='HEAD'?{ok:false,status:409}:{ok:true,status:200,json:async()=>({...structuredClone(snapshot),assets:[changed?{...asset,path:'owned/new.png',sha256:'new'}:asset]})}));
    const api=new BrowserStudioApi(host);await api.openProject('p1');await api.probeAssetFile('p1','image1');expect(api.missingAssets.size).toBe(1);
    changed=true;expect((await api.getSnapshot('p1')).assets[0]?.metadata?.missing).toBeUndefined();expect(api.missingAssets.size).toBe(0);api.dispose();
  });
  it('keeps video bytes out of image thumbnails while displaying a real owned thumbnail',async()=>{
    let withThumbnail=false;const video={...asset,kind:'video',mime:'video/mp4'};
    const thumbnail={...asset,id:'thumb1',path:'owned/thumb.png',sha256:'thumb'};
    const request=vi.fn(async(path)=>path.endsWith('/p1')?{...structuredClone(snapshot),assets:withThumbnail?[{...video,metadata:{thumbPath:thumbnail.path}},thumbnail]:[video]}:{base64:btoa('png'),mime:path.includes('/thumb1?')?'image/png':'video/mp4'});
    const connected={...host,getStatus:()=>({connected:true}),request} as unknown as DirectorHostBridge;
    class TestURL extends URL {static override createObjectURL=vi.fn().mockReturnValueOnce('blob:video').mockReturnValueOnce('blob:thumbnail');static override revokeObjectURL=vi.fn();}
    vi.stubGlobal('URL',TestURL);const api=new BrowserStudioApi(connected);await api.getSnapshot('p1');
    expect(api.assetUrl('p1','image1','thumb')).toBe('');expect(api.assetUrl('p1','image1','proxy')).toBe('blob:video');
    withThumbnail=true;await api.getSnapshot('p1');expect(api.assetUrl('p1','image1','thumb')).toBe('blob:thumbnail');expect(api.assetUrl('p1','thumb1','thumb')).toBe('blob:thumbnail');api.dispose();
  });
});

describe('versioned browser media jobs',()=>{
  const timeline=(assetId:string)=>({kind:'timeline',components:{title:{assetId}},tracks:[]}) as unknown as StudioDocument;
  const snapshot=(jobs:unknown[]=[])=>({manifest:{id:'p1'},document:timeline('source-new'),versions:[{number:1},{number:2}],assets:[],jobs}) as unknown as ProjectSnapshot;
  it('exports the immutable component asset pinned by the historical document, after a rewrite',async()=>{
    const api=new BrowserStudioApi(host);vi.spyOn(api,'getSnapshot').mockResolvedValue(snapshot());
    vi.spyOn(api,'getVersion').mockResolvedValue({number:1,document:timeline('source-old')} as Version);
    const action=vi.spyOn(api,'action').mockImplementation(async(_p,method)=>method==='claimJob'?{claimed:true}:null as never);
    const fetch=vi.fn().mockResolvedValue({ok:true,text:async()=>'old component source'});vi.stubGlobal('fetch',fetch);media.executeMediaJob.mockResolvedValue({files:[],result:{}});
    await api.runMediaJob('p1',{id:'job1',kind:'export_project',input:{projectVersion:1,target:'mp4'},status:'queued',createdAt:'now',updatedAt:'now'});
    expect(fetch).toHaveBeenCalledWith('/api/projects/p1/assets/source-old?variant=original',expect.objectContaining({signal:expect.any(AbortSignal)}));
    expect(media.executeMediaJob.mock.calls[0]![1].components).toEqual({title:'old component source'});
    expect(action.mock.calls.some(([,method])=>method==='readComponent')).toBe(false);api.dispose();
  });
  it('aborts local media execution and retains the confirmed canceled journal state',async()=>{
    const api=new BrowserStudioApi(host);vi.spyOn(api,'getSnapshot').mockResolvedValue(snapshot());
    const patches:unknown[]=[];vi.spyOn(api,'action').mockImplementation(async(_p,method,params)=>{if(method==='claimJob')return {claimed:true} as never;if(method==='updateJob')patches.push(params);return null as never;});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>'component'}));
    let ready:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});let signal:AbortSignal;
    media.executeMediaJob.mockImplementation(async(_job,context)=>{signal=context.signal;ready!();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
    const work=api.runMediaJob('p1',{id:'job2',kind:'export_project',input:{target:'mp4'},status:'queued',createdAt:'now',updatedAt:'now'});
    const rejected=expect(work).rejects.toThrow('Medienjob abgebrochen');await started;await api.cancelMediaJob('p1','job2');await rejected;
    expect(signal!.aborted).toBe(true);expect(patches).toContainEqual(expect.objectContaining({jobId:'job2',patch:expect.objectContaining({status:'canceled'})}));api.dispose();
  });
});
