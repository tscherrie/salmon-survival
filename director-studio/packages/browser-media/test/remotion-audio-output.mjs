// Focused acceptance for removing Remotion's unused prebuilt audio fallbacks.
// Uses the emitted Vite sandbox and emitted self-contained native sandbox. The
// local HTTP fixture supplies runtime bytes; it does not simulate a native host.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRemotionEsbuildBinding, auditRemotionAudioEmission } from '../../../apps/extension/scripts/remotion-audio-binding.mjs';
import { loadCoreArtifacts } from '../../../apps/extension/scripts/adopt-owned-core.mjs';

const studio = fileURLToPath(new URL('../../../', import.meta.url)), dist = path.resolve(studio, '../dist/client');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'director-remotion-audio-outputs.'));
const run = promisify(execFile), sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const core = await loadCoreArtifacts(studio);
if (core.sourceKind !== 'owned-build') throw new Error('Acceptance requires the actual owned core.');
const report = { schemaVersion: 1, inspectedAtUtc: new Date().toISOString(), output, coreSourceKind: core.sourceKind, formats: [], checks: {}, browserErrors: [], limits: ['Actual emitted extension documents and owned runtime are exercised in a local HTTP browser fixture; production native host SDK/CSP and separate desktop builds are not established.'] };
report.emissionAudit = await auditRemotionAudioEmission(studio, dist);
await build({ stdin: { contents: "import * as media from './packages/browser-media/src/index.ts';import * as core from './packages/core/src/index.ts';window.media=media;window.core=core;", resolveDir: studio, sourcefile: 'remotion-audio-fixture.ts' }, outfile: path.join(output, 'test.js'), bundle: true, metafile: true, plugins: [createRemotionEsbuildBinding(studio)], platform: 'browser', format: 'esm', target: 'chrome140', define: { 'process.env.NODE_ENV': '"production"' } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }, requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid'); requests.push(url.pathname);
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('cross-origin-resource-policy', 'cross-origin');
  try {
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><script type="module" src="/test.js"></script></body></html>'); return; }
    const filename = url.pathname === '/test.js' ? path.join(output, 'test.js') : path.resolve(dist, '.' + url.pathname);
    if (filename !== path.join(output, 'test.js') && !filename.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    res.setHeader('content-type', types[path.extname(filename)] ?? 'application/octet-stream'); res.end(await fs.readFile(filename));
  } catch (error) { res.writeHead(404); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', error => report.browserErrors.push(error.message));
await page.exposeBinding('saveOutput', async (_source, metadata, base64) => {
  const bytes = Buffer.from(base64, 'base64'); await fs.writeFile(path.join(output, metadata.filename), bytes); report.formats.push({ ...metadata, bytes: bytes.length, sha256: sha256(bytes) });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.media && window.core);
  report.checks = await page.evaluate(async () => {
    const m = window.media, c = window.core, checks = {}, rate = 48000;
    const tone = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(i / rate * 2 * Math.PI * 550) * .16);
    const audio = m.encodeWav([tone, tone], rate), assets = { tone: { id: 'tone', kind: 'audio', url: URL.createObjectURL(audio) } };
    const doc = c.createTimeline({ fps: 30, format: { id: 'proof', width: 320, height: 180 }, durationFrames: 60 });
    doc.tracks.find(track => track.id === 'A1').clips.push({ id: 'tone', assetId: 'tone', start: 0, duration: 60, in: 0, speed: 1 });
    const source = "import React from 'react';export default ()=> <div style={{position:'absolute',inset:0,background:'#2488aa'}}/>";
    const visual = structuredClone(doc); visual.components.background = { assetId: 'source', name: 'Actual TSX frame' };
    visual.tracks.find(track => track.kind === 'overlay').clips.push({ id: 'background', componentId: 'background', start: 0, duration: 60, in: 0, speed: 1 });
    const visualAssets = { ...assets, source: { id: 'source', kind: 'code', url: URL.createObjectURL(new Blob([source], { type: 'text/plain' })) } };
    const inspect = async (result, context) => {
      const decoded = await m.decodeAudio(result.blob), pcm = decoded.getChannelData(0);
      let energy = 0; for (const sample of pcm) energy += sample * sample;
      const rms = Math.sqrt(energy / pcm.length);
      if (decoded.duration < 1.95 || decoded.duration > 2.15 || decoded.numberOfChannels !== 2 || rms < .04) throw new Error(`Audio missing/invalid in ${result.filename}: ${decoded.duration}s, channels ${decoded.numberOfChannels}, RMS ${rms}`);
      let video;
      if (/\.(mp4|mov)$/.test(result.filename)) {
        const el = document.createElement('video'); el.muted = true; el.src = URL.createObjectURL(result.blob); document.body.append(el);
        const event = name => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Video decode ${name} timeout`)), 10000); el.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true }); el.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Video decode failed')); }, { once: true }); });
        await event('loadeddata'); const seeked = event('seeked'); el.currentTime = .5; await seeked;
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const ctx = canvas.getContext('2d'); ctx.drawImage(el, 0, 0);
        const pixel = [...ctx.getImageData(160, 90, 1, 1).data]; video = { width: el.videoWidth, height: el.videoHeight, duration: el.duration, pixel };
        if (video.width !== 320 || video.height !== 180 || Math.abs(pixel[0] - 36) > 15 || Math.abs(pixel[1] - 136) > 15 || Math.abs(pixel[2] - 170) > 15) throw new Error(`TSX video frame missing in ${result.filename}: ${pixel}`);
        URL.revokeObjectURL(el.src); el.remove();
      }
      const bytes = new Uint8Array(await result.blob.arrayBuffer()); let raw = ''; for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
      await window.saveOutput({ filename: result.filename, mimeType: result.mimeType, context, audio: { duration: decoded.duration, channels: decoded.numberOfChannels, sampleRate: decoded.sampleRate, decodedFrames: decoded.length, rms }, video }, btoa(raw));
    };
    for (const format of ['mp3', 'm4a', 'flac']) await inspect(await m.exportProject({ document: doc, assets, format, filename: `own-audio.${format}` }), 'actual own-core application audio export');
    for (const format of ['mp4', 'mov']) await inspect(await m.exportProject({ document: visual, assets: visualAssets, components: { background: source }, format, filename: `vite-video.${format}` }), 'emitted Vite opaque sandbox muted Remotion video plus own-core AAC mux');
    // Exercise the actual self-contained native-sandbox.html too, with finished
    // media supplied through its production MessagePort, without a host mock.
    const frame = document.createElement('iframe'); frame.sandbox.add('allow-scripts'); frame.style.cssText = 'width:320px;height:180px';
    const client = new m.MediaSandboxClient(frame); frame.src = '/native-sandbox.html'; document.body.append(frame);
    try {
      for (const format of ['mp4', 'mov']) await inspect(await client.export({ document: visual, assets: visualAssets, components: { background: source }, format, filename: `native-video.${format}` }), 'emitted self-contained native opaque sandbox muted Remotion video plus own-core classic AAC mux');
      let parentAccessDenied = false; try { void frame.contentWindow.document; } catch { parentAccessDenied = true; }
      checks.nativeIsolation = { sandbox: frame.getAttribute('sandbox'), parentAccessDenied };
      if (!parentAccessDenied) throw new Error('Native media iframe lost opaque isolation.');
    } finally { client.dispose(); frame.remove(); }
    const abort = new AbortController(); let cancelledAt = null, cancelError = '';
    try {
      await m.exportProject({ document: visual, assets: visualAssets, components: { background: source }, format: 'mp4', filename: 'cancelled.mp4', signal: abort.signal, onProgress: (phase, progress) => { if (phase === 'Video' && progress > 0 && progress < 1 && !abort.signal.aborted) { cancelledAt = { phase, progress }; abort.abort(); } } });
    } catch (error) { cancelError = error.name; }
    if (!cancelledAt || cancelError !== 'AbortError') throw new Error(`In-progress video cancellation failed: ${JSON.stringify(cancelledAt)} / ${cancelError}`);
    checks.cancel = { cancelledAt, cancelError, noCompletedCancelledOutput: true };
    await inspect(await m.exportProject({ document: visual, assets: visualAssets, components: { background: source }, format: 'mp4', filename: 'video-after-cancel.mp4' }), 'fresh video export after in-progress cancellation');
    checks.recovery = true;
    for (const asset of Object.values(visualAssets)) URL.revokeObjectURL(asset.url);
    return checks;
  });
  for (const file of report.formats) {
    file.ffprobe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(output, file.filename)])).stdout);
    const audio = file.ffprobe.streams.find(stream => stream.codec_type === 'audio');
    const expected = /\.mp3$/.test(file.filename) ? 'mp3' : /\.flac$/.test(file.filename) ? 'flac' : 'aac';
    if (audio?.codec_name !== expected) throw new Error(`Wrong audio codec in ${file.filename}: ${audio?.codec_name}`);
    if (/\.(mp4|mov)$/.test(file.filename) && file.ffprobe.streams.find(stream => stream.codec_type === 'video')?.codec_name !== 'h264') throw new Error(`Wrong video codec in ${file.filename}`);
    await run('ffmpeg', ['-v', 'error', '-i', path.join(output, file.filename), '-f', 'null', '-']); file.fullDecodePassed = true;
  }
  report.checks.noLegacyEncoderRequests = !requests.some(request => /(?:aac|mp3|flac)-encoder/.test(request));
  report.checks.mutedRemotionDidNotLoadAudioFallback = !requests.some(request => /remotion-audio-binding-.*\.js$/.test(request));
  // The throw binding chunk need not execute/load while muted. Its absence is
  // expected and is separately proved by emitted-byte/input regression guards.
  if (!report.checks.noLegacyEncoderRequests || !report.checks.mutedRemotionDidNotLoadAudioFallback || report.browserErrors.length || report.formats.length !== 8) throw new Error('Focused browser acceptance failed.');
  report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  report.completedAtUtc = new Date().toISOString(); report.requestPaths = [...new Set(requests)].sort();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); server.close();
}
console.log(JSON.stringify({ output, passed: report.passed, formats: report.formats.map(file => ({ filename: file.filename, bytes: file.bytes, fullDecodePassed: file.fullDecodePassed, context: file.context })), checks: report.checks, error: report.error, browserErrors: report.browserErrors }, null, 2));
