import type { Asset, Timeline, TimedWord } from '@studio/core';
/** Transcripts are source-relative. Clip offset and speed map them to the actual timeline. */
export function wordsForTimeline(timeline: Timeline, assets: readonly Asset[]): TimedWord[] {
  const out: TimedWord[] = [], byId = new Map(assets.map((a) => [a.id, a]));
  for (const track of timeline.tracks) for (const clip of track.clips) {
    if (!clip.assetId || (track.kind !== 'audio' && !(track.kind === 'video' && clip.includeSourceAudio))) continue;
    const asset = byId.get(clip.assetId), transcript = asset?.metadata?.transcript as { words?: TimedWord[] } | undefined;
    for (const word of transcript?.words ?? []) { const start = clip.start / timeline.fps + (word.start - clip.in / timeline.fps) / clip.speed, end = clip.start / timeline.fps + (word.end - clip.in / timeline.fps) / clip.speed, lo = clip.start / timeline.fps, hi = (clip.start + clip.duration) / timeline.fps; if (end > lo && start < hi) out.push({ ...word, start: Math.max(start, lo), end: Math.min(end, hi) }); }
  }
  return out.sort((a, b) => a.start - b.start);
}
