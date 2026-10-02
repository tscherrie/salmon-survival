import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CORE_CHUNK_BYTES = 16 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = ['esm', 'classic'];
const names = {
  esm: { js: 'ffmpeg-core.js', wasm: 'ffmpeg-core.wasm.json', chunk: 'ffmpeg-core.wasm' },
  classic: { js: 'ffmpeg-core-classic.js', wasm: 'ffmpeg-core-classic.wasm.json', chunk: 'ffmpeg-core-classic.wasm' },
};
const fail = message => { throw new Error(`FFmpeg core: ${message}`); };
function keys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...expected].sort().join()) fail(`invalid ${label} fields`);
}
function descriptor(value, label) {
  keys(value, ['path', 'bytes', 'sha256'], label);
  if (typeof value.path !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value.path) || value.path.split('/').some(part => !part || part === '.' || part === '..')) fail(`unsafe ${label} path`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0 || !/^[a-f0-9]{64}$/.test(value.sha256)) fail(`invalid ${label} size or SHA256`);
  return value;
}
async function filesIn(directory, prefix = '') {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isSymbolicLink()) fail(`symlink in vendor scope: ${relative}`);
    if (item.isDirectory()) result.push(...await filesIn(path.join(directory, item.name), `${relative}/`));
    else if (item.isFile()) result.push(relative);
    else fail(`non-file in vendor scope: ${relative}`);
  }
  return result.sort();
}
async function verifiedFile(directory, entry, label) {
  descriptor(entry, label);
  const bytes = await readFile(path.join(directory, entry.path));
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail(`${label} does not match its pinned size and SHA256`);
  return bytes;
}
const info = (relative, bytes) => ({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
function verifiedAcceptance(manifest, acceptance) {
  keys(acceptance, ['schemaVersion', 'status', 'variants', 'checks'], 'browser acceptance');
  if (acceptance.schemaVersion !== 1 || acceptance.status !== 'passed') fail('owned browser acceptance must be passed');
  keys(acceptance.variants, variants, 'accepted variants');
  for (const variant of variants) {
    keys(acceptance.variants[variant], ['jsSha256', 'wasmSha256'], `${variant} accepted hashes`);
    if (acceptance.variants[variant].jsSha256 !== manifest.variants[variant].js.sha256 || acceptance.variants[variant].wasmSha256 !== manifest.variants[variant].wasm.sha256) fail(`${variant} acceptance hashes do not match owned artifacts`);
  }
  const checks = ['opaqueClassic', 'esmRoundTrip', 'h264AacExport', 'cancelRecovery'];
  // Corruption is checked against the integrated dist after the initial candidate gate.
  if (Object.hasOwn(acceptance.checks ?? {}, 'corruptionRejected')) checks.push('corruptionRejected');
  keys(acceptance.checks, checks, 'browser acceptance checks');
  if (checks.some(check => acceptance.checks[check] !== true)) fail('owned browser acceptance checks must all pass');
}

/** Vendor presence activates a strict contract. Missing or invalid owned inputs never use npm. */
export async function loadCoreArtifacts(studio) {
  const directory = path.join(studio, 'packages/browser-media/vendor/ffmpeg-core');
  let vendor, scope = studio;
  for (const part of ['packages', 'browser-media', 'vendor', 'ffmpeg-core']) {
    scope = path.join(scope, part);
    let current;
    try { current = await lstat(scope); } catch (error) { if (error.code !== 'ENOENT') throw error; break; }
    if (current.isSymbolicLink() || !current.isDirectory()) fail('vendor ancestors must be real directories');
    if (scope === directory) vendor = current;
  }
  if (vendor) {
    if (!vendor.isDirectory() || vendor.isSymbolicLink()) fail('vendor root must be a real directory');
    const raw = await readFile(path.join(directory, 'manifest.json'));
    const manifest = JSON.parse(raw);
    keys(manifest, ['schemaVersion', 'provenance', 'build', 'variants'], 'owned manifest');
    if (manifest.schemaVersion !== 1 || manifest.provenance !== 'owned-build') fail('unsupported owned manifest schema or provenance');
    keys(manifest.build, ['recipeCommit', 'sourceLock', 'receipt', 'acceptance'], 'build provenance');
    if (!/^[a-f0-9]{40}$/.test(manifest.build.recipeCommit)) fail('recipeCommit must be an exact Git SHA');
    keys(manifest.variants, variants, 'variants');
    const references = [];
    for (const name of ['sourceLock', 'receipt', 'acceptance']) {
      const entry = descriptor(manifest.build[name], `build.${name}`);
      if (!entry.path.endsWith('.json')) fail(`build.${name} must reference JSON metadata`);
      references.push(entry.path);
    }
    for (const variant of variants) {
      keys(manifest.variants[variant], ['js', 'wasm'], `${variant} variant`);
      for (const type of ['js', 'wasm']) {
        const entry = descriptor(manifest.variants[variant][type], `${variant}.${type}`);
        if (entry.path !== `${variant}/ffmpeg-core.${type}`) fail(`${variant}.${type} has an unexpected path`);
        references.push(entry.path);
      }
    }
    if (new Set(['manifest.json', ...references]).size !== references.length + 1) fail('manifest file references must be distinct');
    if ((await filesIn(directory)).join() !== ['manifest.json', ...references].sort().join()) fail('vendor contains missing or unlisted files');
    const metadata = {};
    for (const name of ['sourceLock', 'receipt', 'acceptance']) {
      const bytes = await verifiedFile(directory, manifest.build[name], `build.${name}`);
      metadata[name] = JSON.parse(bytes); // Review evidence, never executable configuration.
    }
    verifiedAcceptance(manifest, metadata.acceptance);
    const core = { sourceKind: 'owned-build', directory, variants: {}, provenance: { manifestSha256: sha256(raw), build: manifest.build } };
    for (const variant of variants) {
      const js = await verifiedFile(directory, manifest.variants[variant].js, `${variant}.js`);
      const wasm = await verifiedFile(directory, manifest.variants[variant].wasm, `${variant}.wasm`);
      if (!wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) fail(`${variant}.wasm has no WASM v1 header`);
      core.variants[variant] = { js, wasm, source: manifest.variants[variant] };
    }
    return core;
  }
  const packagePath = path.join(studio, 'node_modules/@ffmpeg/core');
  const pkg = JSON.parse(await readFile(path.join(packagePath, 'package.json')));
  const lock = JSON.parse(await readFile(path.join(studio, 'package-lock.json')));
  const pinned = lock.packages['node_modules/@ffmpeg/core'];
  if (!pinned || pinned.version !== pkg.version) fail('installed npm core differs from package-lock');
  const core = { sourceKind: 'npm-baseline', variants: {}, provenance: { package: '@ffmpeg/core', version: pkg.version, npmArchive: pinned.resolved, npmIntegrity: pinned.integrity } };
  for (const variant of variants) {
    const relative = `node_modules/@ffmpeg/core/dist/${variant === 'classic' ? 'umd' : 'esm'}`;
    const js = await readFile(path.join(studio, relative, 'ffmpeg-core.js'));
    const wasm = await readFile(path.join(studio, relative, 'ffmpeg-core.wasm'));
    core.variants[variant] = { js, wasm, source: { js: info(`${relative}/ffmpeg-core.js`, js), wasm: info(`${relative}/ffmpeg-core.wasm`, wasm) } };
  }
  return core;
}

function runtimeProvenance(core) {
  return {
    schemaVersion: 1, sourceKind: core.sourceKind, provenance: core.provenance,
    variants: Object.fromEntries(variants.map(variant => [variant, {
      js: info(names[variant].js, core.variants[variant].js),
      wasm: { manifest: names[variant].wasm, bytes: core.variants[variant].wasm.length, sha256: sha256(core.variants[variant].wasm) },
      source: core.variants[variant].source,
    }])),
  };
}

/** Independently sized variants may share chunks only when their complete WASM hashes agree. */
export async function writeCoreRuntime(core, directory, chunkBytes = CORE_CHUNK_BYTES) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > CORE_CHUNK_BYTES) fail('invalid transport chunk size');
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) if (name.startsWith('ffmpeg-core') || name === 'runtime-provenance.json') await rm(path.join(directory, name), { recursive: true });
  let esmChunks;
  for (const variant of variants) {
    const { js, wasm } = core.variants[variant];
    await writeFile(path.join(directory, names[variant].js), js);
    let chunks = [];
    if (variant === 'classic' && wasm.length === core.variants.esm.wasm.length && sha256(wasm) === sha256(core.variants.esm.wasm)) chunks = esmChunks;
    else for (let offset = 0, index = 0; offset < wasm.length; offset += chunkBytes, index++) {
      const bytes = wasm.subarray(offset, offset + chunkBytes), url = `${names[variant].chunk}.part${index}`;
      await writeFile(path.join(directory, url), bytes);
      chunks.push({ url, bytes: bytes.length, sha256: sha256(bytes) });
    }
    if (variant === 'esm') esmChunks = chunks;
    await writeFile(path.join(directory, names[variant].wasm), JSON.stringify({ version: 1, bytes: wasm.length, sha256: sha256(wasm), chunks }));
  }
  await writeFile(path.join(directory, 'runtime-provenance.json'), JSON.stringify(runtimeProvenance(core), null, 2) + '\n');
}

/** Audits an arbitrary number of parts and checks both JS/WASM variants against selected source bytes. */
export async function auditCoreRuntime(core, directory) {
  const publishedFiles = new Map(), rows = {};
  const expectedFiles = new Set(['runtime-provenance.json']);
  async function inspect(relative) {
    const bytes = await readFile(path.join(directory, relative));
    publishedFiles.set(relative, info(relative, bytes));
    expectedFiles.add(relative);
    return bytes;
  }
  let provenance;
  try { provenance = JSON.parse(await inspect('runtime-provenance.json')); }
  catch (error) { if (error.code !== 'ENOENT' || core.sourceKind !== 'npm-baseline') throw error; expectedFiles.delete('runtime-provenance.json'); }
  if (provenance && JSON.stringify(provenance) !== JSON.stringify(runtimeProvenance(core))) fail('published provenance does not match the selected source');
  for (const variant of variants) {
    const expected = core.variants[variant];
    const js = await inspect(names[variant].js);
    if (!js.equals(expected.js)) fail(`${variant} runtime JS differs from selected source`);
    let manifestName = names[variant].wasm, manifest;
    try { manifest = JSON.parse(await inspect(manifestName)); }
    catch (error) {
      if (error.code !== 'ENOENT' || variant !== 'classic' || core.sourceKind !== 'npm-baseline' || provenance) throw error;
      manifestName = names.esm.wasm; manifest = JSON.parse(await inspect(manifestName));
    }
    keys(manifest, ['version', 'bytes', 'sha256', 'chunks'], `${variant} runtime WASM manifest`);
    if (manifest.version !== 1 || manifest.bytes !== expected.wasm.length || manifest.sha256 !== sha256(expected.wasm) || !Array.isArray(manifest.chunks) || !manifest.chunks.length) fail(`${variant} WASM manifest differs from selected source`);
    const parts = [], chunkNames = new Set();
    for (const [index, chunk] of manifest.chunks.entries()) {
      keys(chunk, ['url', 'bytes', 'sha256'], `${variant} chunk`);
      if (typeof chunk.url !== 'string' || !new RegExp(`^ffmpeg-core(?:-classic)?\\.wasm\\.part${index}$`).test(chunk.url) || chunkNames.has(chunk.url) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > CORE_CHUNK_BYTES || !/^[a-f0-9]{64}$/.test(chunk.sha256)) fail(`${variant} invalid chunk descriptor`);
      chunkNames.add(chunk.url);
      const bytes = await inspect(chunk.url);
      if (bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) fail(`${variant} runtime chunk mismatch`);
      parts.push(bytes);
    }
    if (!Buffer.concat(parts).equals(expected.wasm)) fail(`${variant} reassembled WASM differs from selected source`);
    rows[variant] = { jsEqualsSelectedSource: true, wasmEqualsSelectedSource: true, wasmManifest: manifestName, wasmBytes: manifest.bytes, wasmSha256: manifest.sha256, chunks: manifest.chunks.length };
  }
  const actualFiles = (await readdir(directory)).filter(name => name.startsWith('ffmpeg-core') || name === 'runtime-provenance.json').sort();
  if (actualFiles.join() !== [...expectedFiles].sort().join()) fail('published core has stale or unlisted files');
  return { sourceKind: core.sourceKind, provenance: core.provenance, legacyNpmLayout: !provenance, variants: rows, publishedFiles: [...publishedFiles.values()] };
}
