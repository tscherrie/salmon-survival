import { join } from 'node:path';
import { z } from 'zod';
import { formatSeconds, formatTimecode, secondsToFrames, type DocumentOp, type Version } from '@studio/core';
import { framePaths, normalizeBeats, normalizeLoudness, normalizeSync, pathOf } from '../normalize.ts';
import { PREVIEW_WIDTH } from '../preview.ts';
import { errorMessage, mediaIssueCollector, projectTempDir, readImageBlock, truncate, wrapUntrusted } from '../util.ts';
import { defineTool, errorResult, textResult, type ToolContent, type ToolContext } from './registry.ts';

export function emitVersion(ctx: ToolContext, version: Version): void {
  const { document: _d, ops: _o, ...meta } = version;
  ctx.ui.emit({ type: 'document', projectId: ctx.projectId, version: meta });
}

function requireMedia(ctx: ToolContext) {
  if (!ctx.media) throw new Error('Medienwerkzeuge (ffmpeg) sind nicht verfügbar.');
  return ctx.media;
}

function assetPath(ctx: ToolContext, assetId: string, kinds?: string[]): string {
  const asset = ctx.project.getAsset(assetId);
  if (!asset) throw new Error(`Asset „${assetId}“ existiert nicht.`);
  if (kinds && !kinds.includes(asset.kind)) throw new Error(`Asset „${assetId}“ ist vom Typ ${asset.kind}, erwartet ${kinds.join('/')}.`);
  const path = ctx.project.assetFilePath(asset);
  if (!path) throw new Error(`Asset „${assetId}“ hat keine Datei.`);
  return path;
}

async function timelineFps(ctx: ToolContext): Promise<number> {
  const doc = await ctx.project.getDocument();
  if (!doc || doc.kind !== 'timeline') throw new Error('Das Projekt hat keine Timeline.');
  return doc.fps;
}

export const framesTool = defineTool({
  name: 'frames',
  description: [
    'Zeigt dir Einzelbilder zu exakten Zeitpunkten – aus einem Video-Asset oder aus der aktuell gerenderten Timeline (inkl. Overlays, Text, Komponenten).',
    'Nutze es, um Shots, Übergänge, Text-Timing und Komposition wirklich anzusehen, statt sie dir vorzustellen. Höchstens 6 Zeitpunkte pro Aufruf; für einen Überblick ist contact_sheet günstiger.',
  ].join(' '),
  input: z.object({
    source: z.enum(['asset', 'timeline']).describe('"asset" = Video-Asset, "timeline" = aktueller Schnitt.'),
    assetId: z.string().optional().describe('Bei source "asset".'),
    timesSec: z.array(z.number().min(0)).min(1).max(6).describe('Zeitpunkte in Sekunden (bei timeline: Timeline-Zeit).'),
    formatId: z.string().optional().describe('Formatvariante der Timeline, z. B. "9:16".'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const content: ToolContent[] = [];
    const labels: string[] = [];
    try {
      if (args.source === 'timeline') {
        if (!ctx.render) return errorResult('Renderer ist nicht verfügbar.');
        const fps = await timelineFps(ctx);
        const dir = await projectTempDir(ctx.projectDir, 'frames');
        const issues = mediaIssueCollector();
        for (const [i, t] of args.timesSec.entries()) {
          const frame = secondsToFrames(t, fps);
          const out = await ctx.render.renderTimelineStill({
            frame,
            out: join(dir, `frame-${i}.png`),
            onMediaError: issues.onMediaError,
            ...(args.formatId ? { formatId: args.formatId } : {}),
          });
          const image = await readImageBlock(out);
          if (!image) continue;
          content.push({ type: 'text', text: `Timeline ${formatTimecode(frame, fps)} (Frame ${frame}${args.formatId ? `, ${args.formatId}` : ''}):` }, image);
          labels.push(formatTimecode(frame, fps));
        }
        const warning = issues.summary();
        if (warning) content.push({ type: 'text', text: warning });
      } else {
        if (!args.assetId) return errorResult('assetId fehlt (source "asset").');
        const media = requireMedia(ctx);
        const path = assetPath(ctx, args.assetId, ['video', 'image']);
        const dir = await projectTempDir(ctx.projectDir, 'frames');
        const frames = framePaths(await media.extractFrames(path, args.timesSec, dir, { width: PREVIEW_WIDTH, format: 'jpg' }), args.timesSec);
        for (const f of frames) {
          const image = await readImageBlock(f.path);
          if (!image) continue;
          content.push({ type: 'text', text: `${args.assetId} @ ${formatSeconds(f.timeSec)}:` }, image);
          labels.push(formatSeconds(f.timeSec));
        }
      }
    } catch (error) {
      return errorResult(errorMessage(error));
    }
    if (content.length === 0) return errorResult('Keine Bilder erzeugt.');
    return { content: [{ type: 'text', text: `${labels.length} Frames: ${labels.join(', ')}` }, ...content] };
  },
});

export const contactSheetTool = defineTool({
  name: 'contact_sheet',
  description: 'Erzeugt einen Kontaktabzug (Raster aus gleichmäßig verteilten Frames) eines Video-Assets – der schnellste Weg, einen ganzen Clip auf Identität, Bewegung, Artefakte und Kontinuität zu prüfen.',
  input: z.object({
    assetId: z.string(),
    count: z.number().int().min(4).max(24).optional().describe('Anzahl Frames (Standard 12).'),
    columns: z.number().int().min(2).max(6).optional().describe('Spalten (Standard 4).'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    try {
      const media = requireMedia(ctx);
      const path = assetPath(ctx, args.assetId, ['video']);
      const dir = await projectTempDir(ctx.projectDir, 'contact');
      const out = join(dir, 'contact-sheet.jpg');
      const result = pathOf(await media.contactSheet(path, out, { count: args.count ?? 12, columns: args.columns ?? 4, width: PREVIEW_WIDTH, tileWidth: Math.round(PREVIEW_WIDTH / (args.columns ?? 4)), labels: true })) ?? out;
      const image = await readImageBlock(result);
      if (!image) return errorResult('Kontaktabzug konnte nicht gelesen werden.');
      return { content: [{ type: 'text', text: `Kontaktabzug ${args.assetId} (${args.count ?? 12} Frames, Zeit läuft zeilenweise):` }, image] };
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const analyzeAudioTool = defineTool({
  name: 'analyze_audio',
  description: [
    'Analysiert ein Audio-Asset lokal: Tempo (BPM), Beats, Downbeats, Abschnitte und Lautheit (LUFS integriert, True Peak).',
    'Mit writeMarkers=true werden Beat-/Downbeat-Marker (und Abschnittsmarker) als neue Dokumentversion auf die Timeline geschrieben (offsetSec = Startzeit des Songs auf der Timeline) und eine Beat-Map als Daten-Asset gespeichert – Grundlage für Schnitt auf Beats und für Komponenten.',
  ].join(' '),
  input: z.object({
    assetId: z.string(),
    writeMarkers: z.boolean().optional(),
    offsetSec: z.number().min(0).optional().describe('Position des Audios auf der Timeline (Standard 0).'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    try {
      const media = requireMedia(ctx);
      const path = assetPath(ctx, args.assetId, ['audio', 'video']);
      const beats = normalizeBeats(await media.detectBeats(path));
      let loudnessText = '';
      try {
        const loud = normalizeLoudness(await media.loudness(path));
        loudnessText = `Lautheit: ${loud.integratedLufs !== undefined ? `${loud.integratedLufs.toFixed(1)} LUFS` : '?'} integriert, True Peak ${loud.truePeakDb !== undefined ? `${loud.truePeakDb.toFixed(1)} dBTP` : '?'}${loud.lra !== undefined ? `, LRA ${loud.lra.toFixed(1)} LU` : ''}`;
      } catch (error) {
        loudnessText = `Lautheit: nicht messbar (${errorMessage(error)})`;
      }
      const lines = [
        `Tempo: ${beats.bpm ? `${beats.bpm.toFixed(1)} BPM` : 'unbekannt'}${beats.confidence !== undefined ? ` (Konfidenz ${beats.confidence.toFixed(2)})` : ''}`,
        `${beats.beats.length} Beats, ${beats.downbeats.length} Downbeats${beats.sections.length ? `, ${beats.sections.length} Abschnitte` : ''}`,
        beats.beats.length ? `Erste Beats: ${beats.beats.slice(0, 16).map((t) => t.toFixed(2)).join(' ')}` : '',
        beats.downbeats.length ? `Erste Downbeats: ${beats.downbeats.slice(0, 8).map((t) => t.toFixed(2)).join(' ')}` : '',
        beats.sections.length ? `Abschnitte: ${beats.sections.map((s) => `${s.start.toFixed(2)}${s.label ? ` ${s.label}` : ''}`).join(' · ')}` : '',
        loudnessText,
      ].filter(Boolean);

      const beatMap = await ctx.project.addAssetFromBuffer(JSON.stringify({ sourceAssetId: args.assetId, ...beats }, null, 2), {
        fileName: 'beat-map.json',
        kind: 'data',
        subtype: 'beat-map',
        title: `Beat-Map ${ctx.project.getAsset(args.assetId)?.title ?? args.assetId}`,
        tags: ['beats'],
        source: 'derived',
        parents: [{ assetId: args.assetId, relation: 'extracted' }],
      });
      ctx.ui.emit({ type: 'asset', projectId: ctx.projectId, asset: beatMap });
      lines.push(`Beat-Map gespeichert: ${beatMap.id}`);

      if (args.writeMarkers) {
        const doc = await ctx.project.getDocument();
        if (!doc || doc.kind !== 'timeline') return errorResult(`${lines.join('\n')}\nMarker nicht geschrieben: Das Projekt hat keine Timeline.`);
        const offset = args.offsetSec ?? 0;
        const existing = new Set(doc.markers.map((m) => m.id));
        const prefix = args.assetId.replace(/[^A-Za-z0-9]/g, '').slice(-6);
        const ops: DocumentOp[] = [];
        const add = (id: string, t: number, kind: 'beat' | 'downbeat' | 'section', label?: string) => {
          if (existing.has(id)) return;
          ops.push({ op: 'add_marker', marker: { id, frame: secondsToFrames(t + offset, doc.fps), kind, ...(label ? { label } : {}) } });
        };
        const downbeatSet = new Set(beats.downbeats.map((t) => t.toFixed(3)));
        beats.beats.forEach((t, i) => {
          if (!downbeatSet.has(t.toFixed(3))) add(`b_${prefix}_${i}`, t, 'beat');
        });
        beats.downbeats.forEach((t, i) => add(`db_${prefix}_${i}`, t, 'downbeat'));
        beats.sections.forEach((s, i) => add(`sec_${prefix}_${i}`, s.start, 'section', s.label ?? `Abschnitt ${i + 1}`));
        if (ops.length) {
          const version = await ctx.project.commitOps(ops, { note: `Beat-Marker aus ${args.assetId}`, author: 'director', runId: ctx.runId });
          emitVersion(ctx, version);
          lines.push(`${ops.length} Marker geschrieben → v${version.number}.`);
        } else {
          lines.push('Marker existierten bereits.');
        }
      }
      return textResult(lines.join('\n'));
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const transcribeTool = defineTool({
  name: 'transcribe',
  description:
    'Transkribiert Sprache oder Gesang eines Audio-/Video-Assets mit Wortzeitstempeln (über fal-STT) und speichert die Wortzeiten als Daten-Asset (word-timings) – Grundlage für Lyrics-Typografie, Untertitel, Schnitt auf Phrasen und Lipsync-Segmente. Bei Gesang zuerst Stems trennen, wenn das Ergebnis unsauber ist.',
  input: z.object({
    assetId: z.string(),
    language: z.string().optional().describe('Sprachcode, z. B. "de" oder "en".'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    if (!ctx.transcribe) return errorResult('Transkription ist nicht verfügbar.');
    try {
      const path = assetPath(ctx, args.assetId, ['audio', 'video']);
      ctx.emitProgress('Transkribiere …');
      const result = await ctx.transcribe.transcribe(path, args.language ? { language: args.language } : {});
      const asset = await ctx.project.addAssetFromBuffer(JSON.stringify({ sourceAssetId: args.assetId, language: result.language ?? args.language, text: result.text, words: result.words }, null, 2), {
        fileName: 'word-timings.json',
        kind: 'data',
        subtype: 'word-timings',
        title: `Wortzeiten ${ctx.project.getAsset(args.assetId)?.title ?? args.assetId}`,
        tags: ['transcript'],
        source: 'derived',
        parents: [{ assetId: args.assetId, relation: 'extracted' }],
      });
      ctx.ui.emit({ type: 'asset', projectId: ctx.projectId, asset });
      const sample = result.words
        .slice(0, 60)
        .map((w) => `${w.start.toFixed(2)}–${w.end.toFixed(2)} ${w.text}`)
        .join('\n');
      return textResult(
        `${result.words.length} Wörter, gespeichert als ${asset.id}.\n${wrapUntrusted(`transcript:${args.assetId}`, `${truncate(result.text, 8000)}\n\nErste Wortzeiten (s):\n${sample}`)}`,
      );
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const checkAvSyncTool = defineTool({
  name: 'check_av_sync',
  description:
    'Misst den Versatz zwischen Lippen-/Bewegungsenergie eines Video-Assets und einer Referenz-Audiospur (Kreuzkorrelation) → Versatz in ms + Konfidenz. Pflicht für jeden Lipsync-/Gesangs-Shot vor der Platzierung. Regel: |Versatz| ≤ 1 Frame → platzieren; bis ±6 Frames per Clip-Versatz (in) korrigieren; darüber neu generieren (im Budget, begrenzte Versuche). Ergebnis als qa-Marker vermerken.',
  input: z.object({
    videoAssetId: z.string(),
    referenceAudioAssetId: z.string().describe('Das exakte Audiosegment, das dem Modell gegeben wurde.'),
    roi: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional().describe('Mundregion normiert 0..1 (optional).'),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    try {
      const media = requireMedia(ctx);
      const sync = normalizeSync(
        await media.checkAvSync({
          videoPath: assetPath(ctx, args.videoAssetId, ['video']),
          referenceAudioPath: assetPath(ctx, args.referenceAudioAssetId, ['audio', 'video']),
          ...(args.roi ? { roi: args.roi } : {}),
        }),
      );
      const fps = ctx.project.getAsset(args.videoAssetId)?.fps ?? 30;
      const frames = sync.offsetMs !== undefined ? (sync.offsetMs / 1000) * fps : undefined;
      const verdict = frames === undefined ? 'unbekannt' : Math.abs(frames) <= 1 ? 'OK (≤ 1 Frame)' : Math.abs(frames) <= 6 ? 'per Clip-Versatz korrigierbar' : 'neu generieren';
      return textResult(
        `Versatz: ${sync.offsetMs !== undefined ? `${sync.offsetMs.toFixed(0)} ms (${frames!.toFixed(1)} Frames @ ${fps} fps)` : '?'} · Konfidenz ${sync.confidence !== undefined ? sync.confidence.toFixed(2) : '?'} → ${verdict}\nRohdaten: ${truncate(JSON.stringify(sync.raw), 800)}`,
      );
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const cutAudioTool = defineTool({
  name: 'cut_audio',
  description:
    'Schneidet ein exaktes Audiosegment (mit Handles) aus einem Audio-/Video-Asset und speichert es als neues Audio-Asset mit Lineage – z. B. die gesungene Phrase für einen Lipsync-Shot oder ein Dialogsegment. Plane die Shotlänge um dieses Segment.',
  input: z.object({
    assetId: z.string(),
    fromSec: z.number().min(0),
    toSec: z.number().min(0),
    handlesSec: z.number().min(0).max(5).optional().describe('Vor-/Nachlauf je Seite (Standard 0.25 s).'),
    title: z.string().optional(),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    if (args.toSec <= args.fromSec) return errorResult('toSec muss größer als fromSec sein.');
    try {
      const media = requireMedia(ctx);
      const path = assetPath(ctx, args.assetId, ['audio', 'video']);
      const dir = await projectTempDir(ctx.projectDir, 'cut');
      const handlesSec = args.handlesSec ?? 0.25;
      const out = join(dir, 'segment.wav');
      const result = pathOf(await media.cutAudio(path, out, { fromSec: args.fromSec, toSec: args.toSec, handlesSec })) ?? out;
      const source = ctx.project.getAsset(args.assetId)!;
      const asset = await ctx.project.addAssetFromFile(result, {
        move: true,
        kind: 'audio',
        subtype: 'segment',
        title: args.title ?? `${source.title} ${formatSeconds(args.fromSec)}–${formatSeconds(args.toSec)}`,
        tags: ['segment'],
        source: 'derived',
        durationMs: Math.round((args.toSec - args.fromSec + 2 * handlesSec) * 1000),
        metadata: { fromSec: args.fromSec, toSec: args.toSec, handlesSec, sourceAssetId: args.assetId },
        parents: [{ assetId: args.assetId, relation: 'derived' }],
      });
      ctx.ui.emit({ type: 'asset', projectId: ctx.projectId, asset });
      return textResult(`Segment gespeichert: ${asset.id} „${asset.title}“ (inkl. ${handlesSec} s Handles je Seite; Inhalt beginnt bei ${handlesSec} s im Segment).`);
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});
