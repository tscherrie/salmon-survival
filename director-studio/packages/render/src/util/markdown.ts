import { escapeHtml } from './html.ts';

/**
 * Markdown-light für Folientexte: **fett**, *kursiv*, Zeilenumbrüche, Absätze (Leerzeile) und
 * einfache Aufzählungen (`- `/`• `). Der Text wird VOR der Umwandlung maskiert – es entsteht nie
 * fremdes HTML.
 */

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface TextBlock {
  kind: 'paragraph' | 'bullet';
  /** Zeilen eines Absatzes (bzw. eines Aufzählungspunkts). */
  lines: TextRun[][];
}

/** Zerlegt eine Zeile in Läufe mit fett/kursiv. */
export function parseInline(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let bold = false;
  let italic = false;
  let buffer = '';
  const flush = () => {
    if (buffer) runs.push({ text: buffer, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    buffer = '';
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && (line[i + 1] === '*' || line[i + 1] === '_' || line[i + 1] === '\\')) {
      buffer += line[i + 1];
      i++;
      continue;
    }
    if (ch === '*' && line[i + 1] === '*') {
      // nur umschalten, wenn ein Gegenstück existiert (sonst wörtlich)
      if (bold || line.indexOf('**', i + 2) >= 0) {
        flush();
        bold = !bold;
        i++;
        continue;
      }
    } else if (ch === '*' || ch === '_') {
      const isWordInner = ch === '_' && /\w/.test(line[i - 1] ?? '') && /\w/.test(line[i + 1] ?? '');
      if (!isWordInner && (italic || hasClosing(line, i + 1, ch))) {
        flush();
        italic = !italic;
        continue;
      }
    }
    buffer += ch;
  }
  flush();
  return runs;
}

function hasClosing(line: string, from: number, ch: string): boolean {
  for (let j = from; j < line.length; j++) {
    if (line[j] === ch && !(ch === '*' && line[j + 1] === '*')) return true;
  }
  return false;
}

const BULLET_RE = /^\s*(?:[-•–]|\*(?!\*))\s+/;

/** Zerlegt Text in Absätze/Aufzählungspunkte. */
export function parseBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let current: TextBlock | undefined;
  for (const raw of lines) {
    if (raw.trim() === '') {
      current = undefined;
      continue;
    }
    if (BULLET_RE.test(raw)) {
      current = { kind: 'bullet', lines: [parseInline(raw.replace(BULLET_RE, ''))] };
      blocks.push(current);
      continue;
    }
    if (current && current.kind === 'paragraph') {
      current.lines.push(parseInline(raw));
    } else {
      current = { kind: 'paragraph', lines: [parseInline(raw)] };
      blocks.push(current);
    }
  }
  return blocks;
}

function runsToHtml(runs: TextRun[]): string {
  return runs
    .map((r) => {
      let html = escapeHtml(r.text);
      if (r.italic) html = `<em>${html}</em>`;
      if (r.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}

/** Markdown-light → sicheres HTML. */
export function markdownToHtml(text: string): string {
  const blocks = parseBlocks(text);
  const out: string[] = [];
  let list: string[] | undefined;
  const closeList = () => {
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    list = undefined;
  };
  for (const block of blocks) {
    const inner = block.lines.map(runsToHtml).join('<br>');
    if (block.kind === 'bullet') {
      list ??= [];
      list.push(`<li>${inner}</li>`);
    } else {
      closeList();
      out.push(`<p>${inner}</p>`);
    }
  }
  closeList();
  return out.join('');
}

/** Reiner Text ohne Markdown-Zeichen (z. B. für Labels). */
export function markdownToPlain(text: string): string {
  return parseBlocks(text)
    .map((b) => b.lines.map((l) => l.map((r) => r.text).join('')).join('\n'))
    .join('\n');
}
