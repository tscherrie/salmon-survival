import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';

const extension = fileURLToPath(new URL('..', import.meta.url));
const studio = resolve(extension, '../..');
const repo = resolve(studio, '..');
const output = resolve(process.argv[2] ?? '/tmp/director-studio-release');
const plugin = resolve(extension, 'plugin');
const manifest = JSON.parse(await readFile(resolve(plugin, 'plugin.json'), 'utf8'));
const mcp = JSON.parse(await readFile(resolve(plugin, 'mcp.json'), 'utf8'));
if (manifest.extensions.com.openai.interface.shortDescription.length > 30) throw new Error('Listing subtitle exceeds 30 characters.');
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
if (manifest.extensions.com.openai.apps != null || manifest.apps != null) throw new Error('App bindings are not portable public upload fields.');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
files[`${manifest.name}/SOURCE-CHECKPOINT.txt`] = strToU8(`${head}\nThis package is preparation material. It does not complete Portal promotion, public policy URLs, reviewer access or native demo verification. Publisher Verified is user-reported; no legal attestation is made. Sites owns the existing canonical private plugin; do not upload this as a duplicate private plugin.\n`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'ai-director-studio-plugin.zip'), zipSync(files, { level: 9 }));
execFileSync('git', ['archive', '--format=zip', '--prefix=ai-director-studio-source/', '-o', resolve(output, 'ai-director-studio-source.zip'), head, 'director-studio', 'docs/director-studio', 'LICENSE'], { cwd: repo });
const packages = JSON.parse(await readFile(resolve(studio, 'package-lock.json'), 'utf8')).packages;
const inventory = Object.entries(packages).filter(([path]) => path.includes('node_modules/')).map(([path, value]) => ({ path, version: value.version, license: value.license ?? 'Inspect package license', resolved: value.resolved, integrity: value.integrity }));
await writeFile(resolve(output, 'dependency-licenses.json'), JSON.stringify({ sourceCommit: head, scope: 'Exact entire source workspace lockfile; desktop-only packages are included and are not all shipped by the Extension.', packages: inventory }, null, 2));
console.log(JSON.stringify({ output, sourceCommit: head, pluginFiles: Object.keys(files).length, packages: inventory.length }));
