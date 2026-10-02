#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { loadCoreArtifacts, auditCoreRuntime } from '../../scripts/adopt-owned-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '../../../..');
const lock = JSON.parse(await readFile(join(studio, 'package-lock.json'), 'utf8'));
const sourceDirectory = process.argv[2] ? resolve(process.argv[2]) : null;
const reportPath = process.argv[3] ? resolve(process.argv[3]) : join(here, 'artifact-inventory.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function embeddedWasm(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const found = [], magic = Buffer.from([0, 97, 115, 109]);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.length > 10000) {
      let bytes = Buffer.from(node.value, 'latin1');
      if (!bytes.subarray(0, 4).equals(magic)) bytes = Buffer.from(node.value, 'base64');
      if (bytes.subarray(0, 4).equals(magic)) found.push(bytes);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(ast);
  if (found.length !== 1) throw new Error(`Expected one embedded WASM, found ${found.length}`);
  return found[0];
}
function customSections(bytes) {
  let position = 8;
  function uleb() { let value = 0, shift = 0, byte; do { byte = bytes[position++]; value += (byte & 127) * 2 ** shift; shift += 7; if (shift > 35) throw new Error('Invalid WASM length'); } while (byte & 128); return value; }
  const names = [];
  while (position < bytes.length) { const id = bytes[position++], length = uleb(), end = position + length; if (id === 0) { const nameLength = uleb(); names.push(bytes.subarray(position, position + nameLength).toString('utf8')); } position = end; }
  if (position !== bytes.length) throw new Error('Invalid WASM section boundary');
  return names;
}
const report = { schemaVersion: 1, inspectedAtUtc: new Date().toISOString(), packageLockSha256: hash(await readFile(join(studio, 'package-lock.json'))), packageVersions: [], publishedFiles: [], encoderWasm: [], remotionPackages: [], method: 'Read-only hashing and JavaScript AST literal decoding; no encoder JS or WASM executed' };
for (const name of ['@ffmpeg/core', '@ffmpeg/ffmpeg', '@ffmpeg/types', 'mediabunny', '@mediabunny/aac-encoder', '@mediabunny/mp3-encoder', '@mediabunny/flac-encoder']) {
  const installedPath = `node_modules/${name}`, pkg = JSON.parse(await readFile(join(studio, installedPath, 'package.json'), 'utf8')), pinned = lock.packages[installedPath];
  if (pkg.version !== pinned.version) throw new Error(`Installed version differs from lock: ${name}`);
  report.packageVersions.push({ name, version: pkg.version, license: pkg.license, npmArchive: pinned.resolved, npmIntegrity: pinned.integrity });
}
// Installed npm bytes remain explicitly identified reference material after owned adoption.
for (const relative of ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js', 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm', '../dist/client/runtime/ffmpeg/worker.js']) {
  const bytes = await readFile(resolve(studio, relative)); report.publishedFiles.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
}
const core = await loadCoreArtifacts(studio);
const runtimeDir = resolve(studio, '../dist/client/runtime/ffmpeg');
const runtimeAudit = await auditCoreRuntime(core, runtimeDir);
report.publishedFiles.push(...runtimeAudit.publishedFiles.map(file => ({ ...file, path: `../dist/client/runtime/ffmpeg/${file.path}` })));
report.ffmpeg = {
  sourceKind: core.sourceKind, provenance: runtimeAudit.provenance,
  runtimeEqualsSelectedSource: true,
  runtimeEqualsNpmWasm: core.sourceKind === 'npm-baseline' ? true : null,
  legacyNpmLayout: runtimeAudit.legacyNpmLayout,
  ...(core.sourceKind === 'npm-baseline' ? { version: '5.1.4', emscripten: '3.1.40', emscriptenCommit: '5c27e79dd0a9c4e27ef2326841698cdd4f6b5784' } : {}),
  variants: Object.fromEntries(Object.entries(core.variants).map(([variant, { wasm }]) => [variant, {
    ...runtimeAudit.variants[variant], lameVersionString: wasm.includes(Buffer.from('3.100')),
    x264GitVersion: null, customSections: customSections(wasm),
    buildConfiguration: wasm.toString('latin1').match(/--target-os=none[^\0]+/)?.[0],
  }])),
};
for (const codec of ['aac', 'mp3', 'flac']) {
  const name = `@mediabunny/${codec}-encoder`, file = codec === 'mp3' ? 'lame' : codec;
  const source = await readFile(join(studio, `node_modules/${name}/dist/modules/build/${file}.js`), 'utf8');
  const bytes = embeddedWasm(source);
  const row = { package: name, version: '1.56.1', bytes: bytes.length, sha256: hash(bytes), customSections: customSections(bytes), sourceCommit: 'cee57d1cdfd1776d515c081057b50eb337291e32', embeddedIdentifier: codec === 'aac' ? 'Lavc62.23.103' : codec === 'flac' ? 'reference libFLAC git-3f1ecff8 20260304' : null };
  if (row.embeddedIdentifier && !bytes.includes(Buffer.from(row.embeddedIdentifier))) throw new Error('Expected codec identifier missing');
  if (sourceDirectory) {
    const upstream = await readFile(join(sourceDirectory, `extracted/mediabunny-encoders/packages/${codec}-encoder/build/${file}.js`), 'utf8');
    row.upstreamEmbeddedWasmEqualsInstalled = embeddedWasm(upstream).equals(bytes);
    if (!row.upstreamEmbeddedWasmEqualsInstalled) throw new Error('Upstream and installed encoder differ');
  }
  report.encoderWasm.push(row);
}
if (sourceDirectory) {
  const relative = 'extracted/mediabunny-encoders/packages/mp3-encoder/build/libmp3lame.a';
  const archive = await readFile(join(sourceDirectory, relative));
  const archiveText = archive.toString('latin1');
  const compiler = archiveText.match(/clang version 22\.0\.0git[^\0\r\n]*/)?.[0] ?? archiveText.match(/clang 22\.0\.0git[^\0\r\n]*/)?.[0];
  const compilerRevision = '7f93487862d98bf1c168babba87daf6224d8a46f';
  if (!archive.includes(Buffer.from('LAME3.100')) || !archive.includes(Buffer.from(compilerRevision))) throw new Error('Expected original MP3 static archive identifiers missing');
  report.mp3RelinkArchive = { path: relative, bytes: archive.length, sha256: hash(archive), lameVersion: '3.100', compiler: compiler ?? 'clang22.0.0git (identifier present in archive)', llvmSourceRevision: compilerRevision, originalCompilerBuildOrPatchsetRecorded: false };
}
for (const [path, pkg] of Object.entries(lock.packages)) if (/(?:^|\/)node_modules\/(?:@remotion\/[^/]+|remotion)$/.test(path)) report.remotionPackages.push({ path, version: pkg.version, declaredLicense: pkg.license ?? null, npmArchive: pkg.resolved, npmIntegrity: pkg.integrity });
const remotionLicense = await readFile(join(studio, 'node_modules/remotion/LICENSE.md'));
report.remotionLicense = { version: '4.0.532', bytes: remotionLicense.length, sha256: hash(remotionLicense), userConfirmedIndependentOperatorAtMostThreePeople: true, confirmationSource: 'Human user in parent conversation; not an inferred SkillMeNow affiliation', eligibilityCriterionMatchesInstalledLicense: remotionLicense.includes(Buffer.from('a for-profit organization with up to 3 employees')), legalAttestationProvided: false };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, ffmpegSourceKind: core.sourceKind, ffmpegRuntimeEqualsSelectedSource: true, ffmpegRuntimeEqualsNpm: report.ffmpeg.runtimeEqualsNpmWasm, encoders: report.encoderWasm, remotionResolvedVersion: '4.0.532', report: reportPath }));
