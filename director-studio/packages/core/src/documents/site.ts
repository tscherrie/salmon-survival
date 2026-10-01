import { z } from 'zod';
import {
  DocumentOpError,
  assertAssetKind,
  assertUniqueId,
  deepClone,
  mergeNested,
  mergePatch,
  parseOrThrow,
  patchSchemaOf,
  setOrDelete,
  type OpContext,
} from './common.ts';

/**
 * Website: Der Quellcode liegt als Dateibaum unter `site/` im Projekt (der Director bearbeitet ihn mit
 * Datei-Tools). Dieses Dokument hält die Metadaten (Framework, Seitenkarte, Mockups) und den Snapshot
 * der Quelldateien (Pfad → SHA-256) je Version.
 *
 * Wiederherstellbarkeit: `files` ist der **vollständige** Stand von `site/` zu dieser Version (ohne
 * `node_modules/`, `dist/` usw.). Jeder Hash verweist auf den Inhalt im inhaltsadressierten Speicher des
 * Projekts; beim Wiederherstellen einer Version schreibt der Projektdienst `site/` genau auf diesen Stand
 * zurück (fehlende Dateien anlegen, abweichende überschreiben, nicht enthaltene löschen).
 */

export const pageSchema = z.object({
  id: z.string().min(1),
  /** URL-Pfad, z. B. `/` oder `/about`. */
  path: z.string().startsWith('/'),
  title: z.string(),
  sourceFile: z.string().optional(),
  /** Mockup-Assets (Bilder) dieser Seite je Viewport. */
  mockups: z.record(z.string(), z.string()).optional(),
  notes: z.string().optional(),
});
export type SitePage = z.infer<typeof pageSchema>;

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
} as const;

/**
 * Relativer POSIX-Pfad unter `site/` (z. B. `src/App.tsx`): ohne führenden `/`, ohne `\`, ohne `.`/`..`-Segmente
 * und ohne Laufwerksbuchstaben – damit ein Wiederherstellen nie außerhalb von `site/` schreiben kann.
 */
export function isSafeSitePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Datei-Snapshot einer Site-Version: relativer Pfad unter `site/` → SHA-256 des Inhalts (hex).
 * Er beschreibt den vollständigen Dateistand; der Inhalt liegt inhaltsadressiert im Projektspeicher.
 */
export const siteFilesSchema = z.record(
  z.string().refine(isSafeSitePath, { message: 'muss ein relativer Pfad unter site/ sein (ohne .., ohne führenden /)' }),
  z.string().min(1),
);
export type SiteFiles = z.infer<typeof siteFilesSchema>;

export const siteSchema = z.object({
  kind: z.literal('site'),
  framework: z.enum(['vite-react', 'html']).default('vite-react'),
  /** Phase der Webproduktion: erst Mockups, dann Code. */
  stage: z.enum(['mockup', 'code']).default('mockup'),
  pages: z.array(pageSchema).default([]),
  /** Snapshot der Quelldateien: relativer Pfad unter `site/` → SHA-256 (siehe {@link siteFilesSchema}). */
  files: siteFilesSchema.default({}),
  devCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  outputDir: z.string().default('dist'),
});
export type Site = z.infer<typeof siteSchema>;
export type SiteInput = z.input<typeof siteSchema>;

export function createSite(options: { framework?: 'vite-react' | 'html' } = {}): Site {
  return siteSchema.parse({
    kind: 'site',
    framework: options.framework ?? 'vite-react',
    pages: [{ id: 'home', path: '/', title: 'Start' }],
  });
}

/**
 * Patch-Schemas ohne Defaults (zod 4 würde sie bei `.partial()` injizieren – z. B. `framework`/`stage`/`outputDir`
 * zurücksetzen). Fehlendes Feld = unverändert, `null` = optionales Feld entfernen bzw. auf Standard zurücksetzen.
 * `mockups` wird je Viewport gemergt (`null` je Viewport löscht ihn).
 */
const pagePatchSchema = patchSchemaOf(pageSchema.omit({ id: true })).extend({
  mockups: z.record(z.string(), z.string().nullable()).nullable().optional(),
});
const sitePatchSchema = patchSchemaOf(siteSchema.omit({ kind: true, pages: true, files: true }));

export const siteOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_page'), page: pageSchema }),
  z.object({ op: z.literal('update_page'), pageId: z.string(), patch: pagePatchSchema }),
  z.object({ op: z.literal('remove_page'), pageId: z.string() }),
  z.object({ op: z.literal('update_site'), patch: sitePatchSchema }),
  /** Wird vom Projektdienst nach Dateiänderungen des Directors gesetzt (vollständiger Stand, ersetzt `files`). */
  z.object({ op: z.literal('snapshot_files'), files: siteFilesSchema }),
]);
export type SiteOp = z.infer<typeof siteOpSchema>;
export type SiteOpInput = z.input<typeof siteOpSchema>;

export function applySiteOps(doc: Site, ops: readonly SiteOpInput[], ctx: OpContext = {}): Site {
  let next = deepClone(doc);
  ops.forEach((raw, index) => {
    const parsed = siteOpSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DocumentOpError(index, String((raw as { op?: unknown }).op ?? '?'), parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const op = parsed.data;
    try {
      switch (op.op) {
        case 'add_page':
          assertUniqueId(next.pages.map((p) => p.id), op.page.id, 'Seite');
          if (next.pages.some((p) => p.path === op.page.path)) throw new Error(`Pfad "${op.page.path}" ist schon belegt`);
          checkMockups(op.page.id, op.page.mockups, ctx);
          next.pages.push(op.page);
          break;
        case 'update_page': {
          const idx = next.pages.findIndex((p) => p.id === op.pageId);
          if (idx < 0) throw new Error(`Seite "${op.pageId}" existiert nicht`);
          const page = next.pages[idx]!;
          if (op.patch.path && next.pages.some((p) => p.id !== op.pageId && p.path === op.patch.path)) {
            throw new Error(`Pfad "${op.patch.path}" ist schon belegt`);
          }
          const { mockups, ...rest } = op.patch;
          checkMockups(page.id, mockups, ctx);
          const merged: Record<string, unknown> = mergePatch(page as Record<string, unknown>, rest);
          setOrDelete(merged, 'mockups', mergeNested(page.mockups, mockups));
          next.pages[idx] = parseOrThrow(pageSchema, merged, `Seite "${page.id}"`);
          break;
        }
        case 'remove_page': {
          const idx = next.pages.findIndex((p) => p.id === op.pageId);
          if (idx < 0) throw new Error(`Seite "${op.pageId}" existiert nicht`);
          next.pages.splice(idx, 1);
          break;
        }
        case 'update_site':
          next = parseOrThrow(siteSchema, mergePatch(next as Record<string, unknown>, op.patch), 'Website');
          break;
        case 'snapshot_files':
          next.files = { ...op.files };
          break;
      }
    } catch (error) {
      throw new DocumentOpError(index, op.op, (error as Error).message);
    }
  });
  return next;
}

/** Mockups müssen existierende Bild-Assets sein (`null` = Viewport entfernen, wird nicht geprüft). */
function checkMockups(pageId: string, mockups: Record<string, string | null> | null | undefined, ctx: OpContext): void {
  for (const [viewport, assetId] of Object.entries(mockups ?? {})) {
    if (assetId !== null) assertAssetKind(ctx, assetId, ['image'], `Mockup ${viewport} von Seite "${pageId}"`);
  }
}

export function summarizeSite(doc: Site): string {
  const lines = [`Website (${doc.framework}) · Phase ${doc.stage} · ${doc.pages.length} Seiten · ${Object.keys(doc.files).length} Quelldateien`];
  for (const page of doc.pages) {
    lines.push(`- ${page.id} ${page.path} „${page.title}“${page.sourceFile ? ` (${page.sourceFile})` : ''}${page.mockups ? ` · Mockups: ${Object.keys(page.mockups).join(', ')}` : ''}`);
  }
  return lines.join('\n');
}

/** Parst ein `data-src`-Attribut (`src/App.tsx:12:5`) zu einer Quellangabe. */
export function parseDataSrc(value: string): { file: string; line: number; column?: number } | undefined {
  const match = /^(.+?):(\d+)(?::(\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  return { file: match[1]!, line: Number(match[2]), ...(match[3] ? { column: Number(match[3]) } : {}) };
}
