import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parse } from 'acorn';

const codecs = ['aac', 'mp3', 'flac'];
const packages = codecs.map(codec => `@mediabunny/${codec}-encoder`);
const magic = Buffer.from([0, 97, 115, 109]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanPath = value => value.replaceAll('\\', '/').split('?')[0];
const legacyInput = value => /(?:^|\/)@mediabunny\/(?:aac|mp3|flac)-encoder(?:\/|$)/.test(cleanPath(value));

export function assertNoLegacyEncoderInputs(inputs) {
  const included = inputs.filter(legacyInput);
  if (included.length) throw new Error(`Prebuilt Remotion audio encoder entered the extension build: ${included.join(', ')}`);
}

export function resolveRemotionAudioBinding(source, importer, studio) {
  if (!packages.includes(source)) return null;
  const allowed = cleanPath(resolve(studio, 'node_modules/@remotion/web-renderer/dist/esm/index.mjs'));
  if (!importer || cleanPath(importer) !== allowed) throw new Error(`Unexpected ${source} importer: ${importer ?? '(entry)'}. The extension uses owned FFmpeg for audio.`);
  return resolve(studio, 'packages/browser-media/src/remotion-audio-binding.ts');
}

export async function validateRemotionAudioContract(studio) {
  const directory = join(studio, 'node_modules/@remotion/web-renderer');
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (pkg.version !== '4.0.532') throw new Error(`Review the Remotion audio binding for version ${pkg.version}; expected 4.0.532.`);
  const source = await readFile(join(directory, 'dist/esm/index.mjs'), 'utf8');
  const registrationImports = [];
  const nodes = [parse(source, { ecmaVersion: 'latest', sourceType: 'module' })];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern' && node.init?.type === 'AwaitExpression' && node.init.argument.type === 'ImportExpression') {
      const imported = node.init.argument.source.value;
      if (packages.includes(imported)) registrationImports.push({ package: imported, names: node.id.properties.map(p => p.key.name) });
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) nodes.push(...value); else if (value && typeof value === 'object') nodes.push(value);
  }
  for (const codec of codecs) {
    const matching = registrationImports.filter(row => row.package === `@mediabunny/${codec}-encoder`);
    const expected = `register${codec[0].toUpperCase()}${codec.slice(1)}Encoder`;
    if (matching.length !== 1 || matching[0].names.length !== 1 || matching[0].names[0] !== expected) throw new Error(`Remotion ${codec} registration contract changed; review the audio binding.`);
  }
  return { package: pkg.name, version: pkg.version, sourceSha256: hash(source), registrationImports };
}

export function createRemotionViteBinding(studio) {
  return {
    name: 'director-remotion-owned-audio', enforce: 'pre',
    async buildStart() { await validateRemotionAudioContract(studio); },
    resolveId(source, importer) { return resolveRemotionAudioBinding(source, importer, studio); },
    generateBundle(_options, bundle) {
      assertNoLegacyEncoderInputs(Object.values(bundle).filter(file => file.type === 'chunk').flatMap(file => Object.keys(file.modules)));
    },
  };
}

export function createRemotionEsbuildBinding(studio) {
  return {
    name: 'director-remotion-owned-audio',
    setup(build) {
      build.onStart(async () => { await validateRemotionAudioContract(studio); });
      build.onResolve({ filter: /^@mediabunny\/(aac|mp3|flac)-encoder$/ }, args => ({ path: resolveRemotionAudioBinding(args.path, args.importer, studio) }));
      build.onEnd(result => { if (result.metafile) assertNoLegacyEncoderInputs(Object.keys(result.metafile.inputs)); });
    },
  };
}

/** Decode literals, including encoder scripts carried inside inlineWorker strings. */
export function embeddedWasmInJavaScript(source, depth = 0) {
  const found = [], nodes = [parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    const value = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (typeof value === 'string' && value.length >= 16) {
      let bytes = Buffer.from(value, 'latin1');
      if (!bytes.subarray(0, 4).equals(magic)) bytes = Buffer.from(value.replace(/^data:application\/wasm;base64,/, ''), 'base64');
      if (bytes.subarray(0, 4).equals(magic)) found.push({ bytes: bytes.length, sha256: hash(bytes) });
      else if (depth < 3 && value.length > 10000 && /WebAssembly|wasmBinary|binaryDecode/.test(value)) {
        // An inline worker is executable JavaScript inside a literal. Plain binary,
        // paths and user-facing text need not parse as programs.
        try { found.push(...embeddedWasmInJavaScript(value, depth + 1)); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) nodes.push(...value); else if (value && typeof value === 'object') nodes.push(value);
  }
  return found;
}

export async function auditRemotionAudioEmission(studio, clientDirectory) {
  const referenceWasm = [];
  for (const codec of codecs) {
    const packageName = `@mediabunny/${codec}-encoder`, file = codec === 'mp3' ? 'lame' : codec;
    const source = await readFile(join(studio, `node_modules/${packageName}/dist/modules/build/${file}.js`), 'utf8');
    const wasm = embeddedWasmInJavaScript(source);
    if (wasm.length !== 1) throw new Error(`Expected one installed ${codec} reference WASM, found ${wasm.length}.`);
    referenceWasm.push({ package: packageName, ...wasm[0], shipped: false });
  }
  const files = [], binaryFiles = [], referenceHashes = new Set(referenceWasm.map(row => row.sha256));
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(absolute);
      else if (entry.isFile() && /(?:\.wasm|\.part\d+)$/.test(entry.name)) {
        const bytes = await readFile(absolute), sha256 = hash(bytes);
        if (referenceHashes.has(sha256)) throw new Error(`Original encoder WASM remains in ${relative(clientDirectory, absolute)}: ${sha256}`);
        binaryFiles.push({ path: relative(clientDirectory, absolute).replaceAll('\\', '/'), bytes: bytes.length, sha256, matchesLegacyReference: false });
      } else if (entry.isFile() && /\.(?:m?js|html)$/.test(entry.name)) {
        const bytes = await readFile(absolute), source = bytes.toString('utf8');
        const scripts = entry.name.endsWith('.html') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]).filter(Boolean) : [source];
        const embeddedWasm = scripts.flatMap(script => embeddedWasmInJavaScript(script));
        // The owned core is transported separately in checked .wasm parts. No
        // encoded WASM belongs in extension JavaScript or native HTML resources.
        if (embeddedWasm.length) throw new Error(`Embedded WASM remains in ${relative(clientDirectory, absolute)}: ${embeddedWasm.map(row => row.sha256).join(', ')}`);
        files.push({ path: relative(clientDirectory, absolute).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes), embeddedWasmCount: 0 });
      }
    }
  }
  await inspect(clientDirectory);
  if (!files.some(file => file.path === 'native.html') || !files.some(file => file.path === 'native-sandbox.html')) throw new Error('Both native resources must be present for the Remotion audio emission audit.');
  return { schemaVersion: 1, inspectedAtUtc: new Date().toISOString(), method: 'Installed-reference WASM hashes compared with standalone/transport binary assets; AST-decoded direct and nested inline-worker literals in every emitted JS and inline HTML script; build input guards', passed: true, referenceWasm, files: files.sort((a, b) => a.path.localeCompare(b.path)), binaryFiles: binaryFiles.sort((a, b) => a.path.localeCompare(b.path)), originalEncoderWasmShipped: false, encodedWasmInJsOrNativeHtml: false };
}
