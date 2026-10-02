#!/usr/bin/env node
// Read-only audit of an observed Core build. The JSON report is its only write.
import {readFile, writeFile, readdir, lstat, stat, readlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname, join, relative, resolve, sep, posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [collectionArgument, buildArgument, originalStudioArgument] = process.argv.slice(2);
if (!collectionArgument || !buildArgument || !originalStudioArgument) {
  throw new Error('Use audit-core-source.mjs SOURCE_COLLECTION CORE_BUILD_DIRECTORY ORIGINAL_STUDIO_ROOT');
}
const collection = resolve(collectionArgument);
const build = resolve(buildArgument);
const originalStudio = resolve(originalStudioArgument);
const reportPath = join(build, 'independent-source-audit.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const within = (parent, path) => {
  const child = relative(parent, path);
  return child !== '' && !child.startsWith('..' + sep) && child !== '..' && !child.startsWith(sep);
};
assert(within(collection, build), 'Build evidence must remain inside the source collection');

async function measuredFile(path) {
  const bytes = await readFile(path);
  return {bytes: bytes.length, sha256: hash(bytes)};
}

// Codeload archives use POSIX tar with a global PAX commit comment. Handle
// local/global PAX paths and GNU long names as well; never extract any member.
function paxFields(bytes) {
  const result = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    assert(space > offset, 'Malformed PAX record');
    const length = Number(bytes.subarray(offset, space).toString('ascii'));
    assert(Number.isSafeInteger(length) && length > space - offset + 1 && offset + length <= bytes.length,
      'Invalid PAX record length');
    const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    assert(equals > 0, 'Malformed PAX field');
    result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

function* tarMembers(compressed) {
  const bytes = gunzipSync(compressed);
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  const number = (header, start, length) => {
    const raw = header.subarray(start, start + length);
    assert(!(raw[0] & 0x80), 'Binary tar numeric fields are unsupported by this audit');
    const text = raw.toString('ascii').replace(/\0.*$/s, '').trim();
    assert(text === '' || /^[0-7]+$/.test(text), 'Invalid octal tar field');
    const value = text === '' ? 0 : Number.parseInt(text, 8);
    assert(Number.isSafeInteger(value), 'Oversized tar member');
    return value;
  };
  let offset = 0, globalPax = {}, localPax = {}, longName, longLink;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const checksum = number(header, 148, 8);
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert(checksum === actualChecksum, 'Tar header checksum mismatch');
    const size = number(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const payload = bytes.subarray(offset + 512, offset + 512 + size);
    assert(payload.length === size, 'Truncated tar member');
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g') { globalPax = {...globalPax, ...paxFields(payload)}; continue; }
    if (type === 'x') { localPax = paxFields(payload); continue; }
    if (type === 'L') { longName = payload.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'K') { longLink = payload.toString('utf8').replace(/\0.*$/s, ''); continue; }
    const pax = {...globalPax, ...localPax};
    const prefix = field(header, 345, 155);
    const name = pax.path ?? longName ?? (prefix ? prefix + '/' : '') + field(header, 0, 100);
    const linkname = pax.linkpath ?? longLink ?? field(header, 157, 100);
    assert(!name.startsWith('/') && !name.split('/').includes('..'), 'Unsafe tar member name');
    if (pax.size !== undefined) assert(Number(pax.size) === size, 'Unexpected PAX size override');
    yield {name, linkname, type, payload};
    localPax = {}; longName = undefined; longLink = undefined;
  }
}

async function verifyArchive(name, archiveRow, target, include = () => true) {
  const path = join(collection, archiveRow.archive);
  const compressed = await readFile(path);
  assert(compressed.length === archiveRow.bytes && hash(compressed) === archiveRow.sha256,
    'Source archive hash or length mismatch: ' + name);
  let root, regularFilesCompared = 0, symlinksCompared = 0;
  for (const member of tarMembers(compressed)) {
    const parts = member.name.split('/').filter(Boolean);
    if (!root) root = parts[0];
    assert(parts[0] === root, 'Archive has multiple roots: ' + name);
    const filename = parts.slice(1).join('/');
    if (!filename || !include(filename)) continue;
    const destination = join(target, filename);
    if (member.type === '0') {
      assert((await lstat(destination)).isFile(), 'Archive file became nonordinary: ' + name + '/' + filename);
      assert((await readFile(destination)).equals(member.payload), 'Context source differs from archive: ' + name + '/' + filename);
      regularFilesCompared++;
    } else if (member.type === '2') {
      assert((await lstat(destination)).isSymbolicLink(), 'Archive symlink changed type: ' + name + '/' + filename);
      assert(await readlink(destination) === member.linkname, 'Archive symlink target differs: ' + name + '/' + filename);
      symlinksCompared++;
    } else {
      assert(member.type === '5', 'Unsupported archive member type: ' + member.type);
    }
  }
  return {name, archive: archiveRow.archive, commit: archiveRow.commit, bytes: compressed.length,
    sha256: hash(compressed), archiveHashAndBytesMatchLock: true, regularFilesCompared, symlinksCompared,
    contextMismatches: []};
}

async function scanContext(directory) {
  const entries = [];
  async function walk(path) {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() || entry.isSymbolicLink()) entries.push(child);
      else throw new Error('Unexpected context entry type: ' + child);
    }
  }
  await walk(directory);
  const sourceContextWasmOrStaticArchiveSeeds = entries.filter(path => /\.(?:a|wasm)$/i.test(path)).map(path => relative(directory, path)).sort();
  const sourceContextDistFiles = entries.filter(path => relative(directory, path).split(sep).includes('dist')).map(path => relative(directory, path)).sort();
  const sourceContextNodeModulesFiles = entries.filter(path => relative(directory, path).split(sep).includes('node_modules')).map(path => relative(directory, path)).sort();
  let sourceContextFileCount = 0;
  for (const path of entries) {
    try { if ((await stat(path)).isFile()) sourceContextFileCount++; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {sourceContextFileCount, sourceContextEntryCount: entries.length,
    sourceContextWasmOrStaticArchiveSeeds, sourceContextDistFiles, sourceContextNodeModulesFiles};
}

const receiptBytes = await readFile(join(build, 'run-receipt.json'));
const receipt = JSON.parse(receiptBytes);
const context = resolve(receipt.context);
assert(within(collection, context), 'Executed context must remain inside the source collection');
assert(receipt.status === 'compiled' && receipt.exitCode === 0, 'Successful actual compile receipt required');
const contextLockBytes = await readFile(join(context, 'SOURCE-LOCK.json'));
const dockerfileBytes = await readFile(join(context, 'Dockerfile'));
const lock = JSON.parse(contextLockBytes);
assert(hash(contextLockBytes) === receipt.sourceLockSha256, 'Executed context source lock changed');
assert(hash(dockerfileBytes) === receipt.dockerfileSha256, 'Executed Dockerfile changed');
assert(receipt.compilerImage === lock.toolchains.core.immutableImage, 'Compiler image differs from frozen source lock');
assert(receipt.argv.includes('--network=none'), 'Run steps were not recorded with network disabled');
assert(!receipt.argv.some(argument => /--(?:mount|build-context|secret)(?:=|$)/.test(argument) || argument.includes(originalStudio)),
  'Unexpected external source mount in build arguments');

const proofBytes = await readFile(join(build, 'source-chain-proof.json'));
const proof = JSON.parse(proofBytes);
assert(proof.sourceLockSha256 === receipt.sourceLockSha256 && proof.dockerfileSha256 === receipt.dockerfileSha256,
  'Prior source-chain proof differs from executed context');
assert(proof.npmOrRootNodeModulesMountedIntoBuilder === false && proof.copiedNpmCoreIntoContext === false,
  'Prior proof did not exclude npm source substitution');
const contextScan = await scanContext(context);
assert(contextScan.sourceContextWasmOrStaticArchiveSeeds.length === 0, 'Compiled archive/WASM seeds in context');
assert(contextScan.sourceContextDistFiles.length === 0, 'Preseeded dist files in context');
assert(contextScan.sourceContextNodeModulesFiles.length === 0, 'node_modules files in context');
assert(contextScan.sourceContextFileCount === proof.sourceContextFileCount, 'Frozen context file count changed');
const dockerfile = dockerfileBytes.toString('utf8');
assert(!/^(?:ADD\s+https?:|RUN\s+git\s+clone|RUN\s+.*--mount=)/m.test(dockerfile), 'Unexpected remote/mounted Core input');
assert(/^FROM --platform=linux\/amd64 emscripten\/emsdk@sha256:[a-f0-9]{64} AS emsdk-base$/m.test(dockerfile),
  'Compiler base image is not immutable');
assert(/^FROM scratch AS exportor\nCOPY --from=ffmpeg-wasm-builder \/src\/dist \/dist\s*$/m.test(dockerfile),
  'Export does not come solely from the compiler stage');

const sourceNames = ['ffmpeg', 'x264', 'x265', 'libvpx', 'lame', 'ogg', 'theora', 'opus', 'vorbis',
  'zlib', 'libwebp', 'freetype2', 'fribidi', 'harfbuzz', 'libass', 'zimg', 'sdl2', 'zimg-googletest'];
const sourceArchives = [];
for (const name of sourceNames) {
  const target = name === 'zimg-googletest' ? join(context, 'locked-sources/zimg/test/extra/googletest') : join(context, 'locked-sources', name);
  sourceArchives.push(await verifyArchive(name, lock.sources[name], target));
}
const recipeBindings = await verifyArchive('ffmpegwasm-recipe', lock.sources['ffmpegwasm-recipe'], context,
  filename => filename.startsWith('src/bind/') || filename.startsWith('src/fftools/'));

const workspaceProofBytes = await readFile(join(build, 'compiler-base-workspace-proof.txt'));
const workspaceEntries = workspaceProofBytes.toString('utf8').split('\n').filter(line => /^[dl-][rwx-]{9}\s/.test(line));
assert(workspaceEntries.length === 2 && workspaceEntries.every(line => /\s\.{1,2}$/.test(line)),
  'Captured compiler base workspace listing was not empty');
const logBytes = await readFile(join(build, 'build.log'));
const logLines = logBytes.toString('utf8').split('\n');
function marker(regex, description) {
  const index = logLines.findIndex(line => regex.test(line));
  assert(index >= 0, 'Missing build marker: ' + description);
  return {description, line: index + 1, text: logLines[index]};
}
const stages = [
  marker(/^#73 \[ffmpeg-builder 2\/2\] RUN /, 'FFmpeg compile stage'),
  marker(/^#73 .*\+ emmake make -j2$/, 'Actual FFmpeg compilation'),
];
for (const library of ['libavdevice', 'libavfilter', 'libavformat', 'libavcodec', 'libpostproc', 'libswresample', 'libswscale', 'libavutil']) {
  stages.push(marker(new RegExp('^#73 .*\\bAR\\s+' + library + '/' + library + '\\.a$'), 'Archive built: ' + library));
}
stages.push(marker(/^#73 DONE /, 'FFmpeg compile completed'));
for (const [stage, variant] of [[77, 'umd'], [78, 'esm']]) {
  assert(!logLines.some(line => new RegExp('^#' + stage + ' CACHED$').test(line)), 'Final link was cached: ' + variant);
  stages.push(marker(new RegExp('^#' + stage + ' .*\\+ emcc .* -o dist/' + variant + '/ffmpeg-core\\.js$'), 'Actual ' + variant + ' compilation/link'));
  stages.push(marker(new RegExp('^#' + stage + ' DONE '), variant + ' compile/link completed'));
}
stages.push(marker(/^#79 \[exportor 1\/1\] COPY --from=ffmpeg-wasm-builder \/src\/dist \/dist$/, 'Compiler-stage output copied for export'));
stages.push(marker(/^#79 DONE /, 'Export stage completed'));
stages.push(marker(/^#80 exporting to client directory$/, 'External local export started'));
stages.push(marker(/^#80 copying files .* done$/, 'Exported bytes copied'));
stages.push(marker(/^#80 DONE /, 'External local export completed'));
const cachedDependencyStages = logLines.filter(line => /^#\d+ CACHED$/.test(line)).length;

const inventoryPath = join(here, '../codec-sources/artifact-inventory.json');
const inventoryBytes = await readFile(inventoryPath);
const inventory = JSON.parse(inventoryBytes);
assert(new Date(inventory.inspectedAtUtc) < new Date(receipt.startedAtUtc), 'Baseline inventory does not precede this build');
const originalDist = join(originalStudio, 'node_modules/@ffmpeg/core/dist');
const originalPackage = JSON.parse(await readFile(join(originalStudio, 'node_modules/@ffmpeg/core/package.json'), 'utf8'));
assert(originalPackage.version === '0.12.10', 'Unexpected original npm Core version');
const outputs = [];
for (const variant of ['umd', 'esm']) {
  for (const suffix of ['js', 'wasm']) {
    const filename = posix.join(variant, 'ffmpeg-core.' + suffix);
    const ownedPath = join(build, 'artifacts/dist', filename);
    const originalPath = join(originalDist, filename);
    const ownedStat = await lstat(ownedPath), originalStat = await lstat(originalPath);
    assert(ownedStat.isFile() && originalStat.isFile(), 'Output or original is not an ordinary file: ' + filename);
    assert(!(ownedStat.dev === originalStat.dev && ownedStat.ino === originalStat.ino), 'Output shares npm file identity: ' + filename);
    const owned = await readFile(ownedPath), original = await readFile(originalPath);
    assert(owned.equals(original), 'Compiled output does not equal original npm bytes: ' + filename);
    const baselineName = suffix === 'wasm' ? 'esm/ffmpeg-core.wasm' : filename;
    const baseline = inventory.publishedFiles.find(file => file.path === 'node_modules/@ffmpeg/core/dist/' + baselineName);
    assert(baseline && baseline.bytes === original.length && baseline.sha256 === hash(original),
      'Original npm bytes differ from the prebuild inventory: ' + filename);
    outputs.push({filename, ownedBytes: owned.length, ownedSha256: hash(owned), originalBytes: original.length,
      originalSha256: hash(original), identicalToOriginalNpm: true, ordinarySeparateFiles: true,
      preBuildInventorySha256: baseline.sha256});
  }
}

const report = {
  schemaVersion: 1, status: 'passed', observedAtUtc: new Date().toISOString(),
  auditScript: {filename: 'audit-core-source.mjs', ...await measuredFile(fileURLToPath(import.meta.url))},
  nodeVersion: process.version, collection, context, build, originalStudio,
  receipt: {status: receipt.status, exitCode: receipt.exitCode, startedAtUtc: receipt.startedAtUtc,
    finishedAtUtc: receipt.finishedAtUtc, compilerImage: receipt.compilerImage, buildkitImage: receipt.buildkitImage,
    bytes: receiptBytes.length, sha256: hash(receiptBytes)},
  frozenContext: {sourceLockSha256: hash(contextLockBytes), dockerfileSha256: hash(dockerfileBytes),
    matchesExecutedReceipt: true, matchesPriorSourceChainProof: true, ...contextScan},
  sourceArchives, recipeBindings,
  sourceTreeCount: sourceArchives.length,
  sourceRegularFilesCompared: sourceArchives.reduce((sum, row) => sum + row.regularFilesCompared, 0),
  sourceSymlinksCompared: sourceArchives.reduce((sum, row) => sum + row.symlinksCompared, 0),
  copiedRecipeRegularFilesCompared: recipeBindings.regularFilesCompared,
  evidence: {
    priorSourceChainProof: {bytes: proofBytes.length, sha256: hash(proofBytes)},
    compilerBaseWorkspaceProof: {bytes: workspaceProofBytes.length, sha256: hash(workspaceProofBytes),
      capturedListingContainsOnlyDotDirectories: true, scope: 'Captured /src workspace listing only; not a scan of the entire toolchain image'},
    buildLog: {bytes: logBytes.length, sha256: hash(logBytes), markers: stages},
    preBuildArtifactInventory: {bytes: inventoryBytes.length, sha256: hash(inventoryBytes), inspectedAtUtc: inventory.inspectedAtUtc},
  },
  outputs, originalNpmPackageVersion: originalPackage.version,
  sourceBuildReproducesAllFourOriginalNpmFiles: true,
  boundary: {historicalPublisherCheckoutClaimed: false, historicalPublisherToolchainClaimed: false,
    secondColdBuildClaimed: false, dependencyCacheStagesObserved: cachedDependencyStages,
    browserAcceptanceClaimedByThisAudit: false, realNativeHostAcceptanceClaimed: false,
    productionRuntimeModified: false,
    statement: 'This observed pinned source/recipe/toolchain build reproduces all four installed npm Core files exactly. Its resumed dependency stages used build cache. It does not establish the upstream publisher\'s actual historical checkout or environment, a second cold rebuild, or browser/native-host acceptance.'},
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({passed: true, report: reportPath, ...await measuredFile(reportPath),
  sourceTrees: report.sourceTreeCount, regularSourceFiles: report.sourceRegularFilesCompared,
  sourceSymlinks: report.sourceSymlinksCompared, recipeBindingFiles: report.copiedRecipeRegularFilesCompared,
  outputsCompared: report.outputs.length, allFourEqualOriginalNpm: true}, null, 2));
