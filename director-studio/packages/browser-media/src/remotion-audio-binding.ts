/**
 * The extension renders Remotion video with muted:true, then mixes/encodes audio
 * with its owned FFmpeg runtime. Remotion's optional audio fallbacks must not
 * bring unrelated prebuilt encoder WASM into either extension bundle.
 *
 * These exports match Remotion 4.0.532's three lazy registration imports. They
 * deliberately reject an unexpected unmuted fallback rather than omit audio.
 */
function rejectRemotionAudioFallback(codec: string): never {
  throw new Error(`Remotion ${codec} audio fallback is unavailable in Director Studio. Render Remotion video with muted:true and use the owned FFmpeg audio export/mux.`);
}

export function registerAacEncoder(): never { return rejectRemotionAudioFallback('AAC'); }
export function registerMp3Encoder(): never { return rejectRemotionAudioFallback('MP3'); }
export function registerFlacEncoder(): never { return rejectRemotionAudioFallback('FLAC'); }
