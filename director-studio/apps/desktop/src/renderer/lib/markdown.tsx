import { Fragment, type ReactNode } from 'react';
import { parseTimecode } from '@studio/core';

/**
 * Leichtes Markdown für Director-Nachrichten: Absätze, Überschriften, Listen, Codeblöcke,
 * **fett**, *kursiv*, `code`, [Links](https://…) und anklickbare Timecodes (00:12.400 → Abspielkopf).
 * Baut React-Elemente (kein innerHTML) – Director-Text kann so kein HTML einschleusen.
 */

export interface MarkdownProps {
  text: string;
  /** Klick auf einen Timecode (Sekunden). Ohne Handler werden Timecodes als Text gezeigt. */
  onTimecode?: ((seconds: number) => void) | undefined;
  onLink?: ((href: string) => void) | undefined;
  timecodeLabel?: ((timecode: string) => string) | undefined;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s\n][^*\n]*?\*|_[^_\s\n][^_\n]*?_)|(\[[^\]\n]+\]\([^)\s]+\))|((?<![\d:.])(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?(?![\d:]))/g;

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function renderInline(text: string, props: MarkdownProps, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${index++}`;
    const [token] = m;
    if (m[1]) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (m[2]) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), props, key)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), props, key)}</em>);
    } else if (m[4]) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const href = safeHref(linkMatch?.[2] ?? '');
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => {
              if (props.onLink) {
                e.preventDefault();
                props.onLink(href);
              }
            }}
          >
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    } else if (m[5]) {
      let seconds: number | null = null;
      try {
        seconds = parseTimecode(token);
      } catch {
        seconds = null;
      }
      if (seconds !== null && props.onTimecode) {
        const s = seconds;
        out.push(
          <button
            key={key}
            type="button"
            className="tc-link"
            aria-label={props.timecodeLabel ? props.timecodeLabel(token) : token}
            onClick={() => props.onTimecode?.(s)}
          >
            {token}
          </button>,
        );
      } else {
        out.push(token);
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: 'p'; lines: string[] }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'code'; text: string };

export function parseMarkdownBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', lines: paragraph });
    paragraph = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'h', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i]!)) {
        items.push(lines[i]!.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/, ''));
        i++;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return blocks;
}

export function Markdown(props: MarkdownProps) {
  const blocks = parseMarkdownBlocks(props.text);
  return (
    <div className="md">
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.type) {
          case 'p':
            return (
              <p key={key}>
                {block.lines.map((line, li) => (
                  <Fragment key={li}>
                    {li > 0 && <br />}
                    {renderInline(line, props, `${key}-${li}`)}
                  </Fragment>
                ))}
              </p>
            );
          case 'h': {
            const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[Math.min(block.level, 4) - 1]!;
            return (
              <Tag key={key} className="md-heading">
                {renderInline(block.text, props, key)}
              </Tag>
            );
          }
          case 'ul':
          case 'ol': {
            const Tag = block.type;
            return (
              <Tag key={key}>
                {block.items.map((item, ii) => (
                  <li key={ii}>{renderInline(item, props, `${key}-${ii}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
