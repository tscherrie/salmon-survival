#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const [action = 'verify', output = './codec-source-archives'] = process.argv.slice(2);
if (!['fetch', 'verify', 'extract', 'prepare-recipe'].includes(action)) throw new Error('Use fetch|verify|extract|prepare-recipe [archive-directory]');
const destination = resolve(output);
await mkdir(destination, { recursive: true });
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function checkArchive(entry, bytes) {
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Source integrity mismatch: ${entry.filename}`);
}
for (const entry of manifest.archives) {
  if (!/^[a-zA-Z0-9._-]+\.(tar\.gz|zip)$/.test(entry.filename)) throw new Error('Unsafe source filename');
  const path = join(destination, entry.filename);
  if (action === 'fetch') {
    let cached;
    try { cached = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cached) { checkArchive(entry, cached); continue; }
    if (entry.localSource) await copyFile(resolve(here, entry.localSource), `${path}.partial`);
    else {
      const url = new URL(entry.url);
      if (url.protocol !== 'https:' || !['codeload.github.com', 'downloads.sourceforge.net'].includes(url.hostname)) throw new Error('Unapproved primary source host');
      if (url.hostname === 'codeload.github.com' && !/\/[a-f0-9]{40}$/.test(url.pathname)) throw new Error('Git source URL must pin a full commit');
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`Source download failed: ${entry.filename}: HTTP ${response.status}`);
      await writeFile(`${path}.partial`, new Uint8Array(await response.arrayBuffer()));
    }
    checkArchive(entry, await readFile(`${path}.partial`));
    await rename(`${path}.partial`, path);
  }
  checkArchive(entry, await readFile(path));
  if (action === 'extract' || action === 'prepare-recipe') {
    const listing = spawnSync('tar', ['-tf', path], { encoding: 'utf8' });
    if (listing.status !== 0) throw new Error(`Archive listing failed: ${entry.filename}`);
    for (const name of listing.stdout.split('\n').filter(Boolean)) if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe archive path');
    const target = join(destination, 'extracted', entry.name);
    await mkdir(target, { recursive: true });
    const extracted = spawnSync('tar', ['-xzf', path, '--strip-components=1', '-C', target], { encoding: 'utf8' });
    if (extracted.status !== 0) throw new Error(`Source extraction failed: ${entry.filename}: ${extracted.stderr}`);
  }
}
if (action === 'prepare-recipe') {
  const recipe = join(destination, 'extracted', 'ffmpegwasm-recipe');
  let dockerfile = await readFile(join(recipe, 'Dockerfile'), 'utf8');
  const variables = { x264: 'X264_BRANCH', x265: 'X265_BRANCH', libvpx: 'LIBVPX_BRANCH', lame: 'LAME_BRANCH', ogg: 'OGG_BRANCH', theora: 'THEORA_BRANCH', opus: 'OPUS_BRANCH', vorbis: 'VORBIS_BRANCH', zlib: 'ZLIB_BRANCH', libwebp: 'LIBWEBP_BRANCH', freetype2: 'FREETYPE2_BRANCH', fribidi: 'FRIBIDI_BRANCH', harfbuzz: 'HARFBUZZ_BRANCH', libass: 'LIBASS_BRANCH', zimg: 'ZIMG_BRANCH', ffmpeg: 'FFMPEG_VERSION' };
  for (const [name, variable] of Object.entries(variables)) {
    const entry = manifest.archives.find(item => item.name === name);
    if (!entry?.commit) throw new Error(`Missing immutable recipe source: ${name}`);
    const pattern = new RegExp(`ENV ${variable}=[^\\n]+`);
    if (!pattern.test(dockerfile)) throw new Error(`Original recipe variable missing: ${variable}`);
    dockerfile = dockerfile.replace(pattern, `ENV ${variable}=${entry.commit}`);
  }
  const zimg = manifest.archives.find(item => item.name === 'zimg');
  dockerfile = dockerfile.replace('RUN git clone --recursive -b $ZIMG_BRANCH https://github.com/sekrit-twc/zimg.git /src', `RUN git init /src && cd /src && git remote add origin https://github.com/sekrit-twc/zimg.git && git fetch --depth=1 origin ${zimg.commit} && git checkout --detach FETCH_HEAD && git submodule update --init --recursive`);
  await writeFile(join(recipe, 'Dockerfile.pinned'), dockerfile);
  await writeFile(join(recipe, 'SOURCE-LOCK.json'), JSON.stringify({ purpose: 'Prepared pinned rebuild recipe; no binary rebuilt or historical correspondence asserted', sourceManifest: manifest.archives.filter(item => variables[item.name]), remainingBuildInputs: ['emscripten/emsdk:3.1.40 image digest', 'Dockerfile frontend image digest', 'apt package versions'] }, null, 2) + '\n');
}
await writeFile(join(destination, 'SHA256SUMS'), manifest.archives.map(entry => `${entry.sha256}  ${entry.filename}`).join('\n') + '\n');
console.log(JSON.stringify({ action, archives: manifest.archives.length, bytes: manifest.archives.reduce((sum, entry) => sum + entry.bytes, 0), verified: true, destination, binariesRebuilt: false }));
