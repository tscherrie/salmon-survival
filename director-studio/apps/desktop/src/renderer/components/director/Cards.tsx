import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatUsd, type ApprovalRequest, type Checkpoint, type DirectorQuestion } from '@studio/core';
import { useT } from '../../i18n.ts';
import type { PendingQuestion } from '../../state/types.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { ASSET_KIND_ICONS, Icon } from '../common/Icon.tsx';
import { DirectorMarkdown } from './DirectorMarkdown.tsx';
import { checkpointNumber, splitRecommendation } from './history.ts';

/**
 * Karten der angedockten Entscheidung (DESIGN.md §7.6.3): Rückfrage, Checkpoint, Genehmigung. Kompakt gesetzt
 * (Kicker, Kartentitel 13.5/600, Text 12.5) und nur im Dock zu sehen, nie im Verlauf. Genau ein Primärknopf je
 * Karte; er ist der einzige im sichtbaren Kontext (Tungsten-Budget §6).
 */

/** Beträge im Fließtext in Mono setzen („Überschreitet das Budget um `$3.20`.“). */
function withMonoAmounts(text: string): ReactNode[] {
  return text.split(/(\$\d[\d,]*(?:\.\d+)?)/g).map((part, i) => (i % 2 === 1 ? <span key={i} className="mono">{part}</span> : part));
}

// ───────────────────────── Rückfrage ─────────────────────────

interface AnswerState {
  selected: string[];
  other: string;
  otherOn: boolean;
}

function answerText(a: AnswerState | undefined): string {
  if (!a) return '';
  const parts = [...a.selected];
  if (a.otherOn && a.other.trim()) parts.push(a.other.trim());
  return parts.join(', ');
}

/** Rückfrage: je Frage Radio- bzw. Checkbox-Zeilen, „Andere …“ mit Freitext; Antworten (primär) und Später. */
export function QuestionCard({ question, onLater }: { question: PendingQuestion; onLater?: (() => void) | undefined }) {
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

  const complete = question.questions.every((q) => answerText(answers[q.id]) !== '');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || submitting) return;
    setSubmitting(true);
    const payload: Record<string, string> = {};
    for (const q of question.questions) payload[q.id] = answerText(answers[q.id]);
    await actions.answerQuestion(payload);
    setSubmitting(false);
  };

  return (
    <form className="card dock-card question-card" onSubmit={submit} aria-label={t('director.question')}>
      {question.questions.map((q, qi) => {
        const a = answers[q.id];
        const name = `${baseId}-${qi}`;
        const type = q.multiSelect ? 'checkbox' : 'radio';
        return (
          <fieldset key={q.id} className="question">
            <legend>
              {q.header && <span className="overline question-kicker">{q.header}</span>}
              <span className="card-title">{q.question}</span>
            </legend>
            <div className="options">
              {q.options.map((option) => {
                const checked = !!a?.selected.includes(option.label);
                const shown = splitRecommendation(option.label, option.description);
                return (
                  <label key={option.label} className={`option${checked ? ' is-checked' : ''}`}>
                    <span className={`opt-mark opt-${type}`}>
                      <input
                        type={type}
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
                      {q.multiSelect && <Icon name="check" size={10} />}
                    </span>
                    <span className="option-text">
                      <span className="option-label">
                        {shown.label}
                        {shown.recommended && <span className="badge">{t('dock.recommended')}</span>}
                      </span>
                      {shown.description && <span className="option-desc">{shown.description}</span>}
                    </span>
                  </label>
                );
              })}
              <label className={`option option-other${a?.otherOn ? ' is-checked' : ''}`}>
                <span className={`opt-mark opt-${type}`}>
                  <input
                    type={type}
                    name={name}
                    checked={!!a?.otherOn}
                    onChange={() => update(q, (cur) => (q.multiSelect ? { ...cur, otherOn: !cur.otherOn } : { selected: [], other: cur.other, otherOn: true }))}
                  />
                  {q.multiSelect && <Icon name="check" size={10} />}
                </span>
                <span className="option-text">
                  <span className="option-label">{t('director.other')}</span>
                </span>
              </label>
              {a?.otherOn && (
                <input
                  type="text"
                  className="field option-field"
                  value={a.other}
                  placeholder={t('director.otherPlaceholder')}
                  aria-label={`${q.question} – ${t('director.otherPlaceholder')}`}
                  onChange={(e) => update(q, (cur) => ({ ...cur, other: e.target.value }))}
                  autoFocus
                />
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="card-actions">
        <button type="submit" className="btn primary" disabled={!complete || submitting} aria-busy={submitting || undefined}>
          {t('director.answer')}
        </button>
        {onLater && (
          <button type="button" className="btn ghost" onClick={onLater}>
            {t('dock.later')}
          </button>
        )}
      </div>
    </form>
  );
}

// ───────────────────────── Checkpoint ─────────────────────────

/** Zusammenfassung höchstens drei Zeilen; „Mehr“ nur, wenn der Text wirklich abgeschnitten ist. */
function ClampedSummary({ text }: { text: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className="card-summary">
      <div ref={ref} className={`card-summary-text${open ? ' is-open' : ''}`}>
        <DirectorMarkdown text={text} />
      </div>
      {(overflows || open) && (
        <button type="button" className="link-button card-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('dock.less') : t('dock.more')}
        </button>
      )}
    </div>
  );
}

/**
 * Checkpoint zur Freigabe: Kicker „Checkpoint 3 von 5“ mit neutraler Pill, Titel, Zusammenfassung, bis zu vier Belege,
 * Budgetzeile mit editierbarem Mono-Betrag und darunter dem Schalter für die Aufschlüsselung (eingeklappt, §10),
 * Freigeben (primär) und Ändern … So bleibt die Karte im Dock kurz.
 */
export function CheckpointCard({ checkpoint }: { checkpoint: Checkpoint }) {
  const t = useT();
  const actions = useActions();
  const assetUrl = useAssetUrl();
  const assets = useStudio((s) => s.assets);
  const checkpoints = useStudio((s) => s.checkpoints);
  const budgetSummary = useStudio((s) => s.budget);
  const inputId = useId();
  const breakdownId = useId();
  const errorId = useId();
  const [budget, setBudget] = useState(() => String(checkpoint.budgetRequestedUsd ?? 0));
  const [breakdown, setBreakdown] = useState(false);
  const [changes, setChanges] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBudget(String(checkpoint.budgetRequestedUsd ?? 0));
    setChanges(false);
    setFeedback('');
  }, [checkpoint.id, checkpoint.proposedAt, checkpoint.budgetRequestedUsd]);

  const amount = Number(budget.replace(',', '.'));
  const valid = budget.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  const linked = (checkpoint.assetIds ?? []).map((id) => assets.find((a) => a.id === id)).filter((a) => !!a).slice(0, 4);
  const n = checkpointNumber(checkpoints, checkpoint.id);
  const next = n > 0 ? checkpoints[n] : undefined;
  const amountText = valid ? formatUsd(amount) : '—';

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

  const approvedSoFar = budgetSummary?.approvedUsd ?? 0;
  const spent = budgetSummary?.spentUsd ?? 0;
  const after = approvedSoFar + (valid ? amount : 0);

  return (
    <article className="card dock-card checkpoint-card" aria-label={`${t('director.checkpoint')}: ${checkpoint.title}`}>
      <header className="card-kicker">
        <span className="overline">{n > 0 ? t('dock.checkpointOf', { n, total: checkpoints.length }) : t('director.checkpoint')}</span>
        <span className="badge">{t('cpStatus.proposed')}</span>
      </header>
      <h3 className="card-title">{checkpoint.title}</h3>
      {checkpoint.summary && <ClampedSummary text={checkpoint.summary} />}
      {linked.length > 0 && (
        <div className="cp-evidence" role="group" aria-label={t('director.attachments')}>
          {linked.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="cp-thumb"
              title={asset.title}
              aria-label={t('dock.evidence', { title: asset.title })}
              onClick={() => actions.insertRef({ kind: 'asset', assetId: asset.id })}
            >
              {asset.kind === 'image' || asset.kind === 'video' ? <img src={assetUrl(asset.id, 'thumb')} alt="" /> : <Icon name={ASSET_KIND_ICONS[asset.kind]} size={14} />}
            </button>
          ))}
        </div>
      )}
      <div className="cp-budget">
        <label htmlFor={inputId}>{next ? t('dock.budgetFor', { title: next.title }) : t('dock.budget')}</label>
        <button type="button" className="cp-breakdown-toggle" aria-expanded={breakdown} aria-controls={breakdown ? breakdownId : undefined} onClick={() => setBreakdown((v) => !v)}>
          {t('dock.breakdown')}
          <Icon name="chevronDown" size={12} />
        </button>
        <span className="money-input">
          <span aria-hidden="true">$</span>
          <input
            id={inputId}
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={budget}
            aria-label={t('director.budgetRequested')}
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : errorId}
            onChange={(e) => setBudget(e.target.value)}
          />
        </span>
        {!valid && (
          <p className="field-error cp-budget-error" id={errorId}>
            {t('dock.budgetInvalid')}
          </p>
        )}
      </div>
      {breakdown && (
        <div className="cp-breakdown" id={breakdownId}>
          <dl>
            <div>
              <dt>{t('dock.breakdown.approved')}</dt>
              <dd className="mono">{formatUsd(approvedSoFar)}</dd>
            </div>
            <div>
              <dt>{t('dock.breakdown.request')}</dt>
              <dd className="mono">{amountText}</dd>
            </div>
            <div>
              <dt>{t('dock.breakdown.spent')}</dt>
              <dd className="mono">{formatUsd(spent)}</dd>
            </div>
          </dl>
          <div className="cp-after">
            <span>{t('dock.breakdown.after')}</span>
            <span className="cp-meter" aria-hidden="true">
              <i style={{ width: `${after > 0 ? Math.min(100, (spent / after) * 100) : 0}%` }} />
            </span>
            <span className="mono">
              {formatUsd(spent)} <span className="cp-after-total">/ {formatUsd(after)}</span>
            </span>
          </div>
        </div>
      )}
      {changes && (
        <div className="cp-feedback">
          <textarea
            className="field"
            rows={3}
            value={feedback}
            placeholder={t('director.feedbackPlaceholder')}
            aria-label={t('director.feedbackPlaceholder')}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn" onClick={() => void requestChanges()} disabled={!feedback.trim() || busy}>
            {t('director.sendFeedback')}
          </button>
        </div>
      )}
      <div className="card-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void approve()}
          disabled={!valid || busy}
          aria-busy={busy || undefined}
          aria-label={t('director.approve', { amount: amountText })}
        >
          {busy ? <span className="spin" aria-hidden="true" /> : <Icon name="check" size={14} />}
          <span>{t('dock.approve')}</span>
          <span className="btn-sep" aria-hidden="true">
            ·
          </span>
          <span className="mono">{amountText}</span>
        </button>
        <button type="button" className="btn" aria-expanded={changes} onClick={() => setChanges((v) => !v)}>
          {t('dock.change')}
        </button>
      </div>
    </article>
  );
}

// ───────────────────────── Genehmigung ─────────────────────────

/** Genehmigung: Warn-Icon, Kicker „Genehmigung · Budget“, Titel, ein Satz, Genehmigen (primär) und Ablehnen. */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const t = useT();
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const decide = async (approved: boolean) => {
    setBusy(true);
    await actions.decideApproval(request.id, approved);
    setBusy(false);
  };
  const amount = request.amountUsd !== undefined ? formatUsd(request.amountUsd) : null;
  return (
    <article className="card dock-card approval-card" aria-label={`${t('director.approval')}: ${request.title}`}>
      <header className="card-kicker">
        <Icon name="warning" size={14} className="approval-icon" />
        <span className="overline">{t('dock.approvalKicker', { kind: t(`director.approval.${request.kind}`) })}</span>
      </header>
      <h3 className="card-title">{request.title}</h3>
      {request.detail && <p className="card-text">{withMonoAmounts(request.detail)}</p>}
      <div className="card-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void decide(true)}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label={amount ? `${t('director.grant')} (${amount})` : undefined}
        >
          <span>{t('director.grant')}</span>
          {amount && (
            <>
              <span className="btn-sep" aria-hidden="true">
                ·
              </span>
              <span className="mono">{amount}</span>
            </>
          )}
        </button>
        <button type="button" className="btn" onClick={() => void decide(false)} disabled={busy}>
          {t('director.deny')}
        </button>
      </div>
    </article>
  );
}
