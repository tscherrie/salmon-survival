import { utilityProcess } from 'electron';
import type { NodeLauncher } from '@studio/render';
import type { ForkWorker } from './chromium.ts';

/**
 * Node-Kindprozesse der App als Electron-utilityProcess. Die ausgelieferte App deaktiviert die Fuse `RunAsNode`
 * (sonst könnte jeder lokale Prozess mit ELECTRON_RUN_AS_NODE beliebiges JavaScript unter der Identität der App
 * ausführen – Schlüsselbund, Mikrofon). `process.execPath` + ELECTRON_RUN_AS_NODE würde dann die App ein zweites Mal
 * starten; ein utilityProcess ist der vorgesehene Weg für Node-Code in einem eigenen Prozess.
 */

/** Hilfsprozess für Remotions Chromium-Download (chromium-worker.js). */
export const forkUtilityWorker: ForkWorker = (modulePath, { cwd }) => {
  const child = utilityProcess.fork(modulePath, [], { cwd, stdio: 'ignore', serviceName: 'Chromium-Bereitstellung' });
  return {
    onMessage: (listener) => void child.once('message', listener),
    onExit: (listener) => void child.once('exit', listener),
    kill: () => void child.kill(),
  };
};

/**
 * Vite-Dev-Server der Website-Vorschau (aus dem node_modules des Site-Ordners). Fremder Code: Er darf nicht signierte
 * native Module laden (Vites Binärpakete aus dem Site-Ordner) und läuft – unter macOS – nicht auf die
 * Datenschutzfreigaben der App (`disclaim`, z. B. Mikrofon).
 */
export const utilityNodeLauncher: NodeLauncher = (script, args, { cwd, env }) => {
  const child = utilityProcess.fork(script, args, {
    cwd,
    env,
    stdio: 'pipe',
    serviceName: 'Website-Vorschau (Vite)',
    allowLoadingUnsignedLibraries: true,
    disclaim: true,
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill(force) {
      if (force && child.pid !== undefined) {
        try {
          process.kill(child.pid, 'SIGKILL');
          return;
        } catch {
          // schon beendet – unten regulär
        }
      }
      child.kill();
    },
  };
};
