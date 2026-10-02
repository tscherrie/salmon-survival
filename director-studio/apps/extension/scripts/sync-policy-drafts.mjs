#!/usr/bin/env node
// Render only the Markdown subset used by the three private policy drafts.
// Run with --check to detect stale HTML without writing files.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const extensionRoot = new URL('../', import.meta.url);
const sourceBase = 'https://github.com/tscherrie/salmon-survival/blob/codex/director-native-extension/director-studio/apps/extension/release/';
const pages = ['privacy', 'support', 'terms'];
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) {
  throw new Error('Usage: node scripts/sync-policy-drafts.mjs [--check]');
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function linkDestination(href) {
  if (/\.md(?:#.*)?$/.test(href) && !/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('/')) {
    return new URL(href, sourceBase).href;
  }
  if (/^https:\/\//.test(href) || /^\/(?!\/)/.test(href) || href.startsWith('#')) return href;
  throw new Error(`Unsupported policy link: ${href}`);
}

function inline(markdown) {
  const tokens = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = '';
  let offset = 0;
  for (const match of markdown.matchAll(tokens)) {
    html += escapeHtml(markdown.slice(offset, match.index));
    if (match[1] !== undefined) html += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2] !== undefined) html += `<strong>${inline(match[2])}</strong>`;
    else html += `<a href="${escapeHtml(linkDestination(match[4]))}">${inline(match[3])}</a>`;
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(markdown.slice(offset));
}

function renderBody(markdown) {
  return markdown.trim().split(/\n\s*\n/).map((block) => {
    const heading = /^(#{1,2}) (.+)$/.exec(block);
    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (block.startsWith('- ')) {
      const items = block.split('\n');
      if (items.some((item) => !item.startsWith('- '))) throw new Error('Unsupported multiline policy list');
      return `<ul>\n${items.map((item) => `  <li>${inline(item.slice(2))}</li>`).join('\n')}\n</ul>`;
    }
    if (/^(?:#|>|```|\d+\. )/m.test(block)) throw new Error('Unsupported policy Markdown block');
    return `<p>${inline(block.replace(/\n/g, ' '))}</p>`;
  }).join('\n\n');
}

function renderPage(name, markdown) {
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  if (!title) throw new Error(`Missing draft title: ${name}`);
  const nav = [['/', 'Open editor'], ['/privacy.html', 'Privacy draft'], ['/support.html', 'Support draft'], ['/terms.html', 'Terms draft']]
    .map(([href, label]) => `<a href="${href}"${href === `/${name}.html` ? ' aria-current="page"' : ''}>${label}</a>`).join(' · ');
  return `<!doctype html>
<!-- Generated from release/${name}.md by scripts/sync-policy-drafts.mjs. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { background: #141619; color: #eee; font: 1rem/1.65 system-ui, sans-serif; max-width: 54rem; margin: 2rem auto; padding: 0 1.25rem 2rem; }
    a { color: #e5b77d; overflow-wrap: anywhere; }
    a:focus-visible { outline: 3px solid #e5b77d; outline-offset: 4px; }
    h1, h2 { line-height: 1.25; }
    h1 { font-size: 2rem; }
    h2 { margin-top: 2rem; font-size: 1.4rem; }
    li { margin: .65rem 0; }
    code { font-size: .9em; overflow-wrap: anywhere; }
    .draft { padding: 1rem; border: 1px solid #e5b77d; background: #242019; }
    nav, footer { margin: 1.5rem 0; }
    footer { border-top: 1px solid #51545a; padding-top: 1rem; }
    .skip-link { position: absolute; top: -5rem; }
    .skip-link:focus { position: static; }
  </style>
</head>
<body>
  <a class="skip-link" href="#content">Skip to draft text</a>
  <header>
    <p class="draft"><strong>Unpublished development draft.</strong> This private page is prepared for review and is not an approved public policy or public service terms. Fields marked [CONFIRM] remain unresolved.</p>
    <nav aria-label="Editor and policy drafts">${nav}</nav>
  </header>
  <main id="content">
${renderBody(markdown)}
  </main>
  <footer><p>Draft source: <a href="${sourceBase}${name}.md">release/${name}.md on GitHub</a>. Public availability and final approval are not asserted by this page.</p></footer>
</body>
</html>
`;
}

let stale = false;
for (const name of pages) {
  const markdown = (await readFile(new URL(`release/${name}.md`, extensionRoot), 'utf8')).replace(/\r\n/g, '\n');
  const html = renderPage(name, markdown);
  const destination = new URL(`public/${name}.html`, extensionRoot);
  if (check) {
    const current = await readFile(destination, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (current !== html) {
      stale = true;
      console.error(`Stale policy draft: ${fileURLToPath(destination)}`);
    }
  } else {
    await writeFile(destination, html, 'utf8');
    console.log(`Synced public/${name}.html`);
  }
}
if (stale) process.exitCode = 1;
else if (check) console.log('Policy draft HTML matches all three Markdown sources.');
