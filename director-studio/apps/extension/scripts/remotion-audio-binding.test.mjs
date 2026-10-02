import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { parse } from 'acorn';
import { assertNoLegacyEncoderInputs, resolveRemotionAudioBinding, validateRemotionAudioContract, embeddedWasmInJavaScript, auditRemotionAudioEmission } from './remotion-audio-binding.mjs';

const studio = fileURLToPath(new URL('../../..', import.meta.url));
test('bindings are restricted to the pinned Remotion importer; other callers fail', async () => {
  await validateRemotionAudioContract(studio);
  const importer = join(studio, 'node_modules/@remotion/web-renderer/dist/esm/index.mjs');
  for (const codec of ['aac', 'mp3', 'flac']) {
    const name = `@mediabunny/${codec}-encoder`;
    assert.equal(resolveRemotionAudioBinding(name, importer, studio), resolve(studio, 'packages/browser-media/src/remotion-audio-binding.ts'));
    assert.throws(() => resolveRemotionAudioBinding(name, join(studio, 'packages/browser-media/src/export.ts'), studio), /Unexpected.*importer/);
    assert.throws(() => assertNoLegacyEncoderInputs([`node_modules/${name}/dist/bundles/encoder.mjs`]), /Prebuilt Remotion audio encoder/);
  }
  assert.equal(resolveRemotionAudioBinding('mediabunny', importer, studio), null);
  assert.doesNotThrow(() => assertNoLegacyEncoderInputs(['node_modules/mediabunny/dist/bundles/mediabunny.mjs', 'packages/browser-media/src/remotion-audio-binding.ts']));
});

test('all replacement exports fail explicitly instead of silently discarding audio', async () => {
  const result = await build({ entryPoints: [join(studio, 'packages/browser-media/src/remotion-audio-binding.ts')], bundle: true, write: false, platform: 'browser', format: 'esm' });
  const binding = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  for (const name of ['registerAacEncoder', 'registerMp3Encoder', 'registerFlacEncoder']) assert.throws(() => binding[name](), /muted:true.*owned FFmpeg/);
});

test('actual Remotion callers remain muted and the composition excludes source audio', async () => {
  const source = await readFile(join(studio, 'packages/browser-media/src/timeline.tsx'), 'utf8');
  const compiled = await transform(source, { loader: 'tsx', format: 'esm' });
  const nodes = [parse(compiled.code, { ecmaVersion: 'latest', sourceType: 'module' })], calls = [];
  let includeAudio;
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'CallExpression' && ['canRenderMediaOnWeb', 'renderMediaOnWeb'].includes(node.callee.name)) {
      const options = node.arguments[0];
      assert.equal(options.type, 'ObjectExpression');
      assert.equal(options.properties.find(property => property.key.name === 'muted')?.value.value, true);
      calls.push(node.callee.name);
    }
    if (node.type === 'VariableDeclarator' && node.id?.name === 'inputProps') includeAudio = node.init.properties.find(property => property.key.name === 'includeAudio')?.value.value;
    for (const value of Object.values(node)) if (Array.isArray(value)) nodes.push(...value); else if (value && typeof value === 'object') nodes.push(value);
  }
  assert.deepEqual(calls.sort(), ['canRenderMediaOnWeb', 'renderMediaOnWeb']);
  assert.equal(includeAudio, false);
});

test('byte audit recognizes all three original encoder payloads inside nested inline-worker bundles', async () => {
  for (const codec of ['aac', 'mp3', 'flac']) {
    const file = codec === 'mp3' ? 'lame' : codec;
    const moduleSource = await readFile(join(studio, `node_modules/@mediabunny/${codec}-encoder/dist/modules/build/${file}.js`), 'utf8');
    const bundleSource = await readFile(join(studio, `node_modules/@mediabunny/${codec}-encoder/dist/bundles/mediabunny-${codec}-encoder.mjs`), 'utf8');
    const expected = embeddedWasmInJavaScript(moduleSource);
    assert.equal(expected.length, 1);
    assert.deepEqual(embeddedWasmInJavaScript(bundleSource), expected);
  }
});

test('byte audit rejects encoded WASM in JS, native HTML and a nested worker; clean documents pass', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-remotion-audit-negative.'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'native.html'), '<script>window.native=true</script>');
    await writeFile(join(directory, 'native-sandbox.html'), '<script>window.sandbox=true</script>');
    assert.equal((await auditRemotionAudioEmission(studio, directory)).passed, true);
    const wasm = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), Buffer.alloc(10032)]);
    for (const [path, script] of [
      ['assets/test.js', `const wasm=${JSON.stringify(wasm.toString('base64'))};`],
      ['native.html', `<script>const wasm=${JSON.stringify(wasm.toString('latin1'))};</script>`],
      ['native-sandbox.html', `<script>const worker=${JSON.stringify(`const wasmBinary=${JSON.stringify(wasm.toString('latin1'))};WebAssembly.instantiate(wasmBinary);`)};</script>`],
    ]) {
      await writeFile(join(directory, path), script);
      await assert.rejects(auditRemotionAudioEmission(studio, directory), /Embedded WASM remains/);
      await writeFile(join(directory, path), path.endsWith('.js') ? 'window.clean=true;' : '<script>window.clean=true</script>');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('byte audit rejects a separately copied original encoder WASM asset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'director-remotion-binary-negative.'));
  try {
    await writeFile(join(directory, 'native.html'), '<script>window.native=true</script>');
    await writeFile(join(directory, 'native-sandbox.html'), '<script>window.sandbox=true</script>');
    const source = await readFile(join(studio, 'node_modules/@mediabunny/aac-encoder/dist/modules/build/aac.js'), 'utf8');
    const nodes = [parse(source, { ecmaVersion: 'latest', sourceType: 'module' })];
    let wasm;
    while (nodes.length) {
      const node = nodes.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'Literal' && typeof node.value === 'string' && node.value.startsWith('\0asm')) wasm = Buffer.from(node.value, 'latin1');
      for (const value of Object.values(node)) if (Array.isArray(value)) nodes.push(...value); else if (value && typeof value === 'object') nodes.push(value);
    }
    assert.ok(wasm);
    await writeFile(join(directory, 'legacy.wasm'), wasm);
    await assert.rejects(auditRemotionAudioEmission(studio, directory), /Original encoder WASM remains/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
