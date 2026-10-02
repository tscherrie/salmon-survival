// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SunoMusicDialog } from './SunoMusicDialog.tsx';
import type { BrowserStudioApi } from './BrowserStudioApi.ts';

const state = vi.hoisted(() => ({ projectId: 'p1', document: { kind: 'timeline' }, documentVersion: 4, playhead: 120 }));
const actions = vi.hoisted(() => ({ refreshSnapshot: vi.fn(async () => {}), toast: vi.fn(), pushOverlay: vi.fn(), popOverlay: vi.fn() }));
vi.mock('../../desktop/src/renderer/state/context.tsx', () => ({ useStudio: (selector: (s: typeof state) => unknown) => selector(state), useActions: () => actions }));
vi.mock('../../desktop/src/renderer/i18n.ts', () => ({ useLanguage: () => 'en', useT: () => (key: string) => key === 'common.close' ? 'Close' : key }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function api() {
  return { action: vi.fn(async (_p: string, method: string, input?: unknown) => method === 'listSunoHandoffs' ? [{ title: 'Host music', prompt: 'Quiet strings', instrumental: true, id: 'handoff1' }] : { handoff: { ...(input as object), id: 'handoff2' } }), openExternal: vi.fn(async () => {}), importSunoFiles: vi.fn(async () => ({ assets: [{ id: 'a1' }, { id: 'a2' }], groupId: 'g1' })), importSunoAudioUrl: vi.fn() };
}
describe('Suno workflow in the native editor', () => {
  it('loads the native host prompt and copies it without an external generation call', async () => {
    const stub = api(); const clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    render(<SunoMusicDialog api={stub as unknown as BrowserStudioApi} onClose={() => {}}/>);
    await waitFor(() => expect(screen.getByLabelText('Music title')).toHaveProperty('value', 'Host music'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Quiet strings')));
    expect(stub.openExternal).not.toHaveBeenCalled(); expect(stub.importSunoFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Suno' }));
    expect(stub.openExternal).toHaveBeenCalledWith('https://suno.com/create');
  });
  it('keeps both selected stems, creation plan and current timeline position in one import', async () => {
    const stub = api(), close = vi.fn(); render(<SunoMusicDialog api={stub as unknown as BrowserStudioApi} onClose={close}/>);
    await waitFor(() => expect(screen.getByLabelText('Music title')).toHaveProperty('value', 'Host music'));
    fireEvent.change(screen.getByRole('combobox', { name: /^Export kind/ }), { target: { value: 'stems' } });
    const files = [new File(['one'], 'vocals.wav', { type: 'audio/wav' }), new File(['two'], 'drums.wav', { type: 'audio/wav' })];
    fireEvent.change(screen.getByLabelText('Audio file(s)'), { target: { files } });
    fireEvent.change(screen.getByRole('combobox', { name: /^Suno plan at creation/ }), { target: { value: 'pro' } });
    fireEvent.change(screen.getByRole('combobox', { name: /^Intended use/ }), { target: { value: 'commercial' } });
    expect(screen.getByRole('button', { name: 'Import Suno audio' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('I have the rights required for import and will check my intended use.'));
    fireEvent.click(screen.getByRole('button', { name: 'Import Suno audio' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(stub.importSunoFiles).toHaveBeenCalledWith('p1', files, expect.objectContaining({ planAtCreation: 'pro', intendedUse: 'commercial', rightsAcknowledged: true, handoffId: 'handoff1' }), 'stems', { startFrame: 120, expectedHead: 4 });
    expect(actions.refreshSnapshot).toHaveBeenCalled();
  });
  it('keeps a failed import visible and refreshes persisted assets so it can be repaired', async () => {
    const stub = api(), close = vi.fn(); stub.importSunoFiles.mockRejectedValueOnce(new Error('VERSION_CONFLICT'));
    render(<SunoMusicDialog api={stub as unknown as BrowserStudioApi} onClose={close}/>);
    await waitFor(() => expect(screen.getByLabelText('Music title')).toHaveProperty('value', 'Host music'));
    fireEvent.change(screen.getByLabelText('Audio file(s)'), { target: { files: [new File(['one'], 'song.wav', { type: 'audio/wav' })] } });
    fireEvent.click(screen.getByLabelText('I have the rights required for import and will check my intended use.'));
    fireEvent.click(screen.getByRole('button', { name: 'Import Suno audio' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('VERSION_CONFLICT'));
    expect(close).not.toHaveBeenCalled(); expect(actions.refreshSnapshot).toHaveBeenCalled();
  });
});
