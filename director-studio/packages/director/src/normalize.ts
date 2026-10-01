/**
 * Defensive Normalisierung der Ergebnisse von `MediaPort` (parallel entwickeltes Paket). Liest die
 * üblichen Feldnamen (camelCase und snake_case) und ignoriert Unbekanntes.
 */

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function num(obj: Obj, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function numArray(obj: Obj, ...keys: string[]): number[] | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v)) {
      const out = v
        .map((x) => (typeof x === 'number' ? x : isObj(x) ? num(x, 'time', 'timeSec', 't', 'start') : undefined))
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      return out;
    }
  }
  return undefined;
}

/** Pfad aus `string`, `{ path }`, `{ out }` oder `{ file }`. */
export function pathOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isObj(value)) {
    for (const key of ['path', 'out', 'file', 'outPath', 'output']) {
      const v = value[key];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

/** Frame-Liste aus `string[]`, `{path,timeSec}[]` oder `{ frames: … }`. */
export function framePaths(value: unknown, timesSec: number[]): Array<{ path: string; timeSec: number }> {
  const list = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.frames) ? value.frames : isObj(value) && Array.isArray(value.paths) ? value.paths : [];
  const out: Array<{ path: string; timeSec: number }> = [];
  list.forEach((entry, i) => {
    const path = pathOf(entry);
    if (!path) return;
    const t = isObj(entry) ? num(entry, 'timeSec', 'time', 't') : undefined;
    out.push({ path, timeSec: t ?? timesSec[i] ?? 0 });
  });
  return out;
}

export interface ProbeInfo {
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

export function normalizeProbe(value: unknown): ProbeInfo {
  if (!isObj(value)) return {};
  const out: ProbeInfo = {};
  const durationSec = num(value, 'durationSec', 'duration', 'duration_sec') ?? (num(value, 'durationMs', 'duration_ms') !== undefined ? num(value, 'durationMs', 'duration_ms')! / 1000 : undefined);
  if (durationSec !== undefined) out.durationSec = durationSec;
  const video = isObj(value.video) ? value.video : value;
  const width = num(video, 'width');
  const height = num(video, 'height');
  const fps = num(video, 'fps', 'frameRate', 'frame_rate');
  if (width !== undefined) out.width = Math.round(width);
  if (height !== undefined) out.height = Math.round(height);
  if (fps !== undefined) out.fps = fps;
  if (typeof value.hasAudio === 'boolean') out.hasAudio = value.hasAudio;
  else if (value.audio !== undefined) out.hasAudio = !!value.audio;
  if (typeof value.hasVideo === 'boolean') out.hasVideo = value.hasVideo;
  else if (value.video !== undefined) out.hasVideo = !!value.video;
  return out;
}

export interface BeatInfo {
  bpm?: number;
  beats: number[];
  downbeats: number[];
  confidence?: number;
  sections: Array<{ start: number; label?: string }>;
}

export function normalizeBeats(value: unknown): BeatInfo {
  if (!isObj(value)) return { beats: Array.isArray(value) ? (value as unknown[]).filter((x): x is number => typeof x === 'number') : [], downbeats: [], sections: [] };
  const sectionsRaw = Array.isArray(value.sections) ? value.sections : [];
  const sections = sectionsRaw
    .map((s) => (isObj(s) ? { start: num(s, 'start', 'startSec', 'time') ?? NaN, label: typeof s.label === 'string' ? s.label : undefined } : undefined))
    .filter((s): s is { start: number; label: string | undefined } => !!s && Number.isFinite(s.start))
    .map((s) => (s.label ? { start: s.start, label: s.label } : { start: s.start }));
  const out: BeatInfo = {
    beats: numArray(value, 'beats', 'beatTimes', 'beat_times') ?? [],
    downbeats: numArray(value, 'downbeats', 'downbeatTimes', 'downbeat_times') ?? [],
    sections,
  };
  const bpm = num(value, 'bpm', 'tempo', 'tempoBpm');
  if (bpm !== undefined) out.bpm = bpm;
  const confidence = num(value, 'confidence');
  if (confidence !== undefined) out.confidence = confidence;
  return out;
}

export interface LoudnessInfo {
  integratedLufs?: number;
  truePeakDb?: number;
  lra?: number;
  raw: Obj;
}

export function normalizeLoudness(value: unknown): LoudnessInfo {
  if (!isObj(value)) return { raw: {} };
  const out: LoudnessInfo = { raw: value };
  const i = num(value, 'integratedLufs', 'integrated', 'lufs', 'input_i', 'I');
  const tp = num(value, 'truePeakDb', 'truePeak', 'true_peak', 'tp', 'input_tp', 'TP');
  const lra = num(value, 'lra', 'loudnessRange', 'LRA', 'input_lra');
  if (i !== undefined) out.integratedLufs = i;
  if (tp !== undefined) out.truePeakDb = tp;
  if (lra !== undefined) out.lra = lra;
  return out;
}

export interface SyncInfo {
  offsetMs?: number;
  confidence?: number;
  raw: Obj;
}

export function normalizeSync(value: unknown): SyncInfo {
  if (!isObj(value)) return { raw: {} };
  const out: SyncInfo = { raw: value };
  const offsetMs = num(value, 'offsetMs', 'offset_ms') ?? (num(value, 'offsetSec', 'offset') !== undefined ? num(value, 'offsetSec', 'offset')! * 1000 : undefined);
  const confidence = num(value, 'confidence', 'score');
  if (offsetMs !== undefined) out.offsetMs = offsetMs;
  if (confidence !== undefined) out.confidence = confidence;
  return out;
}
