import type { Modality, ModelCapabilities } from '@studio/core';
import { propertyInfo, type JsonSchema, schemaProperties } from './schema.ts';

/**
 * Fähigkeiten aus dem Eingabeschema ableiten und fal-Kategorien auf Picker-Modalitäten abbilden.
 * Beides sind Heuristiken über Feldnamen und IDs; kuratierte Seed-Einträge ergänzen sie (Registry).
 */

const URL_SUFFIX = /(_url|_urls|_uri|_uris|_file|_files|_path|_paths)$/;
const NON_MEDIA = /^(num|max|min|enable|use|output|generate|sync|return|with)_|_(size|format|scale|strength|count|steps|mode|type|guidance|prompt|quality|resolution|fps|ratio|seconds|duration|length|level|setting|settings|id)$/;
const AUDIO_WORDS = new Set(['audio', 'audios', 'sound', 'speech', 'voice', 'music', 'song', 'vocals', 'vocal', 'track']);
const VIDEO_WORDS = new Set(['video', 'videos', 'clip', 'footage', 'movie']);
const IMAGE_WORDS = new Set(['image', 'images', 'img', 'photo', 'picture', 'frame', 'mask', 'face', 'portrait', 'sketch', 'reference']);

type MediaKind = 'audio' | 'video' | 'image';

function mediaKindOf(name: string, description: string): MediaKind | null {
  const lname = name.toLowerCase();
  if (NON_MEDIA.test(lname)) return null;
  const tokens = lname.split(/[_-]/);
  const urlish = URL_SUFFIX.test(lname);
  const desc = description.toLowerCase();
  const has = (words: Set<string>) => tokens.some((t) => words.has(t));
  if (has(VIDEO_WORDS) && (urlish || lname === 'video' || lname === 'videos')) return 'video';
  if (has(AUDIO_WORDS) && (urlish || lname === 'audio' || lname === 'audios')) return 'audio';
  // „reference“ mit Audio/Video (z. B. `reference_audio_urls`) wurde oben schon erkannt; sonst Bild.
  if (has(IMAGE_WORDS) && (urlish || lname === 'image' || lname === 'images')) return 'image';
  if (/\b(url|uri) of the (input )?video|video (url|file)|input video\b/.test(desc)) return 'video';
  if (/\b(url|uri) of the (input )?audio|audio (url|file)\b/.test(desc)) return 'audio';
  if (/\b(url|uri) of the (input )?image|image (url|file)|input image\b/.test(desc)) return 'image';
  return null;
}

const DURATION_KEYS = [
  'duration',
  'duration_seconds',
  'duration_sec',
  'duration_s',
  'video_duration',
  'audio_duration',
  'seconds',
  'num_seconds',
  'length_seconds',
  'seconds_total',
  'music_length_ms',
  'duration_ms',
];
const ASPECT_KEYS = ['aspect_ratio', 'video_aspect_ratio', 'output_aspect_ratio'];
const RESOLUTION_KEYS = ['resolution', 'output_resolution', 'video_resolution', 'target_resolution'];
const WORD_TIMESTAMP_BOOLEANS = ['word_timestamps', 'timestamps', 'return_timestamps', 'with_timestamps', 'word_level_timestamps', 'enable_word_timestamps'];
const NATIVE_AUDIO_BOOLEANS = ['generate_audio', 'enable_audio', 'with_audio', 'audio_enabled', 'generate_sound'];

/** `"8s"`, `"5"`, `10` → Sekunden; Millisekunden-Felder (`isMs`) werden umgerechnet. */
export function parseDurationValue(value: unknown, isMs = false): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? (isMs ? value / 1000 : value) : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)?\s*$/i.exec(value);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === 'ms') return n / 1000;
  if (unit) return n;
  return isMs ? n / 1000 : n;
}

const RATIO = /^\d+(\.\d+)?:\d+(\.\d+)?$/;
const IMAGE_SIZE_RATIOS: Record<string, string> = {
  square: '1:1',
  square_hd: '1:1',
  landscape_4_3: '4:3',
  landscape_16_9: '16:9',
  portrait_4_3: '3:4',
  portrait_16_9: '9:16',
};

/** Leitet `ModelCapabilities` aus dem (aufgelösten) Eingabeschema ab. Nur positive Befunde werden gesetzt. */
export function deriveCapabilities(schema: JsonSchema): ModelCapabilities {
  const caps: ModelCapabilities = {};
  const props = schemaProperties(schema);
  for (const [name, prop] of props) {
    const info = propertyInfo(prop);
    const lname = name.toLowerCase();
    const isArray = info.types.includes('array');
    const stringish = info.types.includes('string') || (info.types.length === 0 && !info.enumValues.length);
    const arrayOfStrings = isArray && (!info.items || info.items.types.length === 0 || info.items.types.includes('string'));
    if ((stringish && !info.enumValues.length) || arrayOfStrings) {
      const kind = mediaKindOf(name, info.description ?? '');
      if (kind === 'audio') caps.audioInput = true;
      if (kind === 'video') caps.videoInput = true;
      if (kind === 'image') {
        caps.imageInput = true;
        if (isArray) caps.multiImageInput = true;
      }
    }
    if (DURATION_KEYS.includes(lname) && caps.durations === undefined && caps.maxDurationSec === undefined) {
      const isMs = lname.endsWith('_ms');
      const values = info.enumValues.map((v) => parseDurationValue(v, isMs)).filter((v): v is number => v !== undefined && v > 0);
      if (values.length) {
        caps.durations = [...new Set(values)].sort((a, b) => a - b);
        caps.maxDurationSec = caps.durations[caps.durations.length - 1];
      } else {
        const max = info.maximum ?? info.exclusiveMaximum;
        if (max !== undefined) caps.maxDurationSec = isMs ? max / 1000 : max;
      }
    }
    if (ASPECT_KEYS.includes(lname)) {
      const ratios = info.enumValues.filter((v): v is string => typeof v === 'string' && RATIO.test(v.trim())).map((v) => v.trim());
      if (ratios.length) caps.aspectRatios = [...new Set([...(caps.aspectRatios ?? []), ...ratios])];
    }
    if (lname === 'image_size' && !props.some(([n]) => ASPECT_KEYS.includes(n.toLowerCase()))) {
      const ratios = info.enumValues.map((v) => (typeof v === 'string' ? IMAGE_SIZE_RATIOS[v] : undefined)).filter((v): v is string => Boolean(v));
      if (ratios.length) caps.aspectRatios = [...new Set([...(caps.aspectRatios ?? []), ...ratios])];
    }
    if (RESOLUTION_KEYS.includes(lname)) {
      const values = info.enumValues.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String);
      if (values.length) caps.resolutions = [...new Set([...(caps.resolutions ?? []), ...values])];
    }
    if (lname === 'seed') caps.seed = true;
    if ((lname === 'chunk_level' || lname === 'timestamps_granularity' || lname === 'timestamp_granularities') && hasWord(info.enumValues, info.items?.enumValues)) {
      caps.wordTimestamps = true;
    }
    if (WORD_TIMESTAMP_BOOLEANS.includes(lname) && info.types.includes('boolean')) caps.wordTimestamps = true;
    if (NATIVE_AUDIO_BOOLEANS.includes(lname) && info.types.includes('boolean')) caps.nativeAudio = true;
  }
  return caps;
}

function hasWord(...lists: Array<unknown[] | undefined>): boolean {
  return lists.some((list) => (list ?? []).some((v) => typeof v === 'string' && v.toLowerCase() === 'word'));
}

/** Badges für Picker und `describe()` (deutsch). */
export function describeCapabilities(caps: ModelCapabilities): string[] {
  const out: string[] = [];
  if (caps.audioInput) out.push('Audio-Eingang');
  if (caps.imageInput) out.push(caps.multiImageInput ? 'Bild-Eingang (mehrere Referenzbilder)' : 'Bild-Eingang');
  if (caps.videoInput) out.push('Video-Eingang');
  if (caps.nativeAudio) out.push('Native Tonspur');
  if (caps.durations?.length) out.push(`Dauer: ${compactNumbers(caps.durations)} s`);
  else if (caps.maxDurationSec) out.push(`max. ${caps.maxDurationSec} s`);
  if (caps.aspectRatios?.length) out.push(`Formate: ${caps.aspectRatios.join(', ')}`);
  if (caps.resolutions?.length) out.push(`Auflösung: ${caps.resolutions.join(', ')}`);
  if (caps.seed) out.push('Seed');
  if (caps.wordTimestamps) out.push('Wortzeitstempel');
  if (caps.toolUse) out.push('Tool-Aufrufe');
  if (caps.vision) out.push('Bildverständnis');
  return out;
}

/** `[5,6,7,…,15]` → `5–15`, sonst `5/10/15`. */
function compactNumbers(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const contiguous = sorted.length > 3 && sorted.every((v, i) => i === 0 || v - (sorted[i - 1] ?? v) === 1);
  return contiguous && first !== undefined && last !== undefined ? `${first}–${last}` : sorted.join('/');
}

// ───────────────────────── Kategorien → Modalitäten ─────────────────────────

const TOOL_PATTERNS: RegExp[] = [
  /upscal|super-?resolution|seedvr|esrgan|increase-resolution|flashvsr|(^|\/)topaz\/|crystal-(video-)?upscaler|(^|[/-])(lava|nova)-sr\b/,
  /background-?remov|remove-?background|background\/remove|rembg|birefnet|matting|bg-remov/,
  /segment|(^|\/)sam(-?\d(-\d)?|2)?(\/|$)|evf-sam|sa2va/,
  /depth-anything|marigold|(^|\/)depth(\/|$)|imageutils\/depth|zoe-?depth/,
  /dwpose|openpose|pose-estimat|vitpose/,
  /interpolat|(^|\/)rife(\/|$)|(^|\/)film(\/|$)/,
  /vectoriz|image-to-svg|(^|\/)potrace/,
  /demucs|stem-?separ|audio-?separ|audio-isolation|vocal-?remov|deepfilternet|denoise|sam-audio/,
  /speech-to-text|whisper|wizper|scribe|transcri|(^|[/-])(asr|stt)([/-]|$)/,
  /image-preprocessors|imageutils|ffmpeg-api|nsfw-|(^|\/)caption/,
];
const LIPSYNC_PATTERN =
  /lip-?sync|latentsync|avatar|omnihuman|talking|musetalk|sadtalker|hallo|fantasytalking|infinitalk|echomimic|live-?portrait|multitalk|hedra|creatify/;
const SOUND_PATTERN = /sfx|sound-?effect|foley|mmaudio|(^|[/-])v2a([/-]|$)|video-to-audio|thinksound|audio-effects|(^|\/)sound(\/|$)/;
const MUSIC_PATTERN = /music|song|lyria|stable-audio|ace-step|musicgen|diffrhythm|beatoven|(^|\/)yue|suno|riffusion|lyrics/;
const VOICE_PATTERN = /tts|text-to-speech|(^|[/-])speech-\d|voice|dialogue|kokoro|dia-tts|chatterbox|orpheus|f5-tts|zonos|playai|index-tts|vibevoice|(^|\/)speech(\/|$)|minimax\/speech/;
const DEPTH_CONTROL_EXCLUSION = /lora|controlnet|control-/;

function isTool(haystack: string): boolean {
  return TOOL_PATTERNS.some((p, i) => {
    if (!p.test(haystack)) return false;
    // Tiefe/Segmentierung als Steuersignal einer Bild-LoRA ist Generierung, kein Werkzeug.
    if ((i === 2 || i === 3) && DEPTH_CONTROL_EXCLUSION.test(haystack)) return false;
    return true;
  });
}

function audioModality(category: string, haystack: string): Modality {
  if (SOUND_PATTERN.test(haystack)) return 'sound';
  if (MUSIC_PATTERN.test(haystack)) return 'music';
  if (VOICE_PATTERN.test(haystack)) return 'voice';
  if (category === 'audio-to-audio') return 'tools';
  return 'sound';
}

/**
 * fal-Kategorie (+ Endpoint-ID/Tags als Heuristik) → Picker-Modalität; `null` für nicht unterstützte
 * Bereiche (Training, 3D …).
 */
export function modalityForCategory(category: string, endpointId?: string, tags?: string[]): Modality | null {
  const cat = (category ?? '').toLowerCase().trim();
  const haystack = [endpointId ?? '', ...(tags ?? [])].join(' ').toLowerCase();
  if (cat === 'training' || cat.includes('3d') || /(^|[/-])trainer([/-]|$)|training/.test(endpointId?.toLowerCase() ?? '')) return null;
  if (['llm', 'vision', 'text-to-text', 'image-to-json', 'text-to-json', 'json', 'video-to-text', 'image-to-text', 'chat'].includes(cat)) return 'text';
  if (cat === 'speech-to-text' || cat === 'audio-to-text') return 'tools';
  const generative = cat.startsWith('text-to-');
  if (!generative && isTool(haystack)) return 'tools';
  const videoish = ['text-to-video', 'image-to-video', 'video-to-video', 'reference-to-video', 'audio-to-video', 'video'].includes(cat);
  if ((videoish || cat === 'image-to-image' || cat === '') && LIPSYNC_PATTERN.test(haystack)) return 'lipsync';
  if (cat === 'audio-to-video') return 'lipsync';
  if (cat === 'video-to-video' && SOUND_PATTERN.test(haystack)) return 'sound';
  if (videoish) return 'video';
  if (['text-to-image', 'image-to-image', 'image-editing', 'text-to-vector', 'image'].includes(cat)) return 'image';
  if (['text-to-speech', 'speech-to-speech', 'text-to-dialogue', 'voice-cloning', 'voice'].includes(cat)) return 'voice';
  if (['text-to-audio', 'audio-to-audio', 'video-to-audio', 'text-to-music', 'audio', 'music'].includes(cat)) return audioModality(cat, haystack);
  // Unbekannte Kategorie: grobe Schätzung über die ID.
  if (!cat) {
    if (isTool(haystack)) return 'tools';
    if (/video/.test(haystack)) return 'video';
    if (/image|flux|banana|seedream/.test(haystack)) return 'image';
    if (SOUND_PATTERN.test(haystack)) return 'sound';
    if (MUSIC_PATTERN.test(haystack)) return 'music';
    if (VOICE_PATTERN.test(haystack)) return 'voice';
  }
  return null;
}

/** Zusätzliche Modalitäten (z. B. Videomodell mit Audio-Eingang taucht auch unter Lipsync auf). */
export function alsoModalitiesFor(modality: Modality, caps: ModelCapabilities): Modality[] | undefined {
  if (modality === 'video' && caps.audioInput) return ['lipsync'];
  if (modality === 'lipsync') return ['video'];
  return undefined;
}

