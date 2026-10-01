/**
 * @studio/media – lokale Medienverarbeitung mit ffmpeg/ffprobe (der „leichte, lokale“ Teil
 * des hybriden Rechenmodells): Probe, Proxies, Vorschaubilder, Filmstreifen, Kontaktabzüge,
 * Peaks, Lautheit, Schnitt, Beat-Analyse, A/V-Sync-Prüfung und Audiomix einer Timeline.
 */
export { MediaToolkit, defaultMediaToolkit, parseLoudnormJson, type MediaConfig, type FfmpegCapabilities } from './toolkit.ts';
export { MediaError, type MediaErrorCode } from './errors.ts';
export type { MediaInfo, BeatAnalysis, AvSyncResult, Roi } from './types.ts';
export {
  buildAudioMixGraph,
  atempoChain,
  keyRanges,
  clipContributesAudio,
  timelineHasMixAudio,
  DUCKING,
  type AudioMixGraph,
  type AudioMixInput,
  type AudioMixOptions,
} from './mix.ts';
export { beatMarkers, type BeatMarkerOptions } from './markers.ts';
export { estimateOffset, type OffsetEstimate } from './dsp/xcorr.ts';
export { detectBeatsFromPcm, onsetEnvelope, type OnsetEnvelope } from './dsp/beats.ts';
export { FFT, hannWindow, nextPowerOfTwo } from './dsp/fft.ts';
export { rmsEnvelope, movingAverage, syncFeature, resampleLinear, PeakAccumulator, RmsEnvelopeAccumulator } from './dsp/signal.ts';
export { parseProbeJson, parseRate } from './probe.ts';
export {
  formatFfmpegTime,
  escapeFilterOptionValue,
  escapeFilterGraph,
  filterValue,
  audioCodecArgs,
} from './ffmpeg-syntax.ts';
export { runProcess, describeCommand, type RunOptions, type RunResult } from './process.ts';
