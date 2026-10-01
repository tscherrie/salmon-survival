import { insertRefAt, normalizeRef, type ChatMessage, type StudioEvent } from '@studio/core';
import type { StudioData } from './types.ts';

/**
 * Reiner Reducer: Ereignis → Teil-Zustand (oder `null`, wenn das Ereignis nichts ändert).
 * Nebenwirkungen (Dokument nachladen, Warteschlange senden) erledigt der Store.
 */

function upsertBy<T>(list: readonly T[], item: T, key: (x: T) => string): T[] {
  const id = key(item);
  const index = list.findIndex((x) => key(x) === id);
  if (index < 0) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _drop, ...rest } = record;
  return rest;
}

export function reduceEvent(state: StudioData, event: StudioEvent, now: string = new Date().toISOString()): Partial<StudioData> | null {
  if (!state.projectId || event.projectId !== state.projectId) return null;
  switch (event.type) {
    case 'message':
      return {
        messages: upsertBy(state.messages, event.message, (m) => m.id),
        streaming: withoutKey(state.streaming, event.message.id),
      };
    case 'message_delta': {
      if (state.messages.some((m) => m.id === event.messageId)) return null;
      return { streaming: { ...state.streaming, [event.messageId]: (state.streaming[event.messageId] ?? '') + event.delta } };
    }
    case 'progress':
      return {
        progress: [...state.progress, { id: `${event.runId}:${state.progress.length}`, runId: event.runId, text: event.text, at: now }].slice(-100),
      };
    case 'tool':
      return { activities: upsertBy(state.activities, event.activity, (a) => a.id).slice(-200) };
    case 'question':
      return { question: { questionId: event.questionId, questions: event.questions, runId: event.runId } };
    case 'question_resolved':
      return state.question?.questionId === event.questionId ? { question: null } : null;
    case 'approval':
      return { approvals: upsertBy(state.approvals, event.request, (a) => a.id) };
    case 'approval_resolved':
      return { approvals: state.approvals.filter((a) => a.id !== event.approvalId) };
    case 'checkpoints':
      return {
        checkpoints: event.checkpoints,
        ...(state.manifest ? { manifest: { ...state.manifest, checkpoints: event.checkpoints } } : {}),
      };
    case 'budget':
      return { budget: event.summary };
    case 'document': {
      const versions = upsertBy(state.versions, event.version, (v) => String(v.number)).sort((a, b) => a.number - b.number);
      return { versions };
    }
    case 'asset':
      return { assets: upsertBy(state.assets, event.asset, (a) => a.id) };
    case 'generation':
      return { generations: upsertBy(state.generations, event.generation, (g) => g.id) };
    case 'run_state': {
      const patch: Partial<StudioData> = { runState: event.state, runId: event.runId, runError: event.error ?? null };
      if (event.state !== 'running' && Object.keys(state.streaming).length > 0) {
        // Verwaiste Streaming-Texte als Nachrichten übernehmen, damit nichts verschwindet.
        const orphaned: ChatMessage[] = Object.entries(state.streaming).map(([id, text]) => ({
          id,
          role: 'director',
          text,
          createdAt: now,
          ...(event.runId ? { runId: event.runId } : {}),
        }));
        patch.messages = orphaned.reduce((list, m) => upsertBy(list, m, (x) => x.id), state.messages);
        patch.streaming = {};
      }
      return patch;
    }
    case 'manifest':
      return { manifest: event.manifest, checkpoints: event.manifest.checkpoints };
    case 'preview_pick': {
      const ref = normalizeRef(event.ref);
      return { composer: insertRefAt(state.composer, state.caret, ref), caret: state.caret + 1, composerRevision: state.composerRevision + 1 };
    }
    case 'preview_state':
      return { preview: { url: event.url, status: event.status, error: event.error ?? null } };
  }
}
