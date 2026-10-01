/**
 * Anzeigeformat für Zeit (DESIGN.md §9.2). Das Datenformat für den Director bleibt `mm:ss.mmm` aus Core; der Renderer
 * rechnet nur für die Anzeige um. Die Frames stehen getrennt (`frames`, inklusive Trennzeichen), weil sie überall
 * gedämpft dargestellt werden (`--text-3` bzw. 70 % Deckkraft).
 *
 * - `smpte`: `HH:MM:SS:FF` – Transport, Index-Readout
 * - `short`: `MM:SS:FF` (mit `HH:` ab einer Stunde) – Chips, Marker, Chat-Links, Toasts, Ansagen
 * - `ruler`: `m:ss`, bzw. `m:ss:ff`, sobald ein Frame mindestens 8 px breit ist (`pps / fps >= 8`)
 *
 * Drop-Frame (`;` vor den Frames) gilt für 29,97 und 59,94 fps. Andere gebrochene Raten zählen mit der nominellen
 * Rate ohne Drop. Zeitbasen über 120 „fps“ (Audio-Projekte rechnen in Millisekunden) zeigen Millisekunden (`.mmm`).
 */

export type TcStyle = 'smpte' | 'short' | 'ruler';

export interface TcParts {
  /** Stunden, Minuten, Sekunden (je nach Stil). */
  head: string;
  /** Frames inklusive Trennzeichen (`:12`, `;12`, `.400`); leer, wenn der Stil keine Frames zeigt. */
  frames: string;
}

/** Ab dieser Breite eines Frames (px) zeigt das Lineal Frames. */
export const RULER_FRAME_PX = 8;

/** Oberhalb dieser Rate gilt die Zeitbasis als Millisekunden-Raster (Audio-Projekte: 1000). */
const SUBSECOND_FPS = 120;

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** Zerlegt eine Framezahl in Stunden, Minuten, Sekunden und Rest (Frames bzw. Millisekunden). */
function split(frame: number, fps: number): { h: number; m: number; s: number; sub: number; subDigits: number; sep: string } {
  const f = Math.max(0, Math.round(frame));
  if (!Number.isFinite(fps) || fps <= 0) return { h: 0, m: 0, s: 0, sub: 0, subDigits: 2, sep: ':' };
  if (fps > SUBSECOND_FPS) {
    const ms = Math.round((f / fps) * 1000);
    const total = Math.floor(ms / 1000);
    return { h: Math.floor(total / 3600), m: Math.floor(total / 60) % 60, s: total % 60, sub: ms % 1000, subDigits: 3, sep: '.' };
  }
  const nominal = Math.round(fps);
  const digits = Math.max(2, String(nominal - 1).length);
  let counted = f;
  let sep = ':';
  if (!Number.isInteger(fps) && (nominal === 30 || nominal === 60)) {
    // SMPTE-Drop-Frame: je Minute 2 (bzw. 4) Framenummern auslassen, außer in jeder zehnten Minute
    const drop = nominal === 30 ? 2 : 4;
    const perTenMinutes = Math.round(fps * 600);
    const perMinute = nominal * 60 - drop;
    const tens = Math.floor(f / perTenMinutes);
    const rest = f % perTenMinutes;
    counted = f + drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
    sep = ';';
  }
  const total = Math.floor(counted / nominal);
  return { h: Math.floor(total / 3600), m: Math.floor(total / 60) % 60, s: total % 60, sub: counted % nominal, subDigits: digits, sep };
}

/** Timecode in Kopf und Frames zerlegt (siehe Modulbeschreibung). `pps` braucht nur der Stil `ruler`. */
export function tcParts(frame: number, fps: number, style: TcStyle, opts: { pps?: number } = {}): TcParts {
  const { h, m, s, sub, subDigits, sep } = split(frame, fps);
  const frames = `${sep}${pad(sub, subDigits)}`;
  switch (style) {
    case 'smpte':
      return { head: `${pad(h)}:${pad(m)}:${pad(s)}`, frames };
    case 'short':
      return { head: h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`, frames };
    case 'ruler': {
      const head = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
      const showFrames = opts.pps !== undefined && fps > 0 && opts.pps / fps >= RULER_FRAME_PX;
      return { head, frames: showFrames ? frames : '' };
    }
  }
}

/** Timecode als ein String (Kopf plus Frames), z. B. für Ansagen und `aria-label`. */
export function formatTc(frame: number, fps: number, style: TcStyle, opts: { pps?: number } = {}): string {
  const { head, frames } = tcParts(frame, fps, style, opts);
  return head + frames;
}
