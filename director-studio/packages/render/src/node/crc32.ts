import * as zlib from 'node:zlib';

/** CRC-32 (IEEE). Nutzt `zlib.crc32` (Node ≥ 22.2), sonst eine Tabelle. */

let table: Uint32Array | undefined;

function fallbackCrc32(data: Uint8Array, initial = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = (initial ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const native = (zlib as unknown as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;

export function crc32(data: Uint8Array, initial = 0): number {
  return native ? native(data, initial) >>> 0 : fallbackCrc32(data, initial);
}

export { fallbackCrc32 };
