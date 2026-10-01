import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSniffedKind, probeMedia, sniffMediaType } from '../src/node/media-probe.ts';
import { solidPng, tmpDir } from './helpers.ts';

const FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p));

function box(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

/** Minimale MP4-Struktur: ftyp + optional moov (mit hdlr-Typ) + mdat. */
function fakeMp4(handler?: 'vide' | 'soun'): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2', 'latin1'));
  const parts = [ftyp];
  if (handler) {
    const hdlr = box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
    parts.push(box('moov', box('trak', box('mdia', hdlr))));
  }
  parts.push(box('mdat', Buffer.alloc(32, 7)));
  return Buffer.concat(parts);
}

let dir: string;
let server: Server;
let base: string;
const png = solidPng(8, 8, [200, 30, 30]);

beforeAll(async () => {
  dir = await tmpDir('studio-probe-test-');
  server = createServer((req, res) => {
    if (req.url === '/bild.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>404</title>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe('sniffMediaType / checkSniffedKind', () => {
  it('erkennt gängige Signaturen', () => {
    expect(sniffMediaType(png)).toBe('png');
    expect(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('jpeg');
    expect(sniffMediaType(Buffer.from('GIF89a....'))).toBe('gif');
    expect(sniffMediaType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffMediaType(fakeMp4('vide'))).toBe('mp4');
    expect(sniffMediaType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe('webm');
    expect(sniffMediaType(Buffer.from('ID3\x04\0\0\0'))).toBe('audio');
    expect(sniffMediaType(Buffer.from('  <!DOCTYPE html><html>'))).toBe('html');
    expect(sniffMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffMediaType(Buffer.from('{"error":"not found"}'))).toBe('json');
    expect(sniffMediaType(Buffer.from('BMW ist eine Automarke'))).toBe('text');
    expect(sniffMediaType(Buffer.alloc(0))).toBe('empty');
    expect(sniffMediaType(Buffer.from([1, 2, 3, 250, 251, 0, 0, 9]))).toBe('unknown');
  });

  it('Art-Prüfung: Bild am Video-Asset, Video am Bild-Asset, unbekannt = ok', () => {
    expect(checkSniffedKind('png', 'video')).toBe('Datei ist ein Bild (png), kein Video');
    expect(checkSniffedKind('mp4', 'image')).toBe('Datei ist ein Video (mp4), kein Bild');
    expect(checkSniffedKind('html', 'image')).toContain('HTML');
    expect(checkSniffedKind('heic', 'image')).toContain('HEIC');
    expect(checkSniffedKind('unknown', 'video')).toBeUndefined();
    expect(checkSniffedKind('webm', 'video')).toBeUndefined();
    expect(checkSniffedKind('svg', 'image')).toBeUndefined();
  });
});

describe('probeMedia', () => {
  it('lokale Dateien: fehlt, leer, falsche Art, MP4 ohne moov/Videospur', async () => {
    const write = async (name: string, data: Buffer | string) => {
      const file = path.join(dir, name);
      await writeFile(file, data);
      return file;
    };
    expect(await probeMedia(path.join(dir, 'gibtsnicht.png'), 'image')).toBe('Datei fehlt');
    expect(await probeMedia(pathToFileURL(await write('leer.mp4', '')).href, 'video')).toBe('Datei ist leer');
    expect(await probeMedia(await write('bild.mp4', png), 'video')).toBe('Datei ist ein Bild (png), kein Video');
    expect(await probeMedia(await write('fehlerseite.png', '<!doctype html><h1>404</h1>'), 'image')).toContain('HTML');
    expect(await probeMedia(await write('abgebrochen.mp4', fakeMp4()), 'video')).toContain('moov');
    expect(await probeMedia(await write('nur-ton.mp4', fakeMp4('soun')), 'video')).toBe('Datei enthält keine Videospur');
    expect(await probeMedia(await write('ok.mp4', fakeMp4('vide')), 'video')).toBeUndefined();
    expect(await probeMedia(await write('ok.png', png), 'image')).toBeUndefined();
    // Andere Arten und data:-URLs werden nicht geprüft.
    expect(await probeMedia(path.join(dir, 'gibtsnicht.mp3'), 'audio')).toBeUndefined();
    expect(await probeMedia('data:image/png;base64,AAAA', 'image')).toBeUndefined();
  });

  it.skipIf(!FFMPEG)('echtes H.264-MP4 von ffmpeg gilt als ladbar', async () => {
    const file = path.join(dir, 'echt.mp4');
    execFileSync(FFMPEG!, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.5:r=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file]);
    expect(await probeMedia(file, 'video')).toBeUndefined();
  });

  it('entfernte URLs: HTTP-Status und Signatur', async () => {
    expect(await probeMedia(`${base}/fehlt.png`, 'image')).toBe('HTTP 404 beim Laden');
    expect(await probeMedia(`${base}/bild.png`, 'image')).toBeUndefined();
    expect(await probeMedia(`${base}/bild.png`, 'video')).toBe('Datei ist ein Bild (png), kein Video');
    expect(await probeMedia('http://127.0.0.1:9/nie', 'image', { timeoutMs: 3000 })).toMatch(/nicht erreichbar|Zeitüberschreitung/);
  });
});
