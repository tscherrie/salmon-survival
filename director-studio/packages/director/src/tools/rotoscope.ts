import { z } from 'zod';
import { modelMatchesModality, selectionFor, type Asset, type ModelInfo } from '@studio/core';
import { preflightGenerationRequest, runGenerationRequest, type GenerationRequest, type PreflightResult } from './generation.ts';
import { defineTool, errorResult, type ToolContext } from './registry.ts';

/**
 * `extract_rotoscope` (PLAN 7.3/14): Masken, Pose, Tiefe oder Konturen eines Basis-Shots über ein fal-Werkzeug
 * extrahieren. Läuft über dieselbe Generierungs-Pipeline wie `generate` (Picker-, Schema- und Budget-Gate,
 * zweckgebundener Upload, Journal), legt die Ergebnisse aber als Rotoscope-Assets mit Lineage `extracted`
 * zum Basis-Shot ab – plus die Rohantwort als Daten-Asset (z. B. Keypoints).
 */

export const ROTOSCOPE_KINDS = ['mask', 'pose', 'depth', 'contours'] as const;
export type RotoscopeKind = (typeof ROTOSCOPE_KINDS)[number];

const KIND_LABELS: Record<RotoscopeKind, string> = { mask: 'Maske', pose: 'Pose', depth: 'Tiefe', contours: 'Konturen' };

/** Stichworte für die Auto-Wahl eines Werkzeugmodells je Extraktionsart (Reihenfolge = Vorrang). */
const KIND_KEYWORDS: Record<RotoscopeKind, string[]> = {
  mask: ['matting', 'segment', 'sam2', 'sam-2', 'sam ', 'background removal', 'remove background', 'rembg', 'birefnet', 'mask'],
  pose: ['pose', 'openpose', 'dwpose', 'keypoint'],
  depth: ['depth'],
  contours: ['lineart', 'line art', 'canny', 'edge', 'contour', 'sketch'],
};

/** Eingabefelder für das Basis-Medium in gängigen fal-Schemas (Reihenfolge = Vorrang). */
const MEDIA_INPUT_KEYS: Record<'video' | 'image', string[]> = {
  video: ['video_url', 'video', 'input_video_url', 'video_uri', 'input_video'],
  image: ['image_url', 'image', 'input_image_url', 'image_uri', 'input_image'],
};

export const extractRotoscopeInputSchema = z.object({
  assetId: z.string().describe('Basis-Shot (Video oder Bild), aus dem extrahiert wird.'),
  kind: z.enum(ROTOSCOPE_KINDS).describe('mask = Segmentierung/Matting, pose = Keypoints, depth = Tiefenkarte, contours = Linien/Kanten.'),
  endpointId: z
    .string()
    .optional()
    .describe('fal-Werkzeugmodell. Ohne Angabe: das im Picker „Werkzeuge“ gewählte Modell, bei Auto das passendste aus dem Katalog.'),
  input: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Weitere Modellparameter nach get_model_schema (z. B. Prompt für das zu maskierende Objekt). Das Basis-Medium setzt das Tool selbst.'),
  inputKey: z.string().optional().describe('Feldname für das Basis-Medium, falls nicht video_url/image_url (siehe Schema).'),
  purpose: z.string().optional().describe('Zweck in einem Satz (Standard: „<Art> aus <Titel> extrahieren“).'),
  tags: z.array(z.string()).optional(),
  wait: z.boolean().optional().describe('true = auf das Ergebnis warten (Standard false).'),
});

type ExtractArgs = z.output<typeof extractRotoscopeInputSchema>;

function haystack(model: ModelInfo): string {
  return `${model.id} ${model.displayName} ${model.description ?? ''}`.toLowerCase();
}

/** Bestes Werkzeugmodell für die Extraktionsart (Auto): Stichwort-Treffer, passende Eingabe, Empfehlung. */
export function pickRotoscopeModel(models: readonly ModelInfo[], kind: RotoscopeKind, mediaKind: 'video' | 'image'): ModelInfo | undefined {
  const keywords = KIND_KEYWORDS[kind];
  const scored = models
    .filter((m) => m.status !== 'deprecated')
    .map((m) => {
      const text = haystack(m);
      const rank = keywords.findIndex((k) => text.includes(k));
      if (rank < 0) return undefined;
      const supportsMedia = mediaKind === 'video' ? m.capabilities.videoInput === true || text.includes('video') : m.capabilities.imageInput !== false;
      return { model: m, score: (supportsMedia ? 0 : 100) + rank * 2 + (m.recommended ? 0 : 1) };
    })
    .filter((x): x is { model: ModelInfo; score: number } => !!x)
    .sort((a, b) => a.score - b.score || (a.model.id < b.model.id ? -1 : 1));
  return scored[0]?.model;
}

/** Feldname für das Basis-Medium: explizit, sonst aus dem Eingabeschema, sonst `video_url`/`image_url`. */
async function mediaInputKey(ctx: ToolContext, endpointId: string, mediaKind: 'video' | 'image', explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const preferred = MEDIA_INPUT_KEYS[mediaKind];
  try {
    const schema = await ctx.catalog.getInputSchema(endpointId);
    const props = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
    const hit = preferred.find((k) => props.includes(k)) ?? props.find((k) => k.includes(mediaKind) && /url|uri/.test(k));
    if (hit) return hit;
  } catch {
    // Schema nicht verfügbar: Standardfeld verwenden; die Validierung im Gate meldet Abweichungen.
  }
  return preferred[0]!;
}

/** Baut die Generierungsanfrage (Modellwahl, Eingabe, Ablage); Fehlertext statt Ausnahme. */
export async function buildRotoscopeRequest(args: ExtractArgs, ctx: ToolContext): Promise<{ ok: true; request: GenerationRequest } | { ok: false; reason: string }> {
  const asset: Asset | undefined = ctx.project.getAsset(args.assetId);
  if (!asset) return { ok: false, reason: `Asset „${args.assetId}“ existiert nicht.` };
  if (asset.kind !== 'video' && asset.kind !== 'image') return { ok: false, reason: `Asset „${args.assetId}“ ist vom Typ ${asset.kind}; extrahieren lässt sich nur aus Video oder Bild.` };
  const mediaKind = asset.kind;

  let endpointId = args.endpointId;
  let note: string | undefined;
  if (!endpointId) {
    const picker = selectionFor(ctx.project.manifest.pickers, 'tools');
    if (picker.mode === 'model') {
      endpointId = picker.modelId;
      note = `Modell aus dem Picker „Werkzeuge“: ${endpointId}.`;
    } else {
      const candidates = ctx.catalog.list().filter((m) => modelMatchesModality(m, 'tools'));
      const chosen = pickRotoscopeModel(candidates, args.kind, mediaKind);
      if (!chosen) {
        return {
          ok: false,
          reason: `Kein passendes Werkzeugmodell für ${KIND_LABELS[args.kind]} gefunden. Suche mit search_models({modality:"tools", text:"${KIND_KEYWORDS[args.kind][0]}"}) und gib endpointId an.`,
        };
      }
      endpointId = chosen.id;
      note = `Auto (Picker „Werkzeuge“): ${chosen.displayName} (${chosen.id}) für ${KIND_LABELS[args.kind]} gewählt – Stichwort-Treffer${chosen.recommended ? ', empfohlen' : ''}. Nenne dem Nutzer die Wahl.`;
    }
  }

  const key = await mediaInputKey(ctx, endpointId, mediaKind, args.inputKey);
  const input: Record<string, unknown> = { ...(args.input ?? {}) };
  if (input[key] === undefined) input[key] = `asset:${asset.id}`;
  const label = KIND_LABELS[args.kind];
  return {
    ok: true,
    request: {
      endpointId,
      input,
      purpose: args.purpose ?? `${label} aus „${asset.title}“ extrahieren (Rotoscope)`,
      outputTitle: `${label} – ${asset.title}`,
      tags: [...new Set(['rotoscope', args.kind, ...(args.tags ?? [])])],
      inputAssetIds: [asset.id],
      wait: args.wait,
      note,
      ingest: {
        parentRelation: 'extracted',
        subtype: `rotoscope-${args.kind}`,
        dataAsset: { subtype: 'rotoscope-data' },
        metadata: { rotoscope: { kind: args.kind, sourceAssetId: asset.id, endpointId, ...(asset.fps ? { fps: asset.fps } : {}), ...(asset.width ? { width: asset.width, height: asset.height } : {}) } },
      },
    },
  };
}

export const extractRotoscopeTool = defineTool({
  name: 'extract_rotoscope',
  description: [
    'Extrahiert Masken (Segmentierung/Matting), Pose-Keypoints, Tiefe oder Konturen aus einem Video- oder Bild-Asset über ein fal-Werkzeugmodell – Grundlage, um im eigenen Stil über generiertes Footage zu zeichnen (Skill rotoscope-overlay).',
    'Modellwahl: endpointId, sonst das im Picker „Werkzeuge“ gewählte Modell, bei Auto das passendste aus dem Katalog (das Ergebnis nennt die Wahl). Das Basis-Medium wird automatisch als Datei übergeben; weitere Parameter nach get_model_schema über input.',
    'Kostenpflichtig, mit denselben Gates wie generate (Picker, Schema, Budget-Freigabe). Ergebnisse: Medien-Assets (subtype rotoscope-<art>) und die Rohantwort als Daten-Asset (subtype rotoscope-data, Medien als "asset:<id>"), alle mit Lineage „extracted“ zum Basis-Shot.',
    'Läuft im Hintergrund wie generate; Ergebnisse mit await_generations abholen.',
  ].join(' '),
  input: extractRotoscopeInputSchema,
  sideEffect: 'paid',
  async preflight(input, ctx): Promise<PreflightResult> {
    const parsed = extractRotoscopeInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: `Ungültige Eingabe: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
    const built = await buildRotoscopeRequest(parsed.data, ctx);
    if (!built.ok) return built;
    return preflightGenerationRequest(built.request, ctx);
  },
  async run(args, ctx) {
    const built = await buildRotoscopeRequest(args, ctx);
    if (!built.ok) return errorResult(built.reason);
    return runGenerationRequest(built.request, ctx);
  },
});
