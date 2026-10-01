/**
 * Hilfsprozess: stellt Remotions Chromium-Headless-Shell bereit (Download nur beim ersten Mal) und meldet den Pfad.
 * Läuft in der App als Electron-utilityProcess (Einstieg out/main/chromium-worker.js), in Tests über
 * `child_process.fork`. Warum ein eigener Prozess: siehe chromium.ts.
 *
 * Ziel ist Remotions Cache relativ zum Arbeitsordner dieses Prozesses (`<runtime>/node_modules/.remotion`).
 * Antwort: genau eine Nachricht vom Typ `ChromiumWorkerResult`.
 */
import { ensureBrowser } from '@remotion/renderer';
import type { ChromiumWorkerResult } from './chromium.ts';

type ParentPort = { postMessage(message: unknown): void };
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

function reply(result: ChromiumWorkerResult): void {
  if (parentPort) parentPort.postMessage(result);
  else if (process.send) process.send(result);
  else process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  const status = await ensureBrowser({ logLevel: 'error', chromeMode: 'headless-shell' });
  reply('path' in status && status.path ? { ok: true, path: status.path } : { ok: false, message: 'Remotion hat keinen Pfad zur Headless-Shell geliefert' });
} catch (error) {
  reply({ ok: false, message: error instanceof Error ? error.message : String(error) });
}

// Der Hauptprozess beendet den Hilfsprozess nach der Antwort; sonst nach kurzer Frist selbst beenden.
setTimeout(() => process.exit(0), 3000);
