import { alignClicksToWords } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../src/index.ts';

describe('normalizeTranscript', () => {
  it('ElevenLabs Scribe: skips spacing and audio events, keeps speakers', () => {
    const result = normalizeTranscript({
      language_code: 'deu',
      language_probability: 0.98,
      text: 'Mach das dunkler.',
      words: [
        { text: 'Mach', start: 0.1, end: 0.3, type: 'word', speaker_id: 'speaker_0' },
        { text: ' ', start: 0.3, end: 0.35, type: 'spacing' },
        { text: 'das', start: 0.35, end: 0.5, type: 'word', speaker_id: 'speaker_0' },
        { text: '(lacht)', start: 0.5, end: 0.9, type: 'audio_event' },
        { text: 'dunkler.', start: 0.9, end: 1.4, type: 'word' },
      ],
    });
    expect(result).toEqual({
      text: 'Mach das dunkler.',
      language: 'deu',
      words: [
        { text: 'Mach', start: 0.1, end: 0.3, speaker: 'speaker_0' },
        { text: 'das', start: 0.35, end: 0.5, speaker: 'speaker_0' },
        { text: 'dunkler.', start: 0.9, end: 1.4 },
      ],
    });
  });

  it('Whisper word-level chunks', () => {
    const result = normalizeTranscript({
      text: ' Hallo Welt',
      chunks: [
        { timestamp: [0.0, 0.42], text: ' Hallo' },
        { timestamp: [0.42, null], text: ' Welt' },
      ],
      inferred_languages: ['de'],
    });
    expect(result).toEqual({
      text: 'Hallo Welt',
      language: 'de',
      words: [
        { text: 'Hallo', start: 0, end: 0.42 },
        { text: 'Welt', start: 0.42, end: 0.77 },
      ],
    });
  });

  it('Wizper segment chunks are distributed proportionally', () => {
    const result = normalizeTranscript({
      text: 'eins zwei drei vier',
      chunks: [
        { timestamp: [1, 2], text: 'eins zwei' },
        { timestamp: [2, 4], text: 'drei vier', speaker: 'A' },
      ],
      languages: ['de'],
    });
    expect(result.language).toBe('de');
    expect(result.words).toEqual([
      { text: 'eins', start: 1, end: 1.5 },
      { text: 'zwei', start: 1.5, end: 2 },
      { text: 'drei', start: 2, end: 3, speaker: 'A' },
      { text: 'vier', start: 3, end: 4, speaker: 'A' },
    ]);
  });

  it('generic word lists ({word,start,end}, ms fields, missing times)', () => {
    expect(normalizeTranscript({ words: [{ word: 'a', start: 0, end: 0.2 }, { word: 'b', start_time: 0.2, end_time: 0.4 }] }).words).toEqual([
      { text: 'a', start: 0, end: 0.2 },
      { text: 'b', start: 0.2, end: 0.4 },
    ]);
    expect(normalizeTranscript({ words: [{ text: 'x', start_ms: 1500, end_ms: 2000 }, { text: 'y' }] })).toEqual({
      text: 'x y',
      words: [
        { text: 'x', start: 1.5, end: 2 },
        { text: 'y', start: 2, end: 2 },
      ],
    });
  });

  it('segments with nested words and without', () => {
    const result = normalizeTranscript({
      segments: [
        { start: 0, end: 1, text: 'ignoriert', words: [{ word: 'Hi', start: 0, end: 0.5 }] },
        { start: 1, end: 2, text: 'du da' },
      ],
    });
    expect(result.text).toBe('Hi du da');
    expect(result.words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hi', 0, 0.5],
      ['du', 1, 1.5],
      ['da', 1.5, 2],
    ]);
  });

  it('unwraps data/output wrappers and handles strings and junk', () => {
    expect(normalizeTranscript({ data: { text: 'ok', words: [] } })).toEqual({ text: 'ok', words: [] });
    expect(normalizeTranscript('  roh  ')).toEqual({ text: 'roh', words: [] });
    expect(normalizeTranscript(null)).toEqual({ text: '', words: [] });
    expect(normalizeTranscript({ chunks: 'kaputt' })).toEqual({ text: '', words: [] });
  });

  it('joins words without spaces before punctuation when no text is given', () => {
    expect(normalizeTranscript({ words: [{ text: 'Hallo', start: 0, end: 1 }, { text: ',', start: 1, end: 1 }, { text: 'Welt', start: 1, end: 2 }] }).text).toBe('Hallo, Welt');
  });

  it('feeds core alignClicksToWords', () => {
    const { words } = normalizeTranscript({ chunks: [{ timestamp: [0, 0.5], text: 'nimm' }, { timestamp: [0.5, 1], text: 'das' }] });
    const segments = alignClicksToWords(words, [{ atMs: 700, ref: { kind: 'time', frame: 30 } }]);
    expect(segments).toEqual([
      { type: 'text', text: 'nimm das ' },
      { type: 'ref', ref: { kind: 'time', frame: 30 } },
    ]);
  });
});
