import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatUsd, type ChatMessage, type Generation, type ProjectCategory, type ToolActivity } from '@studio/core';
import { useT, type MessageKey } from '../../i18n.ts';
import type { ChipLabelContext } from '../../lib/labels.ts';
import { useElementSize } from '../../lib/hooks.ts';
import { useLayout } from '../../lib/layout.ts';
import { useActions, useApi, useLabelContext, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { StaticRefChip } from '../common/RefChip.tsx';
import { ariaKeyShortcuts } from '../common/Kbd.tsx';
import { Popover } from '../common/Popover.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { openModelPicker } from '../picker/ModelPicker.tsx';
import { openBudgetPopover } from './BudgetMeter.tsx';
import { DecisionDock } from './DecisionDock.tsx';
import { DirectorMarkdown } from './DirectorMarkdown.tsx';
import { activityLabel, activitySpanMs, buildFeed, formatClock, formatDuration, groupSummary, rawToolName, type SystemLine } from './history.ts';
import { JobTray } from './JobTray.tsx';
import { setTechDetails, useTechDetails } from './techDetails.ts';

/**
 * Director-Spalte (DESIGN.md §7.6): Kopf (42 px) mit Laufzustand, Stopp und ⋯-Menü · Verlauf (scrollt, unten
 * verankert) · Job-Zeile · angedockte Entscheidung. Darunter folgt im Raster der Composer – ohne Linie dazwischen.
 */

/** Nach so viel Abstand vom unteren Ende bleibt der Verlauf nicht mehr unten kleben (bestehendes Verhalten). */
const STICK_PX = 80;

/** Sekundentakt, solange `active` (laufende Werkzeugschritte). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// ───────────────────────── Kopf ─────────────────────────

function RunIndicator() {
  const t = useT();
  const runState = useStudio((s) => s.runState);
  const error = useStudio((s) => s.runError);
  return (
    <span className={`run-indicator run-${runState}`} role="status" title={runState === 'failed' && error ? error : undefined}>
      <span className="run-dot" aria-hidden="true" />
      {t(`director.run.${runState}`)}
    </span>
  );
}

/** ⋯-Menü: „Technische Details anzeigen“ (gespeichert) und „Kosten …“ (Budget-Popover der Kopfzeile). */
function DirectorMenu() {
  const t = useT();
  const tech = useTechDetails();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('director.more')}
      className="director-menu"
      anchor={
        <Tooltip label={t('director.more')} disabled={open}>
          <button type="button" className="ibtn" aria-label={t('director.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="more" size={16} />
          </button>
        </Tooltip>
      }
    >
      <div ref={menuRef} className="menu" role="menu" aria-label={t('director.more')} onKeyDown={onKeyDown}>
        <button type="button" role="menuitemcheckbox" aria-checked={tech} tabIndex={-1} onClick={() => setTechDetails(!tech)}>
          <span className="menu-check" aria-hidden="true">
            {tech && <Icon name="check" size={14} />}
          </span>
          {t('director.techDetails')}
        </button>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            setOpen(false);
            openBudgetPopover();
          }}
        >
          <span className="menu-check" aria-hidden="true">
            <Icon name="budget" size={14} />
          </span>
          {t('director.costs')}
        </button>
      </div>
    </Popover>
  );
}

function DirectorHeader() {
  const t = useT();
  const actions = useActions();
  const layout = useLayout();
  const runState = useStudio((s) => s.runState);
  return (
    <header className="director-header">
      <h2>{t('director.label')}</h2>
      <RunIndicator />
      <span className="spacer" />
      {runState === 'running' && (
        <button type="button" className="btn sm danger director-stop" onClick={() => void actions.interrupt()}>
          <Icon name="stop" size={12} /> {t('director.stop')}
        </button>
      )}
      <DirectorMenu />
      {layout && (
        <Tooltip label={t('layout.hideDirector')} keys={['mod', '2']}>
          <button
            type="button"
            className="ibtn"
            aria-label={t('layout.hideDirector')}
            aria-expanded={true}
            aria-keyshortcuts={ariaKeyShortcuts(['mod', '2'])}
            onClick={() => layout.toggle('director')}
          >
            <Icon name="sideRight" size={16} />
          </button>
        </Tooltip>
      )}
    </header>
  );
}

// ───────────────────────── Verlauf ─────────────────────────

const UserMessage = memo(function UserMessage({ message, ctx }: { message: ChatMessage; ctx: ChipLabelContext }) {
  if (!message.segments?.length) return <p className="msg-text">{message.text}</p>;
  return (
    <p className="msg-text">
      {message.segments.map((seg, i) => (seg.type === 'text' ? <span key={i}>{seg.text}</span> : <StaticRefChip key={i} value={seg.ref} ctx={ctx} />))}
    </p>
  );
});

function MessageView({ message, ctx, showMeta = true, streaming = false }: { message: ChatMessage; ctx: ChipLabelContext; showMeta?: boolean; streaming?: boolean }) {
  const t = useT();
  const who = message.role === 'user' ? t('director.you') : t('director.name');
  return (
    <article
      className={`msg msg-${message.role}${streaming ? ' is-streaming' : ''}${showMeta ? '' : ' is-continued'}`}
      aria-busy={streaming || undefined}
      aria-label={showMeta ? undefined : who}
    >
      {showMeta && (
        <header className="msg-meta">
          <span className="msg-author">{who}</span>
          {!streaming && <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>}
          {streaming && <span className="typing">{t('director.typing')}</span>}
        </header>
      )}
      {message.role === 'user' ? <UserMessage message={message} ctx={ctx} /> : <DirectorMarkdown text={message.text} />}
    </article>
  );
}

/** Werkzeuggruppe: eingeklappt eine Zeile („5 Schritte · Frames geprüft, … · 41 s“), aufgeklappt eine Zeile je Schritt. */
function ToolGroup({ activities, tech }: { activities: ToolActivity[]; tech: boolean }) {
  const t = useT();
  const running = activities.some((a) => a.status === 'started');
  const now = useNow(running);
  const count = activities.length;
  return (
    <details className={`tools${running ? ' is-running' : ''}`}>
      <summary>
        <Icon name="chevronRight" size={12} className="tools-chevron" />
        {running && <span className="spin" aria-hidden="true" />}
        <span className="tools-count">{count === 1 ? t('director.step') : t('director.steps', { count })}</span>
        <span className="tools-summary">{groupSummary(activities)}</span>
        <span className="tools-time mono">{formatDuration(activitySpanMs(activities, now))}</span>
      </summary>
      <ul>
        {activities.map((a) => (
          <li key={a.id} className={`tool tool-${a.status}`}>
            <span className="tool-icon" aria-hidden="true">
              {a.status === 'started' ? <span className="spin" /> : <Icon name={a.status === 'failed' ? 'close' : 'check'} size={12} />}
            </span>
            <span className="tool-main">
              {tech && <code className="tool-raw">{rawToolName(a.name)}</code>}
              <span className="tool-label">{activityLabel(a)}</span>
            </span>
            <span className="sr-only">{t(`director.tool.${a.status}`)}</span>
            <span className="tool-time mono">{formatDuration(activitySpanMs([a], now))}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Systemzeile zwischen zwei Haarlinien: Icon, Text, optional Betrag in Mono („Style Bible freigegeben · $6.00“). */
function SystemRow({ line }: { line: SystemLine }) {
  return (
    <p className={`sys-line sys-${line.tone}`} data-sys={line.id}>
      <Icon name={line.icon} size={12} className="sys-icon" />
      <span className="sys-text">
        {line.text}
        {line.amount !== undefined && (
          <>
            {' · '}
            <span className="mono">{formatUsd(line.amount)}</span>
          </>
        )}
      </span>
    </p>
  );
}

/** Fehlerkarte im Verlauf (`role="alert"`): Ursache, Kosten, Erneut versuchen, Anderes Modell … */
function ErrorCard({ generation }: { generation: Generation }) {
  const t = useT();
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const running = useStudio((s) => s.runState === 'running');
  const [busy, setBusy] = useState(false);
  const at = generation.finishedAt ?? generation.createdAt;
  const cause = generation.error?.trim() || t('director.error.unknown');
  const retry = async () => {
    if (!projectId || running) return;
    setBusy(true);
    try {
      await api.sendMessage(projectId, { segments: [{ type: 'text', text: t('director.error.retryRequest', { purpose: generation.purpose }) }] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="error-card" role="alert">
      <header className="error-kicker">
        <Icon name="warning" size={13} />
        <span className="overline">{t('director.error.kicker')}</span>
        <span className="spacer" />
        <time dateTime={at}>{formatClock(at)}</time>
      </header>
      <p className="error-text">
        <strong>{generation.purpose}</strong>
        {' · '}
        {/[.!?…]$/.test(cause) ? cause : `${cause}.`}{' '}
        {generation.costUsd ? (
          <>
            {t('director.error.cost')} <span className="mono">{formatUsd(generation.costUsd)}</span>
          </>
        ) : (
          t('director.error.noCost')
        )}
      </p>
      <div className="card-actions">
        <button type="button" className="btn sm" onClick={() => void retry()} disabled={running || busy} title={running ? t('director.error.retryBusy') : undefined}>
          <Icon name="refresh" size={12} />
          {t('director.error.retry')}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => openModelPicker(generation.modality)}>
          {t('director.error.otherModel')}
        </button>
      </div>
    </article>
  );
}

const EXAMPLE_CATEGORY: Record<ProjectCategory, string> = { video: 'video', audio: 'audio', slides: 'slides', graphic: 'graphic', web: 'web' };

/** Leerer Verlauf: ein Absatz und Beispielzeilen der Kategorie; ein Klick setzt den Text in den Composer. */
function EmptyHistory() {
  const t = useT();
  const actions = useActions();
  const category = useStudio((s) => s.manifest?.category ?? null);
  const group = category ? EXAMPLE_CATEGORY[category] : 'none';
  const examples = [1, 2, 3].map((i) => t(`director.example.${group}.${i}` as MessageKey));
  return (
    <div className="director-empty">
      <p>{t('director.empty')}</p>
      <ul className="director-examples">
        {examples.map((text) => (
          <li key={text}>
            <button
              type="button"
              className="director-example"
              onClick={() => {
                actions.setComposer([{ type: 'text', text }], text.length);
                requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus());
              }}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Verknüpfung in beide Richtungen (§9.4) für Timecode-Links im Verlauf: Hover und Blitz des Gegenstücks. */
function useLinkedTimecodes(feedRef: React.RefObject<HTMLDivElement | null>) {
  const hovered = useStudio((s) => s.hoveredRefKey);
  const flash = useStudio((s) => s.flash);
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>('.tc-link-body[data-ref-key]')) {
      el.classList.toggle('is-linked', el.dataset.refKey === hovered);
    }
  });
  useEffect(() => {
    const root = feedRef.current;
    if (!root || !flash) return;
    const hits = [...root.querySelectorAll<HTMLElement>('.tc-link-body[data-ref-key]')].filter((el) => el.dataset.refKey === flash.key);
    for (const el of hits) {
      el.classList.remove('is-flash');
      void el.offsetWidth;
      el.classList.add('is-flash');
    }
    const timer = setTimeout(() => hits.forEach((el) => el.classList.remove('is-flash')), 600);
    return () => clearTimeout(timer);
  }, [flash, feedRef]);
}

export function DirectorPanel() {
  const t = useT();
  const messages = useStudio((s) => s.messages);
  const streaming = useStudio((s) => s.streaming);
  const progress = useStudio((s) => s.progress);
  const activities = useStudio((s) => s.activities);
  const question = useStudio((s) => s.question);
  const checkpoints = useStudio((s) => s.checkpoints);
  const approvals = useStudio((s) => s.approvals);
  const decidedApprovals = useStudio((s) => s.decidedApprovals);
  const generations = useStudio((s) => s.generations);
  const tech = useTechDetails();
  const ctx = useLabelContext();
  const asideRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const { height } = useElementSize(asideRef);

  // Die Rückfrage trägt keinen Zeitpunkt: Sie steht im Verlauf dort, wo sie zuerst gesehen wurde
  const questionId = question?.questionId ?? null;
  const questionSeenAt = useMemo(() => (questionId ? new Date().toISOString() : null), [questionId]);

  const feed = useMemo(
    () =>
      buildFeed({
        messages,
        progress,
        activities,
        checkpoints,
        approvals,
        decidedApprovals,
        generations,
        question,
        questionSeenAt,
      }),
    [messages, progress, activities, checkpoints, approvals, decidedApprovals, generations, question, questionSeenAt],
  );
  const streamingEntries = Object.entries(streaming);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed, streaming]);

  // Wird der Verlauf niedriger (Dock erscheint oder wächst, Job-Zeile), bleibt er unten verankert
  useEffect(() => {
    const el = feedRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLinkedTimecodes(feedRef);

  const scrollToEnd = () => {
    const el = feedRef.current;
    if (!el) return;
    stick.current = true;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <aside className="director" aria-label={t('director.label')} ref={asideRef}>
      <DirectorHeader />
      <div className="director-body">
        <div
          className={`director-feed${scrolled ? ' is-scrolled' : ''}`}
          ref={feedRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
            stick.current = bottom;
            if (bottom !== atBottom) setAtBottom(bottom);
            if (el.scrollTop > 4 !== scrolled) setScrolled(el.scrollTop > 4);
          }}
        >
          {feed.length === 0 && streamingEntries.length === 0 && <EmptyHistory />}
          {feed.map((item) => {
            switch (item.kind) {
              case 'message':
                return <MessageView key={item.message.id} message={item.message} ctx={ctx} showMeta={item.showMeta} />;
              case 'progress':
                return (
                  <p key={item.note.id} className="progress-note">
                    {item.note.text}
                  </p>
                );
              case 'system':
                return <SystemRow key={item.line.id} line={item.line} />;
              case 'error':
                return <ErrorCard key={`err:${item.generation.id}`} generation={item.generation} />;
              case 'tools':
                return <ToolGroup key={item.activities[0]!.id} activities={item.activities} tech={tech} />;
            }
          })}
          {streamingEntries.map(([id, text]) => (
            <MessageView key={id} message={{ id, role: 'director', text, createdAt: new Date().toISOString() }} ctx={ctx} streaming />
          ))}
        </div>
        {!atBottom && (
          <button type="button" className="feed-newest" onClick={scrollToEnd}>
            {t('director.newest')}
            <Icon name="chevronDown" size={12} />
          </button>
        )}
      </div>
      <JobTray />
      <DecisionDock columnHeight={height} />
    </aside>
  );
}
