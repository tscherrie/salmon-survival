import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { formatTimecode, secondsToFrames, VIEWPORTS } from '@studio/core';
import { errorMessage, mediaIssueCollector, projectTempDir, readImageBlock, truncate, wrapUntrusted } from '../util.ts';
import { emitVersion } from './perception.ts';
import { defineTool, errorResult, textResult, type ToolContent, type ToolContext } from './registry.ts';

// ───────────────────────── Pfad-Sicherheit für site/ ─────────────────────────

const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.git', '.studio', '.vite', '.cache', 'dist']);
const MAX_SITE_FILE_BYTES = 1_000_000;

/**
 * Löst einen vom Modell gelieferten Pfad sicher unter `site/` auf. Abgelehnt werden absolute Pfade,
 * Laufwerksbuchstaben, `..`, Abhängigkeits-/Build-Ordner und `.env*`-Dateien (Keys gehören nie in
 * den Dev-Server). Symlinks werden separat mit {@link assertInsideReal} geprüft.
 */
export function resolveSitePath(siteDir: string, relPath: string): string {
  if (typeof relPath !== 'string' || !relPath.trim() || relPath.includes('\0')) throw new Error('Leerer oder ungültiger Pfad.');
  const normalized = relPath.trim().replace(/\\/g, '/');
  if (isAbsolute(relPath) || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.startsWith('~')) {
    throw new Error(`Absolute Pfade sind nicht erlaubt: ${relPath} (Pfade sind relativ zu site/).`);
  }
  const segments = normalized.replace(/^site\//, '').split('/').filter((s) => s && s !== '.');
  if (segments.length === 0) throw new Error('Pfad zeigt auf site/ selbst.');
  if (segments.some((s) => s === '..')) throw new Error(`Pfad verlässt site/: ${relPath}`);
  const blocked = segments.find((s) => FORBIDDEN_SEGMENTS.has(s));
  if (blocked) throw new Error(`Zugriff auf ${blocked}/ ist nicht erlaubt.`);
  if (/^\.env/i.test(segments[segments.length - 1]!)) throw new Error('.env-Dateien sind nicht erlaubt (keine Schlüssel im Web-Projekt).');
  const abs = resolve(siteDir, ...segments);
  const rel = relative(siteDir, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Pfad verlässt site/: ${relPath}`);
  return abs;
}

/** Prüft nach Auflösung von Symlinks, dass der nächste existierende Vorfahre innerhalb von site/ liegt. */
export async function assertInsideReal(siteDir: string, abs: string): Promise<void> {
  await mkdir(siteDir, { recursive: true });
  const root = await realpath(siteDir);
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      const rel = relative(root, real);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Pfad verlässt site/ (Symlink).');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new Error('Pfad nicht auflösbar.');
      probe = parent;
    }
  }
}

async function snapshotSite(ctx: ToolContext, note: string): Promise<string> {
  const doc = await ctx.project.getDocument();
  if (!doc || doc.kind !== 'site') return '';
  // Snapshot und Commit unter einer Sperre: Eine Wiederherstellung kann sich nicht dazwischenschieben.
  const { version, files } = await ctx.project.commitSiteSnapshot({ note, author: 'director', runId: ctx.runId });
  emitVersion(ctx, version);
  return ` → v${version.number} (Snapshot ${Object.keys(files).length} Dateien)`;
}

export const writeSiteFileTool = defineTool({
  name: 'write_site_file',
  description: [
    'Schreibt eine oder mehrere Dateien des Web-Projekts unter site/ (Pfade relativ zu site/, z. B. "src/App.tsx", "index.html"). Ganze Dateien, kein Patch – lies vorher mit read_site_file.',
    'Nach dem Schreiben wird der Quellbaum als neue Version des Site-Dokuments gesichert. Nicht erlaubt: absolute Pfade, "..", node_modules/, dist/, .git/, .env-Dateien.',
    'Die Vorschau hat kein externes Netz: Schriften, Icons, Bilder und Bibliotheken unter site/ ablegen oder per npm einbinden, nie von CDNs/Google Fonts laden.',
    'Gib Elementen, auf die der Nutzer zeigen könnte (Sektionen, Karten, Hero), ein stabiles data-sid-Attribut. Prüfe danach mit screenshot_site.',
  ].join(' '),
  input: z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(30),
    note: z.string().describe('Änderungsnotiz, z. B. "Hero mit Video-Loop, Typo-Skala angepasst".'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    const siteDir = ctx.project.siteDir;
    const targets: Array<{ abs: string; content: string; path: string }> = [];
    try {
      for (const file of args.files) {
        if (Buffer.byteLength(file.content) > MAX_SITE_FILE_BYTES) throw new Error(`${file.path}: Datei zu groß (max. 1 MB). Große Medien gehören als Assets ins Projekt.`);
        const abs = resolveSitePath(siteDir, file.path);
        await assertInsideReal(siteDir, abs);
        targets.push({ abs, content: file.content, path: relative(siteDir, abs).split(sep).join('/') });
      }
    } catch (error) {
      return errorResult(errorMessage(error));
    }
    for (const t of targets) {
      await mkdir(dirname(t.abs), { recursive: true });
      await writeFile(t.abs, t.content);
    }
    const snapshot = await snapshotSite(ctx, args.note);
    return textResult(`Geschrieben: ${targets.map((t) => `${t.path} (${t.content.split('\n').length} Zeilen)`).join(', ')}${snapshot}`);
  },
});

export const readSiteFileTool = defineTool({
  name: 'read_site_file',
  description: 'Liest eine Datei unter site/ mit Zeilennummern (optional nur einen Zeilenbereich) – vor jeder Änderung und um auf eine Element-Referenz (data-src Datei:Zeile) zu reagieren.',
  input: z.object({
    path: z.string(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    try {
      const abs = resolveSitePath(ctx.project.siteDir, args.path);
      await assertInsideReal(ctx.project.siteDir, abs);
      const text = await readFile(abs, 'utf8');
      const lines = text.split('\n');
      const start = Math.max(1, args.startLine ?? 1);
      const end = Math.min(lines.length, args.endLine ?? Math.min(lines.length, start + 1999));
      const numbered = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(5)}  ${l}`)
        .join('\n');
      return textResult(`${args.path} (Zeilen ${start}–${end} von ${lines.length}):\n${wrapUntrusted(`site/${args.path}`, numbered)}`);
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

async function walk(dir: string, root: string, out: Array<{ path: string; bytes: number }>, limit: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= limit) return;
    if (FORBIDDEN_SEGMENTS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, root, out, limit);
    else if (entry.isFile()) out.push({ path: relative(root, abs).split(sep).join('/'), bytes: (await stat(abs)).size });
  }
}

export const listSiteFilesTool = defineTool({
  name: 'list_site_files',
  description: 'Listet die Dateien des Web-Projekts unter site/ (ohne node_modules, dist, .git) mit Größe – Überblick vor Änderungen.',
  input: z.object({ dir: z.string().optional().describe('Unterordner relativ zu site/ (Standard: alles).') }),
  sideEffect: 'none',
  async run(args, ctx) {
    try {
      const root = ctx.project.siteDir;
      const start = args.dir ? resolveSitePath(root, args.dir) : root;
      const files: Array<{ path: string; bytes: number }> = [];
      await walk(start, root, files, 500);
      if (files.length === 0) return textResult('site/ ist leer.');
      return textResult(files.map((f) => `${f.path} (${f.bytes} B)`).join('\n'));
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const writeComponentTool = defineTool({
  name: 'write_component',
  description: [
    'Schreibt eine Remotion-Komponente (TSX) für Overlays, kinetische Typografie, Übergänge oder Rotoscope-Zeichnungen und kompiliert sie (esbuild, Import-Allowlist: react, remotion, Studio-FX).',
    'Die Komponente bekommt OverlayComponentProps: { clip, frame (relativ zum Clip), durationInFrames, fps, width, height, props, assets, words, random(salt) } – sie muss deterministisch sein (kein Math.random, kein Date, kein Netzwerk) und Timing aus props/words/Beat-Daten lesen.',
    'Default-Export oder benannter Export mit dem Komponentennamen. Bei Erfolg wird der Code als Asset gespeichert; registriere ihn danach mit apply_document_ops (register_component) und prüfe kritische Frames mit render_still, bevor er auf der Timeline bleibt. Lade vorher den Skill kinetic-typography bzw. rotoscope-overlay.',
  ].join(' '),
  input: z.object({
    name: z.string().describe('PascalCase-Name, z. B. "LyricSlam".'),
    source: z.string().describe('Vollständiger TSX-Quelltext.'),
    description: z.string().optional(),
    propsSchema: z.record(z.string(), z.unknown()).optional().describe('JSON-Schema der props (Dokumentation für spätere Clips).'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    if (!/^[A-Z][A-Za-z0-9]{1,63}$/.test(args.name)) return errorResult('Name muss PascalCase sein (Buchstaben/Ziffern, z. B. "LyricSlam").');
    if (!ctx.render) return errorResult('Der Komponenten-Compiler ist nicht verfügbar.');
    const fileName = `${args.name}.tsx`;
    const compiled = await ctx.render.compileComponent(args.source, { fileName });
    if (!compiled.ok) {
      return errorResult(`Kompilierung fehlgeschlagen:\n${compiled.errors.join('\n')}${compiled.warnings.length ? `\nWarnungen:\n${compiled.warnings.join('\n')}` : ''}`);
    }
    const file = join(ctx.project.codeDir, 'components', fileName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, args.source);
    const asset = await ctx.project.addAssetFromBuffer(args.source, {
      fileName,
      kind: 'code',
      subtype: 'component',
      mime: 'text/tsx',
      title: args.name,
      source: 'director',
      tags: ['component'],
      ...(args.description ? { description: args.description } : {}),
      metadata: { componentName: args.name, file: `code/components/${fileName}`, warnings: compiled.warnings, ...(args.propsSchema ? { propsSchema: args.propsSchema } : {}) },
    });
    ctx.ui.emit({ type: 'asset', projectId: ctx.projectId, asset });
    const componentId = `cmp_${args.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
    const register = JSON.stringify({ op: 'register_component', componentId, component: { assetId: asset.id, name: args.name, ...(args.propsSchema ? { propsSchema: args.propsSchema } : {}) } });
    return textResult(
      `Kompiliert und gespeichert: ${asset.id} (code/components/${fileName})${compiled.warnings.length ? `\nWarnungen: ${compiled.warnings.join('; ')}` : ''}\nRegistrieren: apply_document_ops mit ${register}\nDann Clips mit "componentId": "${componentId}" auf Overlay-/Textspur legen und mit render_still prüfen.`,
    );
  },
});

export const renderStillTool = defineTool({
  name: 'render_still',
  description: 'Rendert ein Einzelbild des aktuellen Dokuments genau so, wie es exportiert wird: einen Timeline-Frame (mit allen Spuren, Komponenten, Text) bzw. eine Folie oder die Leinwand. Nutze es, um Komponenten, Typografie, Safe Areas und Layouts zu prüfen.',
  input: z.object({
    target: z.enum(['timeline', 'document']).describe('"timeline" = Video/Audio-Timeline, "document" = Folie (slideId) oder Leinwand.'),
    timeSec: z.number().min(0).optional(),
    frame: z.number().int().min(0).optional(),
    formatId: z.string().optional(),
    slideId: z.string().optional(),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    if (!ctx.render) return errorResult('Renderer ist nicht verfügbar.');
    try {
      const dir = await projectTempDir(ctx.projectDir, 'still');
      const out = join(dir, 'still.png');
      let label: string;
      let path: string;
      const issues = mediaIssueCollector();
      if (args.target === 'timeline') {
        const doc = await ctx.project.getDocument();
        if (!doc || doc.kind !== 'timeline') return errorResult('Das Projekt hat keine Timeline.');
        const frame = args.frame ?? secondsToFrames(args.timeSec ?? 0, doc.fps);
        path = await ctx.render.renderTimelineStill({ frame, out, onMediaError: issues.onMediaError, ...(args.formatId ? { formatId: args.formatId } : {}) });
        label = `Timeline ${formatTimecode(frame, doc.fps)} (Frame ${frame}${args.formatId ? `, ${args.formatId}` : ''})`;
      } else {
        path = await ctx.render.renderDocumentPng({ out, ...(args.slideId ? { slideId: args.slideId } : {}) });
        label = args.slideId ? `Folie ${args.slideId}` : 'Dokument';
      }
      const image = await readImageBlock(path);
      if (!image) return errorResult('Bild konnte nicht gelesen werden (Format/Größe).');
      const warning = issues.summary();
      return { content: [{ type: 'text', text: `${label}:` }, image, ...(warning ? [{ type: 'text' as const, text: warning }] : [])] };
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const screenshotSiteTool = defineTool({
  name: 'screenshot_site',
  description: `Öffnet die Web-Vorschau headless und liefert Screenshots je Viewport (mobile ${VIEWPORTS.mobile.width}px, tablet ${VIEWPORTS.tablet.width}px, desktop ${VIEWPORTS.desktop.width}px) plus Konsolen- und Seitenfehler. Pflicht nach Änderungen an der Site, bevor du sie als fertig meldest.`,
  input: z.object({
    viewports: z.array(z.enum(['mobile', 'tablet', 'desktop'])).min(1).max(3).optional().describe('Standard: desktop und mobile.'),
    path: z.string().optional().describe('URL-Pfad, z. B. "/" oder "/about".'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    if (!ctx.render) return errorResult('Renderer ist nicht verfügbar.');
    try {
      const outDir = await projectTempDir(ctx.projectDir, 'shots');
      const result = await ctx.render.screenshotSite({ viewports: args.viewports ?? ['desktop', 'mobile'], outDir, ...(args.path ? { path: args.path } : {}) });
      const content: ToolContent[] = [];
      for (const shot of result.shots) {
        const image = await readImageBlock(shot.path);
        if (image) content.push({ type: 'text', text: `${shot.viewport}${args.path ? ` ${args.path}` : ''}:` }, image);
        else content.push({ type: 'text', text: `${shot.viewport}: Screenshot zu groß/unlesbar (${shot.path}).` });
      }
      const errors = [...result.consoleErrors.map((e) => `console: ${e}`), ...result.pageErrors.map((e) => `page: ${e}`)];
      const head = errors.length ? `Fehler (${errors.length}):\n${wrapUntrusted('preview:console', truncate(errors.join('\n'), 6000))}` : 'Keine Konsolen- oder Seitenfehler.';
      return { content: [{ type: 'text', text: head }, ...content] };
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const exportProjectTool = defineTool({
  name: 'export_project',
  description: 'Exportiert das Ergebnis lokal (z. B. "mp4", "mp4:9:16", "wav", "pdf", "pptx", "png", "zip"). Erst nach der finalen Prüfung (Review-Checkliste, Lautheit) aufrufen; der Pfad erscheint im Panel.',
  input: z.object({ target: z.string().describe('Exportziel, z. B. "mp4", "pdf", "zip".') }),
  sideEffect: 'local',
  async run(args, ctx) {
    if (!ctx.render) return errorResult('Export ist nicht verfügbar.');
    try {
      ctx.emitProgress(`Exportiere ${args.target} …`);
      const result = await ctx.render.exportProject(args.target);
      return textResult(`Export fertig: ${result.path}`);
    } catch (error) {
      return errorResult(`Export fehlgeschlagen: ${errorMessage(error)}`);
    }
  },
});
