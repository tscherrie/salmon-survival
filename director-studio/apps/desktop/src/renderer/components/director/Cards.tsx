import { useEffect, useId, useState } from 'react';
import { formatUsd, type ApprovalRequest, type Checkpoint, type DirectorQuestion, type Generation } from '@studio/core';
import { useT } from '../../i18n.ts';
import { formatElapsed } from '../../lib/hooks.ts';
import type { PendingQuestion } from '../../state/types.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { DirectorMarkdown } from './DirectorMarkdown.tsx';

// ───────────────────────── Rückfrage ─────────────────────────

interface AnswerState {
  selected: string[];
  other: string;
  otherOn: boolean;
}

function answerText(q: DirectorQuestion, a: AnswerState | undefined): string {
  if (!a) return '';
  const parts = [...a.selected];
  if (a.otherOn && a.other.trim()) parts.push(a.other.trim());
  return parts.join(', ');
}

/** Rückfrage-Karte: Optionen je Frage (Einzel-/Mehrfachauswahl), „Andere …“ mit Freitext. */
export function QuestionCard({ question }: { question: PendingQuestion }) {
  const t = useT();
  const actions = useActions();
  const baseId = useId();
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAnswers({});
    setSubmitting(false);
  }, [question.questionId]);

  const update = (q: DirectorQuestion, patch: (a: AnswerState) => AnswerState) =>
    setAnswers((all) => ({ ...all, [q.id]: patch(all[q.id] ?? { selected: [], other: '', otherOn: false }) }));

  const complete = question.questions.every((q) => answerText(q, answers[q.id]) !== '');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || submitting) return;
    setSubmitting(true);
    const payload: Record<string, string> = {};
    for (const q of question.questions) payload[q.id] = answerText(q, answers[q.id]);
    await actions.answerQuestion(payload);
    setSubmitting(false);
  };

  return (
    <form className="card question-card" onSubmit={submit} aria-label={t('director.question')}>
      <header className="card-header">
        <Icon name="dot" size={10} />
        <span>{t('director.question')}</span>
      </header>
      {question.questions.map((q, qi) => {
        const a = answers[q.id];
        const name = `${baseId}-${qi}`;
        return (
          <fieldset key={q.id} className="question">
            <legend>
              {q.header && <span className="badge">{q.header}</span>} {q.question}
            </legend>
            {q.options.map((option) => {
              const checked = !!a?.selected.includes(option.label);
              return (
                <label key={option.label} className={`option${checked ? ' is-checked' : ''}`}>
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={name}
                    checked={checked}
                    onChange={() =>
                      update(q, (cur) =>
                        q.multiSelect
                          ? { ...cur, selected: checked ? cur.selected.filter((s) => s !== option.label) : [...cur.selected, option.label] }
                          : { selected: [option.label], other: cur.other, otherOn: false },
                      )
                    }
                  />
                  <span className="option-text">
                    <span className="option-label">{option.label}</span>
                    {option.description && <span className="option-desc">{option.description}</span>}
                  </span>
                </label>
              );
            })}
            <label className={`option option-other${a?.otherOn ? ' is-checked' : ''}`}>
              <input
                type={q.multiSelect ? 'checkbox' : 'radio'}
                name={name}
                checked={!!a?.otherOn}
                onChange={() => update(q, (cur) => (q.multiSelect ? { ...cur, otherOn: !cur.otherOn } : { selected: [], other: cur.other, otherOn: true }))}
              />
              <span className="option-text">
                <span className="option-label">{t('director.other')}</span>
              </span>
            </label>
            {a?.otherOn && (
              <input
                type="text"
                className="text-input"
                value={a.other}
                placeholder={t('director.otherPlaceholder')}
                aria-label={`${q.question} – ${t('director.otherPlaceholder')}`}
                onChange={(e) => update(q, (cur) => ({ ...cur, other: e.target.value }))}
                autoFocus
              />
            )}
          </fieldset>
        );
      })}
      <div className="card-actions">
        <button type="submit" className="button button-primary" disabled={!complete || submitting}>
          {t('director.answer')}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────── Checkpoint ─────────────────────────

/** Checkpoint-Karte: Zusammenfassung, Belege, beantragtes Budget (editierbar), Freigeben/Ändern. */
export function CheckpointCard({ checkpoint }: { checkpoint: Checkpoint }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const assets = useStudio((s) => s.assets);
  const inputId = useId();
  const [budget, setBudget] = useState(() => String(checkpoint.budgetRequestedUsd ?? 0));
  const [changes, setChanges] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBudget(String(checkpoint.budgetRequestedUsd ?? 0));
    setChanges(false);
    setFeedback('');
  }, [checkpoint.id, checkpoint.proposedAt, checkpoint.budgetRequestedUsd]);

  const amount = Number(budget.replace(',', '.'));
  const valid = Number.isFinite(amount) && amount >= 0;
  const linked = (checkpoint.assetIds ?? []).map((id) => assets.find((a) => a.id === id)).filter((a) => !!a);

  const approve = async () => {
    if (!valid) return;
    setBusy(true);
    await actions.decideCheckpoint(checkpoint.id, { decision: 'approve', budgetApprovedUsd: Math.round(amount * 100) / 100 });
    setBusy(false);
  };
  const requestChanges = async () => {
    if (!feedback.trim()) return;
    setBusy(true);
    await actions.decideCheckpoint(checkpoint.id, { decision: 'request_changes', feedback: feedback.trim() });
    setBusy(false);
  };

  return (
    <article className="card checkpoint-card" aria-label={`${t('director.checkpoint')}: ${checkpoint.title}`}>
      <header className="card-header">
        <Icon name="check" size={14} />
        <span>{t('director.checkpoint')}</span>
        <strong className="card-title">{checkpoint.title}</strong>
      </header>
      {checkpoint.summary && <DirectorMarkdown text={checkpoint.summary} />}
      {linked.length > 0 && (
        <div className="checkpoint-assets" aria-label={t('director.attachments')}>
          {linked.map((asset) => (
            <button key={asset.id} type="button" className="checkpoint-asset" onClick={() => actions.insertRef({ kind: 'asset', assetId: asset.id })} title={asset.title}>
              {asset.kind === 'image' || asset.kind === 'video' ? <img src={assetUrl(asset.id, 'thumb')} alt="" /> : <Icon name="text" size={18} />}
              <span>{asset.title}</span>
            </button>
          ))}
        </div>
      )}
      <div className="checkpoint-budget">
        <label htmlFor={inputId}>{t('director.budgetRequested')}</label>
        <div className="money-input">
          <span>$</span>
          <input id={inputId} type="number" min={0} step={0.5} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-invalid={!valid} />
        </div>
      </div>
      <div className="card-actions">
        <button type="button" className="button button-primary" onClick={() => void approve()} disabled={!valid || busy}>
          {t('director.approve', { amount: valid ? formatUsd(amount) : '—' })}
        </button>
        <button type="button" className="button" aria-expanded={changes} onClick={() => setChanges((v) => !v)}>
          {t('director.requestChanges')}
        </button>
      </div>
      {changes && (
        <div className="checkpoint-feedback">
          <textarea
            className="text-input"
            rows={3}
            value={feedback}
            placeholder={t('director.feedbackPlaceholder')}
            aria-label={t('director.feedbackPlaceholder')}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
          />
          <button type="button" className="button" onClick={() => void requestChanges()} disabled={!feedback.trim() || busy}>
            {t('director.sendFeedback')}
          </button>
        </div>
      )}
    </article>
  );
}

// ───────────────────────── Genehmigung ─────────────────────────

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const t = useT();
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const decide = async (approved: boolean) => {
    setBusy(true);
    await actions.decideApproval(request.id, approved);
    setBusy(false);
  };
  return (
    <article className="card approval-card" aria-label={`${t('director.approval')}: ${request.title}`}>
      <header className="card-header">
        <Icon name="warning" size={14} />
        <span>
          {t('director.approval')} · {t(`director.approval.${request.kind}`)}
        </span>
      </header>
      <strong className="card-title">{request.title}</strong>
      <p>{request.detail}</p>
      {request.amountUsd !== undefined && <p className="approval-amount">{formatUsd(request.amountUsd)}</p>}
      <div className="card-actions">
        <button type="button" className="button button-primary" onClick={() => void decide(true)} disabled={busy}>
          {t('director.grant')}
          {request.amountUsd !== undefined ? ` (${formatUsd(request.amountUsd)})` : ''}
        </button>
        <button type="button" className="button" onClick={() => void decide(false)} disabled={busy}>
          {t('director.deny')}
        </button>
      </div>
    </article>
  );
}

// ───────────────────────── Warteschlange ─────────────────────────

export function GenerationQueue({ generations }: { generations: Generation[] }) {
  const t = useT();
  const models = useStudio((s) => s.models);
  const [now, setNow] = useState(() => Date.now());
  const active = generations.filter((g) => g.status === 'queued' || g.status === 'running');
  useEffect(() => {
    if (!active.some((g) => g.status === 'running')) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active.length, active]);
  if (active.length === 0) return null;
  const nameOf = (id: string) => models?.find((m) => m.id === id)?.displayName ?? id.split('/').slice(-2).join('/');
  const first = active.find((g) => g.status === 'running') ?? active[0]!;
  return (
    <details className="gen-queue" aria-label={t('director.queue')}>
      <summary>
        <span className={`gen-status${first.status === 'running' ? ' is-running' : ''}`} aria-hidden="true" />
        <span>
          {t('director.queue')} ({active.length})
        </span>
        <span className="gen-queue-first">{first.purpose}</span>
      </summary>
      <ul>
        {active.map((g) => (
          <li key={g.id} className={`gen gen-${g.status}`}>
            <span className={`gen-status${g.status === 'running' ? ' is-running' : ''}`} aria-hidden="true" />
            <span className="gen-main">
              <span className="gen-purpose">{g.purpose}</span>
              <span className="gen-meta">
                {nameOf(g.endpointId)} ·{' '}
                {g.status === 'queued'
                  ? g.queuePosition
                    ? t('director.queuePosition', { n: g.queuePosition })
                    : t('director.gen.queued')
                  : t('director.queueRunning', { elapsed: formatElapsed(now - new Date(g.submittedAt ?? g.createdAt).getTime()) })}{' '}
                · {t('director.queueEstimate', { amount: formatUsd(g.estimateUsd) })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
