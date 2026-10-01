import type { MediaInfo } from './types.ts';

/** Minimaler Ausschnitt der ffprobe-JSON-Struktur (`-show_format -show_streams`). */
interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  nb_frames?: string;
  bit_rate?: string;
  disposition?: { attached_pic?: number; still_image?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface ProbeJson {
  streams?: ProbeStream[];
  format?: { duration?: string; bit_rate?: string; format_name?: string };
}

/** Wandelt die JSON-Ausgabe von ffprobe in `MediaInfo` um (rein, ohne Prozess). */
export function parseProbeJson(json: unknown): MediaInfo {
  const data = (json ?? {}) as ProbeJson;
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const format = data.format ?? {};
  const formatName = format.format_name;
  const still = !!formatName && /(^|,)(image2|[a-z0-9]+_pipe)(,|$)/.test(formatName);

  // Eingebettete Cover-Bilder (z. B. in MP3/M4A) sind keine Videospur.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');

  const info: MediaInfo = {
    durationMs: 0,
    hasVideo: !!video,
    hasAudio: !!audio,
  };
  if (formatName) info.formatName = formatName;

  const formatDuration = positive(format.duration);
  const videoDuration = video ? positive(video.duration) : undefined;
  const audioDuration = audio ? positive(audio.duration) : undefined;
  const durationSec = still ? 0 : (formatDuration ?? Math.max(videoDuration ?? 0, audioDuration ?? 0));
  info.durationMs = Math.round(durationSec * 1000);
  if (videoDuration !== undefined && !still) info.videoDurationMs = Math.round(videoDuration * 1000);
  if (audioDuration !== undefined) info.audioDurationMs = Math.round(audioDuration * 1000);

  const bitRate = positive(format.bit_rate);
  if (bitRate !== undefined) info.bitRate = Math.round(bitRate);

  if (video) {
    if (still) info.isStillImage = true;
    if (video.codec_name) info.videoCodec = video.codec_name;
    const rotation = streamRotation(video);
    if (rotation) info.rotation = rotation;
    if (video.width && video.height) {
      const swap = rotation === 90 || rotation === 270;
      info.width = swap ? video.height : video.width;
      info.height = swap ? video.width : video.height;
    }
    if (!still) {
      const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
      if (fps !== undefined) info.fps = Math.round(fps * 1000) / 1000;
    }
  }
  if (audio) {
    if (audio.codec_name) info.audioCodec = audio.codec_name;
    const sr = positive(audio.sample_rate);
    if (sr !== undefined) info.sampleRate = Math.round(sr);
    if (audio.channels) info.channels = audio.channels;
  }
  return info;
}

/** Rotation im Uhrzeigersinn (0/90/180/270) aus Display-Matrix oder altem `rotate`-Tag. */
function streamRotation(stream: ProbeStream): number {
  const matrix = stream.side_data_list?.find((d) => typeof d.rotation === 'number');
  let deg: number | undefined;
  // Die Display-Matrix gibt die Drehung gegen den Uhrzeigersinn an.
  if (matrix && typeof matrix.rotation === 'number') deg = -matrix.rotation;
  else if (stream.tags?.rotate !== undefined) deg = Number(stream.tags.rotate);
  if (deg === undefined || !Number.isFinite(deg)) return 0;
  const normalized = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

/** `30000/1001` → 29.97; `0/0` → undefined. */
export function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [n, d] = rate.split('/');
  const num = Number(n);
  const den = d === undefined ? 1 : Number(d);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return undefined;
  const value = num / den;
  // Unsinnige Werte (z. B. 90000/1 bei manchen Containern) verwerfen.
  return value > 0 && value <= 1000 ? value : undefined;
}

function positive(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === 'N/A') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
