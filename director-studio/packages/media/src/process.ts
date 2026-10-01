import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { MediaError, stderrTail } from './errors.ts';

/** Optionen für einen ffmpeg/ffprobe-Aufruf (immer mit Argument-Array, nie über eine Shell). */
export interface RunOptions {
  signal?: AbortSignal;
  /**
   * `buffer`: stdout sammeln und zurückgeben; `ignore`: verwerfen;
   * Funktion: jeden Block sofort weiterreichen (Streaming, z. B. PCM).
   */
  stdout?: 'buffer' | 'ignore' | ((chunk: Buffer) => void);
  /** Wie viele Zeichen vom Ende von stderr aufbewahrt werden (Standard 256 KiB). */
  maxStderrChars?: number;
  /**
   * Fortschritt (0..1) über `-progress pipe:1`; nur zusammen mit `stdout: 'ignore'`
   * sinnvoll, weil die Fortschrittszeilen über stdout kommen.
   */
  progress?: { durationSec: number; onProgress: (ratio: number) => void };
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

/** Lesbare Kommandozeile für Diagnosezwecke (wird nie ausgeführt). */
export function describeCommand(bin: string, args: readonly string[]): string {
  const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`);
  return [bin, ...args].map(quote).join(' ');
}

/**
 * Startet ein Programm mit Argument-Array. Wirft `MediaError` bei Exit-Code ≠ 0,
 * fehlendem Programm oder Abbruch. stderr wird (gekürzt) für Fehlermeldungen behalten.
 */
export function runProcess(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const { signal, maxStderrChars = 256 * 1024 } = options;
  const stdoutMode = options.stdout ?? 'buffer';
  const fullArgs = options.progress ? ['-progress', 'pipe:1', '-nostats', ...args] : [...args];
  const command = describeCommand(bin, fullArgs);
  const tool = basename(bin).replace(/\.exe$/i, '');

  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MediaError('aborted', `${tool} wurde abgebrochen, bevor es gestartet ist.`, { command }));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch (error) {
      reject(spawnError(bin, tool, command, error));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let progressRest = '';
    let callbackError: unknown;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (options.progress) {
        progressRest += chunk.toString('utf8');
        const lines = progressRest.split('\n');
        progressRest = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
          if (m && options.progress.durationSec > 0) {
            const ratio = Number(m[1]) / 1e6 / options.progress.durationSec;
            safeCall(() => options.progress!.onProgress(Math.min(1, Math.max(0, ratio))));
          } else if (line.trim() === 'progress=end') {
            safeCall(() => options.progress!.onProgress(1));
          }
        }
        return;
      }
      if (stdoutMode === 'buffer') stdoutChunks.push(chunk);
      else if (typeof stdoutMode === 'function' && callbackError === undefined) {
        try {
          stdoutMode(chunk);
        } catch (error) {
          // Fehler im Verbraucher: Prozess beenden und den Fehler weiterreichen.
          callbackError = error;
          child.kill('SIGKILL');
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > maxStderrChars * 2) stderr = stderr.slice(-maxStderrChars);
    });

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(() => reject(new MediaError('aborted', `${tool} wurde abgebrochen.`, { command, stderrTail: stderrTail(stderr) })));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => finish(() => reject(spawnError(bin, tool, command, error))));
    child.on('close', (code, sig) => {
      if (stderr.length > maxStderrChars) stderr = stderr.slice(-maxStderrChars);
      if (callbackError !== undefined) {
        const err = callbackError;
        finish(() => reject(err instanceof MediaError ? err : new MediaError('parse_failed', `Verarbeitung der Ausgabe von ${tool} fehlgeschlagen: ${(err as Error)?.message ?? String(err)}`, { command, cause: err })));
        return;
      }
      if (code === 0) {
        finish(() => resolve({ stdout: Buffer.concat(stdoutChunks), stderr, exitCode: 0 }));
        return;
      }
      const reason = code === null ? `durch Signal ${sig ?? '?'} beendet` : `mit Exit-Code ${code} beendet`;
      finish(() =>
        reject(new MediaError('process_failed', `${tool} ist fehlgeschlagen (${reason}).`, { command, exitCode: code, stderrTail: stderrTail(stderr) })),
      );
    });
  });
}

function spawnError(bin: string, tool: string, command: string, error: unknown): MediaError {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'EACCES') {
    const envName = tool.toLowerCase().includes('ffprobe') ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
    return new MediaError(
      'binary_missing',
      `${tool} wurde nicht gefunden oder ist nicht ausführbar ("${bin}"). Pfad in den Einstellungen oder über ${envName} setzen.`,
      { command, cause: error },
    );
  }
  return new MediaError('process_failed', `${tool} konnte nicht gestartet werden: ${(error as Error)?.message ?? String(error)}`, { command, cause: error });
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // Fortschritts-Callbacks dürfen den Prozess nicht stören.
  }
}

/**
 * Zerlegt einen Byte-Strom in vollständige Float32-Blöcke (little-endian f32),
 * auch wenn Chunk-Grenzen mitten in einem Sample liegen.
 */
export class Float32StreamDecoder {
  private rest: Buffer = Buffer.alloc(0);
  /** `frameBytes`: Bytes je Frame (4 × Kanäle), damit Blöcke nie Kanäle zerreißen. */
  constructor(private readonly frameBytes = 4) {}

  push(chunk: Buffer): Float32Array {
    const data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const usable = data.length - (data.length % this.frameBytes);
    this.rest = Buffer.from(data.subarray(usable));
    if (usable === 0) return new Float32Array(0);
    const out = new Float32Array(usable / 4);
    // Kopie in einen ausgerichteten Puffer (Buffer-Pools sind nicht 4-Byte-ausgerichtet).
    new Uint8Array(out.buffer).set(data.subarray(0, usable));
    return out;
  }
}
