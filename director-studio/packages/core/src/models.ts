import { formatAmount, formatUsd } from './budget.ts';

/** Modalitäten der Modell-Picker. */
export const MODALITIES = ['director', 'text', 'image', 'video', 'lipsync', 'voice', 'music', 'sound', 'tools'] as const;
export type Modality = (typeof MODALITIES)[number];

export const MODALITY_LABELS: Record<Modality, string> = {
  director: 'Director',
  text: 'Text',
  image: 'Bild',
  video: 'Video',
  lipsync: 'Lipsync',
  voice: 'Stimme',
  music: 'Musik',
  sound: 'Sound',
  tools: 'Werkzeuge',
};

export interface ModelPrice {
  unitPrice: number;
  /** Abrechnungseinheit laut Anbieter, z. B. `second`, `image`, `megapixel`, `1k characters`, `minute`, `request`, `1M input tokens`. */
  unit: string;
  currency: string;
}

export interface ModelCapabilities {
  audioInput?: boolean;
  imageInput?: boolean;
  multiImageInput?: boolean;
  videoInput?: boolean;
  /** Erzeugt eine eigene Tonspur. */
  nativeAudio?: boolean;
  /** Erlaubte Dauern in Sekunden (falls diskret). */
  durations?: number[];
  maxDurationSec?: number;
  aspectRatios?: string[];
  resolutions?: string[];
  seed?: boolean;
  wordTimestamps?: boolean;
  /** Für LLMs: Tool-Aufrufe, Bilder. */
  toolUse?: boolean;
  vision?: boolean;
}

export interface ModelInfo {
  /** fal `endpoint_id` bzw. Claude-Modell-ID. */
  id: string;
  provider: 'fal' | 'anthropic';
  modality: Modality;
  /** Weitere Modalitäten, in denen das Modell auftauchen darf (z. B. Video-Modell mit Lipsync). */
  alsoModalities?: Modality[];
  category?: string;
  displayName: string;
  vendor?: string;
  description: string;
  status?: 'active' | 'beta' | 'deprecated';
  price?: ModelPrice;
  capabilities: ModelCapabilities;
  license?: string;
  tags?: string[];
  /** Kuratierte Empfehlung (z. B. Default-Modell der Modalität). */
  recommended?: boolean;
}

export type PickerSelection = { mode: 'auto' } | { mode: 'model'; modelId: string };
export type PickerState = Partial<Record<Modality, PickerSelection>>;

/**
 * Projekt-Defaults der Picker. „Text“ bleibt bewusst auf „Auto“ (= Director-Modell für Textaufgaben):
 * eine feste Text-Bindung würde über das Picker-Gate auch fal-Textmodelle (Captioning, Vision-LLMs) sperren.
 */
export const DEFAULT_PICKERS: PickerState = {
  director: { mode: 'model', modelId: 'claude-opus-5-5' },
  video: { mode: 'model', modelId: 'minimax/h3-max/text-to-video' },
};

export function selectionFor(picker: PickerState, modality: Modality): PickerSelection {
  return picker[modality] ?? { mode: 'auto' };
}

/** Liest einen (z. B. aus Einstellungen geladenen) Picker-Zustand defensiv: unbekannte Modalitäten und kaputte Einträge fallen weg. */
export function parsePickerState(value: unknown): PickerState {
  const out: PickerState = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const modality of MODALITIES) {
    const sel = (value as Record<string, unknown>)[modality];
    if (!sel || typeof sel !== 'object') continue;
    const { mode, modelId } = sel as { mode?: unknown; modelId?: unknown };
    if (mode === 'auto') out[modality] = { mode: 'auto' };
    else if (mode === 'model' && typeof modelId === 'string' && modelId.trim()) out[modality] = { mode: 'model', modelId: modelId.trim() };
  }
  return out;
}

/** Picker für ein neues Projekt: {@link DEFAULT_PICKERS}, überschrieben von den Nutzer-Defaults (PLAN 4.3). */
export function initialPickers(userDefaults?: unknown): PickerState {
  return { ...DEFAULT_PICKERS, ...parsePickerState(userDefaults) };
}

export function modelMatchesModality(model: Pick<ModelInfo, 'modality' | 'alsoModalities'>, modality: Modality): boolean {
  return model.modality === modality || (model.alsoModalities ?? []).includes(modality);
}

/**
 * Picker-Durchsetzung: Ist eine Modalität auf ein Modell festgelegt, sind andere Modelle dieser
 * Modalität verboten. Erlaubt sind nur Aufgaben-Varianten desselben Modells (gleiche {@link modelFamily}),
 * z. B. `…/h3-max/text-to-video` und `…/h3-max/reference-to-video` oder `fal-ai/flux/dev` und
 * `fal-ai/flux/dev/image-to-image` – nicht aber andere Modelle/Stufen desselben Anbieters (`fal-ai/flux/schnell`).
 */
export function checkModelAllowed(
  picker: PickerState,
  modality: Modality,
  modelId: string,
): { ok: true } | { ok: false; reason: string; expected: string } {
  const selection = selectionFor(picker, modality);
  if (selection.mode === 'auto') return { ok: true };
  if (selection.modelId === modelId || modelFamily(selection.modelId) === modelFamily(modelId)) return { ok: true };
  return {
    ok: false,
    expected: selection.modelId,
    reason: `Der Picker „${MODALITY_LABELS[modality]}“ ist auf ${selection.modelId} festgelegt; ${modelId} ist nicht erlaubt. Nutze das gewählte Modell oder bitte den Nutzer, den Picker auf „Auto“ zu stellen.`,
  };
}

/** Endpoint-Segmente, die nur die Aufgabe eines Modells benennen (nicht das Modell selbst). */
export const TASK_SEGMENTS: ReadonlySet<string> = new Set([
  'text-to-video',
  'image-to-video',
  'reference-to-video',
  'video-to-video',
  'extend-video',
  'lip-sync',
  'text-to-image',
  'image-to-image',
  'edit',
  'text-to-speech',
  'speech-to-text',
  'text-to-audio',
  'audio-to-audio',
  '3d-to-video',
  'director',
  'upscale',
]);

/** Kuratierte Familien-Zuordnung für Modelle, deren Varianten eigene Namen tragen (PLAN 19a: h3-max-turbo gehört zu h3-max). */
export const MODEL_FAMILY_ALIASES: Readonly<Record<string, string>> = {
  'minimax/h3-max-turbo': 'minimax/h3-max',
};

/**
 * Modellfamilie: Endpoint-ID ohne abschließende Aufgaben-Segmente ({@link TASK_SEGMENTS}); mindestens
 * `owner/app` bleibt stehen. Danach greifen die {@link MODEL_FAMILY_ALIASES}.
 */
export function modelFamily(modelId: string): string {
  const parts = modelId.split('/');
  while (parts.length > 2 && TASK_SEGMENTS.has(parts[parts.length - 1]!)) parts.pop();
  const family = parts.join('/');
  return MODEL_FAMILY_ALIASES[family] ?? family;
}

export type PriceUnitKind = 'second' | 'minute' | 'image' | 'megapixel' | 'character' | 'request' | 'video' | 'compute-second' | 'token' | 'other';

export interface PriceUnit {
  kind: PriceUnitKind;
  /** Menge, auf die sich der Einheitspreis bezieht, z. B. 1000 bei „1k characters“, 5 bei „5 seconds“. */
  per: number;
}

/**
 * Interpretiert die freie Einheiten-Angabe der fal-Preis-API robust: „seconds“, „5 seconds“, „1k characters“,
 * „1000 characters“, „characters“, „megapixels“, „compute seconds“, „images“, „1M input tokens“, „units“ …
 */
export function parsePriceUnit(unit: string): PriceUnit {
  let rest = (unit ?? '').trim().toLowerCase();
  let per = 1;
  const m = /^(\d+(?:[.,]\d+)?)\s*(k|m)?\b\s*(.*)$/.exec(rest);
  if (m?.[1] && m[3]) {
    per = Number(m[1].replace(',', '.')) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1);
    rest = m[3];
  } else if (/^(k|m)\s+/.test(rest)) {
    per = rest.startsWith('k') ? 1000 : 1_000_000;
    rest = rest.slice(1).trim();
  }
  if (!Number.isFinite(per) || per <= 0) per = 1;
  let kind: PriceUnitKind = 'other';
  if (/compute|gpu/.test(rest)) kind = 'compute-second';
  else if (/megapixel|\bmp\b|\bmpx\b/.test(rest)) kind = /video/.test(rest) ? 'other' : 'megapixel';
  else if (/char/.test(rest)) kind = 'character';
  else if (/token/.test(rest)) kind = 'token';
  else if (/minute|\bmins?\b/.test(rest)) kind = 'minute';
  else if (/second|\bsecs?\b|^s$/.test(rest)) kind = 'second';
  else if (/frame/.test(rest)) kind = 'other';
  else if (/image|picture|photo/.test(rest)) kind = 'image';
  else if (/video|clip/.test(rest)) kind = 'video';
  else if (/request|call|generation|\brun\b|output|song|track|voice|item/.test(rest)) kind = 'request';
  return { kind, per };
}

const UNIT_LABELS: Partial<Record<PriceUnitKind, string>> = {
  second: 's',
  minute: 'min',
  image: 'Bild',
  megapixel: 'MP',
  character: 'Zeichen',
  request: 'Aufruf',
  video: 'Video',
  'compute-second': 'Rechensek.',
};

function formatPer(per: number): string {
  if (per >= 1_000_000 && per % 1_000_000 === 0) return `${per / 1_000_000}M`;
  if (per >= 1000 && per % 1000 === 0) return `${per / 1000}k`;
  return String(per);
}

export function formatPrice(price: ModelPrice | undefined): string {
  if (!price) return 'Preis unbekannt';
  const parsed = parsePriceUnit(price.unit);
  const label = UNIT_LABELS[parsed.kind];
  const unit = label ? (parsed.per === 1 ? label : `${formatPer(parsed.per)} ${label}`) : price.unit;
  const amount = price.currency === 'USD' ? formatUsd(price.unitPrice) : `${formatAmount(Math.abs(price.unitPrice))} ${price.currency}`;
  return `${amount} / ${unit}`;
}

/** Beispielrechnung für den Picker (z. B. „5 s ≈ $0.80“). */
export function exampleCost(model: Pick<ModelInfo, 'price' | 'modality' | 'capabilities'>): string | undefined {
  const price = model.price;
  if (!price || price.currency !== 'USD' || !Number.isFinite(price.unitPrice)) return undefined;
  const { kind, per } = parsePriceUnit(price.unit);
  const cost = (quantity: number) => formatUsd((price.unitPrice * quantity) / per);
  switch (kind) {
    case 'second': {
      const seconds = model.capabilities.durations?.includes(5) ? 5 : (model.capabilities.durations?.[0] ?? 5);
      return `${seconds} s ≈ ${cost(seconds)}`;
    }
    case 'minute':
      return `1 min ≈ ${cost(1)}`;
    case 'image':
      return `4 Bilder ≈ ${cost(4)}`;
    case 'megapixel':
      return `1024² ≈ ${cost(1.048576)}`;
    case 'character':
      return `500 Zeichen ≈ ${cost(500)}`;
    case 'video':
    case 'request':
      return `1 Aufruf ≈ ${cost(1)}`;
    default:
      return undefined;
  }
}

/** Claude-Modelle für den Director-Picker (Preise je 1M Tokens, Stand 2026-09). */
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    modality: 'director',
    alsoModalities: ['text'],
    displayName: 'Claude Opus 5.5',
    vendor: 'Anthropic',
    description: 'Standard-Director: langes agentisches Arbeiten, Code, Bildverständnis. 1M Kontext.',
    price: { unitPrice: 4, unit: '1M input tokens', currency: 'USD' },
    capabilities: { toolUse: true, vision: true },
    recommended: true,
  },
  {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    modality: 'director',
    alsoModalities: ['text'],
    displayName: 'Claude Fable 5.1',
    vendor: 'Anthropic',
    description: 'Leistungsfähigstes Modell für besonders anspruchsvolle Produktionen; teurer.',
    price: { unitPrice: 10, unit: '1M input tokens', currency: 'USD' },
    capabilities: { toolUse: true, vision: true },
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    modality: 'director',
    alsoModalities: ['text'],
    displayName: 'Claude Sonnet 5.5',
    vendor: 'Anthropic',
    description: 'Schneller und günstiger; gut für Subagenten (QA, Recherche) und Textaufgaben.',
    price: { unitPrice: 2, unit: '1M input tokens', currency: 'USD' },
    capabilities: { toolUse: true, vision: true },
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    modality: 'text',
    displayName: 'Claude Haiku 4.5',
    vendor: 'Anthropic',
    description: 'Sehr schnell und günstig für einfache Textaufgaben (Tags, Beschreibungen).',
    price: { unitPrice: 1, unit: '1M input tokens', currency: 'USD' },
    capabilities: { toolUse: true, vision: true },
  },
];

/** Token-Preise (USD je 1M) für die Kostenbuchung des Directors. */
export const CLAUDE_TOKEN_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite5m: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function tokenCostUsd(modelId: string, usage: TokenUsage): number {
  const price = CLAUDE_TOKEN_PRICES[modelId];
  if (!price) return 0;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite5m) /
    1_000_000
  );
}
