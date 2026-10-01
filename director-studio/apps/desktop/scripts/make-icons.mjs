// Erzeugt die App-Icons aus build/icon.svg (Bildmarke aus DESIGN.md §5: Sucherklammern + Tally-Punkt):
//   build/icon.icns  macOS (PNG-Einträge 16–1024 px)
//   build/icon.ico   Windows (PNG-Einträge 16–256 px)
//   build/icons/     Linux (<n>x<n>.png)
// Gerastert wird mit Playwrights Chromium; ICNS/ICO setzt das Skript selbst zusammen (kein Download zur Build-Zeit).
// Aufruf nach Änderungen an icon.svg: node apps/desktop/scripts/make-icons.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const buildDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = await readFile(path.join(buildDir, 'icon.svg'), 'utf8');

const browser = await chromium.launch(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {});
const page = await browser.newPage();
/** @type {Map<number, Buffer>} */
const pngs = new Map();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  pngs.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();

// ICNS: „icns“ + Gesamtlänge, dann Einträge (Typ, Länge inkl. 8 Byte Kopf, PNG-Daten).
const icnsTypes = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];
const icnsEntries = icnsTypes.map(([type, size]) => {
  const data = /** @type {Buffer} */ (pngs.get(size));
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const icnsBody = Buffer.concat(icnsEntries);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(icnsBody.length + 8, 4);
await writeFile(path.join(buildDir, 'icon.icns'), Buffer.concat([icnsHead, icnsBody]));

// ICO: Kopf (0, Typ 1, Anzahl), je Bild 16 Byte Verzeichnis, dann die PNG-Daten.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const dir = [];
const images = [];
for (const size of icoSizes) {
  const data = /** @type {Buffer} */ (pngs.get(size));
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  dir.push(entry);
  images.push(data);
}
await writeFile(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...dir, ...images]));

// Linux: Satz einzelner PNGs (electron-builder liest die Größe aus dem Dateinamen).
await mkdir(path.join(buildDir, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) await writeFile(path.join(buildDir, 'icons', `${size}x${size}.png`), /** @type {Buffer} */ (pngs.get(size)));

console.log('Icons geschrieben: build/icon.icns, build/icon.ico, build/icons/*.png');
