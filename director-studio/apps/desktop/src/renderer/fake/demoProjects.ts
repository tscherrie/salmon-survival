import {
  DEFAULT_PICKERS,
  PROJECT_SCHEMA_VERSION,
  STANDARD_FORMATS,
  createCheckpoints,
  createDocument,
  type Asset,
  type BudgetApproval,
  type ChatMessage,
  type Checkpoint,
  type DocumentOp,
  type FormatSpec,
  type Generation,
  type LedgerEntry,
  type ProjectCategory,
  type ProjectManifest,
  type StudioDocument,
  type VersionAuthor,
} from '@studio/core';

/** Beschreibung, wie das Fake-Backend Platzhalter-Medien für ein Asset erzeugt. */
export type MediaSpec =
  | {
      type: 'image';
      title: string;
      subtitle?: string;
      hue: number;
      motif?: 'horizon' | 'portrait' | 'grid' | 'frame';
      width?: number;
      height?: number;
    }
  | { type: 'audio'; seconds: number; bpm?: number; toneHz?: number; sampleRate?: number }
  | { type: 'text'; text: string; mime?: string }
  | { type: 'glyph'; label: string; hue: number };

export interface DemoVersion {
  ops: DocumentOp[];
  note: string;
  author: VersionAuthor;
  createdAt: string;
}

export interface DemoProjectSeed {
  path: string;
  manifest: ProjectManifest;
  initialDocument: StudioDocument | null;
  versions: DemoVersion[];
  assets: Asset[];
  media: Record<string, MediaSpec>;
  peaks: Record<string, { bpm?: number; level?: number }>;
  generations: Generation[];
  messages: ChatMessage[];
  ledger: { entries: LedgerEntry[]; approvals: BudgetApproval[] };
}

export const DEMO_ROOT = '/Users/demo/Studio';
export const DEMO_VIDEO_PATH = `${DEMO_ROOT}/Nachtfahrt.dstudio`;
export const DEMO_VIDEO_ID = 'prj_demo_video';

function asset(input: Omit<Asset, 'tags' | 'status'> & Partial<Pick<Asset, 'tags' | 'status'>>): Asset {
  return { tags: [], status: 'active', ...input };
}

function manifest(input: {
  id: string;
  title: string;
  category: ProjectCategory | null;
  createdAt: string;
  updatedAt: string;
  formats?: FormatSpec[];
  checkpoints?: Checkpoint[];
  phase?: 'planning' | 'production';
  approvals?: BudgetApproval[];
}): ProjectManifest {
  return {
    schema: PROJECT_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    category: input.category,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    formats: input.formats ?? [STANDARD_FORMATS['16:9']!],
    brief: null,
    pickers: { ...DEFAULT_PICKERS },
    checkpoints: input.checkpoints ?? (input.category ? createCheckpoints(input.category) : []),
    budgetApprovals: input.approvals ?? [],
    director: { effort: 'xhigh' },
    phase: input.phase ?? 'planning',
  };
}

function completedGeneration(input: {
  id: string;
  endpointId: string;
  modality: Generation['modality'];
  purpose: string;
  outputs: string[];
  inputs?: string[];
  cost: number;
  at: string;
}): Generation {
  return {
    id: input.id,
    endpointId: input.endpointId,
    modality: input.modality,
    status: 'completed',
    input: {},
    purpose: input.purpose,
    estimateUsd: input.cost,
    costUsd: input.cost,
    inputAssetIds: input.inputs ?? [],
    outputAssetIds: input.outputs,
    createdAt: input.at,
    submittedAt: input.at,
    finishedAt: input.at,
  };
}

function ledgerEntry(id: string, kind: LedgerEntry['kind'], amountUsd: number, source: LedgerEntry['source'], refId: string, createdAt: string, checkpointId?: string): LedgerEntry {
  return { id, kind, amountUsd, source, refId, createdAt, ...(checkpointId ? { checkpointId } : {}) };
}

// ───────────────────────── Video: Musikvideo „Nachtfahrt“ ─────────────────────────

function videoProject(): DemoProjectSeed {
  const fps = 30;
  const created = '2026-09-28T09:12:00.000Z';
  const formats = [STANDARD_FORMATS['16:9']!, STANDARD_FORMATS['9:16']!];
  const sbPrompts = [
    'Stadt bei Nacht aus der Vogelperspektive, Neonreflexe auf nassem Asphalt, 35mm, kühle Palette',
    'Mira am Steuer, Gesicht im Licht vorbeiziehender Laternen, Charakterblatt v3 als Referenz',
    'Tunnelfahrt, Lichtstreifen, starke Fluchtlinien, Bewegungsunschärfe',
    'Refrain: Lichterkette der Stadt, Kamera fährt seitlich, warme Akzente',
    'Brücke im Morgengrauen, Silhouette des Autos, Weitwinkel',
    'Stillstand an der Ampel, Regen auf der Scheibe, Nahaufnahme',
  ];
  const sbTitles = ['Storyboard 01 – Stadt', 'Storyboard 02 – Mira', 'Storyboard 03 – Tunnel', 'Storyboard 04 – Lichter', 'Storyboard 05 – Brücke', 'Storyboard 06 – Ampel'];
  const sbHues = [205, 190, 30, 40, 18, 220];
  const sbMotifs: Array<'horizon' | 'portrait' | 'frame'> = ['horizon', 'portrait', 'frame', 'horizon', 'horizon', 'frame'];

  const assets: Asset[] = [
    asset({
      id: 'ast_song',
      kind: 'audio',
      subtype: 'music',
      title: 'Nachtfahrt (Demo-Mix)',
      description: 'Song der Band, Demo-Mix vom 27.09.',
      tags: ['song'],
      source: 'imported',
      mime: 'audio/wav',
      path: 'assets/store/9f/2c/9f2c41ab',
      durationMs: 60_000,
      bytes: 10_584_000,
      createdAt: '2026-09-28T09:14:00.000Z',
    }),
    asset({
      id: 'ast_notes',
      kind: 'text',
      subtype: 'notes',
      title: 'Notizen zum Song',
      description: 'Ideen der Band: nächtliche Fahrt, Aufbruch, Morgengrauen als Auflösung.',
      tags: ['brief'],
      source: 'imported',
      mime: 'text/markdown',
      createdAt: '2026-09-28T09:15:00.000Z',
    }),
    asset({
      id: 'ast_beats',
      kind: 'data',
      subtype: 'beat-map',
      title: 'Beat-Analyse Nachtfahrt',
      description: '120 BPM, 4/4, Sections: Intro, Strophe, Refrain, Bridge, Outro',
      source: 'derived',
      mime: 'application/json',
      createdAt: '2026-09-28T09:16:00.000Z',
      metadata: { bpm: 120, parentIds: ['ast_song'] },
    }),
    asset({
      id: 'ast_vocals',
      kind: 'audio',
      subtype: 'stem',
      title: 'Gesang (Stem)',
      tags: ['stem', 'vocals'],
      source: 'derived',
      mime: 'audio/wav',
      modelId: 'fal-ai/demucs/v4',
      generationId: 'gen_stems',
      costUsd: 0.02,
      durationMs: 60_000,
      createdAt: '2026-09-28T09:20:00.000Z',
      metadata: { parentIds: ['ast_song'] },
    }),
    asset({
      id: 'ast_char_mira',
      kind: 'image',
      subtype: 'character-sheet',
      title: 'Mira – Charakterblatt v3',
      tags: ['character', 'mira'],
      source: 'generated',
      mime: 'image/png',
      modelId: 'fal-ai/nano-banana-pro',
      generationId: 'gen_mira',
      prompt: 'Charakterblatt: junge Fahrerin Mira, kurze dunkle Haare, gelbe Regenjacke, Front/Seite/Rücken, neutraler Hintergrund',
      costUsd: 0.16,
      width: 1920,
      height: 1080,
      createdAt: '2026-09-28T10:02:00.000Z',
    }),
    ...sbTitles.map((title, i) =>
      asset({
        id: `ast_sb_0${i + 1}`,
        kind: 'image',
        subtype: 'storyboard-frame',
        title,
        tags: ['storyboard', `szene-${i + 1}`],
        source: 'generated',
        mime: 'image/png',
        modelId: 'fal-ai/nano-banana-pro',
        generationId: 'gen_sb',
        prompt: sbPrompts[i],
        costUsd: 0.04,
        width: 1920,
        height: 1080,
        createdAt: `2026-09-28T10:${String(20 + i).padStart(2, '0')}:00.000Z`,
      }),
    ),
    asset({
      id: 'ast_clip_test',
      kind: 'video',
      subtype: 'shot',
      title: 'Testshot Tunnelfahrt',
      tags: ['test', 'tunnel'],
      source: 'generated',
      mime: 'video/mp4',
      modelId: 'minimax/h3-max/text-to-video',
      generationId: 'gen_test',
      prompt: 'Tunnelfahrt aus Fahrerperspektive, Lichtstreifen, 1080p, 5 s, ruhige Kamerafahrt',
      costUsd: 0.8,
      durationMs: 5000,
      fps: 24,
      width: 1920,
      height: 1080,
      createdAt: '2026-09-28T11:05:00.000Z',
    }),
    asset({
      id: 'ast_clip_rejected',
      kind: 'video',
      subtype: 'shot',
      title: 'Testshot Regen',
      tags: ['test'],
      status: 'rejected',
      source: 'generated',
      mime: 'video/mp4',
      modelId: 'fal-ai/kling-video/v3/pro',
      generationId: 'gen_rej',
      prompt: 'Regen auf Windschutzscheibe, Nahaufnahme, Scheibenwischer',
      costUsd: 0.55,
      durationMs: 5000,
      fps: 24,
      width: 1920,
      height: 1080,
      createdAt: '2026-09-28T11:12:00.000Z',
    }),
    asset({
      id: 'ast_whoosh',
      kind: 'audio',
      subtype: 'sfx',
      title: 'Whoosh Tunnel',
      tags: ['sfx'],
      source: 'generated',
      mime: 'audio/wav',
      modelId: 'fal-ai/mmaudio-v2',
      generationId: 'gen_whoosh',
      prompt: 'Vorbeifahrendes Auto im Tunnel, kurzer Whoosh',
      costUsd: 0.01,
      durationMs: 800,
      createdAt: '2026-09-28T11:20:00.000Z',
    }),
    asset({
      id: 'ast_logo',
      kind: 'image',
      subtype: 'logo',
      title: 'Label-Logo',
      tags: ['logo'],
      source: 'linked',
      mime: 'image/png',
      path: '/Users/demo/Material/label-logo.png',
      width: 800,
      height: 800,
      createdAt: '2026-09-28T09:18:00.000Z',
    }),
    asset({
      id: 'ast_font',
      kind: 'font',
      title: 'Space Grotesk Bold',
      source: 'imported',
      mime: 'font/ttf',
      createdAt: '2026-09-28T09:19:00.000Z',
    }),
    asset({
      id: 'ast_comp',
      kind: 'code',
      subtype: 'component',
      title: 'PaperRoto.tsx',
      description: 'Remotion-Komponente: Papier-Rotoscope mit „Boil“ auf Zweiern',
      source: 'director',
      mime: 'text/tsx',
      createdAt: '2026-09-28T11:40:00.000Z',
    }),
    asset({
      id: 'ast_web_ref',
      kind: 'web',
      subtype: 'reference',
      title: 'Moodboard-Referenz Nachtfahrt',
      source: 'web',
      sourceUrl: 'https://example.com/moodboard/nachtfahrt',
      createdAt: '2026-09-28T09:30:00.000Z',
    }),
  ];

  const media: Record<string, MediaSpec> = {
    ast_song: { type: 'audio', seconds: 60, bpm: 120, toneHz: 98, sampleRate: 8000 },
    ast_vocals: { type: 'audio', seconds: 60, toneHz: 220, sampleRate: 4000 },
    ast_whoosh: { type: 'audio', seconds: 0.8, toneHz: 330, sampleRate: 8000 },
    ast_notes: {
      type: 'text',
      text: '# Notizen zum Song\n\n- Fahrt durch die Nacht, Aufbruch\n- Refrain: Lichter, Geschwindigkeit\n- Ende im Morgengrauen\n',
      mime: 'text/markdown',
    },
    ast_beats: { type: 'glyph', label: '{ bpm: 120 }', hue: 160 },
    ast_char_mira: { type: 'image', title: 'Mira', subtitle: 'Charakterblatt v3', hue: 48, motif: 'portrait' },
    ast_clip_test: { type: 'image', title: 'Tunnelfahrt', subtitle: 'h3-max · 5 s', hue: 28, motif: 'frame' },
    ast_clip_rejected: { type: 'image', title: 'Regen', subtitle: 'verworfen', hue: 210, motif: 'frame' },
    ast_logo: { type: 'image', title: 'LABEL', hue: 0, motif: 'grid', width: 400, height: 400 },
    ast_font: { type: 'glyph', label: 'Aa', hue: 30 },
    ast_comp: { type: 'glyph', label: '</>', hue: 140 },
    ast_web_ref: { type: 'image', title: 'Moodboard', subtitle: 'example.com', hue: 260, motif: 'grid' },
  };
  sbTitles.forEach((title, i) => {
    media[`ast_sb_0${i + 1}`] = { type: 'image', title: title.replace('Storyboard ', 'SB '), hue: sbHues[i]!, motif: sbMotifs[i]! };
  });

  const generations: Generation[] = [
    completedGeneration({ id: 'gen_stems', endpointId: 'fal-ai/demucs/v4', modality: 'tools', purpose: 'Gesang vom Song trennen', inputs: ['ast_song'], outputs: ['ast_vocals'], cost: 0.02, at: '2026-09-28T09:20:00.000Z' }),
    completedGeneration({ id: 'gen_mira', endpointId: 'fal-ai/nano-banana-pro', modality: 'image', purpose: 'Charakterblatt Mira', outputs: ['ast_char_mira'], cost: 0.16, at: '2026-09-28T10:02:00.000Z' }),
    completedGeneration({
      id: 'gen_sb',
      endpointId: 'fal-ai/nano-banana-pro',
      modality: 'image',
      purpose: 'Storyboard-Frames 01–06',
      inputs: ['ast_char_mira'],
      outputs: ['ast_sb_01', 'ast_sb_02', 'ast_sb_03', 'ast_sb_04', 'ast_sb_05', 'ast_sb_06'],
      cost: 0.24,
      at: '2026-09-28T10:25:00.000Z',
    }),
    completedGeneration({ id: 'gen_test', endpointId: 'minimax/h3-max/text-to-video', modality: 'video', purpose: 'Testshot Tunnel', inputs: ['ast_sb_03'], outputs: ['ast_clip_test'], cost: 0.8, at: '2026-09-28T11:05:00.000Z' }),
    completedGeneration({ id: 'gen_rej', endpointId: 'fal-ai/kling-video/v3/pro', modality: 'video', purpose: 'Testshot Regen', inputs: ['ast_sb_06'], outputs: ['ast_clip_rejected'], cost: 0.55, at: '2026-09-28T11:12:00.000Z' }),
    completedGeneration({ id: 'gen_whoosh', endpointId: 'fal-ai/mmaudio-v2', modality: 'sound', purpose: 'Whoosh für den Tunnel', outputs: ['ast_whoosh'], cost: 0.01, at: '2026-09-28T11:20:00.000Z' }),
    {
      id: 'gen_upscale',
      endpointId: 'fal-ai/topaz/upscale/video',
      modality: 'tools',
      status: 'running',
      input: {},
      purpose: 'Testshot Tunnel auf 4K hochskalieren',
      estimateUsd: 0.4,
      inputAssetIds: ['ast_clip_test'],
      outputAssetIds: [],
      createdAt: '2026-09-28T11:41:00.000Z',
      submittedAt: '2026-09-28T11:41:05.000Z',
    },
    {
      id: 'gen_voice',
      endpointId: 'fal-ai/elevenlabs/tts/v3',
      modality: 'voice',
      status: 'queued',
      input: {},
      purpose: 'Gesprochenes Intro „Nachtfahrt“',
      estimateUsd: 0.03,
      queuePosition: 2,
      inputAssetIds: [],
      outputAssetIds: [],
      createdAt: '2026-09-28T11:42:00.000Z',
    },
  ];

  // v2: Song + Beat-/Section-Marker
  const v2: DocumentOp[] = [
    { op: 'update_timeline', patch: { durationFrames: 60 * fps } },
    { op: 'insert_clip', trackId: 'A2', clip: { id: 'song', assetId: 'ast_song', start: 0, in: 0, duration: 60 * fps, gainDb: 0, name: 'Song' } },
  ];
  const beatFrames = fps / 2; // 120 BPM
  for (let i = 0; i * beatFrames < 60 * fps; i++) {
    const frame = i * beatFrames;
    v2.push({ op: 'add_marker', marker: { id: `beat_${i}`, frame, kind: i % 4 === 0 ? 'downbeat' : 'beat' } });
  }
  const sections: Array<[number, string]> = [
    [0, 'Intro'],
    [8, 'Strophe 1'],
    [24, 'Refrain 1'],
    [40, 'Bridge'],
    [52, 'Outro'],
  ];
  sections.forEach(([sec, label], i) => v2.push({ op: 'add_marker', marker: { id: `sec_${i + 1}`, frame: sec * fps, kind: 'section', label } }));

  // v3: Storyboard-Animatic
  const sb: Array<[string, string, number, number, string]> = [
    ['c_sb01', 'ast_sb_01', 0, 8, 'Intro: Stadt bei Nacht'],
    ['c_sb02', 'ast_sb_02', 8, 16, 'Strophe: Mira am Steuer'],
    ['c_sb03', 'ast_sb_03', 16, 24, 'Strophe: Tunnel'],
    ['c_sb04', 'ast_sb_04', 24, 32, 'Refrain: Lichter'],
    ['c_sb05', 'ast_sb_05', 32, 40, 'Refrain: Brücke'],
    ['c_sb06', 'ast_sb_06', 40, 52, 'Bridge: Stillstand'],
    ['c_outro', 'ast_sb_01', 52, 60, 'Outro: Morgengrauen'],
  ];
  const v3: DocumentOp[] = sb.map(([id, assetId, from, to, name]) => ({
    op: 'insert_clip' as const,
    trackId: 'V1',
    clip: { id, assetId, start: from * fps, in: 0, duration: (to - from) * fps, name, transform: { fit: 'cover' as const } },
  }));
  v3.push(
    { op: 'insert_clip', trackId: 'V2', clip: { id: 'ov_logo', assetId: 'ast_logo', start: 56 * fps, duration: 4 * fps, name: 'Label-Logo', opacity: 0.9 } },
    { op: 'insert_clip', trackId: 'T1', clip: { id: 'lyr_01', text: 'Nachtfahrt', style: 'hero', start: 30, duration: 120 } },
    { op: 'insert_clip', trackId: 'T1', clip: { id: 'lyr_02', text: 'Lichter ziehen vorbei', style: 'lyric', start: 735, duration: 120 } },
    { op: 'insert_clip', trackId: 'T1', clip: { id: 'lyr_03', text: 'schneller', style: 'hero', start: 900, duration: 60 } },
    { op: 'insert_clip', trackId: 'T1', clip: { id: 'lyr_04', text: 'bis der Morgen kommt', style: 'lyric', start: 1600, duration: 140 } },
    { op: 'insert_clip', trackId: 'A1', clip: { id: 'voc', assetId: 'ast_vocals', start: 8 * fps, in: 8 * fps, duration: 44 * fps, name: 'Gesang' } },
    { op: 'insert_clip', trackId: 'A3', clip: { id: 'sfx_whoosh', assetId: 'ast_whoosh', start: 705, duration: 24, name: 'Whoosh' } },
    { op: 'add_marker', marker: { id: 'qa_sync', frame: 900, kind: 'qa', label: 'Sync prüfen' } },
    { op: 'add_marker', marker: { id: 'note_tunnel', frame: 480, kind: 'note', label: 'Tunnel länger?' } },
  );

  const checkpoints = createCheckpoints('video');
  return {
    path: DEMO_VIDEO_PATH,
    manifest: manifest({
      id: DEMO_VIDEO_ID,
      title: 'Musikvideo „Nachtfahrt“',
      category: 'video',
      createdAt: created,
      updatedAt: '2026-09-28T11:45:00.000Z',
      formats,
      checkpoints,
      approvals: [{ checkpointId: '_vorab', amountUsd: 5, approvedAt: '2026-09-28T09:40:00.000Z', note: 'Vorab-Budget für Tests' }],
    }),
    initialDocument: createDocument('video', { format: formats[0]!, formats }),
    versions: [
      { ops: v2, note: 'Song importiert, Beats und Sections analysiert', author: 'director', createdAt: '2026-09-28T09:21:00.000Z' },
      { ops: v3, note: 'Storyboard-Entwurf als Animatic platziert', author: 'director', createdAt: '2026-09-28T10:40:00.000Z' },
    ],
    assets,
    media,
    peaks: { ast_song: { bpm: 120, level: 0.8 }, ast_vocals: { level: 0.55 }, ast_whoosh: { level: 0.9 } },
    generations,
    messages: [
      {
        id: 'msg_demo_1',
        role: 'director',
        text:
          'Hallo! Ich habe den Song analysiert: **120 BPM**, der erste Refrain beginnt bei 00:24.000, die Bridge bei 00:40.000.\n\nDas Storyboard liegt als Animatic in der Timeline. Erzähl mir, was dir für das Video vorschwebt – du kannst jederzeit auf Stellen in der Timeline klicken.',
        createdAt: '2026-09-28T11:45:00.000Z',
      },
    ],
    ledger: {
      approvals: [{ checkpointId: '_vorab', amountUsd: 5, approvedAt: '2026-09-28T09:40:00.000Z', note: 'Vorab-Budget für Tests' }],
      entries: [
        ledgerEntry('led_d1', 'actual', 0.42, 'director', 'run_plan', '2026-09-28T09:30:00.000Z'),
        ledgerEntry('led_d2', 'actual', 0.02, 'fal', 'gen_stems', '2026-09-28T09:20:00.000Z', '_vorab'),
        ledgerEntry('led_d3', 'actual', 0.16, 'fal', 'gen_mira', '2026-09-28T10:02:00.000Z', '_vorab'),
        ledgerEntry('led_d4', 'actual', 0.24, 'fal', 'gen_sb', '2026-09-28T10:25:00.000Z', '_vorab'),
        ledgerEntry('led_d5', 'actual', 0.8, 'fal', 'gen_test', '2026-09-28T11:05:00.000Z', '_vorab'),
        ledgerEntry('led_d6', 'actual', 0.55, 'fal', 'gen_rej', '2026-09-28T11:12:00.000Z', '_vorab'),
        ledgerEntry('led_d7', 'actual', 0.01, 'fal', 'gen_whoosh', '2026-09-28T11:20:00.000Z', '_vorab'),
        ledgerEntry('led_d8', 'reservation', 0.4, 'fal', 'gen_upscale', '2026-09-28T11:41:00.000Z', '_vorab'),
      ],
    },
  };
}

// ───────────────────────── Präsentation ─────────────────────────

function slidesProject(): DemoProjectSeed {
  const created = '2026-09-20T08:00:00.000Z';
  const checkpoints = createCheckpoints('slides').map((c, i): Checkpoint =>
    i === 0
      ? { ...c, status: 'approved', budgetApprovedUsd: 2, summary: 'Gliederung in vier Folien', decidedAt: '2026-09-20T09:00:00.000Z' }
      : c,
  );
  const ops: DocumentOp[] = [
    { op: 'update_theme', patch: { name: 'Morgen', colors: { primary: '#0E3B43', accent: '#F2A541', text: '#1D1D1B', background: '#F7F4EE' }, fonts: { heading: 'Space Grotesk', body: 'Inter' }, background: '#F7F4EE' } },
    {
      op: 'add_slide',
      slide: {
        id: 's_title',
        title: 'Titel',
        layout: 'title',
        background: '#0E3B43',
        elements: [
          { id: 'el_title', type: 'text', name: 'Titel', x: 160, y: 360, width: 1400, height: 200, text: 'Q4 – Wachstum mit Fokus', style: { color: '#F7F4EE', fontSize: 104, fontWeight: 700 } },
          { id: 'el_sub', type: 'text', name: 'Untertitel', x: 160, y: 580, width: 1200, height: 80, text: 'Strategie-Update für das Leitungsteam', style: { color: '#F2A541', fontSize: 44 } },
          { id: 'el_bar', type: 'shape', name: 'Akzentbalken', shape: 'rect', x: 160, y: 320, width: 240, height: 16, style: { background: '#F2A541' } },
        ],
      },
    },
    {
      op: 'add_slide',
      slide: {
        id: 's_status',
        title: 'Wo wir stehen',
        elements: [
          { id: 'el_status_h', type: 'text', name: 'Überschrift', x: 120, y: 100, width: 1600, height: 120, text: 'Wo wir stehen', style: { color: '#0E3B43', fontSize: 72, fontWeight: 700 } },
          {
            id: 'el_chart',
            type: 'chart',
            name: 'Umsatz je Quartal',
            x: 120,
            y: 280,
            width: 1000,
            height: 680,
            chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4 (Plan)'], series: [{ name: 'Umsatz (Mio. €)', values: [2.1, 2.6, 3.4, 4.2] }] },
          },
          { id: 'el_status_t', type: 'text', name: 'Kernaussage', x: 1200, y: 320, width: 600, height: 400, text: '**+62 %** seit Q1\n\nWachstum getragen von zwei Bestandskunden', style: { color: '#1D1D1B', fontSize: 40 } },
        ],
      },
    },
    {
      op: 'add_slide',
      slide: {
        id: 's_product',
        title: 'Produkt',
        elements: [
          { id: 'el_prod_img', type: 'image', name: 'Produktbild', assetId: 'ast_deck_hero', x: 0, y: 0, width: 960, height: 1080 },
          { id: 'el_prod_h', type: 'text', name: 'Überschrift', x: 1040, y: 160, width: 800, height: 120, text: 'Das Produkt', style: { color: '#0E3B43', fontSize: 72, fontWeight: 700 } },
          { id: 'el_prod_t', type: 'text', name: 'Beschreibung', x: 1040, y: 320, width: 780, height: 500, text: 'Ein Werkzeug, das Teams in Minuten statt Tagen zu einem Ergebnis bringt.', style: { color: '#1D1D1B', fontSize: 42 } },
        ],
      },
    },
    {
      op: 'add_slide',
      slide: {
        id: 's_next',
        title: 'Nächste Schritte',
        elements: [
          { id: 'el_next_h', type: 'text', name: 'Überschrift', x: 120, y: 100, width: 1600, height: 120, text: 'Nächste Schritte', style: { color: '#0E3B43', fontSize: 72, fontWeight: 700 } },
          { id: 'el_next_t', type: 'text', name: 'Liste', x: 120, y: 280, width: 1500, height: 600, text: '1. Zwei neue Märkte testen\n2. Onboarding halbieren\n3. Partnerprogramm starten', style: { color: '#1D1D1B', fontSize: 52 } },
          { id: 'el_logo', type: 'image', name: 'Logo', assetId: 'ast_deck_logo', x: 1640, y: 900, width: 160, height: 120 },
        ],
      },
    },
  ];
  return {
    path: `${DEMO_ROOT}/Pitch-Deck Q4.dstudio`,
    manifest: manifest({ id: 'prj_demo_slides', title: 'Pitch-Deck Q4', category: 'slides', createdAt: created, updatedAt: '2026-09-21T16:30:00.000Z', checkpoints, phase: 'production', approvals: [{ checkpointId: checkpoints[0]!.id, amountUsd: 2, approvedAt: '2026-09-20T09:00:00.000Z' }] }),
    initialDocument: createDocument('slides'),
    versions: [{ ops, note: 'Gliederung und Theme umgesetzt', author: 'director', createdAt: '2026-09-21T16:30:00.000Z' }],
    assets: [
      asset({ id: 'ast_deck_hero', kind: 'image', title: 'Produktbild', source: 'generated', modelId: 'fal-ai/flux-2/pro', costUsd: 0.06, prompt: 'Produktfoto Laptop auf Holztisch, Morgenlicht', width: 960, height: 1080, createdAt: '2026-09-21T15:00:00.000Z' }),
      // Verknüpfte Datei, deren Ordner verschoben wurde: zeigt „Erneut verknüpfen …“ im Detail-Drawer.
      asset({
        id: 'ast_deck_logo',
        kind: 'image',
        subtype: 'logo',
        title: 'Firmenlogo',
        source: 'linked',
        path: '/Users/demo/Material/logo.svg',
        width: 320,
        height: 240,
        createdAt: '2026-09-20T08:10:00.000Z',
        metadata: { missing: true },
      }),
    ],
    media: {
      ast_deck_hero: { type: 'image', title: 'Produkt', hue: 28, motif: 'frame', width: 480, height: 540 },
      ast_deck_logo: { type: 'image', title: 'LOGO', hue: 190, motif: 'grid', width: 320, height: 240 },
    },
    peaks: {},
    generations: [],
    messages: [{ id: 'msg_slides_1', role: 'director', text: 'Die Gliederung steht. Als Nächstes schlage ich das Theme mit zwei Beispielfolien vor.', createdAt: '2026-09-21T16:31:00.000Z' }],
    ledger: { approvals: [{ checkpointId: checkpoints[0]!.id, amountUsd: 2, approvedAt: '2026-09-20T09:00:00.000Z' }], entries: [ledgerEntry('led_s1', 'actual', 0.31, 'director', 'run_s1', '2026-09-21T16:30:00.000Z')] },
  };
}

// ───────────────────────── Grafik ─────────────────────────

function graphicProject(): DemoProjectSeed {
  const created = '2026-09-15T12:00:00.000Z';
  const ops: DocumentOp[] = [
    { op: 'update_canvas', patch: { background: '#F3E9DC' } },
    { op: 'add_layer', layer: { id: 'ly_bg', type: 'image', name: 'Hintergrund Papier', assetId: 'ast_poster_bg', x: 0, y: 0, width: 1080, height: 1350, opacity: 0.9 } },
    { op: 'add_layer', layer: { id: 'ly_flowers', type: 'image', name: 'Collage Blumen', assetId: 'ast_poster_flowers', x: 140, y: 380, width: 800, height: 620, rotation: -3, effects: [{ type: 'paper', params: {} }, { type: 'shadow', params: { blur: 12 } }] } },
    { op: 'add_layer', layer: { id: 'ly_sticker', type: 'shape', name: 'Sticker', shape: 'ellipse', x: 760, y: 300, width: 220, height: 220, style: { fill: '#E4572E' } } },
    {
      op: 'add_layer',
      layer: {
        id: 'grp_title',
        type: 'group',
        name: 'Titelgruppe',
        x: 80,
        y: 80,
        width: 920,
        height: 260,
        children: [
          { id: 'ly_title', type: 'text', name: 'Titel', text: 'SOMMERFEST', x: 80, y: 90, width: 920, height: 160, style: { fontSize: 140, fontWeight: 800, color: '#1F2421' } },
          { id: 'ly_date', type: 'text', name: 'Datum', text: '12. Juli · Hof der Alten Mälzerei', x: 84, y: 260, width: 900, height: 60, style: { fontSize: 44, color: '#1F2421' } },
        ],
      },
    },
    { op: 'add_layer', layer: { id: 'ly_footer', type: 'text', name: 'Fußzeile', text: 'Eintritt frei · Musik ab 18 Uhr', x: 80, y: 1180, width: 920, height: 80, style: { fontSize: 48, color: '#1F2421' } } },
  ];
  return {
    path: `${DEMO_ROOT}/Plakat Sommerfest.dstudio`,
    manifest: manifest({ id: 'prj_demo_graphic', title: 'Plakat Sommerfest', category: 'graphic', createdAt: created, updatedAt: '2026-09-16T10:00:00.000Z', formats: [STANDARD_FORMATS['4:5']!], phase: 'production' }),
    initialDocument: createDocument('graphic', { format: STANDARD_FORMATS['4:5']! }),
    versions: [{ ops, note: 'Erster Layout-Entwurf', author: 'director', createdAt: '2026-09-16T10:00:00.000Z' }],
    assets: [
      asset({ id: 'ast_poster_bg', kind: 'image', title: 'Papiertextur', source: 'generated', modelId: 'fal-ai/flux-2/pro', costUsd: 0.05, width: 1080, height: 1350, createdAt: '2026-09-16T09:00:00.000Z' }),
      asset({ id: 'ast_poster_flowers', kind: 'image', title: 'Blumen-Collage', source: 'generated', modelId: 'fal-ai/nano-banana-pro', costUsd: 0.04, width: 1200, height: 900, createdAt: '2026-09-16T09:20:00.000Z' }),
    ],
    media: {
      ast_poster_bg: { type: 'image', title: '', hue: 36, motif: 'grid', width: 540, height: 675 },
      ast_poster_flowers: { type: 'image', title: 'Blumen', hue: 340, motif: 'horizon', width: 600, height: 450 },
    },
    peaks: {},
    generations: [],
    messages: [],
    ledger: { approvals: [], entries: [] },
  };
}

// ───────────────────────── Website ─────────────────────────

function webProject(): DemoProjectSeed {
  const created = '2026-09-10T08:00:00.000Z';
  const ops: DocumentOp[] = [
    { op: 'update_site', patch: { stage: 'code' } },
    { op: 'update_page', pageId: 'home', patch: { title: 'Start', sourceFile: 'src/pages/Home.tsx' } },
    { op: 'add_page', page: { id: 'menu', path: '/karte', title: 'Speisekarte', sourceFile: 'src/pages/Menu.tsx' } },
    { op: 'add_page', page: { id: 'contact', path: '/kontakt', title: 'Kontakt', sourceFile: 'src/pages/Contact.tsx' } },
    { op: 'snapshot_files', files: { 'src/App.tsx': 'a1', 'src/pages/Home.tsx': 'b2', 'src/pages/Menu.tsx': 'c3', 'src/pages/Contact.tsx': 'd4' } },
  ];
  return {
    path: `${DEMO_ROOT}/Café Morgenrot.dstudio`,
    manifest: manifest({ id: 'prj_demo_web', title: 'Landingpage Café Morgenrot', category: 'web', createdAt: created, updatedAt: '2026-09-12T18:00:00.000Z', phase: 'production' }),
    initialDocument: createDocument('web'),
    versions: [{ ops, note: 'Seiten implementiert', author: 'director', createdAt: '2026-09-12T18:00:00.000Z' }],
    assets: [asset({ id: 'ast_web_hero', kind: 'image', title: 'Hero Café', source: 'generated', modelId: 'fal-ai/flux-2/pro', costUsd: 0.05, createdAt: '2026-09-11T10:00:00.000Z' })],
    media: { ast_web_hero: { type: 'image', title: 'Café', hue: 22, motif: 'horizon' } },
    peaks: {},
    generations: [],
    messages: [],
    ledger: { approvals: [], entries: [] },
  };
}

// ───────────────────────── Audio ─────────────────────────

function audioProject(): DemoProjectSeed {
  const created = '2026-09-05T08:00:00.000Z';
  const ops: DocumentOp[] = [
    { op: 'update_timeline', patch: { durationFrames: 90_000 } },
    { op: 'insert_clip', trackId: 'A1', clip: { id: 'v_intro', assetId: 'ast_pod_voice', start: 0, in: 0, duration: 20_000, name: 'Begrüßung' } },
    { op: 'insert_clip', trackId: 'A1', clip: { id: 'v_main', assetId: 'ast_pod_voice', start: 21_000, in: 22_000, duration: 39_000, name: 'Thema' } },
    { op: 'insert_clip', trackId: 'A1', clip: { id: 'v_outro', assetId: 'ast_pod_voice', start: 61_000, in: 62_000, duration: 23_000, name: 'Abmoderation' } },
    { op: 'insert_clip', trackId: 'A2', clip: { id: 'bed', assetId: 'ast_pod_music', start: 0, in: 0, duration: 90_000, gainDb: -18, name: 'Musikbett' } },
    { op: 'insert_clip', trackId: 'A3', clip: { id: 'jingle', assetId: 'ast_pod_jingle', start: 0, in: 0, duration: 3000, name: 'Jingle' } },
    { op: 'add_marker', marker: { id: 'p_sec1', frame: 0, kind: 'section', label: 'Intro' } },
    { op: 'add_marker', marker: { id: 'p_sec2', frame: 21_000, kind: 'section', label: 'Lokaljournalismus' } },
    { op: 'add_marker', marker: { id: 'p_sec3', frame: 61_000, kind: 'section', label: 'Abmoderation' } },
  ];
  return {
    path: `${DEMO_ROOT}/Podcast Folge 12.dstudio`,
    manifest: manifest({ id: 'prj_demo_audio', title: 'Podcast Folge 12', category: 'audio', createdAt: created, updatedAt: '2026-09-06T12:00:00.000Z', formats: [], phase: 'production' }),
    initialDocument: createDocument('audio'),
    versions: [{ ops, note: 'Rohschnitt', author: 'director', createdAt: '2026-09-06T12:00:00.000Z' }],
    assets: [
      asset({ id: 'ast_pod_voice', kind: 'audio', subtype: 'voice', title: 'Aufnahme Moderation', source: 'linked', path: '/Users/demo/Aufnahmen/folge12.wav', durationMs: 85_000, createdAt: '2026-09-05T08:10:00.000Z' }),
      asset({ id: 'ast_pod_music', kind: 'audio', subtype: 'music', title: 'Musikbett ruhig', source: 'generated', modelId: 'fal-ai/stable-audio/v2', costUsd: 0.03, durationMs: 90_000, createdAt: '2026-09-05T09:00:00.000Z' }),
      asset({ id: 'ast_pod_jingle', kind: 'audio', subtype: 'sfx', title: 'Jingle', source: 'imported', durationMs: 3000, createdAt: '2026-09-05T08:20:00.000Z' }),
    ],
    media: {
      ast_pod_voice: { type: 'audio', seconds: 85, toneHz: 180, sampleRate: 3000 },
      ast_pod_music: { type: 'audio', seconds: 90, bpm: 84, toneHz: 110, sampleRate: 3000 },
      ast_pod_jingle: { type: 'audio', seconds: 3, bpm: 240, toneHz: 440, sampleRate: 8000 },
    },
    peaks: { ast_pod_voice: { level: 0.75 }, ast_pod_music: { bpm: 84, level: 0.4 }, ast_pod_jingle: { bpm: 240, level: 0.9 } },
    generations: [],
    messages: [],
    ledger: { approvals: [], entries: [] },
  };
}

export function buildDemoProjects(): DemoProjectSeed[] {
  return [videoProject(), slidesProject(), graphicProject(), webProject(), audioProject()];
}

