import type { Asset, Timeline, TimedWord } from '@studio/core';

type SubtitleAssets = Readonly<Record<string, Pick<Asset, 'id' | 'metadata'>>>;
interface Cue { start: number; end: number; text: string }

function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n[ \t]*\n+/g, '\n').trim();
}

function checkedWords(raw: unknown): TimedWord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Untertitel: Transkript-Wortzeiten müssen eine Liste sein.');
  return raw.map((value: unknown) => {
    const word = value as Partial<TimedWord> | null;
    if (!word || typeof word.text !== 'string' || typeof word.start !== 'number' || typeof word.end !== 'number' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) throw new Error('Untertitel: Ungültige Wortzeiten; Transkript oder Word-Timings prüfen.');
    return { text: cleanText(word.text).replace(/\s+/g, ' '), start: word.start, end: word.end };
  }).filter((word) => word.text);
}

/** Asset transcripts are source-relative; request.words is already timeline-relative. */
function sourceWords(timeline: Timeline, assets: SubtitleAssets): TimedWord[] {
  const words: TimedWord[] = [];
  for (const track of timeline.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.assetId || (track.kind !== 'audio' && !(track.kind === 'video' && clip.includeSourceAudio))) continue;
      const transcript = assets[clip.assetId]?.metadata?.transcript as { words?: unknown } | undefined;
      const lo = clip.start / timeline.fps, hi = (clip.start + clip.duration) / timeline.fps;
      for (const word of checkedWords(transcript?.words)) {
        const start = lo + (word.start - clip.in / timeline.fps) / clip.speed;
        const end = lo + (word.end - clip.in / timeline.fps) / clip.speed;
        if ((end > lo || (end === start && start >= lo)) && start < hi) words.push({ text: word.text, start: Math.max(lo, start), end: Math.min(hi, end) });
      }
    }
  }
  return words;
}

function appendToken(text: string, token: string): string {
  const attachLeft = /^(?:[.,!?;:…)\]%]|[»«"'“”‘’](?![\p{L}\p{N}]))/u.test(token);
  const opensRight = /[(\[„‚]$/.test(text);
  return text + (text && !attachLeft && !opensRight ? ' ' : '') + token;
}

function wordCues(words: TimedWord[], duration: number): Cue[] {
  const seen = new Set<string>();
  const sorted = words.map((word) => ({ ...word, start: Math.max(0, word.start), end: Math.min(duration, word.end) }))
    .filter((word) => word.start < duration && word.end >= word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((word) => { const key = JSON.stringify([word.start, word.end, word.text]); if (seen.has(key)) return false; seen.add(key); return true; });
  const cues: Cue[] = [];
  let cue: Cue | undefined;
  for (const word of sorted) {
    const nextText = appendToken(cue?.text ?? '', word.text);
    // Keep real timing gaps and sentence endings; bound long transcript cues.
    if (cue && (word.start - cue.end >= .75 || word.end - cue.start > 4 || nextText.length > 84 || /[.!?][»”"']?$/.test(cue.text))) {
      cues.push(cue); cue = undefined;
    }
    if (!cue) cue = { start: word.start, end: word.end, text: word.text };
    else { cue.text = appendToken(cue.text, word.text); cue.end = Math.max(cue.end, word.end); }
  }
  if (cue) cues.push(cue);
  return cues;
}

function timestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000), minutes = Math.floor(milliseconds / 60_000) % 60, seconds = Math.floor(milliseconds / 1_000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds % 1_000).padStart(3, '0')}`;
}

/** Authored subtitle clips take precedence over transcript fallback, preserving caption edits. */
export function timelineSrt(timeline: Timeline, words?: readonly TimedWord[], assets: SubtitleAssets = {}): Blob {
  const duration = timeline.durationFrames / timeline.fps;
  const authored = timeline.tracks.filter((track) => track.kind === 'text' && !track.hidden).flatMap((track) => track.clips
    .filter((clip) => clip.opacity !== 0 && !['title', 'hero'].includes(clip.style ?? '') && typeof clip.text === 'string' && cleanText(clip.text))
    .map((clip) => ({ start: clip.start / timeline.fps, end: Math.min(duration, (clip.start + clip.duration) / timeline.fps), text: cleanText(clip.text!) }))
    .filter((cue) => cue.end > cue.start));
  // Supplied words have already passed through wordsForTimeline in the UI.
  // Map asset metadata only when no timeline-word list was supplied.
  const cues = authored.length ? authored : wordCues(words?.length ? checkedWords(words) : sourceWords(timeline, assets), duration);
  const blocks = cues.sort((a, b) => a.start - b.start || a.end - b.end).map((cue) => ({ ...cue, start: Math.round(cue.start * 1000), end: Math.round(cue.end * 1000) }))
    .filter((cue) => cue.text && cue.end > cue.start && cue.start >= 0)
    .map((cue, index) => `${index + 1}\r\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\r\n${cue.text.replace(/\n/g, '\r\n')}\r\n`);
  if (!blocks.length) throw new Error('Keine Untertitel vorhanden. Caption-Clips mit Text oder ein Transkript mit Wortzeiten hinzufügen.');
  return new Blob([blocks.join('\r\n') + '\r\n'], { type: 'application/x-subrip;charset=utf-8' });
}
