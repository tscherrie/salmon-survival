import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DirectorPanel } from '../src/renderer/components/director/DirectorPanel.tsx';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

describe('Director-Panel', () => {
  it('zeigt Verlauf mit Markdown; Timecodes springen im Abspielkopf', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    const panel = screen.getByRole('complementary', { name: 'Director' });
    expect(within(panel).getByText('120 BPM').tagName).toBe('STRONG');
    // Der Director schreibt mm:ss.mmm; angezeigt wird das Chip-Format MM:SS:FF (DESIGN.md §9.2)
    const link = within(panel).getByRole('button', { name: 'Zu 00:24:00 springen' });
    expect(link).toHaveTextContent('00:24:00');
    expect(link.querySelector('.ff')).toHaveTextContent(':00');
    await userEvent.click(link);
    expect(studio.store.getState().playhead).toBe(720);
    expect(studio.store.getState().seekRequest?.frame).toBe(720);
  });

  it('streamt Antworten (message_delta) und zeigt Werkzeugschritte und Fortschritt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    const emit = studio.api.debug.emit;
    act(() => {
      emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'r1', state: 'running' });
      emit({ type: 'tool', projectId: DEMO_VIDEO_ID, activity: { id: 'a1', runId: 'r1', name: 'get_document', status: 'started', startedAt: new Date().toISOString() } });
      emit({ type: 'progress', projectId: DEMO_VIDEO_ID, runId: 'r1', text: 'Analysiere den Refrain …' });
      emit({ type: 'message_delta', projectId: DEMO_VIDEO_ID, messageId: 'm1', delta: 'Ich schaue ' });
      emit({ type: 'message_delta', projectId: DEMO_VIDEO_ID, messageId: 'm1', delta: 'mir das an.' });
    });
    expect(screen.getByText('Arbeitet …')).toBeInTheDocument();
    expect(screen.getByText('Ich schaue mir das an.')).toBeInTheDocument();
    expect(screen.getByText('schreibt …')).toBeInTheDocument();
    expect(screen.getByText('Analysiere den Refrain …')).toBeInTheDocument();
    expect(screen.getByText(/get_document – läuft/)).toBeInTheDocument();
    act(() => {
      emit({ type: 'message', projectId: DEMO_VIDEO_ID, message: { id: 'm1', role: 'director', text: 'Ich schaue mir das **genau** an.', createdAt: new Date().toISOString() } });
      emit({ type: 'tool', projectId: DEMO_VIDEO_ID, activity: { id: 'a1', runId: 'r1', name: 'get_document', status: 'finished', summary: '7 Clips', startedAt: new Date().toISOString() } });
      emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'r1', state: 'idle' });
    });
    expect(screen.queryByText('schreibt …')).toBeNull();
    expect(screen.getByText('genau').tagName).toBe('STRONG');
    expect(screen.getByText('7 Clips')).toBeInTheDocument();
    expect(screen.getByText('Bereit')).toBeInTheDocument();
  });

  it('Rückfrage-Karte: Optionen, Mehrfachauswahl und „Andere …“ → answerQuestion', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const answer = vi.spyOn(studio.api, 'answerQuestion');
    renderStudio(<DirectorPanel />, studio);
    let questionId = '';
    act(() => {
      questionId = studio.api.debug.triggerQuestion(DEMO_VIDEO_ID);
    });
    const card = screen.getByRole('form', { name: 'Rückfrage' });
    const submit = within(card).getByRole('button', { name: 'Antworten' });
    expect(submit).toBeDisabled();
    const user = userEvent.setup();
    await user.click(within(card).getByLabelText(/Beides/));
    await user.click(within(card).getByLabelText(/Neon-Noir/));
    await user.click(within(card).getByLabelText(/Analogfilm/));
    // „Andere …“ in der Stil-Frage (Mehrfachauswahl) mit Freitext
    const others = within(card).getAllByLabelText('Andere …');
    await user.click(others[1]!);
    await user.type(within(card).getByRole('textbox', { name: /Welche Bildsprache passt\?.*Eigene Antwort/ }), 'Kreidezeichnung');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(answer).toHaveBeenCalledWith(DEMO_VIDEO_ID, questionId, { q_platform: 'Beides', q_style: 'Neon-Noir, Analogfilm, Kreidezeichnung' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Rückfrage' })).toBeNull());
  });

  it('Checkpoint-Karte: Freigabe mit geändertem Budget', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideCheckpoint');
    renderStudio(<DirectorPanel />, studio);
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 12.5);
    });
    const card = screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' });
    expect(within(card).getByText('nächtliche Fahrt durch die Stadt, Auflösung im Morgengrauen.', { exact: false })).toBeInTheDocument();
    const input = within(card).getByLabelText('Beantragtes Budget (USD)');
    expect(input).toHaveValue(12.5);
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '20');
    await user.click(within(card).getByRole('button', { name: 'Freigeben (Budget $20.00)' }));
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'cp_1_treatment', { decision: 'approve', budgetApprovedUsd: 20 });
    // Freigabe aktualisiert Checkpoints und Budget
    await waitFor(() => expect(studio.store.getState().checkpoints[0]?.status).toBe('approved'));
    expect(studio.store.getState().checkpoints[0]?.budgetApprovedUsd).toBe(20);
    expect(studio.store.getState().budget?.approvedUsd).toBe(25);
    expect(screen.queryByRole('article', { name: /Checkpoint zur Freigabe/ })).toBeNull();
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
  });

  it('Checkpoint-Karte: „Änderungen wünschen …“ sendet Feedback', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideCheckpoint');
    renderStudio(<DirectorPanel />, studio);
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 10);
    });
    const user = userEvent.setup();
    const card = screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' });
    await user.click(within(card).getByRole('button', { name: 'Änderungen wünschen …' }));
    await user.type(within(card).getByRole('textbox', { name: 'Was soll anders werden?' }), 'Mehr Regen');
    await user.click(within(card).getByRole('button', { name: 'Feedback senden' }));
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'cp_1_treatment', { decision: 'request_changes', feedback: 'Mehr Regen' });
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
    // Der Fake-Director legt eine Überarbeitung erneut vor
    await waitFor(() => expect(screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' })).toHaveTextContent('Überarbeitet: Mehr Regen'));
  });

  it('Genehmigungs-Karte (Budget) → decideApproval; Ablehnen ebenso', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideApproval');
    renderStudio(<DirectorPanel />, studio);
    let first = { id: '' };
    act(() => {
      first = studio.api.debug.triggerApproval(DEMO_VIDEO_ID, { title: 'Zusatzbudget 4K', amountUsd: 8.4 });
      studio.api.debug.triggerApproval(DEMO_VIDEO_ID, { id: 'apr_upload', kind: 'upload', title: 'Upload zu fal', detail: 'Song-Stem (12 MB) für Lipsync', amountUsd: undefined });
    });
    const card = screen.getByRole('article', { name: 'Genehmigung erforderlich: Zusatzbudget 4K' });
    expect(card).toHaveTextContent('$8.40');
    await userEvent.click(within(card).getByRole('button', { name: 'Genehmigen ($8.40)' }));
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, first.id, true);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Genehmigung erforderlich: Zusatzbudget 4K' })).toBeNull());
    expect(studio.store.getState().budget?.approvedUsd).toBeCloseTo(13.4);
    const upload = screen.getByRole('article', { name: 'Genehmigung erforderlich: Upload zu fal' });
    expect(upload).toHaveTextContent('Upload');
    await userEvent.click(within(upload).getByRole('button', { name: 'Ablehnen' }));
    expect(decide).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'apr_upload', false);
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
  });

  it('Generierungs-Warteschlange und Budget-Aufschlüsselung', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    const queue = screen.getByLabelText('Generierungen');
    expect(queue).toHaveTextContent('Generierungen (2)');
    expect(queue).toHaveTextContent('Position 2 in der Warteschlange');
    expect(queue).toHaveTextContent('läuft seit');
    expect(screen.getAllByRole('img', { name: 'Budget: $2.20 verbraucht, $0.40 reserviert, $5.00 freigegeben' }).length).toBeGreaterThan(0);
  });

  it('Stopp unterbricht den laufenden Director', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH, delayMs: 20 });
    const interrupt = vi.spyOn(studio.api, 'interrupt');
    renderStudio(<DirectorPanel />, studio);
    await act(async () => {
      await studio.api.sendMessage(DEMO_VIDEO_ID, { segments: [{ type: 'text', text: 'Los geht’s' }] });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Stopp' }));
    expect(interrupt).toHaveBeenCalledWith(DEMO_VIDEO_ID);
    await waitFor(() => expect(studio.store.getState().runState).toBe('interrupted'));
    expect(screen.getByText('Unterbrochen')).toBeInTheDocument();
  });
});
