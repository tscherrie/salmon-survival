/**
 * Entschärft vom Director geschriebenes HTML für Folien-HTML-Blöcke. Ziel: kein Skript kann laufen.
 * Entfernt `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<frame*>`,
 * `<portal>`, alle `on*`-Attribute, `srcdoc` sowie `javascript:`/`vbscript:`/`data:text/html`-URLs.
 *
 * Hinweis: Das ist eine Schutzschicht, kein vollständiger HTML-Parser. Zusätzlich setzt `deckToHtml`
 * eine Content-Security-Policy (`script-src 'none'`), die Skripte auch bei einer Lücke blockiert.
 */

const DANGEROUS_CONTAINERS = ['script', 'iframe', 'object', 'embed', 'frameset', 'frame', 'noscript', 'template', 'portal', 'applet'];
const DANGEROUS_VOID = ['link', 'meta', 'base', 'frame', 'embed', 'param'];

export function sanitizeHtml(html: string): string {
  let out = html;
  // Kommentare entfernen (können bedingte IE-Kommentare/Verschleierung enthalten)
  out = out.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (const tag of DANGEROUS_CONTAINERS) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, 'gi');
    out = out.replace(re, '');
  }
  for (const tag of DANGEROUS_VOID) {
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }
  // Übrig gebliebene schließende Tags gefährlicher Container
  out = out.replace(new RegExp(`<\\/(?:${DANGEROUS_CONTAINERS.join('|')})\\s*>`, 'gi'), '');
  out = out.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g, (_m, tag: string, attrs: string, selfClose: string) => {
    return `<${tag}${sanitizeAttributes(attrs)}${selfClose ? ' /' : ''}>`;
  });
  return out;
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'data', 'ping', 'cite', 'srcset']);

function sanitizeAttributes(attrs: string): string {
  const re = /\s+([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let m: RegExpExecArray | null;
  const kept: string[] = [];
  while ((m = re.exec(attrs)) !== null) {
    const name = m[1]!.toLowerCase();
    const rawValue = m[2];
    if (name.startsWith('on')) continue;
    if (name === 'srcdoc' || name === 'formaction' || name === 'http-equiv') continue;
    let value = rawValue === undefined ? undefined : unquote(rawValue);
    if (value !== undefined && URL_ATTRS.has(name) && isDangerousUrl(value)) continue;
    if (value !== undefined && name === 'style') value = sanitizeInlineStyle(value);
    kept.push(value === undefined ? ` ${m[1]}` : ` ${m[1]}="${value.replace(/"/g, '&quot;')}"`);
  }
  return kept.join('');
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n');
}

export function isDangerousUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const normalized = decodeEntities(value).replace(/[\u0000- ]/g, '').toLowerCase();
  return /^(?:javascript|vbscript|livescript):/.test(normalized) || /^data:text\/html/.test(normalized) || /^data:image\/svg\+xml/.test(normalized);
}

function sanitizeInlineStyle(style: string): string {
  return style.replace(/expression\s*\(/gi, '').replace(/javascript\s*:/gi, '').replace(/behavior\s*:/gi, '').replace(/-moz-binding/gi, '');
}

/** Begrenzt CSS aus `<style>`-Blöcken eines HTML-Elements auf dessen Container (`@scope`). */
export function scopeStyleBlocks(html: string, scopeSelector: string): string {
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => {
    const cleaned = css.replace(/@import[^;]*;?/gi, '').replace(/<\/?\w[^>]*>/g, '');
    return `<style>@scope (${scopeSelector}) { ${cleaned} }</style>`;
  });
}
