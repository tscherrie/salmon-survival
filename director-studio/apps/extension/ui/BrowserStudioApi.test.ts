// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserStudioApi } from './BrowserStudioApi.ts';
import type { ProjectSnapshot, StudioDocument, Version } from '@studio/core';
const media=vi.hoisted(()=>({executeMediaJob:vi.fn(),wordsForTimeline:vi.fn(()=>[]),usedAssets:vi.fn(()=>[])}));
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
