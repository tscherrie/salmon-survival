import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** Testmedien per ffmpeg (lavfi) erzeugen. */
export async function ff(args: string[]): Promise<void> {
  await execFileAsync(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
}

export async function ffprobeLines(args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync(FFPROBE, ['-v', 'error', ...args]);
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Temporäres Verzeichnis (mit Leerzeichen im Namen, um Pfad-Quoting zu prüfen). */
export async function makeTmpDir(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), `studio-media-${prefix}-`));
  const dir = join(base, 'Mein Ordner');
  return { dir, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** Gate-Ausdruck für „sprachähnliche“ Bursts (unregelmäßig, nicht periodisch); `t` wird ersetzt. */
export function burstGate(timeExpr = 't'): string {
  const t = timeExpr;
  return `gt(sin(2*PI*0.7*${t})+sin(2*PI*1.9*${t}+1)+0.6*sin(2*PI*3.3*${t}+2)\\,0.7)`;
}

/** Klick-Spur: Klicks bei `offset + k·60/bpm`, jeder 4. (ab `accentIndex`) lauter und höher. */
export function clickTrackPcm(opts: { bpm: number; durationSec: number; sampleRate: number; offsetSec?: number; accentIndex?: number; noise?: number }): Float32Array {
  const { bpm, durationSec, sampleRate } = opts;
  const offset = opts.offsetSec ?? 0.25;
  const accentIndex = opts.accentIndex ?? 0;
  const out = new Float32Array(Math.round(durationSec * sampleRate));
  const period = 60 / bpm;
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let k = 0, t = offset; t < durationSec; k++, t = offset + k * period) {
    const accent = k % 4 === accentIndex % 4;
    const amp = accent ? 0.9 : 0.35;
    const freq = accent ? 2000 : 1200;
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < 0.04 * sampleRate && start + i < out.length; i++) {
      out[start + i]! += amp * Math.sin((2 * Math.PI * freq * i) / sampleRate) * Math.exp(-i / (0.006 * sampleRate));
    }
  }
  if (opts.noise) for (let i = 0; i < out.length; i++) out[i]! += opts.noise * (rand() * 2 - 1);
  return out;
}

/** Schlagzeug-Pattern: Bassdrum auf 1 und 3, Snare auf 2 und 4, Hi-Hat in Achteln, dazu Bass und Rauschen. */
export function drumPatternPcm(opts: { bpm: number; durationSec: number; sampleRate: number; offsetSec?: number }): Float32Array {
  const { bpm, durationSec, sampleRate: sr } = opts;
  const offset = opts.offsetSec ?? 0.1;
  const out = new Float32Array(Math.round(durationSec * sr));
  const rand = seededRandom(42);
  const beat = 60 / bpm;
  const hit = (t: number, kind: 'kick' | 'snare' | 'hat', amp: number) => {
    const start = Math.round(t * sr);
    const len = Math.round((kind === 'kick' ? 0.3 : kind === 'snare' ? 0.2 : 0.05) * sr);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const tt = i / sr;
      let v: number;
      if (kind === 'kick') v = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt / 0.03)) * tt) * Math.exp(-tt / 0.12);
      else if (kind === 'snare') v = ((rand() * 2 - 1) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt / 0.06);
      else v = (rand() * 2 - 1) * Math.exp(-tt / 0.01);
      out[start + i]! += amp * v;
    }
  };
  for (let k = 0, t = offset; t < durationSec; k++, t = offset + k * beat) {
    hit(t, k % 2 === 0 ? 'kick' : 'snare', k % 2 === 0 ? 0.8 : 0.5);
    hit(t, 'hat', 0.15);
    hit(t + beat / 2, 'hat', 0.1);
  }
  for (let i = 0; i < out.length; i++) out[i]! += 0.05 * Math.sin((2 * Math.PI * 55 * i) / sr) + 0.01 * (rand() * 2 - 1);
  return out;
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return values.length ? s / values.length : 0;
}

/** Deterministischer Pseudo-Zufall (für reproduzierbare DSP-Tests). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}
