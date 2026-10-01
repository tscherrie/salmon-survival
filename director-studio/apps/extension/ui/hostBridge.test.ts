// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DirectorHostBridge, selectionText } from './hostBridge.ts';
import type { SelectionContext } from './hostBridge.ts';

const context: SelectionContext = {
  projectId:'project-a',title:'Night drive',version:12,assets:[],
  document:{kind:'timeline',fps:30,width:1920,height:1080,durationFrames:300,formats:[],markers:[],components:{},tracks:[{id:'V1',kind:'video',clips:[{id:'c17',start:120,duration:150,in:0,speed:1}]}]},
  refs:[{kind:'clip',clipId:'c17',trackId:'V1'},{kind:'range',from:120,to:270,trackId:'V1'}],
};
describe('native selection context',() => {
  it('identifies exact project version, clip, track and frame-derived range',() => {
    const text=selectionText(context);
    expect(text).toContain('Projekt project-a'); expect(text).toContain('Projektversion 12');
    expect(text).toContain('Clip c17, Spur V1, 00:04.000–00:09.000');
    expect(text).toContain('Bereich 00:04.000–00:09.000, Spur V1');
  });
  it('updates model context without sending a message and clears references',async () => {
    const bridge=new DirectorHostBridge(); const update=vi.fn().mockResolvedValue({updateId:'one'}); const send=vi.fn();
    Object.defineProperty(bridge.extensions,'modelContext',{value:{update,getCurrent:()=>null}});
    Object.defineProperty(bridge.extensions,'message',{value:{send}});
    expect(await bridge.updateSelection(context)).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({structuredContent:{projectId:'project-a',projectVersion:12,selectedRefs:context.refs}}));
    await bridge.updateSelection(null);
    expect(update).toHaveBeenLastCalledWith({content:[],structuredContent:{}}); expect(send).not.toHaveBeenCalled();
  });
  it('exposes copy fallback when modelContext is absent',async () => {
    const bridge=new DirectorHostBridge(); expect(await bridge.updateSelection(context)).toBe(false);
  });
  it('keeps concurrent instances scoped to their own context',async () => {
    const one=new DirectorHostBridge(); const two=new DirectorHostBridge(); const first=vi.fn(); const second=vi.fn();
    Object.defineProperty(one.extensions,'modelContext',{value:{update:first}}); Object.defineProperty(two.extensions,'modelContext',{value:{update:second}});
    await one.updateSelection(context); await two.updateSelection({...context,projectId:'project-b',refs:[{kind:'asset',assetId:'other'}]});
    expect(first.mock.calls[0]?.[0].structuredContent.projectId).toBe('project-a'); expect(second.mock.calls[0]?.[0].structuredContent.projectId).toBe('project-b');
  });
});
