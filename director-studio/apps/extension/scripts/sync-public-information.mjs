#!/usr/bin/env node
// Generate the four ordinary static information pages and editor policy copies.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const extensionRoot = new URL('../', import.meta.url);
const sourceBase = 'https://github.com/tscherrie/salmon-survival/blob/codex/director-native-extension/director-studio/apps/extension/release/';
const pages = ['product', 'support', 'privacy', 'terms'];
const filenames = { product: 'index.html', support: 'support.html', privacy: 'privacy.html', terms: 'terms.html' };
const labels = { product: 'Product', support: 'Support', privacy: 'Privacy', terms: 'Terms' };
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) throw new Error('Usage: node scripts/sync-public-information.mjs [--check]');
const site = JSON.parse(await readFile(new URL('info-site/site.json', extensionRoot), 'utf8'));
const origin = new URL(site.url);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('A verified public HTTPS Site origin is required.');
if (!site.projectId || site.projectId === 'appgprj_6abec3c3c19081918a89d36f28297662') throw new Error('Information hosting must remain separate from the private Director runtime.');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function linkDestination(href) {
  const match = /^([a-z-]+)\.md(#.*)?$/.exec(href);
  if (match) return new URL(filenames[match[1]] ? filenames[match[1]] + (match[2] ?? '') : href, filenames[match[1]] ? origin : sourceBase).href;
  if (/^https:\/\//.test(href) || /^\/(?!\/)/.test(href) || href.startsWith('#')) return href;
  throw new Error(`Unsupported information link: ${href}`);
}

function inline(markdown) {
  const tokens = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = '', offset = 0;
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
  return markdown.trim().split(/\n\s*\n/).map(block => {
    const heading = /^(#{1,2}) (.+)$/.exec(block);
    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (block.startsWith('- ')) {
      const items = block.split('\n');
      if (items.some(item => !item.startsWith('- '))) throw new Error('Unsupported multiline information list');
      return `<ul>\n${items.map(item => `  <li>${inline(item.slice(2))}</li>`).join('\n')}\n</ul>`;
    }
    if (/^(?:#|>|```|\d+\. )/m.test(block)) throw new Error('Unsupported information Markdown block');
    return `<p>${inline(block.replace(/\n/g, ' '))}</p>`;
  }).join('\n\n');
}

function renderPage(name, markdown) {
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  if (!title || markdown.includes('[CONFIRM]') || /\[CONFIRM\b/.test(markdown)) throw new Error(`Unresolved information source: ${name}`);
  const nav = pages.map(page => `<a href="${new URL(filenames[page], origin).href}"${page === name ? ' aria-current="page"' : ''}>${labels[page]}</a>`).join('\n');
  return `<!doctype html>
<!-- Generated from release/${name}.md by scripts/sync-public-information.mjs. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(name === 'product' ? 'AI Director Studio: free project editing for video, audio, presentations, graphics and websites.' : `${labels[name]} information for AI Director Studio, operated by Jeremias Grenzebach.`)}">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${new URL(filenames[name], origin).href}">
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #121417; color: #f3f4f6; }
    * { box-sizing: border-box; }
    body { margin: 0; font-size: 1rem; line-height: 1.7; }
    header, main, footer { max-width: 58rem; margin: auto; padding: 1.5rem; }
    header { border-bottom: 1px solid #393e47; }
    .brand { display: block; color: #f3f4f6; font-size: 1.2rem; font-weight: 700; margin-bottom: 1rem; text-decoration: none; }
    nav { display: flex; flex-wrap: wrap; gap: .6rem 1.4rem; }
    nav a { padding: .3rem 0; }
    nav a[aria-current] { color: #f3f4f6; font-weight: 700; text-decoration-thickness: 3px; }
    a { color: #f1bf80; overflow-wrap: anywhere; text-underline-offset: .22em; }
    a:focus-visible { outline: 3px solid #f1bf80; outline-offset: 5px; }
    h1, h2 { line-height: 1.2; letter-spacing: -.015em; }
    h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 1rem 0 1.5rem; }
    h2 { font-size: 1.45rem; margin-top: 2.2rem; }
    p, li { max-width: 50rem; }
    li { margin: .8rem 0; }
    code { font-size: .95em; overflow-wrap: anywhere; }
    footer { border-top: 1px solid #393e47; font-size: .9rem; color: #b7bcc5; }
    .skip-link { position: absolute; top: -5rem; }
    .skip-link:focus { position: static; display: block; padding: 1rem; }
    @media (max-width: 36rem) { header, main, footer { padding: 1.2rem; } ul { padding-left: 1.3rem; } }
  </style>
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <header>
    <a class="brand" href="${origin.href}">AI Director Studio</a>
    <nav aria-label="Product and policies">${nav}</nav>
  </header>
  <main id="content">
${renderBody(markdown)}
  </main>
  <footer><p>Jeremias Grenzebach · <a href="mailto:l@lll.uno">l@lll.uno</a> · <a href="${sourceBase}${name}.md">Page source</a></p></footer>
</body>
</html>
`;
}

await mkdir(new URL('info-site/public/', extensionRoot), { recursive: true });
let stale = false;
for (const name of pages) {
  const markdown = (await readFile(new URL(`release/${name}.md`, extensionRoot), 'utf8')).replace(/\r\n/g, '\n');
  const html = renderPage(name, markdown);
  const destinations = [new URL(`info-site/public/${filenames[name]}`, extensionRoot)];
  if (name !== 'product') destinations.push(new URL(`public/${filenames[name]}`, extensionRoot));
  for (const destination of destinations) {
    if (check) {
      const current = await readFile(destination, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (current !== html) { stale = true; console.error(`Stale information page: ${fileURLToPath(destination)}`); }
    } else {
      await writeFile(destination, html);
      console.log(`Synced ${fileURLToPath(destination)}`);
    }
  }
}
if (stale) process.exitCode = 1;
else if (check) console.log('All four public information pages and three editor policy copies match their Markdown sources.');
