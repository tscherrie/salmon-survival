import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { timelineSchema, type Timeline, type TimelineInput } from '@studio/core';
import { encodePng } from '../src/node/png.ts';

/** Chromium-Pfade dieses Containers – NUR für Tests als Standard (App: STUDIO_CHROMIUM_PATH/Option). */
export const TEST_HEADLESS_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
export const TEST_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function testChromiumPath(): string | undefined {
  if (process.env.STUDIO_CHROMIUM_PATH) return process.env.STUDIO_CHROMIUM_PATH;
  return existsSync(TEST_HEADLESS_SHELL) ? TEST_HEADLESS_SHELL : undefined;
}

export const HAS_CHROMIUM = testChromiumPath() !== undefined;

export async function tmpDir(prefix = 'studio-render-test-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function timeline(input: Partial<TimelineInput> & Pick<TimelineInput, 'tracks'>): Timeline {
  return timelineSchema.parse({ kind: 'timeline', fps: 30, width: 1920, height: 1080, durationFrames: 90, formats: [{ id: '16:9', width: 1920, height: 1080 }], ...input });
}

/** Minimaler PNG-Dekoder für Tests (8 Bit, RGB/RGBA, ohne Interlacing). */
export function decodePng(buf: Buffer): { width: number; height: number; pixel: (x: number, y: number) => [number, number, number, number] } {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('Nur 8 Bit, ohne Interlacing');
      colorType = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`Farbtyp ${colorType} nicht unterstützt`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const i = y * stride + x * bpp;
      return [out[i]!, out[i + 1]!, out[i + 2]!, bpp === 4 ? out[i + 3]! : 255];
    },
  };
}

/** Einfarbiges PNG (für Asset-Tests). */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

/** Anzahl der Seiten eines (unverschlüsselten) PDFs. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}
