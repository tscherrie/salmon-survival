import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatMessage, RefLabelContext, ToolActivity } from '@studio/core';
import { formatDateTime, useT } from '../../i18n.ts';
import { refChipLabel, refChipTitle } from '../../lib/labels.ts';
import type { ProgressNote } from '../../state/types.ts';
import { useActions, useLabelContext, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { BudgetMeter } from './BudgetMeter.tsx';
import { ApprovalCard, CheckpointCard, GenerationQueue, QuestionCard } from './Cards.tsx';
import { DirectorMarkdown } from './DirectorMarkdown.tsx';

type FeedItem =
  | { kind: 'message'; at: string; message: ChatMessage }
  | { kind: 'progress'; at: string; note: ProgressNote }
  | { kind: 'tools'; at: string; activities: ToolActivity[] };

const UserMessage = memo(function UserMessage({ message, ctx }: { message: ChatMessage; ctx: RefLabelContext }) {
  if (!message.segments?.length) return <p className="msg-text">{message.text}</p>;
  return (
    <p className="msg-text">
      {message.segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span key={i} className={`chip chip-static chip-${seg.ref.kind}`} title={refChipTitle(seg.ref, ctx)}>
            {refChipLabel(seg.ref, ctx)}
          </span>
        ),
      )}
    </p>
  );
});

function MessageView({ message, ctx, streaming = false }: { message: ChatMessage; ctx: RefLabelContext; streaming?: boolean }) {
  const t = useT();
  const who = message.role === 'user' ? t('director.you') : message.role === 'director' ? t('director.name') : t('director.system');
  return (
    <article className={`msg msg-${message.role}${streaming ? ' is-streaming' : ''}`} aria-busy={streaming || undefined}>
      <header className="msg-meta">
        <span className="msg-author">{who}</span>
        {streaming ? <span className="typing">{t('director.typing')}</span> : <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>}
      </header>
      {message.role === 'user' ? <UserMessage message={message} ctx={ctx} /> : <DirectorMarkdown text={message.text} />}
    </article>
  );
}

function ToolGroup({ activities }: { activities: ToolActivity[] }) {
  const t = useT();
  const last = activities[activities.length - 1]!;
  const running = activities.some((a) => a.status === 'started');
  return (
    <details className={`tools${running ? ' is-running' : ''}`}>
      <summary>
        <Icon name="tools" size={12} />
        <span className="tools-count">
          {t('director.tools')} · {activities.length}
        </span>
        <span className="tools-last">
          {last.name} – {t(`director.tool.${last.status}`)}
        </span>
      </summary>
      <ul>
        {activities.map((a) => (
          <li key={a.id} className={`tool tool-${a.status}`}>
            <code>{a.name}</code>
            <span className="tool-status">{t(`director.tool.${a.status}`)}</span>
            {a.summary && <span className="tool-summary">{a.summary}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RunIndicator() {
  const t = useT();
  const runState = useStudio((s) => s.runState);
  const error = useStudio((s) => s.runError);
  return (
    <span className={`run-indicator run-${runState}`} role="status" title={error ?? undefined}>
      <span className="run-dot" aria-hidden="true" />
      {t(`director.run.${runState}`)}
    </span>
  );
}

/** Director-Panel: Gespräch, Fortschritt, Werkzeuge, Rückfragen, Checkpoints, Genehmigungen, Kosten. */
export function DirectorPanel() {
  const t = useT();
  const actions = useActions();
  const messages = useStudio((s) => s.messages);
  const streaming = useStudio((s) => s.streaming);
  const progress = useStudio((s) => s.progress);
  const activities = useStudio((s) => s.activities);
  const question = useStudio((s) => s.question);
  const checkpoints = useStudio((s) => s.checkpoints);
  const approvals = useStudio((s) => s.approvals);
  const generations = useStudio((s) => s.generations);
  const budget = useStudio((s) => s.budget);
  const runState = useStudio((s) => s.runState);
  const ctx = useLabelContext();
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const feed = useMemo(() => {
    const items: FeedItem[] = [
      ...messages.map((message) => ({ kind: 'message' as const, at: message.createdAt, message })),
      ...progress.map((note) => ({ kind: 'progress' as const, at: note.at, note })),
      ...activities.map((a) => ({ kind: 'tools' as const, at: a.startedAt, activities: [a] })),
    ];
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // Aufeinanderfolgende Werkzeugschritte zusammenfassen
    const grouped: FeedItem[] = [];
    for (const item of items) {
      const last = grouped[grouped.length - 1];
      if (item.kind === 'tools' && last?.kind === 'tools') last.activities = [...last.activities, ...item.activities];
      else grouped.push(item.kind === 'tools' ? { ...item, activities: [...item.activities] } : item);
    }
    return grouped;
  }, [messages, progress, activities]);

  const proposed = checkpoints.filter((c) => c.status === 'proposed');
  const streamingEntries = Object.entries(streaming);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed, streaming, question, proposed.length, approvals.length]);

  return (
    <aside className="director" aria-label={t('director.label')}>
      <header className="director-header">
        <h2>{t('director.label')}</h2>
        <RunIndicator />
        <span className="spacer" />
        {runState === 'running' && (
          <button type="button" className="button button-small button-danger" onClick={() => void actions.interrupt()}>
            <Icon name="stop" size={12} /> {t('director.stop')}
          </button>
        )}
      </header>
      <div
        className="director-feed"
        ref={feedRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {feed.length === 0 && streamingEntries.length === 0 && <p className="director-empty">{t('director.empty')}</p>}
        {feed.map((item) => {
          if (item.kind === 'message') return <MessageView key={item.message.id} message={item.message} ctx={ctx} />;
          if (item.kind === 'progress')
            return (
              <p key={item.note.id} className="progress-note">
                {item.note.text}
              </p>
            );
          return <ToolGroup key={item.activities[0]!.id} activities={item.activities} />;
        })}
        {streamingEntries.map(([id, text]) => (
          <MessageView key={id} message={{ id, role: 'director', text, createdAt: new Date().toISOString() }} ctx={ctx} streaming />
        ))}
        {question && <QuestionCard question={question} />}
        {proposed.map((c) => (
          <CheckpointCard key={c.id} checkpoint={c} />
        ))}
        {approvals.map((a) => (
          <ApprovalCard key={a.id} request={a} />
        ))}
      </div>
      <footer className="director-footer">
        <GenerationQueue generations={generations} />
        <details className="budget-details">
          <summary>
            <Icon name="budget" size={13} /> {t('header.budget')}
            <BudgetMeter budget={budget} />
          </summary>
          <BudgetMeter budget={budget} detailed />
        </details>
      </footer>
    </aside>
  );
}
