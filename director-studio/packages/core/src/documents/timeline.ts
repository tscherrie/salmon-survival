import { z } from 'zod';
import { formatTimecode } from '../time.ts';
import { DocumentOpError, assertAssetKind, assertUniqueId, deepClone, mergePatch, type OpContext } from './common.ts';

/** Timeline-Dokument für Video und Audio: framegenau, Ganzzahlen. */

export const TRACK_KINDS = ['video', 'overlay', 'text', 'audio'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
export const AUDIO_ROLES = ['music', 'vocals', 'voice', 'sfx', 'ambience'] as const;
export type AudioRole = (typeof AUDIO_ROLES)[number];

/** Auf diesen Spurarten dürfen sich Clips nicht überlappen. */
export const EXCLUSIVE_TRACK_KINDS: readonly TrackKind[] = ['video', 'audio'];

export const formatSpecSchema = z.object({
  id: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type FormatSpec = z.infer<typeof formatSpecSchema>;

export const STANDARD_FORMATS: Record<string, FormatSpec> = {
  '16:9': { id: '16:9', width: 1920, height: 1080 },
  '9:16': { id: '9:16', width: 1080, height: 1920 },
  '1:1': { id: '1:1', width: 1080, height: 1080 },
  '4:5': { id: '4:5', width: 1080, height: 1350 },
};

export const transitionSchema = z.object({
  type: z.enum(['cut', 'crossfade', 'dip', 'component']),
  durationFrames: z.number().int().nonnegative(),
  componentId: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export const clipTransformSchema = z.object({
  fit: z.enum(['cover', 'contain', 'fill', 'none']).default('cover'),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().optional(),
  rotation: z.number().optional(),
  /** Bildausschnitt je Format (Mittelpunkt normiert 0..1). */
  reframe: z.record(z.string(), z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().positive().optional() })).optional(),
});

export const clipSchema = z.object({
  id: z.string().min(1),
  start: z.number().int().nonnegative(),
  duration: z.number().int().positive(),
  /** Startoffset im Quellmaterial (Frames). */
  in: z.number().int().nonnegative().default(0),
  assetId: z.string().optional(),
  componentId: z.string().optional(),
  text: z.string().optional(),
  style: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  name: z.string().optional(),
  speed: z.number().positive().default(1),
  gainDb: z.number().optional(),
  fadeInFrames: z.number().int().nonnegative().optional(),
  fadeOutFrames: z.number().int().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.string().optional(),
  transform: clipTransformSchema.optional(),
  transitionIn: transitionSchema.optional(),
  notes: z.string().optional(),
});
export type Clip = z.infer<typeof clipSchema>;
export type ClipInput = z.input<typeof clipSchema>;

export const trackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(TRACK_KINDS),
  role: z.enum(AUDIO_ROLES).optional(),
  name: z.string().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  gainDb: z.number().optional(),
  /** Ducking: diese Spur wird abgesenkt, solange auf `byTrackId` Clips liegen. */
  duck: z.object({ byTrackId: z.string(), db: z.number() }).optional(),
  clips: z.array(clipSchema).default([]),
});
export type Track = z.infer<typeof trackSchema>;
export type TrackInput = z.input<typeof trackSchema>;

export const MARKER_KINDS = ['beat', 'downbeat', 'section', 'word', 'checkpoint', 'note', 'qa'] as const;
export const markerSchema = z.object({
  id: z.string().min(1),
  frame: z.number().int().nonnegative(),
  kind: z.enum(MARKER_KINDS),
  label: z.string().optional(),
  durationFrames: z.number().int().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Marker = z.infer<typeof markerSchema>;

export const componentRefSchema = z.object({
  /** Code-Asset (TSX) dieser Komponente. */
  assetId: z.string().min(1),
  name: z.string().min(1),
  propsSchema: z.record(z.string(), z.unknown()).optional(),
});

export const timelineSchema = z.object({
  kind: z.literal('timeline'),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationFrames: z.number().int().nonnegative(),
  formats: z.array(formatSpecSchema).default([]),
  tracks: z.array(trackSchema).default([]),
  markers: z.array(markerSchema).default([]),
  components: z.record(z.string(), componentRefSchema).default({}),
  backgroundColor: z.string().optional(),
});
export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineInput = z.input<typeof timelineSchema>;

export function createTimeline(options: {
  fps?: number;
  format?: FormatSpec;
  formats?: FormatSpec[];
  durationFrames?: number;
  audioOnly?: boolean;
} = {}): Timeline {
  const primary = options.format ?? STANDARD_FORMATS['16:9']!;
  const tracks: TrackInput[] = options.audioOnly
    ? [
        { id: 'A1', kind: 'audio', role: 'voice', name: 'Stimme' },
        { id: 'A2', kind: 'audio', role: 'music', name: 'Musik' },
        { id: 'A3', kind: 'audio', role: 'sfx', name: 'SFX' },
      ]
    : [
        { id: 'V1', kind: 'video', name: 'Video' },
        { id: 'V2', kind: 'overlay', name: 'Overlay/Code' },
        { id: 'T1', kind: 'text', name: 'Text' },
        { id: 'A1', kind: 'audio', role: 'voice', name: 'Stimme/Gesang' },
        { id: 'A2', kind: 'audio', role: 'music', name: 'Musik' },
        { id: 'A3', kind: 'audio', role: 'sfx', name: 'SFX' },
      ];
  return timelineSchema.parse({
    kind: 'timeline',
    fps: options.fps ?? 30,
    width: primary.width,
    height: primary.height,
    durationFrames: options.durationFrames ?? 0,
    formats: options.formats ?? [primary],
    tracks,
  });
}

// ───────────────────────── Operationen ─────────────────────────

const clipPatchSchema = clipSchema.omit({ id: true }).partial().extend({
  props: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const timelineOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_track'), track: trackSchema, index: z.number().int().nonnegative().optional() }),
  z.object({ op: z.literal('remove_track'), trackId: z.string() }),
  z.object({
    op: z.literal('update_track'),
    trackId: z.string(),
    patch: trackSchema.omit({ id: true, kind: true, clips: true }).partial(),
  }),
  z.object({ op: z.literal('insert_clip'), trackId: z.string(), clip: clipSchema }),
  z.object({ op: z.literal('remove_clip'), clipId: z.string() }),
  z.object({
    op: z.literal('move_clip'),
    clipId: z.string(),
    start: z.number().int().nonnegative(),
    trackId: z.string().optional(),
  }),
  z.object({
    op: z.literal('trim_clip'),
    clipId: z.string(),
    start: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    in: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal('update_clip'), clipId: z.string(), patch: clipPatchSchema }),
  z.object({ op: z.literal('add_marker'), marker: markerSchema }),
  z.object({ op: z.literal('remove_marker'), markerId: z.string() }),
  z.object({
    op: z.literal('update_timeline'),
    patch: z
      .object({
        durationFrames: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        formats: z.array(formatSpecSchema),
        backgroundColor: z.string(),
      })
      .partial(),
  }),
  z.object({ op: z.literal('register_component'), componentId: z.string(), component: componentRefSchema }),
  z.object({ op: z.literal('unregister_component'), componentId: z.string() }),
]);
export type TimelineOp = z.infer<typeof timelineOpSchema>;
export type TimelineOpInput = z.input<typeof timelineOpSchema>;

export function applyTimelineOps(doc: Timeline, ops: readonly TimelineOpInput[], ctx: OpContext = {}): Timeline {
  let next = deepClone(doc);
  ops.forEach((raw, index) => {
    const parsed = timelineOpSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DocumentOpError(index, String((raw as { op?: unknown }).op ?? '?'), parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    try {
      next = applyOne(next, parsed.data, ctx);
    } catch (error) {
      if (error instanceof DocumentOpError) throw error;
      throw new DocumentOpError(index, parsed.data.op, (error as Error).message);
    }
  });
  validateTimeline(next, ctx);
  return next;
}

function applyOne(doc: Timeline, op: TimelineOp, ctx: OpContext): Timeline {
  switch (op.op) {
    case 'add_track': {
      assertUniqueId(doc.tracks.map((t) => t.id), op.track.id, 'Spur');
      for (const clip of op.track.clips) assertUniqueId(allClipIds(doc), clip.id, 'Clip');
      const index = op.index ?? doc.tracks.length;
      doc.tracks.splice(Math.min(index, doc.tracks.length), 0, op.track);
      return doc;
    }
    case 'remove_track': {
      const idx = doc.tracks.findIndex((t) => t.id === op.trackId);
      if (idx < 0) throw new Error(`Spur "${op.trackId}" existiert nicht`);
      doc.tracks.splice(idx, 1);
      return doc;
    }
    case 'update_track': {
      const track = getTrack(doc, op.trackId);
      Object.assign(track, op.patch);
      return doc;
    }
    case 'insert_clip': {
      const track = getTrack(doc, op.trackId);
      assertUniqueId(allClipIds(doc), op.clip.id, 'Clip');
      checkClipForTrack(track, op.clip, ctx);
      track.clips.push(op.clip);
      sortClips(track);
      return doc;
    }
    case 'remove_clip': {
      const { track, index } = locateClip(doc, op.clipId);
      track.clips.splice(index, 1);
      return doc;
    }
    case 'move_clip': {
      const { track, index, clip } = locateClip(doc, op.clipId);
      const moved = { ...clip, start: op.start };
      if (op.trackId && op.trackId !== track.id) {
        const target = getTrack(doc, op.trackId);
        checkClipForTrack(target, moved, ctx);
        track.clips.splice(index, 1);
        target.clips.push(moved);
        sortClips(target);
      } else {
        track.clips[index] = moved;
        sortClips(track);
      }
      return doc;
    }
    case 'trim_clip': {
      const { track, index, clip } = locateClip(doc, op.clipId);
      track.clips[index] = {
        ...clip,
        ...(op.start !== undefined ? { start: op.start } : {}),
        ...(op.duration !== undefined ? { duration: op.duration } : {}),
        ...(op.in !== undefined ? { in: op.in } : {}),
      };
      sortClips(track);
      return doc;
    }
    case 'update_clip': {
      const { track, index, clip } = locateClip(doc, op.clipId);
      const { props, ...rest } = op.patch;
      let updated: Clip = mergePatch(clip as Record<string, unknown>, rest) as Clip;
      if (props === null) {
        const { props: _drop, ...withoutProps } = updated;
        updated = withoutProps as Clip;
      } else if (props) {
        updated = { ...updated, props: mergePatch(clip.props ?? {}, props) };
      }
      updated = clipSchema.parse(updated);
      checkClipForTrack(track, updated, ctx);
      track.clips[index] = updated;
      sortClips(track);
      return doc;
    }
    case 'add_marker': {
      assertUniqueId(doc.markers.map((m) => m.id), op.marker.id, 'Marker');
      doc.markers.push(op.marker);
      doc.markers.sort((a, b) => a.frame - b.frame);
      return doc;
    }
    case 'remove_marker': {
      const idx = doc.markers.findIndex((m) => m.id === op.markerId);
      if (idx < 0) throw new Error(`Marker "${op.markerId}" existiert nicht`);
      doc.markers.splice(idx, 1);
      return doc;
    }
    case 'update_timeline': {
      Object.assign(doc, op.patch);
      return doc;
    }
    case 'register_component': {
      assertAssetKind(ctx, op.component.assetId, ['code'], 'Komponente');
      doc.components[op.componentId] = op.component;
      return doc;
    }
    case 'unregister_component': {
      if (!doc.components[op.componentId]) throw new Error(`Komponente "${op.componentId}" existiert nicht`);
      const inUse = doc.tracks.some((t) => t.clips.some((c) => c.componentId === op.componentId || c.transitionIn?.componentId === op.componentId));
      if (inUse) throw new Error(`Komponente "${op.componentId}" wird noch verwendet`);
      delete doc.components[op.componentId];
      return doc;
    }
  }
}

function checkClipForTrack(track: Track, clip: Clip, ctx: OpContext): void {
  switch (track.kind) {
    case 'video':
      if (!clip.assetId) throw new Error(`Clip "${clip.id}" auf Videospur braucht assetId`);
      assertAssetKind(ctx, clip.assetId, ['video', 'image'], `Clip "${clip.id}"`);
      break;
    case 'audio':
      if (!clip.assetId) throw new Error(`Clip "${clip.id}" auf Audiospur braucht assetId`);
      assertAssetKind(ctx, clip.assetId, ['audio', 'video'], `Clip "${clip.id}"`);
      break;
    case 'overlay':
      if (!clip.componentId && !clip.assetId) {
        throw new Error(`Clip "${clip.id}" auf Overlay-Spur braucht componentId oder assetId`);
      }
      if (clip.assetId) assertAssetKind(ctx, clip.assetId, ['video', 'image'], `Clip "${clip.id}"`);
      break;
    case 'text':
      if (clip.text === undefined && !clip.componentId) {
        throw new Error(`Clip "${clip.id}" auf Textspur braucht text oder componentId`);
      }
      break;
  }
}

/** Prüft globale Invarianten: eindeutige IDs, Grenzen, Überlappungen, Komponenten. */
export function validateTimeline(doc: Timeline, _ctx: OpContext = {}): void {
  const seen = new Set<string>();
  for (const track of doc.tracks) {
    if (seen.has(track.id)) throw new Error(`Doppelte Spur-ID "${track.id}"`);
    seen.add(track.id);
  }
  const clipIds = new Set<string>();
  for (const track of doc.tracks) {
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i]!;
      if (clipIds.has(clip.id)) throw new Error(`Doppelte Clip-ID "${clip.id}"`);
      clipIds.add(clip.id);
      const end = clip.start + clip.duration;
      if (end > doc.durationFrames) {
        throw new Error(
          `Clip "${clip.id}" endet bei ${formatTimecode(end, doc.fps)} und damit nach dem Timeline-Ende ${formatTimecode(doc.durationFrames, doc.fps)} (vorher update_timeline.durationFrames setzen)`,
        );
      }
      if (clip.componentId && !doc.components[clip.componentId]) {
        throw new Error(`Clip "${clip.id}" verwendet unbekannte Komponente "${clip.componentId}"`);
      }
      if (clip.transitionIn?.componentId && !doc.components[clip.transitionIn.componentId]) {
        throw new Error(`Clip "${clip.id}" verwendet unbekannte Übergangskomponente "${clip.transitionIn.componentId}"`);
      }
      const next = sorted[i + 1];
      if (next && EXCLUSIVE_TRACK_KINDS.includes(track.kind) && next.start < end) {
        throw new Error(`Clips "${clip.id}" und "${next.id}" überlappen auf Spur "${track.id}"`);
      }
    }
  }
  if (doc.tracks.some((t) => t.duck && !doc.tracks.find((x) => x.id === t.duck?.byTrackId))) {
    throw new Error('Ducking verweist auf eine unbekannte Spur');
  }
}

// ───────────────────────── Abfragen ─────────────────────────

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function findClip(doc: Timeline, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

/** Alle Clips, die den Frame enthalten, je Spur. */
export function clipsAtFrame(doc: Timeline, frame: number): Array<{ track: Track; clip: Clip }> {
  const out: Array<{ track: Track; clip: Clip }> = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (frame >= clip.start && frame < clipEnd(clip)) out.push({ track, clip });
    }
  }
  return out;
}

/** Alle Clips, die den Bereich [from, to) schneiden. */
export function clipsInRange(doc: Timeline, from: number, to: number, trackId?: string): Array<{ track: Track; clip: Clip }> {
  const out: Array<{ track: Track; clip: Clip }> = [];
  for (const track of doc.tracks) {
    if (trackId && track.id !== trackId) continue;
    for (const clip of track.clips) {
      if (clip.start < to && clipEnd(clip) > from) out.push({ track, clip });
    }
  }
  return out;
}

export function markersInRange(doc: Timeline, from: number, to: number, kinds?: readonly Marker['kind'][]): Marker[] {
  return doc.markers.filter((m) => m.frame >= from && m.frame < to && (!kinds || kinds.includes(m.kind)));
}

/** Ende des letzten Clips (Inhaltsdauer). */
export function contentEnd(doc: Timeline): number {
  return doc.tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, clipEnd(c)), max), 0);
}

/** Kompakte Textdarstellung für den Director-Kontext. */
export function summarizeTimeline(doc: Timeline, names: Record<string, string> = {}): string {
  const tc = (f: number) => formatTimecode(f, doc.fps);
  const lines: string[] = [
    `Timeline ${doc.width}×${doc.height} @ ${doc.fps} fps · Dauer ${tc(doc.durationFrames)} · Formate ${doc.formats.map((f) => f.id).join(', ') || '—'}`,
  ];
  for (const track of doc.tracks) {
    const label = `${track.id} ${track.kind}${track.role ? `/${track.role}` : ''}${track.name ? ` „${track.name}“` : ''}${track.muted ? ' (stumm)' : ''}`;
    if (track.clips.length === 0) {
      lines.push(`${label}: leer`);
      continue;
    }
    lines.push(`${label}:`);
    for (const clip of track.clips) {
      const what = clip.text !== undefined
        ? `„${clip.text.length > 40 ? `${clip.text.slice(0, 40)}…` : clip.text}“${clip.style ? ` [${clip.style}]` : ''}`
        : clip.componentId
          ? `Komponente ${clip.componentId}`
          : clip.assetId
            ? `${names[clip.assetId] ? `${names[clip.assetId]} ` : ''}(${clip.assetId}${clip.in ? ` ab ${tc(clip.in)}` : ''})`
            : '?';
      lines.push(`  ${clip.id} ${tc(clip.start)}–${tc(clipEnd(clip))} ${what}${clip.gainDb !== undefined ? ` ${clip.gainDb} dB` : ''}`);
    }
  }
  const sections = doc.markers.filter((m) => m.kind === 'section' || m.kind === 'checkpoint' || m.kind === 'note' || m.kind === 'qa');
  if (sections.length) {
    lines.push(`Marker: ${sections.map((m) => `${tc(m.frame)} ${m.kind}${m.label ? ` ${m.label}` : ''}`).join(' · ')}`);
  }
  const beats = doc.markers.filter((m) => m.kind === 'beat' || m.kind === 'downbeat').length;
  if (beats) lines.push(`${beats} Beat-Marker vorhanden`);
  const components = Object.entries(doc.components);
  if (components.length) {
    lines.push(`Komponenten: ${components.map(([id, c]) => `${id}=${c.name} (${c.assetId})`).join(', ')}`);
  }
  return lines.join('\n');
}

function getTrack(doc: Timeline, trackId: string): Track {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Spur "${trackId}" existiert nicht`);
  return track;
}

function locateClip(doc: Timeline, clipId: string): { track: Track; index: number; clip: Clip } {
  for (const track of doc.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, index, clip: track.clips[index]! };
  }
  throw new Error(`Clip "${clipId}" existiert nicht`);
}

function allClipIds(doc: Timeline): string[] {
  return doc.tracks.flatMap((t) => t.clips.map((c) => c.id));
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
}
