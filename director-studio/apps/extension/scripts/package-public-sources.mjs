#!/usr/bin/env node
// Stage public source downloads outside Git; generated manifests never enter source ZIPs.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, lstat, readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(extension, '../../..');
const [releaseArgument, stageArgument, ...extra] = process.argv.slice(2);
if (!releaseArgument || !stageArgument || extra.length || !isAbsolute(releaseArgument) || !isAbsolute(stageArgument)) throw Error('Usage: node package-public-sources.mjs /absolute/release-directory /absolute/new-external-stage');
const release = await realpath(releaseArgument);
const stage = resolve(stageArgument);
for (const path of [release, stage]) if (!relative(repository, path).startsWith('..')) throw Error('Release inputs and the generated stage must stay outside the source repository.');
let stageExists = false;
try { await lstat(stage); stageExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (stageExists) throw Error('Use a fresh stage path; existing stages are preserved.');
await mkdir(stage, { recursive: true });
const canonicalStage = await realpath(stage);
if (!relative(repository, canonicalStage).startsWith('..')) throw Error('The generated stage must not resolve inside the source repository.');
const distribution = resolve(stage, 'dist');
const publicDirectory = resolve(extension, 'info-site/public');
const sourceCommit = (await readFile(resolve(release, 'SOURCE-CHECKPOINT.txt'), 'utf8')).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('An exact release source checkpoint is required.');
const releaseManifest = JSON.parse(await readFile(resolve(extension, 'plugin/plugin.json'), 'utf8'));
const site = JSON.parse(await readFile(resolve(extension, 'info-site/site.json'), 'utf8'));
const origin = new URL(site.url);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || site.projectId !== 'appgprj_6abf3f90f2f88191a35455153e4c9359') throw Error('Use the existing ordinary public information Site.');
const partBytes = 16 * 1024 * 1024;
const archiveLimit = 256 * 1024 * 1024;
const selected = [
  { id: 'application-source', filename: 'ai-director-studio-source.zip', label: 'Application source', description: 'Committed application source, runtime files, project-file prototype, build recipes and dependency notices.' },
  { id: 'core-source', filename: 'ai-director-studio-core-sources.zip', label: 'FFmpeg Core build sources', description: 'Pinned original source archives, complete executed build context, locked inputs, build evidence and original notices for the selected source-built Core.' },
];
const checksumLines = (await readFile(resolve(release, 'SHA256SUMS'), 'utf8')).trim().split(/\r?\n/);
const releaseChecksums = new Map();
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64}) [ *]([^\0\r\n]+)$/.exec(line);
  if (!match || match[2].length > 4096) throw Error('Malformed or oversized release checksum record.');
  // The full release inventory may include nested receipts. Only these exact ZIP names are inputs.
  if (selected.some(item => item.filename === match[2])) {
    if (releaseChecksums.has(match[2])) throw Error('Duplicate selected source ZIP checksum.');
    releaseChecksums.set(match[2], match[1]);
  }
}
const bundleReceipt = JSON.parse(await readFile(resolve(release, 'codec-core-source-bundle.json'), 'utf8'));
if (bundleReceipt.status !== 'passed' || bundleReceipt.archive?.filename !== selected[1].filename || bundleReceipt.archive?.sha256 !== releaseChecksums.get(selected[1].filename)) throw Error('Verified Core source bundle does not match the release.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const publicFiles = [];
async function copyPublic(directory) {
  for (const entry of (await readdir(directory)).sort()) {
    const input = resolve(directory, entry);
    const status = await lstat(input);
    if (status.isSymbolicLink()) throw Error('Public source entries cannot be symlinks.');
    const path = relative(publicDirectory, input).split('\\').join('/');
    if (status.isDirectory()) { await mkdir(resolve(distribution, path), { recursive: true }); await copyPublic(input); }
    else if (status.isFile()) {
      if (status.size > 25 * 1024 * 1024) throw Error(`Public asset exceeds the static-file limit: ${path}`);
      const output = resolve(distribution, path);
      await mkdir(resolve(output, '..'), { recursive: true });
      await copyFile(input, output);
      const inputBytes = await readFile(input), outputBytes = await readFile(output);
      if (!inputBytes.equals(outputBytes)) throw Error(`Public asset changed during staging: ${path}`);
      publicFiles.push({ path, bytes: inputBytes.length, sha256: sha(inputBytes), byteExact: true });
    } else throw Error('Public assets must be ordinary files.');
  }
}
await copyPublic(publicDirectory);
if (!publicFiles.some(file => file.path === 'sources.html')) throw Error('The generic sources download page is required.');
const manifest = { schemaVersion: 1, releaseVersion: releaseManifest.version, sourceCommit, partBytes, maxArchiveBytes: archiveLimit, files: [] };
const partChecksums = [];
for (const item of selected) {
  const source = resolve(release, item.filename);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > archiveLimit) throw Error(`Archive is not an ordinary bounded file: ${item.filename}`);
  const expectedSha = releaseChecksums.get(item.filename);
  if (!expectedSha) throw Error(`Missing release checksum: ${item.filename}`);
  const parts = [];
  const fullHash = createHash('sha256');
  let index = 0, offset = 0;
  for await (const bytes of createReadStream(source, { highWaterMark: partBytes })) {
    // Node file streams use this bounded read size; each published file remains <=16MiB.
    if (bytes.length > partBytes) throw Error('Archive part exceeds the configured bound.');
    const suffix = String(++index).padStart(4, '0');
    const path = `${expectedSha}/${item.filename}.part${suffix}`;
    const destination = resolve(distribution, 'downloads', path);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
    const digest = sha(bytes);
    const readback = await readFile(destination);
    if (!readback.equals(bytes) || sha(readback) !== digest) throw Error(`Part readback failed: ${path}`);
    parts.push({ index, offset, bytes: bytes.length, sha256: digest, path });
    partChecksums.push(`${digest}  ${path}`);
    fullHash.update(bytes); offset += bytes.length;
  }
  if (offset !== stat.size || fullHash.digest('hex') !== expectedSha) throw Error(`Release archive differs from SHA256SUMS: ${item.filename}`);
  const assembledHash = createHash('sha256');
  let assembledBytes = 0;
  for (const part of parts) {
    const stored = await readFile(resolve(distribution, 'downloads', part.path));
    if (stored.length !== part.bytes || sha(stored) !== part.sha256 || assembledBytes !== part.offset) throw Error('Published part identity or ordering failed.');
    assembledHash.update(stored); assembledBytes += stored.length;
  }
  if (assembledBytes !== stat.size || assembledHash.digest('hex') !== expectedSha) throw Error('Complete published part reassembly differs from the exact source ZIP.');
  manifest.files.push({ ...item, bytes: stat.size, sha256: expectedSha, parts, reassemblyVerified: true });
}
await mkdir(resolve(distribution, 'downloads'), { recursive: true });
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(distribution, 'downloads/source-manifest.json'), manifestBytes);
await writeFile(resolve(distribution, 'downloads/SHA256SUMS'), manifest.files.map(file => `${file.sha256}  ${file.filename}`).join('\n') + '\n');
await writeFile(resolve(distribution, 'downloads/PART-SHA256SUMS'), partChecksums.join('\n') + '\n');
const shell = ['#!/bin/sh', '# Download both exact source archives. No credentials or account cookies are used.', 'set -eu', 'mkdir -p "${1:-ai-director-studio-source-downloads}"', 'cd "${1:-ai-director-studio-source-downloads}"'];
for (const file of manifest.files) {
  for (const part of file.parts) {
    const filename = part.path.split('/').at(-1);
    shell.push(`curl --fail --proto '=https' --tlsv1.2 --max-redirs 0 '${new URL(`downloads/${part.path}`, origin).href}' --output '${filename}'`);
    shell.push(`printf '%s\\n' '${part.sha256}  ${filename}' | shasum -a 256 -c -`);
  }
  shell.push(`cat ${file.parts.map(part => `'${part.path.split('/').at(-1)}'`).join(' ')} > '${file.filename}'`);
  shell.push(`printf '%s\\n' '${file.sha256}  ${file.filename}' | shasum -a 256 -c -`);
}
shell.push('printf "%s\\n" "Both source ZIPs passed SHA-256 verification."');
await writeFile(resolve(distribution, 'downloads/download-sources.sh'), shell.join('\n') + '\n');
const generatedFiles = [];
async function audit(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name), status = await lstat(path);
    if (status.isSymbolicLink()) throw Error('Generated symlinks are forbidden.');
    if (status.isDirectory()) await audit(path);
    else {
      if (!status.isFile() || status.size > 25 * 1024 * 1024) throw Error('Invalid static archive entry.');
      generatedFiles.push({ path: relative(distribution, path).split('\\').join('/'), bytes: status.size, sha256: sha(await readFile(path)) });
    }
  }
}
await audit(distribution);
const receipt = {
  schemaVersion: 1, status: 'passed', generatedAt: new Date().toISOString(), projectId: site.projectId,
  publicPage: new URL('sources.html', origin).href, manifestUrl: new URL('downloads/source-manifest.json', origin).href,
  sourceCommit, releaseVersion: manifest.releaseVersion, distribution, manifestSha256: sha(manifestBytes),
  files: manifest.files.map(({ parts, ...file }) => ({ ...file, partCount: parts.length })),
  publicFilesPreserved: publicFiles, stagedFiles: generatedFiles,
  checks: { exactReleaseChecksums: true, allPartHashesAndBytes: true, completeZipReassembly: true, allStaticFilesAtMost25MiB: true, partsAtMost16MiB: true, existingPublicAssetsByteExact: true, noGeneratedArchivePartsInRepository: true },
  deployment: { performed: false, liveDownloadVerified: false },
};
await writeFile(resolve(stage, 'public-sources-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ stage, distribution, sourceCommit, releaseVersion: manifest.releaseVersion, files: receipt.files.map(file => ({ filename: file.filename, bytes: file.bytes, sha256: file.sha256, parts: file.partCount })), preservedPublicAssets: publicFiles.length, stagedFiles: generatedFiles.length, checks: receipt.checks }));
