import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { loadCoreArtifacts } from './adopt-owned-core.mjs';

const extension = fileURLToPath(new URL('..', import.meta.url));
const studio = resolve(extension, '../..');
const repo = resolve(studio, '..');
const output = resolve(process.argv[2] ?? '/tmp/director-studio-release');
const plugin = resolve(extension, 'plugin');
const releasePaths = ['director-studio', 'docs/director-studio', '.openai/hosting.example.json', 'drizzle'];
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...releasePaths], { cwd: repo, encoding: 'utf8' }).trim()) throw new Error('Commit all release source inputs before packaging.');
const core = await loadCoreArtifacts(studio);
let coreSourceBundle;
if (core.sourceKind === 'owned-build') {
  coreSourceBundle = JSON.parse(await readFile(resolve(extension, 'release/codec-core-source-bundle.json'), 'utf8'));
  const record = coreSourceBundle.archive;
  const sourceChecks = ['allSelectedArchiveHashes', 'completeContextArchiveAndGeneratedInputCorrespondence', 'frozenRecipeHandoffHashes', 'rawBuildEvidenceHashes', 'originalNoticeHashes', 'safeOrdinaryZipPaths', 'fullZipCountBytesCrcSha256Readback'];
  if (coreSourceBundle.schemaVersion !== 1 || coreSourceBundle.status !== 'passed' || record?.filename !== 'ai-director-studio-core-sources.zip' || coreSourceBundle.selectedInputs?.sourceLock?.sha256 !== core.provenance.build.sourceLock.sha256 || sourceChecks.some(check => coreSourceBundle.checks?.[check] !== true)) throw new Error('Matching verified Core source bundle is required.');
  const sourceBytes = await readFile(resolve(output, record.filename));
  if (sourceBytes.length !== record.bytes || createHash('sha256').update(sourceBytes).digest('hex') !== record.sha256) throw new Error('Core source ZIP differs from its verified receipt.');
}
const coreSourceSummary = core.sourceKind === 'owned-build'
  ? 'Source-built FFmpeg Core UMD/ESM JavaScript and WASM are vendored in packages/browser-media/vendor/ffmpeg-core with a SHA256-checked provenance manifest, source lock, executed-build receipt and browser acceptance. Recipe generators, pins, patches and source-correspondence records are in apps/extension/release/codec-rebuild; their lock identifies the exact frozen executed context. That context, bulk pinned source archives, locked build inputs and complete raw build evidence are in ai-director-studio-core-sources.zip, verified against codec-core-source-bundle.json and included in release SHA256SUMS; supply both source ZIPs together. This Git source ZIP alone is not a complete corresponding-source bundle.'
  : 'FFmpeg Core uses the installed, lockfile-pinned npm baseline. No owned Core adoption is represented by this source checkpoint.';
const manifest = JSON.parse(await readFile(resolve(plugin, 'plugin.json'), 'utf8'));
const openai = manifest.extensions?.['com.openai'];
if (!openai) throw new Error('OpenAI Extension metadata is required.');
const mcp = JSON.parse(await readFile(resolve(plugin, 'mcp.json'), 'utf8'));
const publicPages = JSON.parse(await readFile(resolve(extension, 'release/evidence/public-information-pages.json'), 'utf8'));
const publicSite = JSON.parse(await readFile(resolve(extension, 'info-site/site.json'), 'utf8'));
if (!publicPages.allPublicPagesReachable || publicPages.hasMcp !== false || publicPages.checks?.length !== 4) throw new Error('Verified ordinary public information pages are required.');
for (const [field, file] of [['websiteURL', 'index.html'], ['supportURL', 'support.html'], ['privacyPolicyURL', 'privacy.html'], ['termsOfServiceURL', 'terms.html']]) {
  const check = publicPages.checks.find(entry => entry.field === field);
  if (!check || check.status !== 200 || !check.mainContentMatchesPreparedSourceExactly || !check.requestHadNoCookieOrAuthorization || openai.interface[field] !== check.url) throw new Error(`Unverified publication URL: ${field}`);
  const url = new URL(check.url);
  if (url.protocol !== 'https:' || url.origin !== new URL(publicSite.url).origin) throw new Error(`Unexpected public information destination: ${field}`);
  const htmlHash = createHash('sha256').update(await readFile(resolve(extension, 'info-site/public', file))).digest('hex');
  if (htmlHash !== check.preparedHtmlSha256) throw new Error(`Public page changed after anonymous verification: ${field}`);
}
if (openai.review?.demo_recording_url) {
  const demo = JSON.parse(await readFile(resolve(extension, 'release/evidence/review-demo-public.json'), 'utf8'));
  const authoredVideoHash = createHash('sha256').update(await readFile(resolve(extension, 'info-site/public/review-demo.mp4'))).digest('hex');
  if (demo.url !== openai.review.demo_recording_url || demo.status !== 200 || !demo.requestHadNoCookieOrAuthorization || !demo.videoBytesMatchExactly || !demo.browserPlaybackVerified || demo.sha256 !== authoredVideoHash) throw new Error('Recorded reviewer-video verification or authored media hashes are missing or inconsistent; current URL availability requires a separate fresh check.');
  if (new URL(demo.url).origin !== new URL(publicSite.url).origin) throw new Error('Reviewer video must use the existing ordinary public information Site.');
}
if (openai.interface.shortDescription.length > 30) throw new Error('Listing subtitle exceeds 30 characters.');
if (Object.keys(mcp.mcpServers ?? {}).length !== 1) throw new Error('Expected one verified Director MCP server.');
for (const server of Object.values(mcp.mcpServers)) if (server.type !== 'streamable-http' || new URL(server.url).protocol !== 'https:') throw new Error('A verified HTTPS MCP endpoint is required.');
const files = {};
async function collect(dir) {
  for (const name of await readdir(dir)) {
    if (['.app.json', 'node_modules', '.git', 'lifecycleHooks'].includes(name)) throw new Error(`Nonportable package entry: ${name}`);
    const path = resolve(dir, name); const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are excluded from the release.');
    if (stat.isDirectory()) await collect(path);
    else files[`${manifest.name}/${relative(plugin, path)}`] = new Uint8Array(await readFile(path));
  }
}
await collect(plugin);
if (openai.apps != null || manifest.apps != null) throw new Error('App bindings are not portable public upload fields.');
if (manifest.lifecycleHooks != null || openai.lifecycleHooks != null) throw new Error('Lifecycle hooks are excluded from the public preparation package.');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
files[`${manifest.name}/SOURCE-CHECKPOINT.txt`] = strToU8(`${head}\nThis package is local review preparation for the existing canonical Sites app. The canonical Site is public; the recorded V8/domain verification and Portal package 0.1.3 are separate evidence. Portal OAuth authorization remains unavailable and the scan failed; no publication or review submission is claimed, and the OAuth client is unchanged. A prepared 0.1.4 source/package is not an uploaded Portal revision. Recorded policy-page and demo checks are historical; the latest CLI demo check returned HTTP403/Cloudflare1010, and current browser playback completed; absence of cookies/Authorization in that session is not established. ${coreSourceSummary} Standalone Mediabunny AAC/MP3/FLAC encoders remain the embedded npm baseline despite separate successful owned-candidate tests. Native project-file storage is an unwired prototype; cross-chat continuity and backend TTL/deletion are not established. No legal attestation is made.\n`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'ai-director-studio-plugin.zip'), zipSync(files, { level: 9 }));
execFileSync('git', ['archive', '--format=zip', '--prefix=ai-director-studio-source/', '-o', resolve(output, 'ai-director-studio-source.zip'), head, ...releasePaths], { cwd: repo });
const packages = JSON.parse(await readFile(resolve(studio, 'package-lock.json'), 'utf8')).packages;
const inventory = Object.entries(packages).filter(([path]) => path.includes('node_modules/')).map(([path, value]) => ({ path, version: value.version, license: value.license ?? 'Inspect package license', resolved: value.resolved, integrity: value.integrity }));
await writeFile(resolve(output, 'dependency-licenses.json'), JSON.stringify({ sourceCommit: head, scope: 'Exact entire source workspace lockfile; desktop-only packages are included and are not all shipped by the Extension.', packages: inventory }, null, 2));
await writeFile(resolve(output, 'SOURCE-CHECKPOINT.txt'), `${head}\n`);
await writeFile(resolve(output, 'README.txt'), `AI Director Studio ${manifest.version} — review preparation
Source checkpoint: ${head}

ai-director-studio-plugin.zip: portable metadata, native Director skill, the canonical HTTPS MCP endpoint, icons and preserved MIT notices. The canonical Site is public; owner APIs and media retain authenticated access. The recorded V8/domain verification and Portal package 0.1.3 are separate evidence. Portal OAuth authorization remains unavailable and the scan failed. No publication or review submission is claimed; the OAuth client is unchanged. Package 0.1.4 is local preparation until the final source commit, ZIP generation and Portal upload are separately recorded. This ZIP belongs to the existing canonical app.

ai-director-studio-source.zip: extract, enter director-studio, run npm ci then npm run extension:build. The included .openai/hosting.example.json has no Site ID and is used for local builds. Deployment requires your own provisioned Site identity. Root drizzle migrations are included.

dependency-licenses.json: exact complete workspace dependency inventory. MIT applies to application source, not all dependencies. ${coreSourceSummary} Standalone Mediabunny AAC/MP3/FLAC encoders remain their embedded npm baseline; separate owned-candidate build/browser results do not mean those encoders were integrated. Pinned codec/toolchain archive identities, exact binary hashes and remaining source limits are documented in apps/extension/release/codec-sources, apps/extension/release/codec-rebuild and license-inventory.md. The independent operator with at most three people meets the Remotion Free criterion; no paid Remotion plan is pending.

The source contains apps/extension/release/acceptance.md and function-coverage.md with precise test and live MCP evidence. The real native start was human-confirmed at cf761; complete native context/Library/category flows and a second real account remain unverified. The native-project-files prototype has 20 passing focused tests but is not wired into the editor or server; native cross-chat reopen is unproven and backend TTL/deletion remains a rollout plan. No storage migration occurred. The recorded SDK-browser demo provides historical supporting evidence; its original anonymous200/playback receipt does not prove current availability. The latest CLI request returned HTTP403/Cloudflare1010; current browser playback completed; absence of cookies/Authorization in that session is not established. Public support/privacy contact l@lll.uno and all countries offered by OpenAI are expressly confirmed; publication.countries is intentionally []. The four information/support/privacy/terms URLs and their recorded source/hash checks are included in metadata. Reviewer access, fresh demo access and Portal submission remain open. Individual Verified identity was observed in a read-only Portal view; no legal attestation is made. The packager checks committed inputs and recorded evidence; official plugin/MCP schema validation and final ZIP auditing are separate release steps.
`);
const artifacts = ['ai-director-studio-plugin.zip', 'ai-director-studio-source.zip', 'dependency-licenses.json', 'SOURCE-CHECKPOINT.txt', 'README.txt'];
if (coreSourceBundle) {
  await writeFile(resolve(output, 'codec-core-source-bundle.json'), JSON.stringify(coreSourceBundle, null, 2)+'\n');
  artifacts.push('ai-director-studio-core-sources.zip', 'codec-core-source-bundle.json');
}
await writeFile(resolve(output, 'SHA256SUMS'), (await Promise.all(artifacts.map(async name => `${createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')}  ${name}`))).join('\n')+'\n');
console.log(JSON.stringify({ output, sourceCommit: head, coreSourceKind: core.sourceKind, pluginFiles: Object.keys(files).length, packages: inventory.length }));
