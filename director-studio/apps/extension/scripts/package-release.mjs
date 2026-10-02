import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

const extension = fileURLToPath(new URL('..', import.meta.url));
const studio = resolve(extension, '../..');
const repo = resolve(studio, '..');
const output = resolve(process.argv[2] ?? '/tmp/director-studio-release');
const plugin = resolve(extension, 'plugin');
const releasePaths = ['director-studio', 'docs/director-studio', '.openai/hosting.example.json', 'drizzle'];
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...releasePaths], { cwd: repo, encoding: 'utf8' }).trim()) throw new Error('Commit all release source inputs before packaging.');
const manifest = JSON.parse(await readFile(resolve(plugin, 'plugin.json'), 'utf8'));
const openai = manifest.extensions?.['com.openai'];
if (!openai) throw new Error('OpenAI Extension metadata is required.');
const mcp = JSON.parse(await readFile(resolve(plugin, 'mcp.json'), 'utf8'));
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
files[`${manifest.name}/SOURCE-CHECKPOINT.txt`] = strToU8(`${head}\nThis package is preparation material. It does not complete Portal promotion, public policy URLs, reviewer access or native demo verification. Individual Verified identity was confirmed in a read-only Portal view; canonical Sites-app/project mapping remains unresolved. No legal attestation is made. Sites owns the existing canonical private plugin; do not upload this as a duplicate private plugin.\n`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'ai-director-studio-plugin.zip'), zipSync(files, { level: 9 }));
execFileSync('git', ['archive', '--format=zip', '--prefix=ai-director-studio-source/', '-o', resolve(output, 'ai-director-studio-source.zip'), head, ...releasePaths], { cwd: repo });
const packages = JSON.parse(await readFile(resolve(studio, 'package-lock.json'), 'utf8')).packages;
const inventory = Object.entries(packages).filter(([path]) => path.includes('node_modules/')).map(([path, value]) => ({ path, version: value.version, license: value.license ?? 'Inspect package license', resolved: value.resolved, integrity: value.integrity }));
await writeFile(resolve(output, 'dependency-licenses.json'), JSON.stringify({ sourceCommit: head, scope: 'Exact entire source workspace lockfile; desktop-only packages are included and are not all shipped by the Extension.', packages: inventory }, null, 2));
await writeFile(resolve(output, 'SOURCE-CHECKPOINT.txt'), `${head}\n`);
await writeFile(resolve(output, 'README.txt'), `AI Director Studio 0.1.0 — review preparation
Source checkpoint: ${head}

ai-director-studio-plugin.zip: portable metadata, native Director skill, verified HTTPS MCP endpoint, icons and preserved MIT notices. The endpoint is private. Sites owns the already installed canonical plugin; this ZIP is not a second private installation.

ai-director-studio-source.zip: extract, enter director-studio, run npm ci then npm run extension:build. The included .openai/hosting.example.json has no Site ID and is used for local builds. Deployment requires your own provisioned Site identity. Root drizzle migrations are included.

dependency-licenses.json: exact complete workspace dependency inventory. MIT applies to application source, not all dependencies. Pinned codec/toolchain source archives, exact binary hashes and corresponding-source limits are in apps/extension/release/codec-sources and license-inventory.md. The independent operator with at most three people meets the Remotion Free criterion; no paid Remotion plan is pending. No third-party runtime WASM is vendored in the source ZIP.

The source contains apps/extension/release/acceptance.md and function-coverage.md with precise test and live MCP evidence. The real native start was human-confirmed at cf761; complete native context/Library/category flows and a second real account remain unverified. A recorded SDK-browser demo is supporting evidence, not the required native reviewer walkthrough. Public policy/support URLs, canonical reviewer access, country targeting and Portal promotion remain unresolved. Individual Verified identity is observed in a read-only Portal view; no legal attestation is made.
`);
const artifacts = ['ai-director-studio-plugin.zip', 'ai-director-studio-source.zip', 'dependency-licenses.json', 'SOURCE-CHECKPOINT.txt', 'README.txt'];
await writeFile(resolve(output, 'SHA256SUMS'), (await Promise.all(artifacts.map(async name => `${createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')}  ${name}`))).join('\n')+'\n');
console.log(JSON.stringify({ output, sourceCommit: head, pluginFiles: Object.keys(files).length, packages: inventory.length }));
