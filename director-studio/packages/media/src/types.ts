/** Öffentliche Ergebnis-Typen von @studio/media. */

export interface MediaInfo {
  /** Gesamtdauer in ms (0 bei Standbildern). */
  durationMs: number;
  /** Echte Videospur vorhanden (eingebettete Cover-Bilder zählen nicht). */
  hasVideo: boolean;
  hasAudio: boolean;
  /** Anzeigebreite/-höhe (Rotation bereits berücksichtigt). */
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  /** Rotation laut Metadaten in Grad (0, 90, 180, 270). */
  rotation?: number;
  /** Gesamt-Bitrate in bit/s. */
  bitRate?: number;
  /** Containerformat laut ffprobe (z. B. `mov,mp4,m4a,3gp,3g2,mj2`). */
  formatName?: string;
  /** Einzelbild (PNG/JPEG/…), keine Bewegtbildspur. */
  isStillImage?: boolean;
  /** Dauer der ersten Videospur in ms, falls abweichend bekannt. */
  videoDurationMs?: number;
  /** Dauer der ersten Audiospur in ms, falls abweichend bekannt. */
  audioDurationMs?: number;
}

export interface BeatAnalysis {
  /** Tempo in Schlägen pro Minute (0, wenn keines erkennbar ist). */
  bpm: number;
  /** Schlagzeiten in Sekunden. */
  beats: number[];
  /** Taktanfänge (jeder 4. Schlag, ausgerichtet an der stärksten Betonung). */
  downbeats: number[];
  /** Einsatzzeiten (Onsets) in Sekunden. */
  onsets: number[];
  /** Heuristische Sicherheit 0..1. */
  confidence: number;
}

export interface AvSyncResult {
  /** Versatz in ms; positiv = Ton/Bewegung im Video kommt später als die Referenz. */
  offsetMs: number;
  /** Sicherheit 0..1. */
  confidence: number;
  method: 'audio' | 'motion';
  /** Kurze deutsche Erläuterung für Director und Panel. */
  note: string;
}

/** Normierter Bildausschnitt (0..1, bezogen auf die Anzeigegröße). */
export interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}
