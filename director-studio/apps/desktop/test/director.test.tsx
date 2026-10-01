import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Generation } from '@studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { focusDecision } from '../src/renderer/components/director/DecisionDock.tsx';
import { DirectorPanel } from '../src/renderer/components/director/DirectorPanel.tsx';
import { buildFeed, formatDuration, humanizeToolName, splitRecommendation, toolLabel } from '../src/renderer/components/director/history.ts';
import { JOB_DONE_MS } from '../src/renderer/components/director/JobTray.tsx';
import { resetTechDetailsCache, TECH_DETAILS_KEY } from '../src/renderer/components/director/techDetails.ts';
import { Workspace } from '../src/renderer/components/workspace/Workspace.tsx';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio, type Studio } from './helpers.tsx';

/** Director-Spalte (DESIGN.md §7.6): Kopf, Verlauf, Job-Zeile, angedockte Entscheidung; Test-Vertrag §15. */

beforeEach(() => {
  localStorage.removeItem(TECH_DETAILS_KEY);
  resetTechDetailsCache();
});

const log = () => screen.getByRole('log');
const dock = () => document.querySelector<HTMLElement>('.dock');

/** Simuliert die gemessene Höhe der Director-Spalte (jsdom hat kein Layout). */
function stubColumnHeight(height: number): () => void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('director') ? height : 0;
    },
  });
  return () => Object.defineProperty(Element.prototype, 'clientHeight', original);
}

function generation(patch: Partial<Generation> & Pick<Generation, 'id' | 'status'>): Generation {
  return {
    endpointId: 'minimax/h3-max/text-to-video',
    modality: 'video',
    input: { duration: 8 },
    purpose: 'Shot 05 – Brücke v2',
    estimateUsd: 0.8,
    inputAssetIds: [],
    outputAssetIds: [],
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

describe('Verlauf', () => {
  it('Markdown; Timecodes im Chip-Format springen per revealRef und tragen die Nummer eines Markers am selben Frame', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    const panel = screen.getByRole('complementary', { name: 'Director' });
    expect(within(panel).getByText('120 BPM').tagName).toBe('STRONG');
    // Der Director schreibt mm:ss.mmm; angezeigt wird das Chip-Format MM:SS:FF (DESIGN.md §9.2)
    const link = within(panel).getByRole('button', { name: 'Zu 00:24:00 springen' });
    expect(link).toHaveTextContent('00:24:00');
    expect(link.querySelector('.ff')).toHaveTextContent(':00');
    expect(link.querySelector('.n')).toBeNull();
    await userEvent.click(link);
    expect(studio.store.getState().playhead).toBe(720);
    expect(studio.store.getState().seekRequest?.frame).toBe(720);
    expect(studio.store.getState().flash?.key).toBe('time:720');
    // Marker 1 im Composer am selben Frame: Der Link zeigt dieselbe Nummer, Hover verknüpft beide (§9.4)
    act(() => {
      studio.store.getState().insertRef({ kind: 'time', frame: 720 });
    });
    expect(link.querySelector('.n')).toHaveTextContent('1');
    fireEvent.mouseEnter(link.querySelector('.tc-link-body')!);
    expect(studio.store.getState().hoveredRefKey).toBe('time:720');
    expect(link.querySelector('.tc-link-body')).toHaveClass('is-linked');
  });

  it('streamt Antworten; Werkzeugschritte als Gruppe im Klartext, Rohnamen nur mit „Technische Details“', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    const emit = studio.api.debug.emit;
    const at = new Date().toISOString();
    act(() => {
      emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'r1', state: 'running' });
      emit({ type: 'tool', projectId: DEMO_VIDEO_ID, activity: { id: 'a1', runId: 'r1', name: 'get_document', status: 'started', startedAt: at } });
      emit({ type: 'progress', projectId: DEMO_VIDEO_ID, runId: 'r1', text: 'Analysiere den Refrain …' });
      emit({ type: 'message_delta', projectId: DEMO_VIDEO_ID, messageId: 'm1', delta: 'Ich schaue ' });
      emit({ type: 'message_delta', projectId: DEMO_VIDEO_ID, messageId: 'm1', delta: 'mir das an.' });
    });
    expect(screen.getByText('arbeitet')).toBeInTheDocument();
    expect(screen.getByText('Ich schaue mir das an.')).toBeInTheDocument();
    expect(screen.getByText('schreibt …')).toBeInTheDocument();
    expect(screen.getByText('Ich schaue mir das an.').closest('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Analysiere den Refrain …')).toBeInTheDocument();
    const group = log().querySelector<HTMLElement>('details.tools')!;
    expect(within(group).getByText('1 Schritt')).toBeInTheDocument();
    expect(within(group).getAllByText('Dokument gelesen').length).toBeGreaterThan(0);
    expect(within(group).getByText('läuft')).toBeInTheDocument();
    expect(within(group).queryByText('get_document')).toBeNull();

    act(() => {
      emit({ type: 'message', projectId: DEMO_VIDEO_ID, message: { id: 'm1', role: 'director', text: 'Ich schaue mir das **genau** an.', createdAt: new Date().toISOString() } });
      emit({ type: 'tool', projectId: DEMO_VIDEO_ID, activity: { id: 'a1', runId: 'r1', name: 'get_document', status: 'finished', summary: '7 Clips', startedAt: at, finishedAt: at } });
      emit({ type: 'tool', projectId: DEMO_VIDEO_ID, activity: { id: 'a2', runId: 'r1', name: 'frames', status: 'finished', startedAt: at, finishedAt: at } });
      emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'r1', state: 'idle' });
    });
    expect(screen.queryByText('schreibt …')).toBeNull();
    expect(screen.getByText('genau').tagName).toBe('STRONG');
    // Eine Gruppe für aufeinanderfolgende Schritte; Zeile 1: Zusammenfassung, Zeile 2: Klartext des Werkzeugs
    expect(log().querySelectorAll('details.tools')).toHaveLength(1);
    expect(within(group).getByText('2 Schritte')).toBeInTheDocument();
    expect(within(group).getByText('Dokument gelesen, Frames geprüft')).toBeInTheDocument();
    expect(within(group).getByText('7 Clips')).toBeInTheDocument();
    expect(screen.getByText('Bereit')).toBeInTheDocument();

    // ⋯-Menü: „Technische Details anzeigen“ zeigt die Rohnamen und wird gespeichert
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Technische Details anzeigen' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByText('get_document').tagName).toBe('CODE');
    expect(within(group).getByText('frames')).toBeInTheDocument();
    expect(localStorage.getItem(TECH_DETAILS_KEY)).toBe('1');
  });

  it('Systemzeilen, Fehlerkarte (Erneut versuchen) und Leerzustand mit Beispielen', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage').mockResolvedValue();
    renderStudio(<DirectorPanel />, studio);
    act(() => {
      studio.api.debug.emit({ type: 'message', projectId: DEMO_VIDEO_ID, message: { id: 's1', role: 'system', text: 'Hinweis zum Projektspeicher: Zeile 3 übersprungen', createdAt: new Date().toISOString() } });
      studio.api.debug.emit({
        type: 'generation',
        projectId: DEMO_VIDEO_ID,
        generation: generation({ id: 'g_fail', status: 'failed', purpose: 'Shot 06 – Stillstand', error: 'fal.ai antwortet nicht', finishedAt: new Date().toISOString() }),
      });
    });
    const sys = within(log()).getByText('Hinweis zum Projektspeicher: Zeile 3 übersprungen');
    expect(sys.closest('.sys-line')).not.toBeNull();
    const alert = within(log()).getByRole('alert');
    expect(alert).toHaveTextContent('Generierung fehlgeschlagen');
    expect(alert).toHaveTextContent('Shot 06 – Stillstand · fal.ai antwortet nicht. Es wurden keine Kosten berechnet.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(send).toHaveBeenCalledWith(DEMO_VIDEO_ID, { segments: [{ type: 'text', text: 'Bitte versuch „Shot 06 – Stillstand“ noch einmal.' }] });
    expect(within(alert).getByRole('button', { name: 'Anderes Modell …' })).toBeInTheDocument();
  });

  it('leerer Verlauf: Beispielzeilen setzen den Text in den Composer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() => studio.store.setState({ messages: [], activities: [], progress: [] }));
    renderStudio(<DirectorPanel />, studio);
    expect(within(log()).getByText('Erzähl dem Director, was du vorhast. Er beginnt mit einem kurzen Planungsgespräch.')).toBeInTheDocument();
    const example = within(log()).getByRole('button', { name: 'Schneide aus dem Refrain einen Teaser von 30 Sekunden.' });
    await userEvent.click(example);
    expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'Schneide aus dem Refrain einen Teaser von 30 Sekunden.' }]);
  });
});

describe('DecisionDock (§7.6.3)', () => {
  it('Rückfrage: nur im Dock, im Verlauf eine Systemzeile; Optionen, Mehrfachauswahl und „Andere …“ → answerQuestion', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const answer = vi.spyOn(studio.api, 'answerQuestion');
    renderStudio(<DirectorPanel />, studio);
    let questionId = '';
    act(() => {
      questionId = studio.api.debug.triggerQuestion(DEMO_VIDEO_ID);
    });
    const card = screen.getByRole('form', { name: 'Rückfrage' });
    expect(dock()).toContainElement(card);
    expect(log()).not.toContainElement(card);
    expect(within(log()).getByText('Rückfrage vorgelegt · unten angeheftet')).toBeInTheDocument();
    expect(studio.store.getState().announcement).toBe('Neue Entscheidung: Rückfrage');
    // Empfehlung als neutrales Badge, nicht im Label
    expect(within(card).getByText('Empfohlen')).toHaveClass('badge');
    const submit = within(card).getByRole('button', { name: 'Antworten' });
    expect(submit).toBeDisabled();
    const user = userEvent.setup();
    await user.click(within(card).getByLabelText(/Beides/));
    await user.click(within(card).getByLabelText(/Neon-Noir/));
    await user.click(within(card).getByLabelText(/Analogfilm/));
    const others = within(card).getAllByLabelText('Andere …');
    await user.click(others[1]!);
    await user.type(within(card).getByRole('textbox', { name: /Welche Bildsprache passt\?.*Eigene Antwort/ }), 'Kreidezeichnung');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(answer).toHaveBeenCalledWith(DEMO_VIDEO_ID, questionId, { q_platform: 'Beides', q_style: 'Neon-Noir, Analogfilm, Kreidezeichnung' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Rückfrage' })).toBeNull());
  });

  it('Checkpoint: Karte im Dock (nicht im Verlauf), Freigabe mit geändertem Budget, danach nur noch Systemzeile', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideCheckpoint');
    renderStudio(<DirectorPanel />, studio);
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 12.5);
    });
    const card = screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' });
    expect(dock()).toContainElement(card);
    expect(within(log()).queryByRole('article', { name: /Checkpoint zur Freigabe/ })).toBeNull();
    expect(within(log()).getByText('Checkpoint 1 vorgelegt · unten angeheftet')).toBeInTheDocument();
    expect(card).toHaveTextContent('Checkpoint 1 von 5');
    expect(within(card).getByText('zur Freigabe')).toHaveClass('badge');
    expect(within(card).getByText('nächtliche Fahrt durch die Stadt, Auflösung im Morgengrauen.', { exact: false })).toBeInTheDocument();
    // Budget für den nächsten Schritt; das Feld behält seinen Namen aus dem Test-Vertrag
    expect(within(card).getByText('Budget für „Style Bible“')).toBeInTheDocument();
    const input = within(card).getByLabelText('Beantragtes Budget (USD)');
    expect(input).toHaveValue(12.5);
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '20');
    // Aufschlüsselung ist eingeklappt (§10) und rechnet mit dem eingegebenen Betrag
    const breakdown = within(card).getByRole('button', { name: 'Aufschlüsselung' });
    expect(breakdown).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByText('Danach')).toBeNull();
    await user.click(breakdown);
    expect(within(card).getByText('Danach').closest('.cp-after')).toHaveTextContent('Danach$2.20 / $25.00');
    const approve = within(card).getByRole('button', { name: 'Freigeben (Budget $20.00)' });
    expect(approve).toHaveClass('primary');
    expect(approve).toHaveTextContent('Freigeben·$20.00');
    await user.click(approve);
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'cp_1_treatment', { decision: 'approve', budgetApprovedUsd: 20 });
    await waitFor(() => expect(studio.store.getState().checkpoints[0]?.status).toBe('approved'));
    expect(studio.store.getState().checkpoints[0]?.budgetApprovedUsd).toBe(20);
    expect(studio.store.getState().budget?.approvedUsd).toBe(25);
    expect(screen.queryByRole('article', { name: /Checkpoint zur Freigabe/ })).toBeNull();
    expect(dock()).toBeNull();
    expect(within(log()).getByText(/Treatment freigegeben/).closest('.sys-line')).toHaveTextContent('Treatment freigegeben · $20.00');
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
  });

  it('Checkpoint: „Ändern …“ sendet Feedback; die Überarbeitung erscheint wieder im Dock', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideCheckpoint');
    renderStudio(<DirectorPanel />, studio);
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 10);
    });
    const user = userEvent.setup();
    const card = screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' });
    await user.click(within(card).getByRole('button', { name: 'Ändern …' }));
    await user.type(within(card).getByRole('textbox', { name: 'Was soll anders werden?' }), 'Mehr Regen');
    await user.click(within(card).getByRole('button', { name: 'Feedback senden' }));
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'cp_1_treatment', { decision: 'request_changes', feedback: 'Mehr Regen' });
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
    // Der Fake-Director legt eine Überarbeitung erneut vor
    await waitFor(() => expect(screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' })).toHaveTextContent('Überarbeitet: Mehr Regen'));
    expect(dock()).toContainElement(screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' }));
  });

  it('Genehmigungen: mehrere offen → „1 von 2 offenen Entscheidungen“ mit ‹ ›; Genehmigen/Ablehnen; danach Systemzeile', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const decide = vi.spyOn(studio.api, 'decideApproval');
    renderStudio(<DirectorPanel />, studio);
    let first = { id: '' };
    act(() => {
      first = studio.api.debug.triggerApproval(DEMO_VIDEO_ID, { title: 'Zusatzbudget 4K', amountUsd: 8.4, detail: 'Überschreitet das Budget um $3.20.' });
      studio.api.debug.triggerApproval(DEMO_VIDEO_ID, { id: 'apr_upload', kind: 'upload', title: 'Upload zu fal', detail: 'Song-Stem (12 MB) für Lipsync', amountUsd: undefined });
    });
    expect(within(dock()!).getByText('1 von 2 offenen Entscheidungen')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Genehmigung erforderlich: Zusatzbudget 4K' });
    expect(card).toHaveTextContent('Genehmigung · Budget');
    expect(within(card).getByText('$3.20')).toHaveClass('mono');
    // Blättern zur zweiten Entscheidung und zurück
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nächste Entscheidung' }));
    expect(screen.getByRole('article', { name: 'Genehmigung erforderlich: Upload zu fal' })).toHaveTextContent('Upload');
    await user.click(screen.getByRole('button', { name: 'Vorherige Entscheidung' }));
    await user.click(within(screen.getByRole('article', { name: 'Genehmigung erforderlich: Zusatzbudget 4K' })).getByRole('button', { name: 'Genehmigen ($8.40)' }));
    expect(decide).toHaveBeenCalledWith(DEMO_VIDEO_ID, first.id, true);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Genehmigung erforderlich: Zusatzbudget 4K' })).toBeNull());
    expect(studio.store.getState().budget?.approvedUsd).toBeCloseTo(13.4);
    expect(within(log()).getByText(/„Zusatzbudget 4K“ genehmigt/).closest('.sys-line')).toHaveTextContent('„Zusatzbudget 4K“ genehmigt · $8.40');
    const upload = screen.getByRole('article', { name: 'Genehmigung erforderlich: Upload zu fal' });
    expect(screen.queryByText(/offenen Entscheidungen/)).toBeNull();
    await user.click(within(upload).getByRole('button', { name: 'Ablehnen' }));
    expect(decide).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'apr_upload', false);
    await waitFor(() => expect(within(log()).getByText('„Upload zu fal“ abgelehnt')).toBeInTheDocument());
    await studio.api.debug.whenIdle(DEMO_VIDEO_ID);
  });

  it('Kompaktmodus unter 420 px: 36-px-Zeile mit Prüfen; Sheet nach oben, Esc schließt; nach „Später“ kompakt bis zur nächsten Entscheidung', async () => {
    const restore = stubColumnHeight(400);
    try {
      const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
      renderStudio(<DirectorPanel />, studio);
      await act(async () => {
        await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 12.5);
      });
      const row = document.querySelector<HTMLElement>('.dock-row')!;
      expect(row).toHaveTextContent('Checkpoint 1 wartet auf Freigabe');
      expect(row).toHaveTextContent('$12.50');
      expect(screen.queryByRole('article', { name: /Checkpoint zur Freigabe/ })).toBeNull();
      const review = within(row).getByRole('button', { name: 'Prüfen' });
      expect(review).toHaveClass('primary');
      const user = userEvent.setup();
      await user.click(review);
      const sheet = screen.getByRole('dialog', { name: 'Offene Entscheidung' });
      expect(sheet).toHaveClass('dock-sheet');
      expect(within(sheet).getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' })).toBeInTheDocument();
      expect(sheet).toHaveFocus();
      fireEvent.keyDown(sheet, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Offene Entscheidung' })).toBeNull();
      await waitFor(() => expect(within(document.querySelector<HTMLElement>('.dock-row')!).getByRole('button', { name: 'Prüfen' })).toHaveFocus());
      // Klick auf den Schritt im Stepper (Ereignis der Kopfzeile) öffnet die Entscheidung erneut
      let handled = false;
      act(() => {
        handled = focusDecision('cp_1_treatment');
      });
      expect(handled).toBe(true);
      expect(screen.getByRole('dialog', { name: 'Offene Entscheidung' })).toBeInTheDocument();
      expect(focusDecision('cp_2_style_bible')).toBe(false);
    } finally {
      restore();
    }
  });

  it('„Später“ macht das Dock kompakt, bis eine neue Entscheidung kommt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    act(() => {
      studio.api.debug.triggerQuestion(DEMO_VIDEO_ID);
    });
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('form', { name: 'Rückfrage' })).getByRole('button', { name: 'Später' }));
    expect(screen.queryByRole('form', { name: 'Rückfrage' })).toBeNull();
    expect(document.querySelector('.dock-row')).toHaveTextContent('Rückfrage wartet');
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 10);
    });
    // Neue Entscheidung: wieder ausführlich, die Rückfrage bleibt zuerst
    expect(screen.getByRole('form', { name: 'Rückfrage' })).toBeInTheDocument();
    expect(within(dock()!).getByText('1 von 2 offenen Entscheidungen')).toBeInTheDocument();
  });
});

describe('Kopf und Job-Zeile', () => {
  it('Stopp steht im Director-Kopf (nur bei „arbeitet“), nicht im Composer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH, delayMs: 20 });
    const interrupt = vi.spyOn(studio.api, 'interrupt');
    renderStudio(
      <>
        <DirectorPanel />
        <Composer />
      </>,
      studio,
    );
    expect(screen.queryByRole('button', { name: 'Stopp' })).toBeNull();
    await act(async () => {
      await studio.api.sendMessage(DEMO_VIDEO_ID, { segments: [{ type: 'text', text: 'Los geht’s' }] });
    });
    const stop = await screen.findByRole('button', { name: 'Stopp' });
    expect(stop.closest('.director-header')).not.toBeNull();
    expect(within(screen.getByRole('region', { name: 'Nachricht an den Director' })).queryByRole('button', { name: 'Stopp' })).toBeNull();
    await userEvent.click(stop);
    expect(interrupt).toHaveBeenCalledWith(DEMO_VIDEO_ID);
    await waitFor(() => expect(studio.store.getState().runState).toBe('interrupted'));
    expect(within(document.querySelector<HTMLElement>('.director-header')!).getByRole('status')).toHaveTextContent('unterbrochen');
    expect(screen.queryByRole('button', { name: 'Stopp' })).toBeNull();
  });

  it('Job-Zeile ersetzt Warteschlange und Budget-Fuß: laufender Job, „+1“ mit allen Jobs; kein director-footer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<DirectorPanel />, studio);
    expect(document.querySelector('.director-footer')).toBeNull();
    expect(document.querySelector('.budget-details')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Budget:/ })).toBeNull();
    const tray = screen.getByRole('status', { name: 'Generierungen' });
    expect(tray).toHaveTextContent('Testshot Tunnel auf 4K hochskalieren');
    expect(tray).toHaveTextContent('≈ $0.40');
    expect(tray.querySelector('.spin')).not.toBeNull();
    const more = within(tray).getByRole('button', { name: '1 weitere Generierungen' });
    expect(more).toHaveTextContent('+1');
    await userEvent.click(more);
    const list = screen.getByRole('dialog', { name: 'Generierungen' });
    expect(list).toHaveTextContent('Gesprochenes Intro „Nachtfahrt“');
    expect(list).toHaveTextContent('Position 2 in der Warteschlange');
  });

  it('Job-Zeile: fertig mit Häkchen und Kosten, nach 10 s weg; fehlgeschlagen bleibt bis „Ausblenden“', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() => studio.store.setState({ generations: [] }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderStudio(<DirectorPanel />, studio);
      expect(screen.queryByRole('status', { name: 'Generierungen' })).toBeNull();
      act(() => {
        studio.api.debug.emit({ type: 'generation', projectId: DEMO_VIDEO_ID, generation: generation({ id: 'g1', status: 'running', submittedAt: new Date().toISOString(), etaSec: 10 }) });
      });
      const tray = screen.getByRole('status', { name: 'Generierungen' });
      expect(tray).toHaveTextContent('Shot 05 – Brücke v2');
      expect(tray).toHaveTextContent(/h3-max · 8\s+s/);
      expect(tray.querySelector('.job-progress')).not.toBeNull();
      act(() => {
        studio.api.debug.emit({ type: 'generation', projectId: DEMO_VIDEO_ID, generation: generation({ id: 'g1', status: 'completed', costUsd: 0.8, finishedAt: new Date().toISOString() }) });
      });
      expect(screen.getByRole('status', { name: 'Generierungen' })).toHaveTextContent('$0.80');
      expect(document.querySelector('.job-done')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(JOB_DONE_MS + 1500);
      });
      expect(screen.queryByRole('status', { name: 'Generierungen' })).toBeNull();
      act(() => {
        studio.api.debug.emit({ type: 'generation', projectId: DEMO_VIDEO_ID, generation: generation({ id: 'g2', status: 'failed', error: 'Zeitüberschreitung', finishedAt: new Date().toISOString() }) });
      });
      act(() => {
        vi.advanceTimersByTime(JOB_DONE_MS + 1500);
      });
      const failed = screen.getByRole('status', { name: 'Generierungen' });
      expect(failed.querySelector('.job-failed')).not.toBeNull();
      fireEvent.click(within(failed).getByRole('button', { name: 'Ausblenden' }));
      expect(screen.queryByRole('status', { name: 'Generierungen' })).toBeNull();
      // Die Details stehen weiter in der Fehlerkarte im Verlauf
      expect(within(log()).getByRole('alert')).toHaveTextContent('Zeitüberschreitung');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Verlauf als Daten (history.ts)', () => {
  it('Klartext der Werkzeuge: i18n, sonst vermenschlicht; MCP-Präfix fällt weg', () => {
    expect(toolLabel('frames')).toBe('Frames geprüft');
    expect(toolLabel('mcp__studio__analyze_audio')).toBe('Audio analysiert');
    expect(toolLabel('qa.contact_sheet_v2')).toBe('Qa contact sheet v2');
    expect(humanizeToolName('timeline.apply')).toBe('Timeline apply');
    expect(formatDuration(2000)).toBe('2\u00A0s');
    expect(formatDuration(65_000)).toBe('1:05');
  });

  it('Kopfzeile entfällt bei Folgenachrichten desselben Autors innerhalb von 2 Minuten; Werkzeugschritte werden gruppiert', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString();
    const feed = buildFeed({
      messages: [
        { id: 'm1', role: 'director', text: 'a', createdAt: at(0) },
        { id: 'm2', role: 'director', text: 'b', createdAt: at(60) },
        { id: 'm3', role: 'user', text: 'c', createdAt: at(70) },
      ],
      progress: [],
      activities: [
        { id: 't1', runId: 'r', name: 'frames', status: 'finished', startedAt: at(80) },
        { id: 't2', runId: 'r', name: 'generate', status: 'started', startedAt: at(90) },
      ],
      checkpoints: [],
      approvals: [],
      decidedApprovals: [],
      generations: [],
      question: null,
      questionSeenAt: null,
    });
    expect(feed.map((i) => i.kind)).toEqual(['message', 'message', 'message', 'tools']);
    expect(feed.map((i) => (i.kind === 'message' ? i.showMeta : null))).toEqual([true, false, true, null]);
    expect(feed[3]!.kind === 'tools' && feed[3]!.activities.map((a) => a.id)).toEqual(['t1', 't2']);
  });

  it('Empfehlung im Label oder in der Beschreibung wird zum Badge', () => {
    expect(splitRecommendation('Stillstand (Empfehlung)')).toEqual({ label: 'Stillstand', description: undefined, recommended: true });
    expect(splitRecommendation('YouTube', 'Empfohlen: volle Länge')).toEqual({ label: 'YouTube', description: 'Volle Länge', recommended: true });
    expect(splitRecommendation('Beides', '16:9 und 9:16')).toMatchObject({ recommended: false });
  });
});

describe('Tungsten-Budget (§6): höchstens drei Stellen je Bildschirm', () => {
  /**
   * jsdom kennt die echte Kaskade samt Spezifität, löst `var()` aber nicht auf: Berechnete Werte enthalten dann
   * wörtlich `var(--accent…)`. Gezählt werden sichtbare Elemente, deren Farbe, Fläche, Rand, Schatten, Füllung oder
   * Kontur ein Tungsten-Token nutzt. Vererbte Schriftfarbe zählt nicht doppelt (nur der oberste Treffer), und der
   * Abspielkopf (Linie und Kappe in Lineal und Spuren) ist eine Stelle (§6 #1). Die Messung im echten Browser
   * (Screenshot-Abnahme) ergibt dieselben Stellen.
   */
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/styles/app.css'), 'utf8');
  const ACCENT = /var\(--accent(?:-hi|-line|-text|-soft)?\)/;
  const PROPS = ['background', 'background-color', 'background-image', 'color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'fill', 'stroke'];

  function hidden(el: Element): boolean {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || node.hasAttribute('hidden')) return true;
    }
    return false;
  }

  function tungstenPlaces(root: HTMLElement): string[] {
    const hits = [...root.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return PROPS.some((p) => ACCENT.test(cs.getPropertyValue(p))) && !hidden(el);
    });
    const top = hits.filter((el) => !hits.some((other) => other !== el && other.contains(el)));
    return [...new Set(top.map((el) => (el.closest('[class*="playhead"]') ? 'playhead' : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`)))];
  }

  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  });
  afterEach(() => style.remove());

  async function workspace(): Promise<Studio> {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    return studio;
  }

  it('offener Checkpoint, Text im Composer: Abspielkopf und der Primärknopf des Docks (Senden ist secondary)', async () => {
    const studio = await workspace();
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 12.5);
    });
    act(() => studio.store.getState().setComposer([{ type: 'text', text: 'Mach den Refrain wärmer' }], 23));
    const places = tungstenPlaces(document.body);
    expect(places.length).toBeLessThanOrEqual(3);
    expect(places).toContain('button.btn.primary');
    expect(screen.getByRole('button', { name: 'Senden' })).not.toHaveClass('primary');
  }, 60_000);

  it('Director arbeitet: Abspielkopf und Live-Punkt; Einreihen bleibt secondary', async () => {
    const studio = await workspace();
    act(() => {
      studio.api.debug.emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'r1', state: 'running' });
      studio.store.getState().setComposer([{ type: 'text', text: 'Noch etwas' }], 11);
    });
    const places = tungstenPlaces(document.body);
    expect(places.length).toBeLessThanOrEqual(3);
    expect(places).toContain('span.run-dot');
  }, 60_000);
});
