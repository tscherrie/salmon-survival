import { useCallback, useEffect, useRef } from 'react';
import { alignClicksToWords, type ComposerSegment } from '@studio/core';
import { t } from '../../i18n.ts';
import { useActions, useApi, useStudioStore } from '../../state/context.tsx';

/**
 * Push-to-Talk: Aufnahme per MediaRecorder, solange der Mikrofon-Button bzw. Strg/⌘+Shift+Leertaste
 * gehalten wird. Bühnenklicks während der Aufnahme werden mit Zeitstempel gesammelt (Store) und nach
 * der Transkription per `alignClicksToWords` hinter das passende Wort gesetzt.
 */

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  audioContext: AudioContext | null;
  raf: number;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

export function usePushToTalk(): { start: () => Promise<void>; stop: () => Promise<void> } {
  const api = useApi();
  const actions = useActions();
  const store = useStudioStore();
  const recording = useRef<Recording | null>(null);
  const wanted = useRef(false);
  const starting = useRef(false);

  const cleanup = (rec: Recording) => {
    cancelAnimationFrame(rec.raf);
    rec.stream.getTracks().forEach((track) => track.stop());
    void rec.audioContext?.close().catch(() => undefined);
  };

  const stop = useCallback(async () => {
    wanted.current = false;
    const rec = recording.current;
    if (!rec) return;
    recording.current = null;
    const stopped = new Promise<void>((resolve) => rec.recorder.addEventListener('stop', () => resolve(), { once: true }));
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    else rec.recorder.dispatchEvent(new Event('stop'));
    await stopped;
    cleanup(rec);
    const clicks = actions.stopVoice();
    const projectId = store.getState().projectId;
    if (!projectId) return;
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
    actions.setVoiceTranscribing(true);
    try {
      const buffer = await blobToArrayBuffer(blob);
      const result = await api.transcribe(projectId, buffer, blob.type || 'audio/webm');
      const segments = alignClicksToWords(result.words, clicks);
      if (segments.length) actions.insertSegments(segments);
    } catch (error) {
      actions.toast('error', t('voice.failed', { error: error instanceof Error ? error.message : String(error) }));
      // Referenzen nicht verlieren
      const refs: ComposerSegment[] = clicks.map((c) => ({ type: 'ref', ref: c.ref }));
      if (refs.length) actions.insertSegments(refs);
    } finally {
      actions.setVoiceTranscribing(false);
    }
  }, [api, actions, store]);

  const start = useCallback(async () => {
    if (recording.current || starting.current || store.getState().voice.transcribing) return;
    wanted.current = true;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia || typeof MediaRecorder === 'undefined') {
      actions.toast('error', t('voice.unavailable', { error: 'MediaRecorder/getUserMedia fehlt' }));
      return;
    }
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({ audio: true });
    } catch (error) {
      starting.current = false;
      actions.toast('error', t('voice.unavailable', { error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    starting.current = false;
    if (!wanted.current) {
      // Schon wieder losgelassen, bevor das Mikrofon bereit war
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const recorder = new MediaRecorder(stream);
    const rec: Recording = { recorder, stream, chunks: [], audioContext: null, raf: 0 };
    recorder.addEventListener('dataavailable', (e: BlobEvent) => {
      if (e.data && e.data.size > 0) rec.chunks.push(e.data);
    });
    recording.current = rec;
    recorder.start();
    actions.startVoice(performance.now());
    // Pegelanzeige (optional – ohne Web Audio einfach aus)
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        rec.audioContext = ctx;
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          actions.setVoiceLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
          rec.raf = requestAnimationFrame(tick);
        };
        rec.raf = requestAnimationFrame(tick);
      }
    } catch {
      // kein Pegel
    }
  }, [actions, store]);

  // Strg/⌘ + Shift + Leertaste halten
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!e.repeat) void start();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!recording.current && !starting.current) return;
      if (e.code === 'Space' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') void stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [start, stop]);

  // Beim Verlassen laufende Aufnahme beenden
  useEffect(
    () => () => {
      const rec = recording.current;
      if (rec) {
        recording.current = null;
        if (rec.recorder.state !== 'inactive') rec.recorder.stop();
        cleanup(rec);
        actions.stopVoice();
      }
    },
    [actions],
  );

  return { start, stop };
}
