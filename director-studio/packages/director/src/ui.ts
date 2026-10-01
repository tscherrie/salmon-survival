import { defaultIdGenerator, type ApprovalRequest, type DirectorQuestion, type IdGenerator, type StudioEvent } from '@studio/core';
import { systemClock, type Clock, type UiPort } from './ports.ts';
import { abortError } from './util.ts';

interface PendingQuestion {
  questionId: string;
  questions: DirectorQuestion[];
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Fertige UiPort-Implementierung über Ereignisse: Rückfragen und Freigaben werden als `question` /
 * `approval` gemeldet und blockieren, bis die App `answerQuestion` bzw. `decideApproval` aufruft
 * (StudioApi → IPC). Abbruch über das AbortSignal des Laufs.
 */
export class InteractiveUi implements UiPort {
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly approvals = new Map<string, PendingApproval>();
  private runId: string | null = null;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(private readonly options: { projectId: string; emit: (event: StudioEvent) => void; clock?: Clock; ids?: IdGenerator }) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? defaultIdGenerator;
  }

  emit(event: StudioEvent): void {
    if (event.type === 'run_state') this.runId = event.runId;
    this.options.emit(event);
  }

  askUser(questions: DirectorQuestion[], signal: AbortSignal): Promise<Record<string, string>> {
    if (signal.aborted) return Promise.reject(abortError());
    const questionId = this.ids('qst');
    return new Promise<Record<string, string>>((resolve, reject) => {
      const onAbort = () => {
        if (!this.questions.delete(questionId)) return;
        this.options.emit({ type: 'question_resolved', projectId: this.options.projectId, questionId });
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.questions.set(questionId, {
        questionId,
        questions,
        resolve: (answers) => {
          signal.removeEventListener('abort', onAbort);
          resolve(answers);
        },
        reject,
      });
      this.options.emit({ type: 'question', projectId: this.options.projectId, runId: this.runId ?? '', questions, questionId });
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

  requestApproval(req: Omit<ApprovalRequest, 'id' | 'createdAt'>, signal: AbortSignal): Promise<boolean> {
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

  pendingQuestion(): { questionId: string; questions: DirectorQuestion[] } | null {
    const first = this.questions.values().next().value as PendingQuestion | undefined;
    return first ? { questionId: first.questionId, questions: first.questions } : null;
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].map((a) => a.request);
  }
}
