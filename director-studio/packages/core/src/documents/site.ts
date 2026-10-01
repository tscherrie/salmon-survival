import { z } from 'zod';
import { DocumentOpError, assertUniqueId, deepClone, type OpContext } from './common.ts';

/**
 * Website: Der Quellcode liegt als Dateibaum unter `site/` im Projekt (der Director bearbeitet ihn mit
 * Datei-Tools). Dieses Dokument hält die Metadaten (Framework, Seitenkarte, Mockups) und den Snapshot
 * der Quelldateien (Pfad → SHA-256) je Version.
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

export const siteSchema = z.object({
  kind: z.literal('site'),
  framework: z.enum(['vite-react', 'html']).default('vite-react'),
  /** Phase der Webproduktion: erst Mockups, dann Code. */
  stage: z.enum(['mockup', 'code']).default('mockup'),
  pages: z.array(pageSchema).default([]),
  /** Snapshot der Quelldateien: relativer Pfad unter `site/` → SHA-256. */
  files: z.record(z.string(), z.string()).default({}),
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

export const siteOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_page'), page: pageSchema }),
  z.object({ op: z.literal('update_page'), pageId: z.string(), patch: pageSchema.omit({ id: true }).partial() }),
  z.object({ op: z.literal('remove_page'), pageId: z.string() }),
  z.object({
    op: z.literal('update_site'),
    patch: siteSchema.omit({ kind: true, pages: true, files: true }).partial(),
  }),
  /** Wird vom Projektdienst nach Dateiänderungen des Directors gesetzt. */
  z.object({ op: z.literal('snapshot_files'), files: z.record(z.string(), z.string()) }),
]);
export type SiteOp = z.infer<typeof siteOpSchema>;
export type SiteOpInput = z.input<typeof siteOpSchema>;

export function applySiteOps(doc: Site, ops: readonly SiteOpInput[], _ctx: OpContext = {}): Site {
  const next = deepClone(doc);
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
          next.pages.push(op.page);
          break;
        case 'update_page': {
          const page = next.pages.find((p) => p.id === op.pageId);
          if (!page) throw new Error(`Seite "${op.pageId}" existiert nicht`);
          if (op.patch.path && next.pages.some((p) => p.id !== op.pageId && p.path === op.patch.path)) {
            throw new Error(`Pfad "${op.patch.path}" ist schon belegt`);
          }
          Object.assign(page, op.patch);
          break;
        }
        case 'remove_page': {
          const idx = next.pages.findIndex((p) => p.id === op.pageId);
          if (idx < 0) throw new Error(`Seite "${op.pageId}" existiert nicht`);
          next.pages.splice(idx, 1);
          break;
        }
        case 'update_site':
          Object.assign(next, op.patch);
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
