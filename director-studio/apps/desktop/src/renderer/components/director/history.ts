import type { ApprovalRequest, ChatMessage, Checkpoint, Generation, ToolActivity } from '@studio/core';
import { getLanguage, t, type MessageKey } from '../../i18n.ts';
import type { DecidedApproval, PendingQuestion, ProgressNote } from '../../state/types.ts';
import type { IconName } from '../common/Icon.tsx';

/**
 * Verlauf des Directors als reine Daten (DESIGN.md §7.6.2): Nachrichten, Fortschritt, Werkzeuggruppen, Systemzeilen
 * und Fehlerkarten, chronologisch. Offene Entscheidungen stehen nur im Dock; im Verlauf erscheint an ihrer Stelle
 * eine Systemzeile („… vorgelegt · unten angeheftet“), erledigte nur noch als Systemzeile.
 */

/** Folgen Nachrichten desselben Autors innerhalb dieser Zeit, entfällt die Kopfzeile. */
export const SAME_AUTHOR_MS = 2 * 60_000;

export interface SystemLine {
  id: string;
  icon: IconName;
  text: string;
  /** Betrag in Mono hinter dem Text („· $6.00“). */
  amount?: number | undefined;
  tone: 'ok' | 'neutral' | 'pinned';
}

export type FeedItem =
  | { kind: 'message'; at: string; message: ChatMessage; showMeta: boolean }
  | { kind: 'system'; at: string; line: SystemLine }
  | { kind: 'progress'; at: string; note: ProgressNote }
  | { kind: 'tools'; at: string; activities: ToolActivity[] }
  | { kind: 'error'; at: string; generation: Generation };

export interface FeedInput {
  messages: readonly ChatMessage[];
  progress: readonly ProgressNote[];
  activities: readonly ToolActivity[];
  checkpoints: readonly Checkpoint[];
  approvals: readonly ApprovalRequest[];
  decidedApprovals: readonly DecidedApproval[];
  generations: readonly Generation[];
  question: PendingQuestion | null;
  /** Zeitpunkt, zu dem die offene Rückfrage zuerst gesehen wurde (sie trägt selbst keinen). */
  questionSeenAt: string | null;
}

const MCP_PREFIX = /^mcp__[^_]+(?:_[^_]+)*__/;

/** Rohname ohne MCP-Präfix (`mcp__studio__frames` → `frames`). */
export function rawToolName(name: string): string {
  return name.replace(MCP_PREFIX, '');
}

/** Vermenschlichter Name: Punkte und Unterstriche werden zu Leerzeichen, erster Buchstabe groß. */
export function humanizeToolName(name: string): string {
  const words = rawToolName(name).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** Klartext eines Werkzeugs: `tool.<name>` aus i18n, sonst vermenschlicht (§7.6.2, Labels 2 und 3). */
export function toolLabel(name: string): string {
  const key = `tool.${rawToolName(name)}`;
  const label = t(key as MessageKey);
  return label === key ? humanizeToolName(name) : label;
}

/** Zeile eines Werkzeugschritts: Zusammenfassung, sonst Klartext (§7.6.2, Label 1). */
export function activityLabel(activity: ToolActivity): string {
  return activity.summary?.trim() || toolLabel(activity.name);
}

/** Zusammenfassung einer eingeklappten Gruppe: Klartext-Namen ohne Wiederholung, in Reihenfolge. */
export function groupSummary(activities: readonly ToolActivity[]): string {
  return [...new Set(activities.map((a) => toolLabel(a.name)))].join(', ');
}

/** Dauer kurz: „2 s“, ab einer Minute „1:05“ (geschütztes Leerzeichen zwischen Zahl und Einheit, §13.8). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}\u00A0s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Dauer eines Schritts bzw. einer Gruppe; laufende bis `now`. */
export function activitySpanMs(activities: readonly ToolActivity[], now: number): number {
  const starts = activities.map((a) => Date.parse(a.startedAt)).filter(Number.isFinite);
  if (starts.length === 0) return 0;
  const ends = activities.map((a) => (a.status === 'started' ? now : Date.parse(a.finishedAt ?? a.startedAt))).filter(Number.isFinite);
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

/** Uhrzeit im Verlauf: heute nur „10:52“, sonst mit Datum („28.09., 10:52“). */
export function formatClock(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const locale = getLanguage() === 'de' ? 'de-DE' : 'en-GB';
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Nummer eines Checkpoints in der Reihenfolge des Projekts (1-basiert). */
export function checkpointNumber(checkpoints: readonly Checkpoint[], id: string): number {
  return checkpoints.findIndex((c) => c.id === id) + 1;
}

function checkpointLines(checkpoints: readonly Checkpoint[]): FeedItem[] {
  const items: FeedItem[] = [];
  checkpoints.forEach((c, i) => {
    const n = i + 1;
    if (c.status === 'proposed' && c.proposedAt) {
      items.push({ kind: 'system', at: c.proposedAt, line: { id: `cp-pinned:${c.id}`, icon: 'pin', text: t('dock.pinnedNote', { title: t('dock.checkpointN', { n }) }), tone: 'pinned' } });
    }
    if (!c.decidedAt) return;
    if (c.status === 'approved') {
      items.push({ kind: 'system', at: c.decidedAt, line: { id: `cp-done:${c.id}`, icon: 'check', text: t('director.sys.approved', { title: c.title }), amount: c.budgetApprovedUsd, tone: 'ok' } });
    } else if (c.status === 'changes_requested') {
      items.push({ kind: 'system', at: c.decidedAt, line: { id: `cp-changes:${c.id}`, icon: 'restore', text: t('director.sys.changes', { title: c.title }), tone: 'neutral' } });
    } else if (c.status === 'skipped') {
      items.push({ kind: 'system', at: c.decidedAt, line: { id: `cp-skip:${c.id}`, icon: 'chevronRight', text: t('director.sys.skipped', { title: c.title }), tone: 'neutral' } });
    }
  });
  return items;
}

/** Baut den Verlauf: chronologisch, aufeinanderfolgende Werkzeugschritte als eine Gruppe. */
export function buildFeed(input: FeedInput): FeedItem[] {
  const items: FeedItem[] = [
    ...input.messages.map((message): FeedItem =>
      message.role === 'system'
        ? { kind: 'system', at: message.createdAt, line: { id: message.id, icon: 'info', text: message.text, tone: 'neutral' } }
        : { kind: 'message', at: message.createdAt, message, showMeta: true },
    ),
    ...input.progress.map((note): FeedItem => ({ kind: 'progress', at: note.at, note })),
    ...input.activities.map((a): FeedItem => ({ kind: 'tools', at: a.startedAt, activities: [a] })),
    ...checkpointLines(input.checkpoints),
    ...input.approvals.map((a): FeedItem => ({
      kind: 'system',
      at: a.createdAt,
      line: { id: `apr-pinned:${a.id}`, icon: 'pin', text: t('dock.pinnedNote', { title: t('dock.approvalShort') }), tone: 'pinned' },
    })),
    ...input.decidedApprovals.map(({ request, approved, decidedAt }): FeedItem => ({
      kind: 'system',
      at: decidedAt,
      line: {
        id: `apr-done:${request.id}`,
        icon: approved ? 'check' : 'close',
        text: t(approved ? 'director.sys.granted' : 'director.sys.denied', { title: request.title }),
        amount: approved ? request.amountUsd : undefined,
        tone: approved ? 'ok' : 'neutral',
      },
    })),
    ...input.generations.filter((g) => g.status === 'failed').map((g): FeedItem => ({ kind: 'error', at: g.finishedAt ?? g.createdAt, generation: g })),
  ];
  if (input.question && input.questionSeenAt) {
    items.push({
      kind: 'system',
      at: input.questionSeenAt,
      line: { id: `q-pinned:${input.question.questionId}`, icon: 'pin', text: t('dock.pinnedNote', { title: t('director.question') }), tone: 'pinned' },
    });
  }
  // Stabil sortieren (gleiche Zeitpunkte behalten ihre Reihenfolge)
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const out: FeedItem[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.kind === 'tools' && last?.kind === 'tools') {
      last.activities = [...last.activities, ...item.activities];
      continue;
    }
    if (item.kind === 'message' && last?.kind === 'message' && last.message.role === item.message.role) {
      const gap = Date.parse(item.at) - Date.parse(last.at);
      out.push({ ...item, showMeta: !(gap >= 0 && gap <= SAME_AUTHOR_MS) });
      continue;
    }
    out.push(item.kind === 'tools' ? { ...item, activities: [...item.activities] } : item);
  }
  return out;
}

/**
 * Empfehlung einer Option erkennen: Der Director markiert sie im Label mit „(Empfehlung)“ (siehe `ask_user`);
 * ältere Texte beginnen die Beschreibung mit „Empfohlen:“. Liefert die Anzeige ohne Markierung.
 */
export function splitRecommendation(label: string, description?: string): { label: string; description: string | undefined; recommended: boolean } {
  const mark = /\s*\((?:Empfehlung|empfohlen|Empfohlen|recommended|Recommended)\)\s*/;
  if (mark.test(label)) return { label: label.replace(mark, ' ').trim(), description, recommended: true };
  const lead = /^\s*(?:Empfohlen|Empfehlung|Recommended)\s*[:–-]\s*/;
  if (description && lead.test(description)) {
    const rest = description.replace(lead, '');
    return { label, description: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : undefined, recommended: true };
  }
  return { label, description, recommended: false };
}
