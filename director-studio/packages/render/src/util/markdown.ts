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

/** Zerlegt eine Zeile in Läufe mit fett/kursiv (Öffner vor Nicht-Leerzeichen, Schließer danach). */
export function parseInline(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let bold = false;
  let italic: string | undefined;
  let buffer = '';
  const flush = () => {
    if (buffer) runs.push({ text: buffer, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    buffer = '';
  };
  const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && (line[i + 1] === '*' || line[i + 1] === '_' || line[i + 1] === '\\')) {
      buffer += line[i + 1];
      i++;
      continue;
    }
    if (ch === '*' && line[i + 1] === '*') {
      if (bold && !isSpace(line[i - 1])) {
        flush();
        bold = false;
        i++;
        continue;
      }
      if (!bold && !isSpace(line[i + 2]) && findCloser(line, '**', i + 2) >= 0) {
        flush();
        bold = true;
        i++;
        continue;
      }
    } else if (ch === '*' || ch === '_') {
      const wordInner = ch === '_' && /\w/.test(line[i - 1] ?? '') && /\w/.test(line[i + 1] ?? '');
      if (!wordInner) {
        if (italic === ch && !isSpace(line[i - 1])) {
          flush();
          italic = undefined;
          continue;
        }
        if (!italic && !isSpace(line[i + 1]) && findCloser(line, ch, i + 1) >= 0) {
          flush();
          italic = ch;
          continue;
        }
      }
    }
    buffer += ch;
  }
  flush();
  return runs;
}

/** Position eines schließenden Markers (vor ihm kein Leerzeichen), sonst −1. */
function findCloser(line: string, token: string, from: number): number {
  for (let j = from; j < line.length; j++) {
    if (!line.startsWith(token, j) || /\s/.test(line[j - 1] ?? ' ')) continue;
    if (token === '*' && (line[j + 1] === '*' || line[j - 1] === '*')) continue;
    if (token === '_' && /\w/.test(line[j + 1] ?? '')) continue;
    return j;
  }
  return -1;
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
