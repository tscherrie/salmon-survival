import { formatUsd, type ModelInfo, roundUsd } from '@studio/core';
import { parseDurationValue } from './capabilities.ts';
import { isPlainObject } from './schema.ts';

/**
 * Lokale Kostenschätzung aus Einheitspreis × Menge, die aus der Eingabe abgeleitet wird.
 * fal liefert je Endpoint nur `unit_price` + `unit` (freier Text: „seconds“, „images“, „megapixels“,
 * „1k characters“, „compute seconds“, „5 seconds“, „units“ …); Staffeln (Auflösung, Tonspur) kennt die
 * API nicht – dafür gibt es wenige kuratierte Regeln (`PRICE_RULES`), als ungeprüft markiert.
 */

export interface CostEstimate {
  usd: number;
  /** Rechenweg, z. B. „10 s × $0.160/s“. */
  basis: string;
  /** `true`, wenn die Menge aus der Eingabe feststeht und keine Heuristik nötig war. */
  exact: boolean;
}

/** Zusatzwissen über Eingabemedien (z. B. Dauer der hochgeladenen Audiodatei bei STT). */
export interface CostHints {
  mediaDurationSec?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaFrames?: number;
}

export type UnitKind =
  | 'second'
  | 'minute'
  | 'image'
  | 'megapixel'
  | 'video_megapixel'
  | 'characters'
  | 'tokens'
  | 'video'
  | 'request'
  | 'compute_second'
  | 'frame'
  | 'unknown';

export interface ParsedUnit {
  kind: UnitKind;
  /** Größe einer Einheit, z. B. 1000 bei „1k characters“, 5 bei „5 seconds“. */
  size: number;
  raw: string;
}

/** Interpretiert die freie Einheiten-Angabe der fal-Preis-API. */
export function parseUnit(unit: string): ParsedUnit {
  const raw = (unit ?? '').trim();
  let rest = raw.toLowerCase();
  let size = 1;
  const m = /^(\d+(?:[.,]\d+)?)\s*(k|m)?\b\s*(.*)$/.exec(rest);
  if (m?.[1] && m[3] !== undefined && m[3].length > 0) {
    size = Number(m[1].replace(',', '.')) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1);
    rest = m[3];
  } else if (/^(k|m)\s+/.test(rest)) {
    size = rest.startsWith('k') ? 1000 : 1_000_000;
    rest = rest.slice(1).trim();
  }
  if (!Number.isFinite(size) || size <= 0) size = 1;
  let kind: UnitKind = 'unknown';
  if (/compute|gpu/.test(rest)) kind = 'compute_second';
  else if (/megapixel|\bmp\b|\bmpx\b/.test(rest)) kind = /video/.test(rest) ? 'video_megapixel' : 'megapixel';
  else if (/char/.test(rest)) kind = 'characters';
  else if (/token/.test(rest)) kind = 'tokens';
  else if (/minute|\bmins?\b/.test(rest)) kind = 'minute';
  else if (/second|\bsecs?\b|^s$/.test(rest)) kind = 'second';
  else if (/frame/.test(rest)) kind = 'frame';
  else if (/image|picture|photo/.test(rest)) kind = 'image';
  else if (/video|clip/.test(rest)) kind = 'video';
  else if (/request|call|generation|\brun\b|output|song|track|voice|item/.test(rest)) kind = 'request';
  return { kind, size, raw };
}

// ───────────────────────── Eingaben lesen ─────────────────────────

const SECOND_KEYS = ['duration', 'duration_seconds', 'duration_sec', 'duration_s', 'seconds', 'num_seconds', 'seconds_total', 'video_length', 'video_duration', 'audio_duration', 'length_seconds'];
const MS_KEYS = ['duration_ms', 'music_length_ms', 'length_ms'];
const COUNT_KEYS = ['num_images', 'num_outputs', 'num_videos', 'n', 'batch_size', 'num_samples', 'number_of_images'];
const TEXT_KEYS = ['text', 'prompt', 'input', 'script', 'content'];

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

interface Quantity {
  value: number;
  exact: boolean;
  note?: string;
}

function durationSec(input: Record<string, unknown>, model: ModelInfo, hints: CostHints, preferMedia: boolean, fallbackSec = 5): Quantity {
  for (const key of SECOND_KEYS) {
    const v = parseDurationValue(input[key]);
    if (v !== undefined && v > 0) return { value: v, exact: true };
  }
  for (const key of MS_KEYS) {
    const v = parseDurationValue(input[key], true);
    if (v !== undefined && v > 0) return { value: v, exact: true };
  }
  const frames = num(input.num_frames);
  if (frames && frames > 0 && model.modality !== 'tools') {
    const fps = num(input.fps) ?? num(input.frames_per_second) ?? 24;
    return { value: frames / fps, exact: num(input.fps) !== undefined || num(input.frames_per_second) !== undefined, note: `${frames} Frames ÷ ${fps} fps` };
  }
  if (hints.mediaDurationSec && hints.mediaDurationSec > 0 && (preferMedia || !model.capabilities.durations?.length)) {
    return { value: hints.mediaDurationSec, exact: true, note: 'Dauer der Eingabedatei' };
  }
  const allowed = model.capabilities.durations?.filter((d) => d > 0);
  if (allowed?.length) return { value: Math.min(...allowed), exact: false, note: 'Dauer nicht angegeben – kleinste erlaubte angenommen' };
  if (hints.mediaDurationSec && hints.mediaDurationSec > 0) return { value: hints.mediaDurationSec, exact: false, note: 'Dauer der Eingabedatei' };
  return { value: fallbackSec, exact: false, note: `Dauer unbekannt – ${fallbackSec} s angenommen` };
}

function outputCount(input: Record<string, unknown>): Quantity {
  for (const key of COUNT_KEYS) {
    const v = num(input[key]);
    if (v !== undefined && v >= 1) return { value: Math.floor(v), exact: true };
  }
  return { value: 1, exact: true };
}

const IMAGE_SIZE_PRESETS: Record<string, [number, number]> = {
  square: [512, 512],
  square_hd: [1024, 1024],
  portrait_4_3: [768, 1024],
  portrait_16_9: [576, 1024],
  landscape_4_3: [1024, 768],
  landscape_16_9: [1024, 576],
};

function ratioOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!m?.[1] || !m[2]) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}

/** Ausgabegröße in Pixeln aus `image_size`, `width/height`, `resolution` (1080p, 2K …) und `aspect_ratio`. */
export function outputDimensions(input: Record<string, unknown>, hints: CostHints = {}): { width: number; height: number; exact: boolean } {
  const size = input.image_size;
  if (typeof size === 'string' && IMAGE_SIZE_PRESETS[size]) {
    const [width, height] = IMAGE_SIZE_PRESETS[size];
    return { width, height, exact: true };
  }
  if (isPlainObject(size)) {
    const width = num(size.width);
    const height = num(size.height);
    if (width && height) return { width, height, exact: true };
  }
  const w = num(input.width);
  const h = num(input.height);
  if (w && h) return { width: w, height: h, exact: true };
  const ratio = ratioOf(input.aspect_ratio) ?? (hints.mediaWidth && hints.mediaHeight ? hints.mediaWidth / hints.mediaHeight : undefined);
  const resolution = typeof input.resolution === 'string' ? input.resolution.trim().toLowerCase() : undefined;
  if (resolution) {
    const p = /^(\d{3,4})p$/.exec(resolution);
    const k = /^(\d(?:\.\d)?)k$/.exec(resolution);
    const r = ratio ?? 16 / 9;
    if (p?.[1]) {
      const short = Number(p[1]);
      const long = Math.round(short * Math.max(r, 1 / r));
      return r >= 1 ? { width: long, height: short, exact: ratio !== undefined } : { width: short, height: long, exact: ratio !== undefined };
    }
    if (k?.[1]) {
      const long = Math.round(Number(k[1]) * 1024);
      const rr = ratio ?? 1;
      const short = Math.round(long / Math.max(rr, 1 / rr));
      return rr >= 1 ? { width: long, height: short, exact: ratio !== undefined } : { width: short, height: long, exact: ratio !== undefined };
    }
    const dims = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(resolution);
    if (dims?.[1] && dims[2]) return { width: Number(dims[1]), height: Number(dims[2]), exact: true };
  }
  if (hints.mediaWidth && hints.mediaHeight) return { width: hints.mediaWidth, height: hints.mediaHeight, exact: false };
  if (ratio) {
    // ~1 MP mit gegebenem Seitenverhältnis
    const height = Math.round(Math.sqrt(1_048_576 / ratio));
    return { width: Math.round(height * ratio), height, exact: false };
  }
  return { width: 1024, height: 1024, exact: false };
}

/** fal rechnet Bild-Megapixel in 1024×1024-Blöcken und rundet je Bild auf (mind. 1 MP). */
export const FAL_MEGAPIXEL = 1024 * 1024;

function textOf(input: Record<string, unknown>): string | undefined {
  for (const key of TEXT_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.length) return v;
  }
  return undefined;
}

// ───────────────────────── Kuratierte Preisregeln ─────────────────────────

interface RuleContext {
  input: Record<string, unknown>;
  unit: ParsedUnit;
  quantity: number;
}

interface RuleEffect {
  factor?: number;
  /** Ersetzt die Menge (z. B. Aufrunden auf 5-s-Schritte). */
  quantity?: number;
  extraUsd?: number;
  note: string;
}

interface PriceRule {
  test: RegExp;
  apply(ctx: RuleContext): RuleEffect | null;
}

const H3_TIERS: Record<string, number> = { '480': 0.625, '768': 1, '1080': 2 };

/** Preisstaffeln aus fal-Modellseiten (Websuche 2026-10-01, ungeprüft). Ergebnis ist dann nie `exact`. */
export const PRICE_RULES: PriceRule[] = [
  {
    // H3 Max / Turbo: 480p $0.05 · 768p $0.08 · 1080p $0.16 je s (Turbo halb) – Einheitspreis = 768P angenommen.
    test: /^minimax\/h3-max(-turbo)?\/(?!director)/,
    apply({ input, unit }) {
      if (unit.kind !== 'second') return null;
      const res = typeof input.resolution === 'string' ? (/(\d{3,4})/.exec(input.resolution)?.[1] ?? '') : '';
      const factor = H3_TIERS[res];
      if (factor === undefined) return { factor: 1, note: 'Auflösung nicht angegeben – 768P-Preis angenommen' };
      return factor === 1 ? null : { factor, note: `${res}P: ×${factor} ggü. 768P (Staffel ungeprüft)` };
    },
  },
  {
    test: /^fal-ai\/nano-banana-pro(\/|$)/,
    apply({ input }) {
      const effects: RuleEffect = { note: '' };
      const notes: string[] = [];
      if (typeof input.resolution === 'string' && input.resolution.toUpperCase() === '4K') {
        effects.factor = 2;
        notes.push('4K: doppelter Preis');
      }
      if (input.enable_web_search === true) {
        effects.extraUsd = 0.015;
        notes.push('+$0.015 Websuche');
      }
      if (!notes.length) return null;
      effects.note = notes.join(', ');
      return effects;
    },
  },
  {
    test: /^fal-ai\/veo3(\.1)?(\/|$)/,
    apply({ input, unit }) {
      if (unit.kind !== 'second' || input.generate_audio !== false) return null;
      return { factor: 0.5, note: 'ohne Ton: halber Preis (Staffel ungeprüft)' };
    },
  },
  {
    test: /^fal-ai\/kling-video\/lipsync\//,
    apply({ unit, quantity }) {
      if (unit.kind !== 'second') return null;
      const rounded = Math.max(5, Math.ceil(quantity / 5) * 5);
      return rounded === quantity ? null : { quantity: rounded, note: 'auf 5-s-Schritte aufgerundet' };
    },
  },
  {
    // FLUX.2 [pro]: erstes MP voller Preis, jedes weitere MP halber Preis.
    test: /^fal-ai\/flux-2-pro(\/|$)/,
    apply({ unit, quantity, input }) {
      if (unit.kind !== 'megapixel') return null;
      const images = outputCount(input).value;
      const perImage = quantity / images;
      if (perImage <= 1) return null;
      return { factor: (1 + 0.5 * (perImage - 1)) / perImage, note: 'weitere MP zum halben Preis' };
    },
  },
];

// ───────────────────────── Schätzung ─────────────────────────

function fmtPrice(value: number): string {
  if (value === 0) return '$0';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${Number(value.toPrecision(2))}`;
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function unitLabel(unit: ParsedUnit): string {
  const prefix = unit.size !== 1 ? `${unit.size >= 1000 && unit.size % 1000 === 0 ? `${unit.size / 1000}k` : unit.size} ` : '';
  switch (unit.kind) {
    case 'second':
      return `${prefix}s`;
    case 'minute':
      return `${prefix}min`;
    case 'image':
      return `${prefix}Bild`;
    case 'megapixel':
    case 'video_megapixel':
      return `${prefix}MP`;
    case 'characters':
      return `${prefix}Zeichen`;
    case 'tokens':
      return `${prefix}Tokens`;
    case 'video':
      return `${prefix}Video`;
    case 'request':
      return `${prefix}Aufruf`;
    case 'compute_second':
      return `${prefix}Rechensek.`;
    case 'frame':
      return `${prefix}Frames`;
    default:
      return unit.raw || 'Einheit';
  }
}

/**
 * Schätzt die Kosten eines Aufrufs. Einheiten: Sekunden (duration/duration_seconds/num_frames÷fps; Standard: kleinste
 * erlaubte Dauer), Minuten, Bilder (num_images), Megapixel (image_size/width×height/resolution/aspect_ratio),
 * Zeichen (Text-/Promptlänge), Videos/Aufrufe pauschal, Rechensekunden (Heuristik). Unbekannte Einheit → 1 × Preis.
 */
export function estimateCostUsd(model: ModelInfo, input: Record<string, unknown>, hints: CostHints = {}): CostEstimate {
  const price = model.price;
  if (!price || !Number.isFinite(price.unitPrice)) {
    return { usd: 0, basis: 'Kein Preis bekannt – Kosten unbekannt', exact: false };
  }
  const data = isPlainObject(input) ? input : {};
  const unit = parseUnit(price.unit);
  const unitPrice = price.unitPrice;
  const notes: string[] = [];
  let quantity = 1;
  let quantityLabel = '1';
  let exact = true;

  switch (unit.kind) {
    case 'second':
    case 'minute': {
      const preferMedia = model.modality === 'tools' || model.modality === 'lipsync';
      const d = durationSec(data, model, hints, preferMedia, unit.kind === 'minute' ? 60 : 5);
      const amount = unit.kind === 'minute' ? d.value / 60 : d.value;
      quantity = unit.size > 1 ? Math.ceil(amount / unit.size - 1e-9) : amount;
      quantityLabel = unit.size > 1 ? `${fmtQty(quantity)} × ${unitLabel(unit)} (${fmtQty(d.value)} s)` : unit.kind === 'minute' ? `${fmtQty(amount)} min` : `${fmtQty(amount)} s`;
      exact = d.exact;
      if (d.note) notes.push(d.note);
      break;
    }
    case 'image': {
      const c = outputCount(data);
      quantity = c.value / unit.size;
      quantityLabel = `${c.value} ${c.value === 1 ? 'Bild' : 'Bilder'}`;
      break;
    }
    case 'megapixel': {
      const dims = outputDimensions(data, hints);
      const images = outputCount(data).value;
      const perImage = Math.max(1, Math.ceil(dims.width * dims.height / FAL_MEGAPIXEL - 1e-9));
      quantity = (perImage * images) / unit.size;
      quantityLabel = `${images > 1 ? `${images} × ` : ''}${perImage} MP (${dims.width}×${dims.height})`;
      exact = dims.exact;
      if (!dims.exact) notes.push('Bildgröße geschätzt');
      break;
    }
    case 'video_megapixel': {
      const dims = outputDimensions(data, hints);
      const d = durationSec(data, model, hints, true);
      const fps = num(data.fps) ?? 24;
      const frames = num(data.num_frames) ?? hints.mediaFrames ?? Math.round(d.value * fps);
      const mp = (dims.width * dims.height * frames) / 1_000_000;
      quantity = mp / unit.size;
      quantityLabel = `${fmtQty(mp)} MP (${dims.width}×${dims.height}×${frames} Frames)`;
      exact = false;
      notes.push('Videodaten geschätzt');
      break;
    }
    case 'characters': {
      const text = textOf(data);
      if (text) {
        const chars = [...text].length;
        quantity = chars / unit.size;
        quantityLabel = `${chars} Zeichen`;
      } else {
        quantity = 1;
        quantityLabel = `1 × ${unitLabel(unit)}`;
        exact = false;
        notes.push('Text fehlt – 1 Einheit angenommen');
      }
      break;
    }
    case 'tokens': {
      const text = textOf(data) ?? '';
      const maxTokens = num(data.max_tokens) ?? 1000;
      const tokens = Math.ceil(text.length / 4) + maxTokens;
      quantity = tokens / unit.size;
      quantityLabel = `~${tokens} Tokens`;
      exact = false;
      notes.push('Tokenzahl geschätzt');
      break;
    }
    case 'video': {
      const c = outputCount(data);
      quantity = c.value / unit.size;
      quantityLabel = `${c.value} ${c.value === 1 ? 'Video' : 'Videos'}`;
      break;
    }
    case 'request': {
      quantity = 1 / unit.size;
      quantityLabel = '1 Aufruf';
      break;
    }
    case 'frame': {
      const frames = num(data.num_frames);
      const d = durationSec(data, model, hints, true);
      const count = frames ?? Math.round(d.value * (num(data.fps) ?? 24));
      quantity = unit.size > 1 ? Math.ceil(count / unit.size) : count;
      quantityLabel = `${count} Frames`;
      exact = frames !== undefined;
      break;
    }
    case 'compute_second': {
      const media = hints.mediaDurationSec;
      const seconds = media && media > 0 ? Math.max(5, Math.ceil(media)) : 10;
      quantity = seconds / unit.size;
      quantityLabel = `~${seconds} Rechensek.`;
      exact = false;
      notes.push('Rechenzeit geschätzt');
      break;
    }
    default: {
      quantity = 1;
      quantityLabel = '1';
      exact = false;
      notes.push(`Einheit „${unit.raw || '?'}“ unbekannt – 1 Einheit angenommen`);
    }
  }

  let factor = 1;
  let extra = 0;
  for (const rule of PRICE_RULES) {
    if (!rule.test.test(model.id)) continue;
    const effect = rule.apply({ input: data, unit, quantity });
    if (!effect) continue;
    if (effect.quantity !== undefined) {
      quantity = effect.quantity;
      quantityLabel = `${fmtQty(quantity)} s`;
    }
    if (effect.factor !== undefined) factor *= effect.factor;
    if (effect.extraUsd) extra += effect.extraUsd;
    if (effect.note) notes.push(effect.note);
    exact = false;
  }

  const usd = roundUsd(Math.max(0, quantity * unitPrice * factor + extra));
  let basis = `${quantityLabel} × ${fmtPrice(unitPrice)}/${unitLabel(unit)}`;
  if (factor !== 1) basis += ` × ${Number(factor.toFixed(3))}`;
  if (price.currency !== 'USD') {
    notes.push(`Währung ${price.currency} (nicht umgerechnet)`);
    exact = false;
  }
  basis += ` ≈ ${formatUsd(usd)}`;
  if (notes.length) basis += ` (${[...new Set(notes)].join('; ')})`;
  return { usd, basis, exact };
}
