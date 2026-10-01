import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { formatSeconds, type Timeline } from '@studio/core';
import { detectBeatsFromPcm } from './dsp/beats.ts';
import { GrowableFloat32, PeakAccumulator, RmsEnvelopeAccumulator, absDiff, syncFeature } from './dsp/signal.ts';
import { estimateOffset } from './dsp/xcorr.ts';
import { MediaError } from './errors.ts';
import {
  audioCodecArgs,
  audioContainerArgs,
  extensionOf,
  filterValue,
  formatFfmpegTime,
  imageCodecArgs,
  num,
} from './ffmpeg-syntax.ts';
import { buildAudioMixGraph, clipContributesAudio, type AudioMixOptions } from './mix.ts';
import { parseProbeJson } from './probe.ts';
import { Float32StreamDecoder, runProcess, type RunOptions } from './process.ts';
import type { AvSyncResult, BeatAnalysis, MediaInfo, Roi } from './types.ts';

export interface MediaConfig {
  /** Pfad zu ffmpeg (Standard: `FFMPEG_PATH` bzw. `ffmpeg` aus dem PATH). */
  ffmpegPath?: string;
  /** Pfad zu ffprobe (Standard: `FFPROBE_PATH`, sonst neben ffmpeg, sonst `ffprobe` aus dem PATH). */
  ffprobePath?: string;
  /** Schriftdatei für Beschriftungen (Kontaktabzug); sonst Systemschrift. */
  fontFile?: string;
}

export interface FfmpegCapabilities {
  /** Versionszeile, z. B. `6.1.1-3ubuntu5` oder `N-118000-g…`. */
  version: string;
  major?: number;
  minor?: number;
  filters: Set<string>;
  encoders: Set<string>;
}

/** Ab dieser Länge wird `filter_complex` über eine Datei übergeben (Windows: max. 32 767 Zeichen Kommandozeile). */
const MAX_INLINE_FILTER_CHARS = 12_000;
/** Analyse-Abtastraten. */
const PEAKS_SAMPLE_RATE = 22_050;
const BEATS_SAMPLE_RATE = 16_000;
const SYNC_RATE_HZ = 200;
const MOTION_SIZE = 64;

/**
 * Lokale Medienverarbeitung mit ffmpeg/ffprobe (immer per Argument-Array, nie über eine Shell).
 * Alle Methoden werfen `MediaError` mit deutscher Meldung und stderr-Ende.
 */
export class MediaToolkit {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  private readonly fontFile: string | undefined;
  private capsPromise: Promise<FfmpegCapabilities> | undefined;

  constructor(cfg: MediaConfig = {}) {
    this.ffmpegPath = cfg.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobePath = cfg.ffprobePath || process.env.FFPROBE_PATH || siblingProbe(this.ffmpegPath) || 'ffprobe';
    this.fontFile = cfg.fontFile;
  }

  // ───────────────────────── Grundlagen ─────────────────────────

  /** Version, Filter und Encoder des konfigurierten ffmpeg (einmal ermittelt, dann zwischengespeichert). */
  capabilities(): Promise<FfmpegCapabilities> {
    if (this.capsPromise) return this.capsPromise;
    const pending = (async () => {
      const [ver, filters, encoders] = await Promise.all([
        runProcess(this.ffmpegPath, ['-hide_banner', '-version']),
        runProcess(this.ffmpegPath, ['-hide_banner', '-filters']),
        runProcess(this.ffmpegPath, ['-hide_banner', '-encoders']),
      ]);
      const line = ver.stdout.toString('utf8').split('\n')[0] ?? '';
      const version = /version\s+(\S+)/.exec(line)?.[1] ?? 'unbekannt';
      const m = /^n?(\d+)\.(\d+)/.exec(version);
      const caps: FfmpegCapabilities = {
        version,
        filters: parseListing(filters.stdout.toString('utf8')),
        encoders: parseListing(encoders.stdout.toString('utf8')),
      };
      if (m) {
        caps.major = Number(m[1]);
        caps.minor = Number(m[2]);
      }
      return caps;
    })();
    this.capsPromise = pending;
    // Fehlschläge nicht zwischenspeichern (z. B. Pfad wird später korrigiert).
    pending.catch(() => {
      if (this.capsPromise === pending) this.capsPromise = undefined;
    });
    return pending;
  }

  async hasFilter(name: string): Promise<boolean> {
    return (await this.capabilities()).filters.has(name);
  }

  async probe(path: string): Promise<MediaInfo> {
    const src = await this.input(path);
    const { stdout } = await runProcess(this.ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', src]);
    let json: unknown;
    try {
      json = JSON.parse(stdout.toString('utf8'));
    } catch (error) {
      throw new MediaError('parse_failed', `ffprobe-Ausgabe für "${basename(path)}" ist kein gültiges JSON.`, { cause: error });
    }
    const info = parseProbeJson(json);
    if (!info.hasVideo && !info.hasAudio) {
      throw new MediaError('invalid_input', `"${basename(path)}" enthält weder Video noch Audio.`);
    }
    return info;
  }

  // ───────────────────────── Bilder ─────────────────────────

  /** Einzelbild (PNG/JPEG/WebP nach Endung) zum Zeitpunkt `atSec` (Standard: 25 % der Dauer, max. 1 s). */
  async thumbnail(src: string, out: string, opts: { atSec?: number; width?: number; signal?: AbortSignal } = {}): Promise<string> {
    const input = await this.input(src);
    const info = await this.requireVideo(src);
    const output = await this.output(out);
    const codec = this.imageArgs(output);
    const durSec = videoSeconds(info);
    let t = info.isStillImage ? 0 : clampSeek(opts.atSec ?? Math.min(1, durSec * 0.25), info);
    const vf = opts.width ? ['-vf', `scale=${evenPositive(opts.width)}:-2`] : [];
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ffmpeg([...(t > 0 ? ['-ss', formatFfmpegTime(t)] : []), '-i', input, '-map', '0:v:0', '-frames:v', '1', ...vf, '-update', '1', ...codec, output], signalOptions(opts.signal));
      if (await nonEmpty(output)) return output;
      t = Math.max(0, t - 1); // Suchposition hinter dem letzten dekodierbaren Bild
    }
    throw new MediaError('process_failed', `ffmpeg hat kein Vorschaubild für "${basename(src)}" erzeugt.`);
  }

  /** Einzelbilder (PNG) an den angegebenen Zeiten (genaue Suche, auf die Dauer begrenzt); Reihenfolge wie `timesSec`. */
  async extractFrames(src: string, timesSec: number[], outDir: string, opts: { width?: number; signal?: AbortSignal } = {}): Promise<string[]> {
    const input = await this.input(src);
    const info = await this.requireVideo(src);
    const dir = resolve(outDir);
    await mkdir(dir, { recursive: true });
    const times = timesSec.map((t) => (info.isStillImage ? 0 : clampSeek(t, info)));
    const paths = times.map((t, i) => join(dir, `frame_${String(i + 1).padStart(3, '0')}_${Math.round(t * 1000)}ms.png`));
    const vf = opts.width ? ['-vf', `scale=${evenPositive(opts.width)}:-2`] : [];
    const batch = 8;
    for (let start = 0; start < times.length; start += batch) {
      const idx = times.slice(start, start + batch).map((_, k) => start + k);
      await this.ffmpeg(this.multiFrameArgs(input, idx.map((i) => times[i]!), idx.map((i) => paths[i]!), vf), signalOptions(opts.signal));
    }
    // Fehlende Bilder (Suche hinter das letzte dekodierbare Bild) einzeln etwas früher nachholen.
    for (let i = 0; i < paths.length; i++) {
      if (await nonEmpty(paths[i]!)) continue;
      const earlier = Math.max(0, times[i]! - 0.5);
      await this.ffmpeg(this.multiFrameArgs(input, [earlier], [paths[i]!], vf), signalOptions(opts.signal));
      if (!(await nonEmpty(paths[i]!))) {
        throw new MediaError('process_failed', `Bild bei ${times[i]!.toFixed(3)} s aus "${basename(src)}" konnte nicht extrahiert werden.`);
      }
    }
    return paths;
  }

  /** Horizontaler Filmstreifen aus `count` gleichmäßig verteilten Bildern der Höhe `height`. */
  async filmstrip(
    src: string,
    out: string,
    opts: { count?: number; height?: number; signal?: AbortSignal } = {},
  ): Promise<{ path: string; frameWidth: number; frameHeight: number; count: number }> {
    const input = await this.input(src);
    const info = await this.requireVideo(src);
    const output = await this.output(out);
    const codec = this.imageArgs(output);
    const count = Math.max(1, Math.min(60, Math.round(opts.count ?? 10)));
    const frameHeight = evenPositive(opts.height ?? 72);
    const frameWidth = evenPositive(frameHeight * aspect(info));
    const times = evenlySpacedTimes(info, count);
    const args: string[] = [];
    times.forEach((t) => args.push(...(t > 0 ? ['-ss', formatFfmpegTime(t)] : []), '-i', input));
    const scaled = times.map((_, i) => `[${i}:v:0]scale=${frameWidth}:${frameHeight},setsar=1,format=yuv420p[v${i}]`);
    const graph = count === 1 ? `[0:v:0]scale=${frameWidth}:${frameHeight},setsar=1[out]` : `${scaled.join(';')};${times.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${count}[out]`;
    await this.ffmpeg([...args, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-update', '1', ...codec, output], signalOptions(opts.signal));
    if (!(await nonEmpty(output))) throw new MediaError('process_failed', `ffmpeg hat keinen Filmstreifen für "${basename(src)}" erzeugt.`);
    return { path: output, frameWidth, frameHeight, count };
  }

  /**
   * Kontaktabzug: Raster aus Einzelbildern mit Zeitstempel (drawtext). Ohne drawtext
   * (oder wenn Schriften fehlen) wird automatisch ohne Beschriftung gerendert.
   */
  async contactSheet(
    src: string,
    out: string,
    opts: { timesSec?: number[]; count?: number; columns?: number; tileWidth?: number; labels?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ path: string; timesSec: number[]; columns: number; rows: number; tileWidth: number; tileHeight: number; labeled: boolean }> {
    const input = await this.input(src);
    const info = await this.requireVideo(src);
    const output = await this.output(out);
    const codec = this.imageArgs(output);
    const times = opts.timesSec?.length
      ? opts.timesSec.map((t) => (info.isStillImage ? 0 : clampSeek(t, info)))
      : evenlySpacedTimes(info, Math.max(1, Math.min(100, Math.round(opts.count ?? 12))));
    const n = times.length;
    const columns = Math.max(1, Math.min(n, Math.round(opts.columns ?? Math.ceil(Math.sqrt(n)))));
    const rows = Math.ceil(n / columns);
    const tileWidth = evenPositive(opts.tileWidth ?? 320);
    const tileHeight = evenPositive(tileWidth / aspect(info));
    let labeled = opts.labels !== false && (await this.hasFilter('drawtext').catch(() => false));

    const build = (withLabels: boolean) => {
      const args: string[] = [];
      times.forEach((t) => args.push(...(t > 0 ? ['-ss', formatFfmpegTime(t)] : []), '-i', input));
      const font = withLabels ? this.resolveFont() : undefined;
      const fontSize = Math.max(10, Math.round(tileHeight * 0.1));
      const chains = times.map((t, i) => {
        const filters = [`scale=${tileWidth}:${tileHeight}`, 'setsar=1', 'trim=end_frame=1', 'setpts=PTS-STARTPTS', 'format=yuv420p'];
        if (withLabels) {
          const label = formatSeconds(t);
          filters.push(
            [
              `drawtext=text=${filterValue(label)}`,
              'expansion=none',
              ...(font ? [`fontfile=${filterValue(font)}`] : []),
              `fontsize=${fontSize}`,
              'fontcolor=white',
              'box=1',
              'boxcolor=black@0.6',
              `boxborderw=${Math.max(2, Math.round(fontSize * 0.3))}`,
              `x=${Math.round(fontSize * 0.6)}`,
              `y=h-th-${Math.round(fontSize * 0.6)}`,
            ].join(':'),
          );
        }
        return `[${i}:v:0]${filters.join(',')}[v${i}]`;
      });
      const graph = `${chains.join(';')};${times.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,tile=${columns}x${rows}:padding=4:margin=4:color=0x161616[out]`;
      return [...args, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-update', '1', ...codec, output];
    };

    try {
      await this.ffmpeg(build(labeled), signalOptions(opts.signal));
    } catch (error) {
      if (!labeled || !(error instanceof MediaError) || error.code !== 'process_failed') throw error;
      // z. B. keine Schrift gefunden → ohne Beschriftung erneut versuchen.
      labeled = false;
      await this.ffmpeg(build(false), signalOptions(opts.signal));
    }
    if (!(await nonEmpty(output))) throw new MediaError('process_failed', `ffmpeg hat keinen Kontaktabzug für "${basename(src)}" erzeugt.`);
    return { path: output, timesSec: times.map(round3), columns, rows, tileWidth, tileHeight, labeled };
  }

  // ───────────────────────── Video ─────────────────────────

  /**
   * Vorschau-Proxy: H.264 (yuv420p) + AAC-Stereo, Keyframe jede Sekunde, faststart,
   * gerade Abmessungen, höchstens `height` Pixel hoch (keine Vergrößerung).
   */
  async proxy(src: string, out: string, opts: { height?: number; signal?: AbortSignal; onProgress?: (ratio: number) => void } = {}): Promise<string> {
    const input = await this.input(src);
    const info = await this.requireVideo(src);
    if (info.isStillImage) throw new MediaError('invalid_input', `"${basename(src)}" ist ein Standbild – Proxies gibt es nur für Videos.`);
    const output = await this.output(out);
    const target = evenPositive(opts.height ?? 540);
    const height = info.height ? Math.min(target, evenFloor(info.height)) : target;
    const gop = Math.max(1, Math.round(info.fps ?? 30));
    const encoder = await this.h264Encoder();
    const args = [
      '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=-2:${height}:flags=bicubic,setsar=1,format=yuv420p`,
      ...encoder,
      '-g', String(gop),
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart',
      output,
    ];
    await this.ffmpeg(args, progressOptions(opts.signal, opts.onProgress, info.durationMs / 1000));
    if (!(await nonEmpty(output))) throw new MediaError('process_failed', `ffmpeg hat keinen Proxy für "${basename(src)}" erzeugt.`);
    return output;
  }

  /** Video-Stream kopieren, Audio als AAC (bzw. Opus bei WebM) dazu; Länge = kürzere Spur. */
  async mux(videoPath: string, audioPath: string, out: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
    const video = await this.input(videoPath);
    const audio = await this.input(audioPath);
    await this.requireVideo(videoPath);
    await this.requireAudio(audioPath);
    const output = await this.output(out);
    const ext = extensionOf(output);
    const audioCodec = ext === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k'];
    await this.ffmpeg(
      [
        '-i', video, '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', ...audioCodec,
        '-shortest',
        ...(ext === 'mp4' || ext === 'mov' || ext === 'm4v' ? ['-movflags', '+faststart'] : []),
        output,
      ],
      { ...(opts.signal ? { signal: opts.signal } : {}), stdout: 'ignore' },
    );
    return output;
  }

  /**
   * Bewegungsenergie je Frame: mittlere absolute Differenz aufeinanderfolgender Graustufenbilder
   * (auf 64×64 verkleinert) im normierten Ausschnitt `roi`; Werte 0..1, erster Wert 0.
   */
  async motionEnergy(videoSrc: string, opts: { roi?: Roi; rateHz?: number; signal?: AbortSignal } = {}): Promise<{ values: Float32Array; rateHz: number }> {
    const input = await this.input(videoSrc);
    const info = await this.requireVideo(videoSrc);
    if (info.isStillImage) throw new MediaError('invalid_input', `"${basename(videoSrc)}" ist ein Standbild.`);
    const rate = Math.max(1, Math.min(120, opts.rateHz ?? info.fps ?? 25));
    const crop = opts.roi ? cropFilter(opts.roi, info) : undefined;
    const vf = [`fps=${num(rate)}`, ...(crop ? [crop] : []), `scale=${MOTION_SIZE}:${MOTION_SIZE}:flags=area`, 'format=gray'].join(',');
    const frameBytes = MOTION_SIZE * MOTION_SIZE;
    const values = new GrowableFloat32(1024);
    let prev: Uint8Array | undefined;
    let rest = Buffer.alloc(0);
    const onChunk = (chunk: Buffer) => {
      let data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      while (data.length >= frameBytes) {
        const frame = new Uint8Array(data.subarray(0, frameBytes));
        if (prev) {
          let sum = 0;
          for (let i = 0; i < frameBytes; i++) sum += Math.abs(frame[i]! - prev[i]!);
          values.push(sum / frameBytes / 255);
        } else {
          values.push(0);
        }
        prev = frame;
        data = data.subarray(frameBytes);
      }
      rest = Buffer.from(data);
    };
    await this.ffmpeg(['-i', input, '-map', '0:v:0', '-an', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], {
      stdout: onChunk,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { values: values.toArray(), rateHz: rate };
  }

  // ───────────────────────── Audio-Analyse ─────────────────────────

  /** Min/Max-Paare (−1..1) für Wellenformen; `points` Paare (Standard 2000). */
  async peaks(src: string, opts: { points?: number; signal?: AbortSignal } = {}): Promise<{ peaks: number[]; durationMs: number }> {
    const input = await this.input(src);
    const info = await this.requireAudio(src);
    const points = Math.max(1, Math.round(opts.points ?? 2000));
    const channels = Math.min(2, Math.max(1, info.channels ?? 1));
    const estFrames = ((info.audioDurationMs ?? info.durationMs) / 1000) * PEAKS_SAMPLE_RATE;
    const blockFrames = Math.max(1, Math.min(65536, Math.floor(estFrames / (points * 8))));
    const acc = new PeakAccumulator(channels, blockFrames);
    const decoder = new Float32StreamDecoder(4 * channels);
    await this.ffmpeg(
      ['-i', input, '-map', '0:a:0', '-vn', '-ac', String(channels), '-ar', String(PEAKS_SAMPLE_RATE), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'],
      { stdout: (chunk) => acc.push(decoder.push(chunk)), ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    return { peaks: acc.finish(points), durationMs: Math.round((acc.frames / PEAKS_SAMPLE_RATE) * 1000) };
  }

  /** Lautheit nach EBU R128: integriert (LUFS), True Peak (dBTP), Lautheitsumfang (LU). Stille: −70 LUFS / −144 dBTP. */
  async loudness(src: string, opts: { signal?: AbortSignal } = {}): Promise<{ integratedLufs: number; truePeakDb: number; lra: number }> {
    const input = await this.input(src);
    await this.requireAudio(src);
    const { stderr } = await this.ffmpeg(
      ['-nostats', '-i', input, '-map', '0:a:0', '-vn', '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'],
      { stdout: 'ignore', ...(opts.signal ? { signal: opts.signal } : {}) },
      'info',
    );
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
    const integrated = parseDbValue(/I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
    const lra = parseDbValue(/LRA:\s+(-?[\d.]+|-inf)\s+LU/.exec(summary)?.[1]);
    const peak = parseDbValue(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
    if (integrated === undefined || peak === undefined || lra === undefined || !summary.startsWith('Summary:')) {
      throw new MediaError('parse_failed', `Lautheitsmessung für "${basename(src)}" ließ sich nicht auswerten.`, { stderrTail: stderr.slice(-1500) });
    }
    return {
      integratedLufs: Math.max(-70, integrated),
      truePeakDb: Math.max(-144, peak),
      lra: Math.max(0, lra),
    };
  }

  /** Dekodiert die erste Audiospur zu Float32-PCM (Standard 22 050 Hz, mono; sonst interleaved). */
  async decodePcm(
    src: string,
    opts: { sampleRate?: number; mono?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ samples: Float32Array; sampleRate: number; channels: number }> {
    const input = await this.input(src);
    const info = await this.requireAudio(src);
    const sampleRate = Math.round(opts.sampleRate ?? 22_050);
    const channels = opts.mono === false ? Math.max(1, info.channels ?? 2) : 1;
    const out = new GrowableFloat32(Math.max(1024, Math.ceil(((info.audioDurationMs ?? info.durationMs) / 1000) * sampleRate * channels) + 4096));
    const decoder = new Float32StreamDecoder(4 * channels);
    await this.ffmpeg(
      ['-i', input, '-map', '0:a:0', '-vn', '-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'],
      { stdout: (chunk) => out.pushAll(decoder.push(chunk)), ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    return { samples: out.toArray(), sampleRate, channels };
  }

  /** RMS-Hüllkurve (mono) mit `rateHz` Werten pro Sekunde (Standard 100). */
  async envelope(src: string, opts: { rateHz?: number; signal?: AbortSignal } = {}): Promise<{ values: Float32Array; rateHz: number }> {
    return this.envelopeInternal(src, opts.rateHz ?? 100, false, opts.signal);
  }

  /** Tempo, Beats, Downbeats und Onsets (lokal in JS, siehe `detectBeatsFromPcm`). */
  async detectBeats(src: string, opts: { signal?: AbortSignal } = {}): Promise<BeatAnalysis> {
    const { samples, sampleRate } = await this.decodePcm(src, { sampleRate: BEATS_SAMPLE_RATE, mono: true, ...(opts.signal ? { signal: opts.signal } : {}) });
    return detectBeatsFromPcm(samples, sampleRate);
  }

  /**
   * A/V-Sync-Prüfung gegen eine Referenzaudiodatei.
   * Mit Tonspur im Video: Kreuzkorrelation der Audio-Hüllkurven (200 Hz).
   * Ohne Tonspur: Bewegungsenergie (ROI, z. B. Mundbereich) gegen Stimm-Hüllkurve, ~1 Frame Auflösung.
   */
  async checkAvSync(opts: {
    videoPath: string;
    referenceAudioPath: string;
    roi?: Roi;
    maxLagMs?: number;
    signal?: AbortSignal;
  }): Promise<AvSyncResult> {
    const maxLagMs = opts.maxLagMs ?? 1000;
    const video = await this.probe(opts.videoPath);
    await this.requireAudio(opts.referenceAudioPath);
    const signal = opts.signal;

    let audioResult: AvSyncResult | undefined;
    if (video.hasAudio) {
      const [ref, test] = await Promise.all([
        this.envelopeInternal(opts.referenceAudioPath, SYNC_RATE_HZ, true, signal),
        this.envelopeInternal(opts.videoPath, SYNC_RATE_HZ, true, signal),
      ]);
      const est = estimateOffset(syncFeature(ref.values, SYNC_RATE_HZ), syncFeature(test.values, SYNC_RATE_HZ), SYNC_RATE_HZ, maxLagMs);
      audioResult = {
        offsetMs: est.offsetMs,
        confidence: est.confidence,
        method: 'audio',
        note: `Audio↔Audio-Kreuzkorrelation der Hüllkurven (${SYNC_RATE_HZ} Hz): ${describeOffset(est.offsetMs)}, Korrelation ${est.correlation.toFixed(2)}.`,
      };
      // Eindeutiges Ergebnis oder kein Bild zum Gegenprüfen → fertig.
      if (est.confidence >= 0.2 || !video.hasVideo || video.isStillImage) return audioResult;
    }
    if (!video.hasVideo || video.isStillImage) {
      throw new MediaError('invalid_input', `"${basename(opts.videoPath)}" hat weder Tonspur noch Bewegtbild für eine Sync-Prüfung.`);
    }

    const rate = Math.max(10, Math.min(60, Math.round(video.fps ?? 25)));
    const [motion, ref] = await Promise.all([
      this.motionEnergy(opts.videoPath, { ...(opts.roi ? { roi: opts.roi } : {}), rateHz: rate, ...(signal ? { signal } : {}) }),
      this.envelopeInternal(opts.referenceAudioPath, rate, true, signal),
    ]);
    const level = syncFeature(ref.values, rate);
    // Bewegung entsteht sowohl während der Stimme (Pegel) als auch bei Pegelwechseln (Änderungsrate).
    const candidates = [estimateOffset(level, motion.values, rate, maxLagMs), estimateOffset(absDiff(level), motion.values, rate, maxLagMs)];
    const best = candidates[0]!.confidence >= candidates[1]!.confidence ? candidates[0]! : candidates[1]!;
    const motionResult: AvSyncResult = {
      offsetMs: best.offsetMs,
      confidence: best.confidence,
      method: 'motion',
      note: `Bewegungsenergie${opts.roi ? ' im Ausschnitt' : ''} ↔ Stimm-Hüllkurve (${rate} Hz): ${describeOffset(best.offsetMs)}, Korrelation ${best.correlation.toFixed(2)}; Auflösung ≈ 1 Frame.`,
    };
    if (audioResult && audioResult.confidence >= motionResult.confidence) return audioResult;
    return audioResult ? { ...motionResult, note: `${motionResult.note} (Audio-Vergleich war uneindeutig.)` } : motionResult;
  }

  // ───────────────────────── Audio-Bearbeitung ─────────────────────────

  /**
   * Schneidet [fromSec, toSec] (plus Handles links/rechts) aus der ersten Audiospur.
   * Liefert den tatsächlichen, auf die Dauer begrenzten Bereich inklusive Handles.
   */
  async cutAudio(
    src: string,
    out: string,
    opts: { fromSec: number; toSec: number; handlesSec?: number; sampleRate?: number; signal?: AbortSignal },
  ): Promise<{ path: string; fromSec: number; toSec: number }> {
    const input = await this.input(src);
    const info = await this.requireAudio(src);
    if (!Number.isFinite(opts.fromSec) || !Number.isFinite(opts.toSec)) throw new MediaError('invalid_input', 'Schnittbereich ist ungültig.');
    const dur = (info.audioDurationMs ?? info.durationMs) / 1000;
    const handles = Math.max(0, opts.handlesSec ?? 0);
    const from = clampNum(opts.fromSec, 0, dur);
    const to = clampNum(opts.toSec, 0, dur);
    if (!(to > from)) {
      throw new MediaError('invalid_input', `Schnittbereich ${opts.fromSec}–${opts.toSec} s liegt außerhalb der Datei (Dauer ${dur.toFixed(3)} s) oder ist leer.`);
    }
    const a = round6(Math.max(0, from - handles));
    const b = round6(Math.min(dur, to + handles));
    const output = await this.output(out);
    await this.ffmpeg(
      [
        '-ss', formatFfmpegTime(a), '-t', formatFfmpegTime(b - a), '-i', input,
        '-map', '0:a:0', '-vn',
        ...(opts.sampleRate ? ['-ar', String(Math.round(opts.sampleRate))] : []),
        ...this.audioArgs(output),
        output,
      ],
      { stdout: 'ignore', ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    return { path: output, fromSec: a, toSec: b };
  }

  /**
   * Zwei-Pass-Lautheitsnormalisierung mit `loudnorm` (linear, wenn möglich).
   * Standard: −14 LUFS integriert, −1 dBTP (Podcast: −16 LUFS).
   */
  async normalizeLoudness(
    src: string,
    out: string,
    opts: { targetLufs?: number; truePeakDb?: number; signal?: AbortSignal } = {},
  ): Promise<string> {
    const input = await this.input(src);
    const info = await this.requireAudio(src);
    const target = opts.targetLufs ?? -14;
    const tp = opts.truePeakDb ?? -1;
    if (!(target >= -70 && target <= -5)) throw new MediaError('invalid_input', `Ziel-Lautheit ${target} LUFS liegt außerhalb von −70…−5.`);
    if (!(tp >= -9 && tp <= 0)) throw new MediaError('invalid_input', `True Peak ${tp} dBTP liegt außerhalb von −9…0.`);
    const runOpts: RunOptions = { stdout: 'ignore', ...(opts.signal ? { signal: opts.signal } : {}) };

    const pass1 = await this.ffmpeg(
      ['-nostats', '-i', input, '-map', '0:a:0', '-vn', '-af', `loudnorm=I=${num(target)}:TP=${num(tp)}:LRA=11:print_format=json`, '-f', 'null', '-'],
      runOpts,
      'info',
    );
    const m = parseLoudnormJson(pass1.stderr);
    if (!m) throw new MediaError('parse_failed', `loudnorm-Messung für "${basename(src)}" ließ sich nicht auswerten.`, { stderrTail: pass1.stderr.slice(-1500) });
    if (!Number.isFinite(m.input_i) || m.input_i <= -70) {
      throw new MediaError('invalid_input', `"${basename(src)}" ist (nahezu) stumm – keine Normalisierung möglich.`);
    }
    // Großzügiges LRA-Ziel, damit loudnorm im linearen Modus bleibt (keine Dynamikänderung).
    const lra = Math.min(50, Math.max(11, Math.ceil(m.input_lra + 1)));
    const filter = [
      `loudnorm=I=${num(target)}`,
      `TP=${num(tp)}`,
      `LRA=${lra}`,
      `measured_I=${num(m.input_i, 2)}`,
      `measured_TP=${num(m.input_tp, 2)}`,
      `measured_LRA=${num(m.input_lra, 2)}`,
      `measured_thresh=${num(m.input_thresh, 2)}`,
      `offset=${num(m.target_offset, 2)}`,
      'linear=true',
      'print_format=summary',
    ].join(':');
    const output = await this.output(out);
    const sr = info.sampleRate && info.sampleRate >= 8000 ? info.sampleRate : 48000;
    await this.ffmpeg(['-i', input, '-map', '0:a:0', '-vn', '-af', filter, '-ar', String(sr), ...this.audioArgs(output), output], runOpts);
    return output;
  }

  /**
   * Rendert den Audiomix einer Timeline (WAV/AAC/… nach Endung): Audiospuren plus Originalton von
   * Videoclips mit `includeSourceAudio`. Assets ohne Tonspur werden übersprungen (Warnung);
   * fehlende Dateien führen zu einem Fehler.
   */
  async renderAudioMix(
    timeline: Timeline,
    resolveAssetPath: (assetId: string) => string | undefined,
    out: string,
    opts: {
      sampleRate?: number;
      signal?: AbortSignal;
      fromFrame?: number;
      toFrame?: number;
      ducking?: AudioMixOptions['ducking'];
      onProgress?: (ratio: number) => void;
      onWarning?: (message: string) => void;
    } = {},
  ): Promise<string> {
    // Pfade der Clips im Renderbereich auflösen und prüfen (Existenz, Tonspur).
    const endFrame = timeline.durationFrames > 0 ? timeline.durationFrames : Number.POSITIVE_INFINITY;
    const rangeFrom = opts.fromFrame ?? 0;
    const rangeTo = Math.min(opts.toFrame ?? endFrame, endFrame);
    const resolved = new Map<string, string | undefined>();
    for (const track of timeline.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (!clipContributesAudio(track, clip)) continue;
        if (clip.start >= rangeTo || clip.start + clip.duration <= rangeFrom) continue;
        if (clip.assetId && !resolved.has(clip.assetId)) {
          const p = resolveAssetPath(clip.assetId);
          resolved.set(clip.assetId, p ? absPath(p) : undefined);
        }
      }
    }
    const paths = [...new Set([...resolved.values()].filter((p): p is string => !!p))];
    const silentPaths = new Set<string>();
    await Promise.all(
      paths.map(async (p) => {
        const info = await this.probe(p);
        if (!info.hasAudio) silentPaths.add(p);
      }),
    );
    const sampleRate = Math.round(opts.sampleRate ?? 48000);
    const graph = buildAudioMixGraph(timeline, (id) => resolved.get(id), {
      sampleRate,
      silentPaths,
      ...(opts.fromFrame !== undefined ? { fromFrame: opts.fromFrame } : {}),
      ...(opts.toFrame !== undefined ? { toFrame: opts.toFrame } : {}),
      ...(opts.ducking ? { ducking: opts.ducking } : {}),
    });
    for (const w of graph.warnings) opts.onWarning?.(w);
    if (graph.totalSamples <= 0) throw new MediaError('invalid_input', 'Der zu rendernde Bereich ist leer (Dauer 0).');

    const output = await this.output(out);
    const args: string[] = [];
    for (const input of graph.inputs) {
      args.push('-ss', formatFfmpegTime(input.seekSec), '-t', formatFfmpegTime(input.durationSec), '-i', input.path);
    }
    const { filterArgs, cleanup } = await this.filterComplexArgs(graph.filterComplex);
    try {
      await this.ffmpeg(
        [...args, ...filterArgs, '-map', `[${graph.outputLabel}]`, '-ar', String(sampleRate), ...this.audioArgs(output), output],
        progressOptions(opts.signal, opts.onProgress, graph.durationSec),
      );
    } finally {
      await cleanup();
    }
    if (!(await nonEmpty(output))) throw new MediaError('process_failed', 'ffmpeg hat keinen Audiomix erzeugt.');
    return output;
  }

  // ───────────────────────── intern ─────────────────────────

  private async ffmpeg(args: string[], opts: RunOptions = { stdout: 'ignore' }, logLevel: 'error' | 'info' = 'error') {
    return runProcess(this.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-loglevel', logLevel, ...args], { stdout: 'ignore', ...opts });
  }

  private async input(path: string): Promise<string> {
    if (isUrl(path)) return path;
    const abs = absPath(path);
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new MediaError('invalid_input', `"${path}" ist keine Datei.`);
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError('invalid_input', `Datei nicht gefunden: "${path}".`, { cause: error });
    }
    return abs;
  }

  private async output(path: string): Promise<string> {
    const abs = absPath(path);
    await mkdir(dirname(abs), { recursive: true });
    return abs;
  }

  private async requireVideo(path: string): Promise<MediaInfo> {
    const info = await this.probe(path);
    if (!info.hasVideo) throw new MediaError('no_video', `"${basename(path)}" hat keine Videospur.`);
    return info;
  }

  private async requireAudio(path: string): Promise<MediaInfo> {
    const info = await this.probe(path);
    if (!info.hasAudio) throw new MediaError('no_audio', `"${basename(path)}" hat keine Audiospur.`);
    return info;
  }

  private imageArgs(out: string): string[] {
    try {
      return imageCodecArgs(out);
    } catch (error) {
      throw new MediaError('invalid_input', (error as Error).message);
    }
  }

  private audioArgs(out: string): string[] {
    try {
      return [...audioCodecArgs(out), ...audioContainerArgs(out)];
    } catch (error) {
      throw new MediaError('invalid_input', (error as Error).message);
    }
  }

  /** Mehrere Einzelbilder in einem Prozess: je Zeitpunkt ein Eingang mit genauer Suche und eine Ausgabe. */
  private multiFrameArgs(input: string, times: number[], outs: string[], vf: string[]): string[] {
    const args: string[] = [];
    times.forEach((t) => args.push(...(t > 0 ? ['-ss', formatFfmpegTime(t)] : []), '-i', input));
    outs.forEach((out, k) => args.push('-map', `${k}:v:0`, '-frames:v', '1', ...vf, '-update', '1', out));
    return args;
  }

  /** Bester verfügbarer H.264-Encoder (libx264, sonst Betriebssystem-Encoder). */
  private async h264Encoder(): Promise<string[]> {
    const caps = await this.capabilities().catch(() => undefined);
    const has = (name: string) => !caps || caps.encoders.has(name);
    if (has('libx264')) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
    if (caps?.encoders.has('h264_videotoolbox')) return ['-c:v', 'h264_videotoolbox', '-b:v', '2500k', '-pix_fmt', 'yuv420p'];
    if (caps?.encoders.has('h264_mf')) return ['-c:v', 'h264_mf', '-b:v', '2500k', '-pix_fmt', 'nv12'];
    if (caps?.encoders.has('libopenh264')) return ['-c:v', 'libopenh264', '-b:v', '2500k', '-pix_fmt', 'yuv420p'];
    throw new MediaError('binary_missing', 'ffmpeg enthält keinen H.264-Encoder (libx264, VideoToolbox, Media Foundation oder OpenH264).');
  }

  /** Lange Filtergraphen über eine Datei übergeben (Kommandozeilenlänge unter Windows). */
  private async filterComplexArgs(graph: string): Promise<{ filterArgs: string[]; cleanup: () => Promise<void> }> {
    if (graph.length <= MAX_INLINE_FILTER_CHARS) return { filterArgs: ['-filter_complex', graph], cleanup: async () => {} };
    const dir = await mkdtemp(join(tmpdir(), 'studio-media-'));
    const file = join(dir, 'graph.txt');
    await writeFile(file, graph, 'utf8');
    const caps = await this.capabilities().catch(() => undefined);
    // Ab ffmpeg 7.1 ersetzt `-/filter_complex <datei>` das veraltete `-filter_complex_script`.
    const modern = !caps?.major || caps.major > 7 || (caps.major === 7 && (caps.minor ?? 0) >= 1);
    return {
      filterArgs: modern ? ['-/filter_complex', file] : ['-filter_complex_script', file],
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }

  private async envelopeInternal(src: string, rateHz: number, alignStart: boolean, signal?: AbortSignal): Promise<{ values: Float32Array; rateHz: number }> {
    if (!(rateHz > 0 && rateHz <= 4000)) throw new MediaError('invalid_input', `Ungültige Hüllkurvenrate: ${rateHz} Hz`);
    const input = await this.input(src);
    await this.requireAudio(src);
    const sr = rateHz <= 1000 ? 16_000 : Math.round(rateHz * 16);
    const acc = new RmsEnvelopeAccumulator(sr, rateHz);
    const decoder = new Float32StreamDecoder(4);
    // Für Sync-Prüfungen: Startversatz der Spur (start_time > 0) mit Stille auffüllen.
    const resample = alignStart ? ['-af', `aresample=${sr}:async=1:min_hard_comp=0.01:first_pts=0`] : ['-ar', String(sr)];
    await this.ffmpeg(['-i', input, '-map', '0:a:0', '-vn', '-ac', '1', ...resample, '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], {
      stdout: (chunk) => acc.push(decoder.push(chunk)),
      ...(signal ? { signal } : {}),
    });
    return { values: acc.finish(), rateHz };
  }

  private resolveFont(): string | undefined {
    if (this.fontFile && existsSync(this.fontFile)) return toForwardSlashes(this.fontFile);
    const candidates =
      process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf']
        : process.platform === 'win32'
          ? ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf']
          : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'];
    const found = candidates.find((c) => existsSync(c));
    return found ? toForwardSlashes(found) : undefined;
  }
}

/** Toolkit mit Pfaden aus `FFMPEG_PATH` / `FFPROBE_PATH` (Desktop-App setzt sie auf die mitgelieferten Binaries). */
export function defaultMediaToolkit(env: Record<string, string | undefined> = process.env): MediaToolkit {
  return new MediaToolkit({
    ...(env.FFMPEG_PATH ? { ffmpegPath: env.FFMPEG_PATH } : {}),
    ...(env.FFPROBE_PATH ? { ffprobePath: env.FFPROBE_PATH } : {}),
    ...(env.STUDIO_FONT_FILE ? { fontFile: env.STUDIO_FONT_FILE } : {}),
  });
}

// ───────────────────────── Hilfsfunktionen ─────────────────────────

function siblingProbe(ffmpegPath: string): string | undefined {
  if (!/[\\/]/.test(ffmpegPath)) return undefined;
  const ext = extname(ffmpegPath).toLowerCase() === '.exe' ? '.exe' : '';
  const candidate = join(dirname(ffmpegPath), `ffprobe${ext}`);
  return existsSync(candidate) ? candidate : undefined;
}

function parseListing(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    // Filter: " T.C drawtext  V->V  …", Encoder: " V....D libx264  …"
    const m = /^\s*[A-Z.|]{3,6}\s+(\S+)\s/.exec(line);
    if (m && m[1] !== '=') out.add(m[1]!);
  }
  return out;
}

function isUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]+:\/\//i.test(path);
}

function absPath(path: string): string {
  return isUrl(path) ? path : resolve(path);
}

function toForwardSlashes(path: string): string {
  return process.platform === 'win32' ? path.replace(/\\/g, '/') : path;
}

async function nonEmpty(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

function videoSeconds(info: MediaInfo): number {
  return (info.videoDurationMs ?? info.durationMs) / 1000;
}

/** Suchposition auf [0, Dauer − 1 Frame] begrenzen. */
function clampSeek(t: number, info: MediaInfo): number {
  if (!Number.isFinite(t)) return 0;
  const frame = 1 / (info.fps && info.fps > 0 ? info.fps : 25);
  const max = Math.max(0, videoSeconds(info) - frame);
  return round6(clampNum(t, 0, max));
}

/** `count` Zeitpunkte in der Mitte gleich langer Abschnitte. */
function evenlySpacedTimes(info: MediaInfo, count: number): number[] {
  if (info.isStillImage) return new Array<number>(count).fill(0);
  const dur = videoSeconds(info);
  return Array.from({ length: count }, (_, i) => clampSeek(((i + 0.5) * dur) / count, info));
}

function aspect(info: MediaInfo): number {
  return info.width && info.height ? info.width / info.height : 16 / 9;
}

function evenPositive(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2);
}

function evenFloor(v: number): number {
  return Math.max(2, Math.floor(v / 2) * 2);
}

function cropFilter(roi: Roi, info: MediaInfo): string {
  const vals = [roi.x, roi.y, roi.width, roi.height];
  if (vals.some((v) => !Number.isFinite(v)) || roi.x < 0 || roi.y < 0 || roi.width <= 0 || roi.height <= 0 || roi.x + roi.width > 1.0001 || roi.y + roi.height > 1.0001) {
    throw new MediaError('invalid_input', 'ROI muss normiert sein (0..1) und im Bild liegen.');
  }
  const W = info.width ?? 0;
  const H = info.height ?? 0;
  if (!W || !H) return `crop=iw*${num(roi.width)}:ih*${num(roi.height)}:iw*${num(roi.x)}:ih*${num(roi.y)}`;
  const w = Math.max(2, Math.min(W, Math.round(W * roi.width)));
  const h = Math.max(2, Math.min(H, Math.round(H * roi.height)));
  const x = Math.min(W - w, Math.round(W * roi.x));
  const y = Math.min(H - h, Math.round(H * roi.y));
  return `crop=${w}:${h}:${x}:${y}`;
}

function signalOptions(signal: AbortSignal | undefined): RunOptions {
  return { stdout: 'ignore', ...(signal ? { signal } : {}) };
}

function progressOptions(signal: AbortSignal | undefined, onProgress: ((r: number) => void) | undefined, durationSec: number): RunOptions {
  return {
    stdout: 'ignore',
    ...(signal ? { signal } : {}),
    ...(onProgress && durationSec > 0 ? { progress: { durationSec, onProgress } } : {}),
  };
}

function parseDbValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value === '-inf') return Number.NEGATIVE_INFINITY;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

interface LoudnormMeasurement {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** Letzten JSON-Block der loudnorm-Ausgabe lesen (`-inf` → −∞). */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | undefined {
  const end = stderr.lastIndexOf('}');
  const start = stderr.lastIndexOf('{', end);
  if (start < 0 || end < 0) return undefined;
  let raw: Record<string, string>;
  try {
    raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  } catch {
    return undefined;
  }
  const f = (k: string) => {
    const v = raw[k];
    if (v === undefined) return Number.NaN;
    if (/^-inf/.test(v)) return Number.NEGATIVE_INFINITY;
    if (/^\+?inf/.test(v)) return Number.POSITIVE_INFINITY;
    return Number(v);
  };
  const m: LoudnormMeasurement = {
    input_i: f('input_i'),
    input_tp: f('input_tp'),
    input_lra: f('input_lra'),
    input_thresh: f('input_thresh'),
    target_offset: f('target_offset'),
  };
  return Number.isNaN(m.input_i) ? undefined : m;
}

function describeOffset(ms: number): string {
  if (Math.abs(ms) < 0.5) return 'kein messbarer Versatz';
  return ms > 0 ? `Video ${Math.abs(ms).toFixed(1)} ms später als Referenz` : `Video ${Math.abs(ms).toFixed(1)} ms früher als Referenz`;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
