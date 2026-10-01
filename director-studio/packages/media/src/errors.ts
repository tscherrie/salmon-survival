/** Fehlerarten der Medien-Pipeline. */
export type MediaErrorCode =
  /** ffmpeg/ffprobe nicht gefunden oder nicht ausführbar. */
  | 'binary_missing'
  /** Prozess mit Exit-Code ≠ 0 beendet. */
  | 'process_failed'
  /** Über `AbortSignal` abgebrochen. */
  | 'aborted'
  /** Ungültige Parameter oder ungeeignete Eingabe. */
  | 'invalid_input'
  /** Datei hat keine Audiospur. */
  | 'no_audio'
  /** Datei hat keine Videospur. */
  | 'no_video'
  /** Ausgabe von ffmpeg/ffprobe ließ sich nicht auswerten. */
  | 'parse_failed';

export interface MediaErrorOptions {
  stderrTail?: string;
  command?: string;
  exitCode?: number | null;
  cause?: unknown;
}

/** Fehler der Medienwerkzeuge; die Meldung ist deutsch und enthält das Ende von stderr. */
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  /** Letzte Zeilen von stderr (gekürzt), falls ein Prozess beteiligt war. */
  readonly stderrTail?: string;
  /** Aufgerufenes Programm samt Argumenten (nur zur Diagnose). */
  readonly command?: string;
  readonly exitCode?: number | null;

  constructor(code: MediaErrorCode, message: string, options: MediaErrorOptions = {}) {
    const tail = options.stderrTail?.trim();
    super(tail ? `${message}\n--- stderr (Ende) ---\n${tail}` : message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'MediaError';
    this.code = code;
    if (tail) this.stderrTail = tail;
    if (options.command !== undefined) this.command = options.command;
    if (options.exitCode !== undefined) this.exitCode = options.exitCode;
  }
}

/** Letzte `maxLines` Zeilen (höchstens `maxChars` Zeichen) eines stderr-Texts. */
export function stderrTail(stderr: string, maxLines = 12, maxChars = 2000): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
  const tail = lines.slice(-maxLines).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}
