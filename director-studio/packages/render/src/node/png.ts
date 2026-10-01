import { deflateSync } from 'node:zlib';
import { crc32 } from './crc32.ts';

/** Minimaler PNG-Kodierer/-Leser (Testbilder, Platzhalter, Größenprüfung). */

export function readPngSize(data: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || sig.some((b, i) => data[i] !== b)) throw new Error('Keine PNG-Datei');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = String.fromCharCode(data[12]!, data[13]!, data[14]!, data[15]!);
  if (type !== 'IHDR') throw new Error('PNG ohne IHDR');
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function chunk(type: string, payload: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, payload])));
  return Buffer.concat([len, typeBuf, payload, crc]);
}

/** RGBA-Pixel (Zeilen von oben) → PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('RGBA-Puffer hat die falsche Größe');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Testbild: Farbverlauf mit Raster (deterministisch). */
export function makeTestPattern(width: number, height: number): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const grid = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0;
      rgba[i] = Math.round((x / Math.max(1, width - 1)) * 255);
      rgba[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      rgba[i + 2] = grid ? 200 : 60;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}
