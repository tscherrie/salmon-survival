import { z } from 'zod';
import { checkModelAllowed, exampleCost, formatPrice, formatUsd, MODALITIES, selectionFor, type ModelInfo, type PickerState } from '@studio/core';
import { errorMessage, stableJson, truncate, wrapUntrusted } from '../util.ts';
import { defineTool, errorResult, textResult } from './registry.ts';

export function capabilitySummary(model: ModelInfo): string {
  const c = model.capabilities;
  const parts: string[] = [];
  if (c.audioInput) parts.push('Audio-Eingang');
  if (c.imageInput) parts.push(c.multiImageInput ? 'mehrere Referenzbilder' : 'Bild-Eingang');
  if (c.videoInput) parts.push('Video-Eingang');
  if (c.nativeAudio) parts.push('eigene Tonspur');
  if (c.durations?.length) parts.push(`Dauer ${c.durations.join('/')} s`);
  else if (c.maxDurationSec) parts.push(`bis ${c.maxDurationSec} s`);
  if (c.aspectRatios?.length) parts.push(`Formate ${c.aspectRatios.join(', ')}`);
  if (c.resolutions?.length) parts.push(`Auflösung ${c.resolutions.join('/')}`);
  if (c.seed) parts.push('Seed');
  if (c.wordTimestamps) parts.push('Wortzeitstempel');
  return parts.join(' · ');
}

export function pickerNote(pickers: PickerState, model: ModelInfo): string {
  const selection = selectionFor(pickers, model.modality);
  if (selection.mode === 'auto') return 'Picker: Auto';
  const allowed = checkModelAllowed(pickers, model.modality, model.id);
  return allowed.ok ? 'Picker: gewählt ★' : `gesperrt (Picker: ${selection.modelId})`;
}

export function modelLine(model: ModelInfo, pickers: PickerState): string {
  const example = exampleCost(model);
  const caps = capabilitySummary(model);
  return [
    `${model.id} — ${model.displayName}${model.vendor ? ` (${model.vendor})` : ''} [${model.modality}${model.status && model.status !== 'active' ? `, ${model.status}` : ''}]`,
    `  ${formatPrice(model.price)}${example ? ` · ${example}` : ''} · ${pickerNote(pickers, model)}${model.recommended ? ' · empfohlen' : ''}`,
    caps ? `  ${caps}` : '',
    model.description ? `  ${truncate(model.description.replace(/\s+/g, ' '), 220)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const searchModelsTool = defineTool({
  name: 'search_models',
  description:
    'Durchsucht den fal-Modellkatalog (live synchronisiert) nach Modalität und/oder Stichworten und zeigt Preis, Fähigkeiten und Picker-Status. Nutze es, bevor du ein Modell zum ersten Mal einsetzt oder wenn ein Picker auf „Auto“ steht und du begründet wählen musst. Gesperrte Modelle (Picker auf anderes Modell) darfst du nicht verwenden.',
  input: z.object({
    modality: z.enum(MODALITIES).optional().describe('Modalität: image, video, lipsync, voice, music, sound, tools, text.'),
    text: z.string().optional().describe('Stichworte, z. B. "upscale video", "reference image character", "stems".'),
    limit: z.number().int().min(1).max(40).optional().describe('Maximale Anzahl (Standard 12).'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const query: { modality?: (typeof MODALITIES)[number]; text?: string } = {};
    if (args.modality) query.modality = args.modality;
    if (args.text) query.text = args.text;
    const models = ctx.catalog.search(query).slice(0, args.limit ?? 12);
    if (models.length === 0) return textResult('Keine Modelle gefunden. Andere Stichworte oder ohne Modalität versuchen.');
    const pickers = ctx.project.manifest.pickers;
    return textResult(models.map((m) => modelLine(m, pickers)).join('\n'));
  },
});

export const getModelSchemaTool = defineTool({
  name: 'get_model_schema',
  description:
    'Liefert Beschreibung und JSON-Eingabeschema eines fal-Modells. Pflicht vor der ersten Generierung mit einem Modell im Projekt: setze danach jeden relevanten Parameter bewusst (Dauer, Seitenverhältnis, Auflösung, Seed, Referenzstärke, Audio-Eingänge). Lade zusätzlich den Modell-Skill mit load_skill, falls im skills_index einer existiert.',
  input: z.object({ endpointId: z.string().describe('fal endpoint_id') }),
  sideEffect: 'none',
  async run(args, ctx) {
    const model = ctx.catalog.get(args.endpointId);
    if (!model) return errorResult(`Unbekanntes Modell „${args.endpointId}“. Nutze search_models.`);
    let description = '';
    try {
      description = await ctx.catalog.describe(args.endpointId);
    } catch (error) {
      description = `(Beschreibung nicht verfügbar: ${errorMessage(error)})`;
    }
    const schema = await ctx.catalog.getInputSchema(args.endpointId);
    const skillHint = ctx.skills
      .list()
      .filter((s) => args.endpointId.includes(s.name) || model.displayName.toLowerCase().includes(s.name))
      .map((s) => s.name);
    return textResult(
      [
        modelLine(model, ctx.project.manifest.pickers),
        skillHint.length ? `Skill verfügbar: ${skillHint.join(', ')} (load_skill).` : '',
        wrapUntrusted(`fal:${args.endpointId}:description`, truncate(description, 6000)),
        'Eingabeschema (JSON Schema):',
        truncate(stableJson(schema, 2), 14000),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  },
});

export const estimateCostTool = defineTool({
  name: 'estimate_cost',
  description:
    'Schätzt die Kosten einer geplanten Generierung (Preiseinheit × Eingabe: Sekunden, Bilder, Megapixel, Zeichen …) ohne etwas auszuführen. Nutze es vor jedem Batch und für Kostenaufstellungen in Checkpoints.',
  input: z.object({
    endpointId: z.string(),
    input: z.record(z.string(), z.unknown()).describe('Geplante Eingabe (wie für generate).'),
    count: z.number().int().min(1).max(500).optional().describe('Anzahl gleichartiger Aufrufe (Standard 1).'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const model = ctx.catalog.get(args.endpointId);
    if (!model) return errorResult(`Unbekanntes Modell „${args.endpointId}“. Nutze search_models.`);
    const estimate = await ctx.catalog.estimate(args.endpointId, args.input);
    const count = args.count ?? 1;
    const budget = ctx.project.budgetSummary();
    return textResult(
      `${args.endpointId}: ${formatUsd(estimate.usd)} je Aufruf (${estimate.basis}${estimate.exact ? '' : ', Schätzung'})` +
        (count > 1 ? ` · ${count}× = ${formatUsd(estimate.usd * count)}` : '') +
        `\nBudget verfügbar: ${formatUsd(budget.availableUsd)} (freigegeben ${formatUsd(budget.approvedUsd)}, verbraucht ${formatUsd(budget.spentUsd)}, reserviert ${formatUsd(budget.reservedUsd)}).`,
    );
  },
});
