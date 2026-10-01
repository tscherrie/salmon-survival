import { normalizeSegments, type ComposerSegment } from './composer.ts';
import type { Ref } from './refs.ts';

/**
 * Ein Wort mit Zeitstempeln in Sekunden (Transkript, Wort-Timings, kinetische Typografie). Der Bezugspunkt
 * hängt vom Verwender ab: Aufnahmestart bei Push-to-Talk, Timeline-Anfang beim Rendern.
 */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** Ein transkribiertes Wort; Zeiten in Sekunden relativ zum Aufnahmestart. */
export type TranscriptWord = TimedWord;

/** Ein Klick auf die Bühne während der Push-to-Talk-Aufnahme. */
export interface VoiceClick {
  /** Millisekunden seit Aufnahmestart. */
  atMs: number;
  ref: Ref;
}

/**
 * Wörter, die ohne Leerzeichen an das vorige Wort angehängt werden: Satzzeichen und schließende Klammern,
 * sowie Anführungszeichen/Apostrophe nur dann, wenn kein Buchstabe oder keine Ziffer folgt (»Hallo« öffnet,
 * ein alleinstehendes « schließt).
 */
const ATTACH_LEFT = /^(?:[.,!?;:…)\]%]|[»«"'“”‘’](?![\p{L}\p{N}]))/u;

/** Alleinstehende öffnende Klammern/Anführungszeichen: Das folgende Wort schließt ohne Leerzeichen an. */
const OPENS_RIGHT = /^[(\[„‚]$/;

/**
 * Setzt Klick-Referenzen an die passende Stelle im Transkript:
 * hinter das letzte Wort, das zum Klickzeitpunkt begonnen hatte.
 * Klicks vor dem ersten Wort landen am Anfang; gleiche Position → Klick-Reihenfolge.
 */
export function alignClicksToWords(words: readonly TranscriptWord[], clicks: readonly VoiceClick[]): ComposerSegment[] {
  const sortedWords = [...words].sort((a, b) => a.start - b.start);
  const sortedClicks = clicks
    .map((click, order) => ({ click, order }))
    .sort((a, b) => a.click.atMs - b.click.atMs || a.order - b.order)
    .map((entry) => entry.click);

  // Für jeden Klick: Index des Wortes, hinter dem er steht (-1 = vor allen Wörtern).
  const afterWord = sortedClicks.map((click) => {
    const t = click.atMs / 1000;
    let index = -1;
    for (let i = 0; i < sortedWords.length; i++) {
      const word = sortedWords[i];
      if (word && word.start <= t) index = i;
      else break;
    }
    return index;
  });

  const segments: ComposerSegment[] = [];
  const pushRefsFor = (wordIndex: number) => {
    afterWord.forEach((idx, clickIndex) => {
      const click = sortedClicks[clickIndex];
      if (idx === wordIndex && click) {
        segments.push({ type: 'text', text: ' ' });
        segments.push({ type: 'ref', ref: click.ref });
      }
    });
  };

  pushRefsFor(-1);
  let previous: { text: string; segmentCount: number } | undefined;
  sortedWords.forEach((word, i) => {
    const afterOpener = previous !== undefined && previous.segmentCount === segments.length && OPENS_RIGHT.test(previous.text);
    const needsSpace = segments.length > 0 && !afterOpener && !ATTACH_LEFT.test(word.text);
    segments.push({ type: 'text', text: (needsSpace ? ' ' : '') + word.text });
    previous = { text: word.text, segmentCount: segments.length };
    pushRefsFor(i);
  });

  const normalized = normalizeSegments(segments);
  // Führendes Leerzeichen entfernen.
  const first = normalized[0];
  if (first && first.type === 'text') {
    const trimmed = first.text.replace(/^\s+/, '');
    if (trimmed === '') normalized.shift();
    else normalized[0] = { type: 'text', text: trimmed };
  }
  return normalized;
}
