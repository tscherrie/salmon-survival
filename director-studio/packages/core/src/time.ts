/** Zeit-Hilfen. Dokumente rechnen framegenau in Ganzzahlen; die UI zeigt Sekunden. */

export function framesToSeconds(frames: number, fps: number): number {
  assertFps(fps);
  return frames / fps;
}

export function secondsToFrames(seconds: number, fps: number): number {
  assertFps(fps);
  return Math.round(seconds * fps);
}

/** `mm:ss.mmm` bzw. `h:mm:ss.mmm` für Werte ab einer Stunde. */
export function formatSeconds(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.abs(totalSeconds);
  let ms = Math.round(abs * 1000);
  const hours = Math.floor(ms / 3_600_000);
  ms -= hours * 3_600_000;
  const minutes = Math.floor(ms / 60_000);
  ms -= minutes * 60_000;
  const seconds = Math.floor(ms / 1000);
  ms -= seconds * 1000;
  const mmss = `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms, 3)}`;
  return hours > 0 ? `${sign}${hours}:${mmss}` : `${sign}${mmss}`;
}

export function formatTimecode(frame: number, fps: number): string {
  return formatSeconds(framesToSeconds(frame, fps));
}

/** Liest `ss`, `ss.mmm`, `mm:ss(.mmm)` oder `h:mm:ss(.mmm)` und liefert Sekunden. */
export function parseTimecode(value: string): number {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const parts = body.split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) {
    throw new Error(`Ungültiger Timecode: "${value}"`);
  }
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + Number(part);
  }
  return negative ? -seconds : seconds;
}

export function parseTimecodeToFrames(value: string, fps: number): number {
  return secondsToFrames(parseTimecode(value), fps);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rastet auf den nächsten Kandidaten ein, wenn er innerhalb der Toleranz liegt. */
export function snapToNearest(value: number, candidates: readonly number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Ungültige Bildrate: ${fps}`);
  }
}
