import { formatUsd } from './budget.ts';

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

export const DEFAULT_PICKERS: PickerState = {
  director: { mode: 'model', modelId: 'claude-opus-5-5' },
  video: { mode: 'model', modelId: 'minimax/h3-max/text-to-video' },
};

export function selectionFor(picker: PickerState, modality: Modality): PickerSelection {
  return picker[modality] ?? { mode: 'auto' };
}

export function modelMatchesModality(model: Pick<ModelInfo, 'modality' | 'alsoModalities'>, modality: Modality): boolean {
  return model.modality === modality || (model.alsoModalities ?? []).includes(modality);
}

/**
 * Picker-Durchsetzung: Ist eine Modalität auf ein Modell festgelegt, sind andere Modelle dieser
 * Modalität verboten. Varianten derselben Familie (gleicher Präfix bis zum letzten `/`) sind erlaubt,
 * damit z. B. `…/h3-max/text-to-video` und `…/h3-max/reference-to-video` als „h3-max“ gelten.
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

/** Modellfamilie: Endpoint-ID ohne letztes Segment, wenn sie mindestens drei Segmente hat. */
export function modelFamily(modelId: string): string {
  const parts = modelId.split('/');
  return parts.length >= 3 ? parts.slice(0, -1).join('/') : modelId;
}

const UNIT_LABELS: Record<string, string> = {
  second: 's',
  seconds: 's',
  image: 'Bild',
  images: 'Bild',
  megapixel: 'MP',
  megapixels: 'MP',
  minute: 'min',
  minutes: 'min',
  request: 'Aufruf',
  requests: 'Aufruf',
  video: 'Video',
  videos: 'Video',
  '1k characters': '1k Zeichen',
  '1000 characters': '1k Zeichen',
  character: 'Zeichen',
  'compute second': 'Rechensek.',
  'compute seconds': 'Rechensek.',
};

export function formatPrice(price: ModelPrice | undefined): string {
  if (!price) return 'Preis unbekannt';
  const unit = UNIT_LABELS[price.unit.toLowerCase()] ?? price.unit;
  const amount = price.currency === 'USD' ? formatUsd(price.unitPrice) : `${price.unitPrice.toFixed(3)} ${price.currency}`;
  return `${amount} / ${unit}`;
}

/** Beispielrechnung für den Picker (z. B. „5 s ≈ $0.80“). */
export function exampleCost(model: Pick<ModelInfo, 'price' | 'modality' | 'capabilities'>): string | undefined {
  const price = model.price;
  if (!price || price.currency !== 'USD') return undefined;
  const unit = price.unit.toLowerCase();
  if (unit.startsWith('second')) {
    const seconds = model.capabilities.durations?.includes(5) ? 5 : (model.capabilities.durations?.[0] ?? 5);
    return `${seconds} s ≈ ${formatUsd(price.unitPrice * seconds)}`;
  }
  if (unit.startsWith('minute')) return `1 min ≈ ${formatUsd(price.unitPrice)}`;
  if (unit.startsWith('image')) return `4 Bilder ≈ ${formatUsd(price.unitPrice * 4)}`;
  if (unit.startsWith('megapixel')) return `1024² ≈ ${formatUsd(price.unitPrice * 1.048576)}`;
  if (unit.includes('characters')) return `500 Zeichen ≈ ${formatUsd(price.unitPrice * 0.5)}`;
  if (unit.startsWith('video') || unit.startsWith('request')) return `1 Aufruf ≈ ${formatUsd(price.unitPrice)}`;
  return undefined;
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
