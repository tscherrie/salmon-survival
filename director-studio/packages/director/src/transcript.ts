import type { ProjectStore } from '@studio/project';
import type { CanonicalMessage } from './transports/types.ts';

/**
 * Persistiertes LLM-Transkript (nur anhängen). Jede Zeile ist ein Eintrag; eine Kompaktierung beginnt
 * ein neues Segment, frühere Zeilen bleiben unverändert erhalten.
 */
export type TranscriptEntry =
  | { type: 'message'; message: CanonicalMessage; extra?: Record<string, unknown> | undefined }
  | { type: 'compaction'; summary: string; replaced: number; at: string }
  /** Laufzeit-Metadaten (z. B. Agent-SDK-Session-ID und kumulierte Kosten). */
  | { type: 'meta'; key: string; value: unknown; at: string };

export interface TranscriptStore {
  load(): Promise<TranscriptEntry[]>;
  append(entries: TranscriptEntry[]): Promise<void>;
}

export class MemoryTranscriptStore implements TranscriptStore {
  readonly entries: TranscriptEntry[] = [];

  async load(): Promise<TranscriptEntry[]> {
    return structuredClone(this.entries);
  }

  async append(entries: TranscriptEntry[]): Promise<void> {
    this.entries.push(...structuredClone(entries));
  }
}

/** Transkript im Projektordner: `conversation/transcript-<runtimeId>.jsonl`. */
export function projectTranscriptStore(project: ProjectStore, runtimeId: string): TranscriptStore {
  return {
    async load() {
      const raw = await project.readTranscript<unknown>(runtimeId);
      // Rückwärtskompatibel: nackte Nachrichten als message-Einträge lesen.
      return raw.map((entry) => {
        if (entry && typeof entry === 'object' && 'type' in entry && ['message', 'compaction', 'meta'].includes(String((entry as { type: unknown }).type))) {
          return entry as TranscriptEntry;
        }
        return { type: 'message', message: entry as CanonicalMessage } satisfies TranscriptEntry;
      });
    },
    append(entries) {
      return project.appendTranscript(runtimeId, entries);
    },
  };
}

/** Aktuelles Segment (nach der letzten Kompaktierung) mit Sidecar-Daten je Nachrichtenindex. */
export function replayTranscript(entries: readonly TranscriptEntry[]): { messages: CanonicalMessage[]; extras: Map<number, Record<string, unknown>>; meta: Map<string, unknown> } {
  let messages: CanonicalMessage[] = [];
  let extras = new Map<number, Record<string, unknown>>();
  const meta = new Map<string, unknown>();
  for (const entry of entries) {
    if (entry.type === 'compaction') {
      messages = [];
      extras = new Map();
    } else if (entry.type === 'message') {
      if (entry.extra) extras.set(messages.length, entry.extra);
      messages.push(entry.message);
    } else {
      meta.set(entry.key, entry.value);
    }
  }
  return { messages, extras, meta };
}
