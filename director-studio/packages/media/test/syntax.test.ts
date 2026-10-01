import { describe, expect, it } from 'vitest';
import {
  MediaError,
  MediaToolkit,
  audioCodecArgs,
  defaultMediaToolkit,
  describeCommand,
  escapeFilterGraph,
  escapeFilterOptionValue,
  filterValue,
  formatFfmpegTime,
  parseLoudnormJson,
  parseProbeJson,
  parseRate,
} from '../src/index.ts';
import { runProcess } from '../src/process.ts';

describe('formatFfmpegTime', () => {
  it('formatiert mit mindestens Millisekunden', () => {
    expect(formatFfmpegTime(0)).toBe('00:00:00.000');
    expect(formatFfmpegTime(1.5)).toBe('00:00:01.500');
    expect(formatFfmpegTime(61.25)).toBe('00:01:01.250');
    expect(formatFfmpegTime(3661)).toBe('01:01:01.000');
  });

  it('behält Mikrosekunden und rundet sauber über Grenzen', () => {
    expect(formatFfmpegTime(3661.000021)).toBe('01:01:01.000021');
    expect(formatFfmpegTime(1 / 48000)).toBe('00:00:00.000021');
    expect(formatFfmpegTime(59.9999999)).toBe('00:01:00.000');
    expect(formatFfmpegTime(100 * 3600)).toBe('100:00:00.000');
  });

  it('unterstützt negative Werte und lehnt NaN ab', () => {
    expect(formatFfmpegTime(-1.25)).toBe('-00:00:01.250');
    expect(() => formatFfmpegTime(Number.NaN)).toThrow();
    expect(() => formatFfmpegTime(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('Filtergraph-Escaping', () => {
  it('escapt Optionswerte und Graph-Sonderzeichen in zwei Ebenen', () => {
    expect(escapeFilterOptionValue("a:b'c\\d")).toBe("a\\:b\\'c\\\\d");
    expect(escapeFilterGraph('a,b[c];d')).toBe('a\\,b\\[c\\]\\;d');
    // Zeitstempel für drawtext: ":" auf Ebene 1, dann "\" auf Ebene 2.
    expect(filterValue('00:12.500')).toBe('00\\\\:12.500');
  });

  it('escapt Windows-Pfade mit Laufwerksbuchstaben', () => {
    expect(filterValue('C:/Windows/Fonts/arial.ttf')).toBe('C\\\\:/Windows/Fonts/arial.ttf');
    expect(filterValue('C:\\Fonts\\a b.ttf')).toBe('C\\\\:\\\\\\\\Fonts\\\\\\\\a b.ttf');
  });
});

describe('Codec-Wahl', () => {
  it('wählt Audio-Codecs nach Endung', () => {
    expect(audioCodecArgs('x.wav')).toEqual(['-c:a', 'pcm_s16le']);
    expect(audioCodecArgs('X.M4A')).toContain('aac');
    expect(audioCodecArgs('x.mp3')).toContain('libmp3lame');
    expect(audioCodecArgs('x.flac')).toContain('flac');
    expect(() => audioCodecArgs('x.xyz')).toThrow(/Nicht unterstütztes Audioformat/);
  });
});

describe('parseProbeJson', () => {
  it('liest Video+Audio, Bildrate und Bitrate', () => {
    const info = parseProbeJson({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', duration: '4.004' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: '4.010' },
      ],
      format: { duration: '4.010', bit_rate: '5000000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    expect(info).toMatchObject({
      durationMs: 4010,
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      fps: 29.97,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitRate: 5000000,
      videoDurationMs: 4004,
    });
    expect(info.rotation).toBeUndefined();
  });

  it('berücksichtigt Rotation (Display-Matrix und altes rotate-Tag)', () => {
    const matrix = parseProbeJson({
      streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }],
      format: { duration: '1' },
    });
    expect(matrix).toMatchObject({ rotation: 90, width: 1080, height: 1920 });
    const tag = parseProbeJson({ streams: [{ codec_type: 'video', width: 640, height: 480, tags: { rotate: '180' } }], format: { duration: '1' } });
    expect(tag).toMatchObject({ rotation: 180, width: 640, height: 480 });
  });

  it('ignoriert Cover-Bilder und erkennt Standbilder', () => {
    const mp3 = parseProbeJson({
      streams: [
        { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
        { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
      format: { duration: '180.5', format_name: 'mp3' },
    });
    expect(mp3).toMatchObject({ hasVideo: false, hasAudio: true, durationMs: 180500 });
    expect(mp3.width).toBeUndefined();
    const png = parseProbeJson({ streams: [{ codec_type: 'video', codec_name: 'png', width: 64, height: 48, avg_frame_rate: '25/1' }], format: { format_name: 'png_pipe' } });
    expect(png).toMatchObject({ isStillImage: true, durationMs: 0, width: 64, height: 48 });
    expect(png.fps).toBeUndefined();
  });

  it('verträgt fehlende Felder', () => {
    expect(parseProbeJson({})).toEqual({ durationMs: 0, hasVideo: false, hasAudio: false });
    expect(parseRate('0/0')).toBeUndefined();
    expect(parseRate('25')).toBe(25);
    expect(parseRate('90000/1')).toBeUndefined();
  });
});

describe('parseLoudnormJson', () => {
  it('liest den letzten JSON-Block inkl. -inf', () => {
    const stderr = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-23.54",\n\t"input_tp" : "-7.12",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-33.54",\n\t"output_i" : "-14.0",\n\t"target_offset" : "0.01"\n}\n`;
    expect(parseLoudnormJson(stderr)).toEqual({ input_i: -23.54, input_tp: -7.12, input_lra: 0, input_thresh: -33.54, target_offset: 0.01 });
    const silent = parseLoudnormJson('{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-70.00", "target_offset" : "inf" }');
    expect(silent?.input_i).toBe(Number.NEGATIVE_INFINITY);
    expect(parseLoudnormJson('kein json')).toBeUndefined();
  });
});

describe('Prozesse und Konfiguration', () => {
  it('beschreibt Kommandos mit Leerzeichen lesbar (nur Diagnose)', () => {
    expect(describeCommand('ffmpeg', ['-i', '/a b/c.mp4', '-vf', 'scale=1:2'])).toBe('ffmpeg -i "/a b/c.mp4" -vf scale=1:2');
  });

  it('meldet fehlende Programme als MediaError(binary_missing) mit deutscher Meldung', async () => {
    const tk = new MediaToolkit({ ffmpegPath: '/nicht/vorhanden/ffmpeg', ffprobePath: '/nicht/vorhanden/ffprobe' });
    await expect(tk.capabilities()).rejects.toMatchObject({ name: 'MediaError', code: 'binary_missing' });
    const error = await runProcess('/nicht/vorhanden/ffprobe', ['-version']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).message).toMatch(/FFPROBE_PATH/);
  });

  it('liest Pfade aus der Umgebung', () => {
    const tk = defaultMediaToolkit({ FFMPEG_PATH: '/opt/ff/ffmpeg', FFPROBE_PATH: '/opt/ff/ffprobe' });
    expect(tk.ffmpegPath).toBe('/opt/ff/ffmpeg');
    expect(tk.ffprobePath).toBe('/opt/ff/ffprobe');
    const explicit = new MediaToolkit({ ffmpegPath: 'C:\\Program Files\\Studio\\ffmpeg.exe', ffprobePath: 'C:\\Program Files\\Studio\\ffprobe.exe' });
    expect(explicit.ffprobePath).toBe('C:\\Program Files\\Studio\\ffprobe.exe');
  });

  it('bricht über AbortSignal ab', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    const late = new AbortController();
    const pending = runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { signal: late.signal });
    setTimeout(() => late.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('meldet Exit-Codes mit stderr-Ende', async () => {
    const error = (await runProcess(process.execPath, ['-e', 'console.error("kaputt: Zeile 1\\nZeile 2"); process.exit(3)']).catch((e: unknown) => e)) as MediaError;
    expect(error.code).toBe('process_failed');
    expect(error.exitCode).toBe(3);
    expect(error.stderrTail).toContain('Zeile 2');
    expect(error.message).toMatch(/fehlgeschlagen \(mit Exit-Code 3 beendet\)/);
  });
});
