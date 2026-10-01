import { z } from 'zod';
import {
  canvasOpSchema,
  clipsInRange,
  deckOpSchema,
  DocumentOpError,
  findLayer,
  markersInRange,
  secondsToFrames,
  siteOpSchema,
  summarizeDocument,
  timelineOpSchema,
  VersionConflictError,
  type DocumentKind,
  type DocumentOp,
  type StudioDocument,
} from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { errorMessage, stableJson, truncate } from '../util.ts';
import { emitVersion } from './perception.ts';
import { defineTool, errorResult, textResult } from './registry.ts';

/** Asset-Namen für lesbare Zusammenfassungen. */
export function assetNames(project: ProjectStore): Record<string, string> {
  return Object.fromEntries(project.allAssets().map((a) => [a.id, a.title]));
}

export function opsSchemaFor(kind: DocumentKind): Record<string, unknown> {
  const schema = kind === 'timeline' ? timelineOpSchema : kind === 'deck' ? deckOpSchema : kind === 'canvas' ? canvasOpSchema : siteOpSchema;
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Einfacher Zeilen-Diff zweier Zusammenfassungen (für Rückmeldungen nach Operationen). */
export function summaryDiff(before: string, after: string, max = 40): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const setA = new Set(a);
  const setB = new Set(b);
  const removed = a.filter((l) => !setB.has(l)).map((l) => `- ${l}`);
  const added = b.filter((l) => !setA.has(l)).map((l) => `+ ${l}`);
  const all = [...removed, ...added];
  if (all.length === 0) return '(keine sichtbare Änderung in der Zusammenfassung)';
  return all.length > max ? `${all.slice(0, max).join('\n')}\n… (${all.length - max} weitere Zeilen)` : all.join('\n');
}

function portion(doc: StudioDocument, args: { trackId?: string | undefined; fromSec?: number | undefined; toSec?: number | undefined; slideId?: string | undefined; layerId?: string | undefined; pageId?: string | undefined }): unknown {
  switch (doc.kind) {
    case 'timeline': {
      if (args.fromSec === undefined && args.toSec === undefined && !args.trackId) return doc;
      const from = secondsToFrames(args.fromSec ?? 0, doc.fps);
      const to = args.toSec !== undefined ? secondsToFrames(args.toSec, doc.fps) : doc.durationFrames;
      const hits = clipsInRange(doc, from, to, args.trackId);
      return {
        range: { fromFrame: from, toFrame: to, fps: doc.fps },
        clips: hits.map(({ track, clip }) => ({ trackId: track.id, trackKind: track.kind, ...clip })),
        markers: markersInRange(doc, from, to),
        components: doc.components,
      };
    }
    case 'deck':
      if (!args.slideId) return doc;
      return doc.slides.find((s) => s.id === args.slideId) ?? { error: `Folie ${args.slideId} existiert nicht` };
    case 'canvas':
      if (!args.layerId) return doc;
      return findLayer(doc.layers, args.layerId) ?? { error: `Ebene ${args.layerId} existiert nicht` };
    case 'site':
      if (!args.pageId) return doc;
      return doc.pages.find((p) => p.id === args.pageId) ?? { error: `Seite ${args.pageId} existiert nicht` };
  }
}

export const getDocumentTool = defineTool({
  name: 'get_document',
  description: [
    'Liest das Projektdokument (Timeline, Deck, Canvas oder Site).',
    'mode "summary" (Standard): kompakte Textfassung mit Spuren/Clips/Markern bzw. Folien/Ebenen/Seiten.',
    'mode "json": exaktes JSON – optional nur ein Ausschnitt (Timeline: fromSec/toSec/trackId; Deck: slideId; Canvas: layerId; Site: pageId). Nutze das vor Operationen, die exakte IDs, Frames oder Props brauchen.',
    'mode "ops_schema": JSON-Schema aller Operationen für diesen Dokumenttyp. mode "versions": Versionsliste mit Notizen. Mit version liest du eine ältere Version.',
  ].join(' '),
  input: z.object({
    mode: z.enum(['summary', 'json', 'ops_schema', 'versions']).optional(),
    version: z.number().int().positive().optional(),
    trackId: z.string().optional(),
    fromSec: z.number().min(0).optional(),
    toSec: z.number().min(0).optional(),
    slideId: z.string().optional(),
    layerId: z.string().optional(),
    pageId: z.string().optional(),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const mode = args.mode ?? 'summary';
    if (mode === 'versions') {
      const versions = await ctx.project.listVersions();
      return textResult(
        versions
          .slice(-30)
          .map((v) => `v${v.number} ${v.createdAt} ${v.author}${v.restoredFrom ? ` (aus v${v.restoredFrom})` : ''}: ${v.note} [${v.opsCount} ops]`)
          .join('\n') || 'Keine Versionen.',
      );
    }
    const version = args.version ? await ctx.project.getVersion(args.version) : await ctx.project.head();
    if (!version) return errorResult(args.version ? `Version ${args.version} existiert nicht.` : 'Das Projekt hat noch kein Dokument (Kategorie offen – set_brief).');
    const doc = version.document;
    if (mode === 'ops_schema') {
      // Eingerückt, solange es passt; sonst kompakt – ein abgeschnittenes Schema wäre kein gültiges JSON mehr.
      const schema = opsSchemaFor(doc.kind);
      const pretty = stableJson(schema, 1);
      return textResult(pretty.length <= OPS_SCHEMA_LIMIT ? pretty : truncate(stableJson(schema), OPS_SCHEMA_LIMIT));
    }
    if (mode === 'json') {
      return textResult(`v${version.number} (${doc.kind}):\n${truncate(JSON.stringify(portion(doc, args), null, 1), 40000, '\n… [gekürzt – Ausschnitt mit fromSec/toSec/trackId/slideId/layerId/pageId anfordern]')}`);
    }
    return textResult(`v${version.number} · ${version.note}\n${summarizeDocument(doc, assetNames(ctx.project))}`);
  },
});

/** Höchstlänge der `ops_schema`-Antwort (Zeichen). */
export const OPS_SCHEMA_LIMIT = 30000;

const OPS_HELP: Record<DocumentKind, string> = {
  timeline: 'add_track, remove_track, update_track, insert_clip, remove_clip, move_clip, trim_clip, update_clip, add_marker, remove_marker, update_timeline, register_component, unregister_component',
  deck: 'add_slide, remove_slide, move_slide, update_slide, add_element, update_element, remove_element, update_theme, update_deck',
  canvas: 'add_layer, update_layer, remove_layer, move_layer, update_canvas',
  site: 'add_page, update_page, remove_page, update_site, snapshot_files',
};

export const applyDocumentOpsTool = defineTool({
  name: 'apply_document_ops',
  description: [
    'Ändert das Projektdokument – der EINZIGE Weg, Timeline, Folien, Leinwand oder Seitenkarte zu bearbeiten. Alle Operationen einer Charge werden validiert (Überlappungen, Grenzen, existierende Assets/Komponenten) und ergeben genau eine neue, unveränderliche Version mit deiner Notiz.',
    'Zeiten in Frames (Ganzzahlen, Timeline-fps). Vor dem Platzieren über das Ende: update_timeline.durationFrames setzen. Code-Komponenten erst mit register_component registrieren.',
    `Operationen – Timeline: ${OPS_HELP.timeline}. Deck: ${OPS_HELP.deck}. Canvas: ${OPS_HELP.canvas}. Site: ${OPS_HELP.site}. Exakte Felder: get_document mode "ops_schema".`,
    'update_*-Patches: fehlende Felder bleiben unverändert, null löscht ein optionales Feld (Felder mit Standardwert fallen auf ihn zurück); props, transform, reframe, duck, style, colors, fonts, fontAssets und mockups werden schlüsselweise gemergt.',
    'expectedHead (aktuelle Versionsnummer) schützt vor parallelen Änderungen. Prüfe das Ergebnis danach visuell (frames / render_still).',
  ].join(' '),
  input: z.object({
    ops: z.array(z.record(z.string(), z.unknown())).min(1).describe('Operationen, jede mit Feld "op", z. B. {"op":"insert_clip","trackId":"V1","clip":{"id":"shot_07","assetId":"ast_31c","start":372,"duration":168}}'),
    note: z.string().describe('Änderungsnotiz für die Versionsliste, z. B. "Chorus 1: Shots 7–9 auf Downbeats gelegt".'),
    expectedHead: z.number().int().nonnegative().optional(),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    const before = await ctx.project.head();
    if (!before) return errorResult('Das Projekt hat noch kein Dokument (Kategorie offen – set_brief).');
    try {
      const version = await ctx.project.commitOps(args.ops as DocumentOp[], {
        note: args.note,
        author: 'director',
        runId: ctx.runId,
        ...(args.expectedHead !== undefined ? { expectedHead: args.expectedHead } : {}),
      });
      emitVersion(ctx, version);
      const names = assetNames(ctx.project);
      const diff = summaryDiff(summarizeDocument(before.document, names), summarizeDocument(version.document, names));
      return textResult(`v${version.number} gespeichert (${args.ops.length} Operationen): ${args.note}\n${diff}`);
    } catch (error) {
      if (error instanceof VersionConflictError) return errorResult(`${error.message}. Lies den aktuellen Stand mit get_document und wende die Änderung erneut an.`);
      if (error instanceof DocumentOpError) return errorResult(`${error.message}\nKeine Änderung gespeichert (die Charge wird nur ganz oder gar nicht angewendet).`);
      return errorResult(errorMessage(error));
    }
  },
});

export const restoreVersionTool = defineTool({
  name: 'restore_version',
  description: 'Stellt eine frühere Version wieder her, indem ihr Inhalt als neue Version angelegt wird (keine Geschichte geht verloren). Nutze es, wenn der Nutzer zu einem früheren Stand zurück will oder eine Änderung klar schlechter war.',
  input: z.object({ version: z.number().int().positive(), note: z.string().optional() }),
  sideEffect: 'local',
  async run(args, ctx) {
    try {
      const version = await ctx.project.restoreVersion(args.version, 'director');
      emitVersion(ctx, version);
      return textResult(`Version ${args.version} wiederhergestellt als v${version.number}.${args.note ? ` ${args.note}` : ''}`);
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});
