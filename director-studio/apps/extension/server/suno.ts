import type { Asset, DocumentOp } from '@studio/core';
import { SUNO_CREATE_URL, sunoPromptSchema, sunoPromptText, sunoRecordSchema, type SunoHandoff } from '../shared/suno.ts';
import { ApiError, documentOf, head, id, type CloudProject } from './storage.ts';

export function prepareSunoHandoff(state: CloudProject, value: unknown) {
  const prompt = sunoPromptSchema.parse(value);
  const handoff: SunoHandoff = { ...prompt, id: id('suno'), createdAt: new Date().toISOString(), status: 'prepared' as const, createUrl: SUNO_CREATE_URL };
  state.musicHandoffs ??= []; state.musicHandoffs.push(handoff);
  return { handoff, copyText: sunoPromptText(prompt), generationStarted: false, hostAction: 'Copy this prompt into the official Suno website. Suno account, generation, plan and charges remain there. Import downloaded audio or stems into this project afterwards.' };
}

/** User-declared provenance; does not impersonate a generation/billing/rights receipt. */
export function recordSunoImport(state: CloudProject, value: unknown) {
  const input = sunoRecordSchema.parse(value);
  if (new Set(input.assetIds).size !== input.assetIds.length || input.kind === 'song' && input.assetIds.length !== 1) throw new ApiError(400, 'SUNO_ASSET_SET', 'Select one song or a distinct set of stem files.');
  if (input.receipt.handoffId && !state.musicHandoffs?.some(h => h.id === input.receipt.handoffId)) throw new ApiError(404, 'SUNO_HANDOFF_NOT_FOUND', 'Suno prompt does not belong to this project.');
  const assets = input.assetIds.map(assetId => {
    const a = state.assets.find(a => a.id === assetId);
    if (!a) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    if (a.kind !== 'audio' || !a.mime?.startsWith('audio/') || a.status !== 'active') throw new ApiError(400, 'SUNO_AUDIO_REQUIRED', 'Only active audio assets can be imported as Suno music.');
    if (a.generationId || a.metadata?.fal) throw new ApiError(409, 'SUNO_PROVENANCE_CONFLICT', 'An existing generation receipt cannot be relabeled as a Suno import.');
    return a;
  });
  const prior = assets.map(a => a.metadata?.musicProvider);
  if (prior.some(Boolean)) {
    const group = prior[0] as { provider?: string; groupId?: string; assetIds?: string[]; receipt?: unknown; kind?: string } | undefined;
    if (!group || group.provider !== 'suno' || group.kind !== input.kind || JSON.stringify(group.assetIds) !== JSON.stringify(input.assetIds) || JSON.stringify(group.receipt) !== JSON.stringify(input.receipt) || !prior.every(p => (p as { groupId?: string } | undefined)?.groupId === group.groupId)) throw new ApiError(409, 'SUNO_PROVENANCE_CONFLICT', 'This audio already has a different provider declaration.');
    return { assets, groupId: group.groupId, ops: [] as DocumentOp[], alreadyRecorded: true, rightsVerified: false };
  }
  const groupId = id('music'); const ops: DocumentOp[] = [];
  if (input.placement) {
    const doc = documentOf(state);
    if (doc?.kind !== 'timeline') throw new ApiError(409, 'NOT_TIMELINE', 'Timeline placement requires a video or audio project.');
    if (input.placement.expectedHead !== head(state)?.number) throw new ApiError(409, 'VERSION_CONFLICT', 'The timeline changed. Reopen and import at the current head.');
    let nextTrackNumber = 1;
    for (const a of assets) {
      while (doc.tracks.some(t => t.id === `A${nextTrackNumber}`)) nextTrackNumber++;
      const trackId = `A${nextTrackNumber++}`;
      if (!(a.durationMs && Number.isFinite(a.durationMs))) throw new ApiError(400, 'SUNO_DURATION_REQUIRED', 'Read each audio duration before timeline placement. Assets can be imported without placement.');
      const duration = Math.max(1, Math.round(a.durationMs * doc.fps / 1000));
      ops.push({ op: 'add_track', track: { id: trackId, kind: 'audio', role: /vocal/i.test(a.title) ? 'vocals' : 'music', name: a.title, clips: [{ id: id('clip'), assetId: a.id, name: a.title, start: input.placement.startFrame, duration, in: 0, speed: 1 }] } });
    }
    const end = Math.max(...assets.map(a => input.placement!.startFrame + Math.max(1, Math.round(a.durationMs! * doc.fps / 1000))));
    if (end > doc.durationFrames) ops.push({ op: 'update_timeline', patch: { durationFrames: end } });
  }
  for (const a of assets) {
    if (input.kind === 'song') a.title = input.receipt.title;
    a.subtype = input.kind === 'stems' ? 'stem' : 'music';
    if (input.receipt.sourceUrl) a.sourceUrl = input.receipt.sourceUrl;
    a.metadata = { ...a.metadata, musicProvider: { provider: 'suno', importMode: 'user-export', groupId, assetIds: input.assetIds, kind: input.kind, receipt: input.receipt, recordedAt: new Date().toISOString(), declarationSource: 'user', rightsVerified: false, generationVerified: false, billingKnown: false, timelineStartFrame: input.placement?.startFrame ?? null, alignment: input.kind === 'stems' ? 'common-export-origin' : null, rightsReviewRequired: input.receipt.intendedUse === 'commercial' && !['pro', 'premier'].includes(input.receipt.planAtCreation) } };
  }
  return { assets: assets as Asset[], groupId, ops, alreadyRecorded: false, rightsVerified: false };
}
