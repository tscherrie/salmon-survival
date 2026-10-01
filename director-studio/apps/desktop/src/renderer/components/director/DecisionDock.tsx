import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatUsd, type ApprovalRequest, type Checkpoint } from '@studio/core';
import { useT } from '../../i18n.ts';
import type { PendingQuestion } from '../../state/types.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { ApprovalCard, CheckpointCard, QuestionCard } from './Cards.tsx';
import { checkpointNumber } from './history.ts';

/**
 * Angedockte Entscheidung (DESIGN.md §7.6.3): unten in der Director-Spalte, direkt über dem Composer; scrollt nie
 * weg. Reihenfolge: Rückfrage, Genehmigungen, vorgelegte Checkpoints. Ist die Spalte niedriger als 420 px (oder nach
 * „Später“), zeigt das Dock nur eine 36-px-Zeile; „Prüfen“ öffnet es als Sheet nach oben über den Verlauf.
 */

/** Unter dieser Spaltenhöhe wird das Dock automatisch zur Zeile. */
export const DOCK_COMPACT_BELOW = 420;

export type Decision =
  | { kind: 'question'; key: string; question: PendingQuestion }
  | { kind: 'approval'; key: string; request: ApprovalRequest }
  | { kind: 'checkpoint'; key: string; checkpoint: Checkpoint; n: number };

/** Offene Entscheidungen in Dock-Reihenfolge; ein erneut vorgelegter Checkpoint gilt als neue Entscheidung. */
export function collectDecisions(question: PendingQuestion | null, approvals: readonly ApprovalRequest[], checkpoints: readonly Checkpoint[]): Decision[] {
  const out: Decision[] = [];
  if (question) out.push({ kind: 'question', key: `q:${question.questionId}`, question });
  for (const request of approvals) out.push({ kind: 'approval', key: `a:${request.id}`, request });
  for (const checkpoint of checkpoints) {
    if (checkpoint.status === 'proposed') {
      out.push({ kind: 'checkpoint', key: `c:${checkpoint.id}:${checkpoint.proposedAt ?? ''}`, checkpoint, n: checkpointNumber(checkpoints, checkpoint.id) });
    }
  }
  return out;
}

function useDecisions(): Decision[] {
  const question = useStudio((s) => s.question);
  const approvals = useStudio((s) => s.approvals);
  const checkpoints = useStudio((s) => s.checkpoints);
  return useMemo(() => collectDecisions(question, approvals, checkpoints), [question, approvals, checkpoints]);
}

const ICONS: Record<Decision['kind'], IconName> = { question: 'info', approval: 'warning', checkpoint: 'check' };

function useDecisionText() {
  const t = useT();
  return {
    /** Zeile im Kompaktmodus („Checkpoint 3 wartet auf Freigabe“). */
    row(d: Decision): string {
      if (d.kind === 'checkpoint') return t('dock.compact.checkpoint', { n: d.n });
      return d.kind === 'approval' ? t('dock.compact.approval') : t('dock.compact.question');
    },
    /** Ansage bei einer neuen Entscheidung. */
    spoken(d: Decision): string {
      if (d.kind === 'checkpoint') return `${t('dock.checkpointN', { n: d.n })}: ${d.checkpoint.title}`;
      return d.kind === 'approval' ? t('dock.approvalNamed', { title: d.request.title }) : t('director.question');
    },
  };
}

function amountOf(d: Decision): number | undefined {
  if (d.kind === 'checkpoint') return d.checkpoint.budgetRequestedUsd;
  if (d.kind === 'approval') return d.request.amountUsd;
  return undefined;
}

function DecisionCard({ decision, onLater }: { decision: Decision; onLater?: (() => void) | undefined }) {
  if (decision.kind === 'question') return <QuestionCard question={decision.question} onLater={onLater} />;
  if (decision.kind === 'approval') return <ApprovalCard request={decision.request} />;
  return <CheckpointCard checkpoint={decision.checkpoint} />;
}

/** „1 von 3 offenen Entscheidungen“ mit ‹ › (nur bei mehreren). */
function Pager({ index, total, onStep }: { index: number; total: number; onStep: (delta: -1 | 1) => void }) {
  const t = useT();
  if (total < 2) return null;
  return (
    <div className="dock-pager">
      <span role="status">{t('dock.pending', { n: index + 1, total })}</span>
      <span className="spacer" />
      <button type="button" className="ibtn sm" aria-label={t('dock.prev')} disabled={index === 0} onClick={() => onStep(-1)}>
        <Icon name="chevronLeft" size={14} />
      </button>
      <button type="button" className="ibtn sm" aria-label={t('dock.next')} disabled={index >= total - 1} onClick={() => onStep(1)}>
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

export function DecisionDock({ columnHeight }: { columnHeight: number }) {
  const t = useT();
  const text = useDecisionText();
  const actions = useActions();
  const decisions = useDecisions();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const [later, setLater] = useState(false);
  const [sheet, setSheet] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Ausgewählte Entscheidung: bleibt stehen, solange sie offen ist; sonst rückt die nächste an ihre Stelle
  let index = selectedKey ? decisions.findIndex((d) => d.key === selectedKey) : -1;
  if (index < 0) index = Math.min(lastIndex.current, Math.max(0, decisions.length - 1));
  const current = decisions[index];
  useLayoutEffect(() => {
    lastIndex.current = index;
  });

  // Neue Entscheidung: ansagen (Fokus bleibt, wo er ist) und „Später“ aufheben. Was beim Öffnen schon offen war,
  // wird nicht angesagt. Läuft nur, wenn sich die Schlüssel ändern.
  const keys = decisions.map((d) => d.key).join('|');
  const latest = useRef({ decisions, text, actions, t });
  useLayoutEffect(() => {
    latest.current = { decisions, text, actions, t };
  });
  useEffect(() => {
    const { decisions: list, text: words, actions: act, t: tr } = latest.current;
    const known = seen.current;
    const fresh = list.filter((d) => !known?.has(d.key));
    seen.current = new Set(list.map((d) => d.key));
    if (!known || fresh.length === 0) return;
    setLater(false);
    act.announce(tr('dock.announce', { label: words.spoken(fresh[0]!) }));
  }, [keys]);

  // Ohne offene Entscheidung schließt das Sheet
  useEffect(() => {
    if (decisions.length === 0) setSheet(false);
  }, [decisions.length]);

  const compact = later || (columnHeight > 0 && columnHeight < DOCK_COMPACT_BELOW);

  // Sheet: Fokus hinein beim Öffnen, Esc schließt und gibt den Fokus an „Prüfen“ zurück
  useEffect(() => {
    if (!sheet || !compact) return;
    const first = sheetRef.current?.querySelector<HTMLElement>('input:not([disabled]), textarea, button:not([disabled])');
    (first ?? sheetRef.current)?.focus();
  }, [sheet, compact]);

  if (!current) return null;

  const step = (delta: -1 | 1) => {
    const next = decisions[Math.max(0, Math.min(decisions.length - 1, index + delta))];
    if (next) setSelectedKey(next.key);
  };
  const closeSheet = () => {
    setSheet(false);
    requestAnimationFrame(() => reviewRef.current?.focus());
  };
  const onLater = () => {
    setLater(true);
    setSheet(false);
  };

  if (!compact) {
    return (
      <section className="dock" aria-label={t('dock.label')}>
        <Pager index={index} total={decisions.length} onStep={step} />
        <DecisionCard key={current.key} decision={current} onLater={onLater} />
      </section>
    );
  }

  const amount = amountOf(current);
  const more = decisions.length - 1;
  return (
    <section className={`dock is-compact${sheet ? ' has-sheet' : ''}`} aria-label={t('dock.label')}>
      <div className="dock-row">
        <Icon name={ICONS[current.kind]} size={14} className={`dock-row-icon dock-icon-${current.kind}`} />
        <span className="dock-row-label" role="status">
          {text.row(current)}
        </span>
        {more > 0 && <span className="dock-row-more mono">+{more}</span>}
        {amount !== undefined && <span className="dock-row-amount mono">{formatUsd(amount)}</span>}
        <button ref={reviewRef} type="button" className="btn primary sm" aria-expanded={sheet} aria-haspopup="dialog" onClick={() => setSheet(true)} disabled={sheet}>
          {t('dock.review')}
        </button>
      </div>
      {sheet && (
        <div
          ref={sheetRef}
          className="dock-sheet"
          role="dialog"
          aria-label={t('dock.label')}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeSheet();
            }
          }}
        >
          <div className="dock-sheet-head">
            <Pager index={index} total={decisions.length} onStep={step} />
            <button type="button" className="ibtn sm dock-sheet-close" aria-label={t('common.close')} onClick={closeSheet}>
              <Icon name="chevronDown" size={14} />
            </button>
          </div>
          <DecisionCard key={current.key} decision={current} onLater={onLater} />
        </div>
      )}
    </section>
  );
}
