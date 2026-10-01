import type { TranscriptWord } from '@studio/core';
import { isPlainObject } from './schema.ts';

/**
 * Vereinheitlicht Transkriptionsergebnisse verschiedener fal-Modelle zu `{ text, words, language }`
 * (Zeiten in Sekunden):
 * - ElevenLabs Scribe: `{ text, language_code, words: [{ text, start, end, type: 'word'|'spacing'|'audio_event', speaker_id }] }`
 * - Whisper/Wizper: `{ text, chunks: [{ timestamp: [s, e], text, speaker? }], languages | inferred_languages }`
 *   (Wort-Chunks direkt; Segment-Chunks werden proportional zur Zeichenlänge auf Wörter verteilt)
 * - generisch: `{ words: [{ word|text, start|start_time, end|end_time }] }` oder `{ segments: [{ start, end, text, words? }] }`
 */

export interface NormalizedWord extends TranscriptWord {
  speaker?: string;
}

export interface NormalizedTranscript {
  text: string;
  words: NormalizedWord[];
  language?: string;
}

const PUNCT_START = /^[.,!?;:…)»"'\]%]/;

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

function firstNum(entry: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = num(entry[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function unwrap(result: unknown, depth = 0): unknown {
  if (!isPlainObject(result) || depth > 2) return result;
  const hasContent = ['text', 'words', 'chunks', 'segments', 'transcript', 'transcription'].some((k) => k in result);
  if (hasContent) return result;
  for (const key of ['data', 'output', 'result', 'response']) {
    if (isPlainObject(result[key])) return unwrap(result[key], depth + 1);
  }
  return result;
}

function speakerOf(entry: Record<string, unknown>): string | undefined {
  const s = entry.speaker_id ?? entry.speaker;
  return typeof s === 'string' && s ? s : typeof s === 'number' ? String(s) : undefined;
}

function fromWordList(list: unknown[]): NormalizedWord[] {
  const words: NormalizedWord[] = [];
  let lastEnd = 0;
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : 'word';
    if (type === 'spacing' || type === 'audio_event' || type === 'punctuation_spacing') continue;
    const raw = entry.text ?? entry.word ?? entry.punctuated_word ?? entry.token;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    const ts = Array.isArray(entry.timestamp) ? entry.timestamp : undefined;
    let start = firstNum(entry, ['start', 'start_time', 'startTime', 'from', 'begin']) ?? num(ts?.[0]);
    let end = firstNum(entry, ['end', 'end_time', 'endTime', 'to', 'stop']) ?? num(ts?.[1]);
    const startMs = firstNum(entry, ['start_ms', 'startMs']);
    const endMs = firstNum(entry, ['end_ms', 'endMs']);
    if (start === undefined && startMs !== undefined) start = startMs / 1000;
    if (end === undefined && endMs !== undefined) end = endMs / 1000;
    start ??= lastEnd;
    end ??= start;
    if (end < start) end = start;
    lastEnd = end;
    const word: NormalizedWord = { text, start, end };
    const speaker = speakerOf(entry);
    if (speaker) word.speaker = speaker;
    words.push(word);
  }
  return words;
}

/** Verteilt die Wörter eines Segments proportional zur Zeichenlänge auf [start, end]. */
function distribute(text: string, start: number, end: number, speaker?: string): NormalizedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const total = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
  const span = Math.max(0, end - start);
  const out: NormalizedWord[] = [];
  let cursor = start;
  for (const token of tokens) {
    const length = (span * token.length) / total;
    const word: NormalizedWord = { text: token, start: round(cursor), end: round(cursor + length) };
    if (speaker) word.speaker = speaker;
    out.push(word);
    cursor += length;
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fromChunks(chunks: unknown[]): NormalizedWord[] {
  const items = chunks
    .filter(isPlainObject)
    .map((chunk) => {
      const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
      return {
        text: typeof chunk.text === 'string' ? chunk.text.trim() : '',
        start: num(ts[0]) ?? firstNum(chunk, ['start', 'start_time']),
        end: num(ts[1]) ?? firstNum(chunk, ['end', 'end_time']),
        speaker: speakerOf(chunk),
      };
    })
    .filter((c) => c.text);
  const wordLevel = items.length > 0 && items.every((c) => !/\s/.test(c.text));
  const words: NormalizedWord[] = [];
  let lastEnd = 0;
  items.forEach((chunk, index) => {
    const start = chunk.start ?? lastEnd;
    const next = items[index + 1]?.start;
    const tokenCount = chunk.text.split(/\s+/).filter(Boolean).length;
    const end = chunk.end ?? next ?? start + 0.35 * tokenCount;
    lastEnd = Math.max(start, end);
    if (wordLevel) {
      const word: NormalizedWord = { text: chunk.text, start, end: Math.max(start, end) };
      if (chunk.speaker) word.speaker = chunk.speaker;
      words.push(word);
    } else {
      words.push(...distribute(chunk.text, start, Math.max(start, end), chunk.speaker));
    }
  });
  return words;
}

function fromSegments(segments: unknown[]): NormalizedWord[] {
  const words: NormalizedWord[] = [];
  for (const segment of segments) {
    if (!isPlainObject(segment)) continue;
    if (Array.isArray(segment.words) && segment.words.length) {
      words.push(...fromWordList(segment.words));
      continue;
    }
    const text = typeof segment.text === 'string' ? segment.text.trim() : '';
    const start = firstNum(segment, ['start', 'start_time']) ?? words[words.length - 1]?.end ?? 0;
    const end = firstNum(segment, ['end', 'end_time']) ?? start;
    words.push(...distribute(text, start, end, speakerOf(segment)));
  }
  return words;
}

function joinWords(words: NormalizedWord[]): string {
  let text = '';
  for (const word of words) text += text && !PUNCT_START.test(word.text) ? ` ${word.text}` : word.text;
  return text;
}

function languageOf(root: Record<string, unknown>): string | undefined {
  for (const key of ['language', 'language_code', 'detected_language']) {
    const v = root[key];
    if (typeof v === 'string' && v) return v;
  }
  for (const key of ['languages', 'inferred_languages']) {
    const v = root[key];
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return undefined;
}

export function normalizeTranscript(result: unknown): NormalizedTranscript {
  const root = unwrap(result);
  if (typeof root === 'string') return { text: root.trim(), words: [] };
  if (!isPlainObject(root)) return { text: '', words: [] };
  let words: NormalizedWord[] = [];
  if (Array.isArray(root.words) && root.words.length) words = fromWordList(root.words);
  else if (Array.isArray(root.chunks) && root.chunks.length) words = fromChunks(root.chunks);
  else if (Array.isArray(root.segments) && root.segments.length) words = fromSegments(root.segments);
  else if (Array.isArray(root.timestamps) && root.timestamps.length) words = fromWordList(root.timestamps);
  words.sort((a, b) => a.start - b.start);
  const rawText = [root.text, root.transcript, root.transcription].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const out: NormalizedTranscript = { text: rawText?.trim() ?? joinWords(words), words };
  const language = languageOf(root);
  if (language) out.language = language;
  return out;
}
