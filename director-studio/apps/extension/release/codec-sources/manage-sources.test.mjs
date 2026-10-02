import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
test('verified archive acquisition refuses changed cached source bytes before any remote request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-source-integrity-'));
  try {
    const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
    const first = manifest.archives[0];
    await writeFile(join(directory, first.filename), Buffer.from('changed upstream source'));
    const result = spawnSync(process.execPath, [join(here, 'manage-sources.mjs'), 'fetch', directory], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source integrity mismatch/);
    assert.doesNotMatch(result.stderr, /Source download failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('acquisition manifest pins all repository archives and covers the linked source/recursive build closure', async () => {
  const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
  for (const entry of manifest.archives.filter(item => item.url?.includes('codeload.github.com'))) {
    assert.match(entry.commit, /^[a-f0-9]{40}$/);
    assert.equal(new URL(entry.url).pathname.split('/').at(-1), entry.commit);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  for (const name of ['ffmpegwasm-recipe', 'ffmpeg', 'x264', 'x265', 'libvpx', 'lame', 'ogg', 'theora', 'opus', 'vorbis', 'zlib', 'libwebp', 'freetype2', 'fribidi', 'harfbuzz', 'libass', 'zimg', 'zimg-googletest', 'emsdk', 'emscripten', 'sdl2', 'mediabunny-encoders', 'mediabunny-runtime', 'flac', 'lame-official']) assert(manifest.archives.some(item => item.name === name), `Missing source material: ${name}`);
});
