import { defaultIdGenerator, type ApprovalRequest, type DirectorQuestion, type IdGenerator, type StudioEvent } from '@studio/core';
import { systemClock, type Clock, type UiPort, type UiRequestMeta } from './ports.ts';
import { abortError } from './util.ts';

interface PendingQuestion {
  questionId: string;
  runId: string;
  questions: DirectorQuestion[];
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

interface PendingApproval {
  request: ApprovalRequest;
  runId: string | undefined;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Fertige UiPort-Implementierung über Ereignisse: Rückfragen und Freigaben werden als `question` /
 * `approval` gemeldet und blockieren, bis die App `answerQuestion` bzw. `decideApproval` aufruft
 * (StudioApi → IPC). Abbruch über das AbortSignal des Laufs. Die Lauf-ID kommt explizit vom Aufrufer
 * (`meta.runId`), nicht aus zuletzt gesehenen `run_state`-Ereignissen – sonst trüge eine Rückfrage eines
 * Subagenten oder eines noch laufenden Hintergrund-Tools die ID eines späteren Laufs.
 */
export class InteractiveUi implements UiPort {
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(private readonly options: { projectId: string; emit: (event: StudioEvent) => void; clock?: Clock; ids?: IdGenerator }) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? defaultIdGenerator;
  }

  emit(event: StudioEvent): void {
    this.options.emit(event);
  }

  askUser(questions: DirectorQuestion[], signal: AbortSignal, meta?: UiRequestMeta): Promise<Record<string, string>> {
    if (signal.aborted) return Promise.reject(abortError());
    const questionId = this.ids('qst');
    const runId = meta?.runId ?? '';
    return new Promise<Record<string, string>>((resolve, reject) => {
      const onAbort = () => {
        if (!this.questions.delete(questionId)) return;
        this.options.emit({ type: 'question_resolved', projectId: this.options.projectId, questionId });
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.questions.set(questionId, {
        questionId,
        runId,
        questions,
        resolve: (answers) => {
          signal.removeEventListener('abort', onAbort);
          resolve(answers);
        },
        reject,
      });
      this.options.emit({ type: 'question', projectId: this.options.projectId, runId, questions, questionId });
    });
  }

  /** Antwort des Nutzers (Frage-ID der Einzelfrage → Label oder Freitext). */
  answerQuestion(questionId: string, answers: Record<string, string>): boolean {
    const pending = this.questions.get(questionId);
    if (!pending) return false;
    this.questions.delete(questionId);
    this.options.emit({ type: 'question_resolved', projectId: this.options.projectId, questionId });
    pending.resolve(answers);
    return true;
  }

  requestApproval(req: Omit<ApprovalRequest, 'id' | 'createdAt'>, signal: AbortSignal, meta?: UiRequestMeta): Promise<boolean> {
    if (signal.aborted) return Promise.reject(abortError());
    const request: ApprovalRequest = { ...req, id: this.ids('apr'), createdAt: this.clock() };
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = () => {
        if (!this.approvals.delete(request.id)) return;
        this.options.emit({ type: 'approval_resolved', projectId: this.options.projectId, approvalId: request.id, approved: false });
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.approvals.set(request.id, {
        request,
        runId: meta?.runId,
        resolve: (approved) => {
          signal.removeEventListener('abort', onAbort);
          resolve(approved);
        },
        reject,
      });
      this.options.emit({ type: 'approval', projectId: this.options.projectId, request });
    });
  }

  decideApproval(approvalId: string, approved: boolean): boolean {
    const pending = this.approvals.get(approvalId);
    if (!pending) return false;
    this.approvals.delete(approvalId);
    this.options.emit({ type: 'approval_resolved', projectId: this.options.projectId, approvalId, approved });
    pending.resolve(approved);
    return true;
  }

  /** Älteste offene Rückfrage samt Lauf, aus dem sie stammt. */
  pendingQuestion(): { questionId: string; runId: string; questions: DirectorQuestion[] } | null {
    const first = this.questions.values().next().value as PendingQuestion | undefined;
    return first ? { questionId: first.questionId, runId: first.runId, questions: first.questions } : null;
  }

  /** Offene Freigaben; mit `runId` nur die dieses Laufs. */
  pendingApprovals(runId?: string): ApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => runId === undefined || a.runId === runId).map((a) => a.request);
  }
}
