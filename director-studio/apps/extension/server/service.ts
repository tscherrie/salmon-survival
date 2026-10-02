import {
  ASSET_KINDS, BudgetLedger, DEFAULT_PICKERS, MODALITIES, PROJECT_CATEGORIES, PROJECT_SCHEMA_VERSION, formatSpecSchema,
  STANDARD_FORMATS, applyDocumentOps, assetKindFromMime, assetSchema, createCheckpoints, createDocument,
  checkModelAllowed, currentCheckpoint, decideCheckpoint, documentAssetIds, filterAssets, isSafeSitePath, mergeCheckpoints,
  mimeFromExtension, projectBriefSchema, proposeCheckpoint, summarizeDocument,
  type Asset, type AssetQuery, type CheckpointDecision, type CreateProjectInput, type DocumentOp,
  type Generation, type Modality, type PickerSelection, type ProjectCategory, type ProjectSnapshot, type RecentProject, type StudioDocument, type Version,
} from '@studio/core';
import { z } from 'zod';
import { ApiError, CloudStore, documentOf, head, id, sha256, type CloudProject, type LoadedProject, type PersistentJob, type WorkerEnv } from './storage.ts';
import { prepareSunoHandoff, recordSunoImport } from './suno.ts';
import { SUNO_CAPABILITIES } from '../shared/suno.ts';

const obj = z.record(z.string(), z.unknown());
const string = z.string().min(1);
const finite = z.number().finite().nonnegative();
const now = () => new Date().toISOString();
export function snapshot(loaded: LoadedProject): ProjectSnapshot & { cloudRevision: number; jobs: PersistentJob[]; siteFiles: Record<string, string>; updates: CloudProject['updates']; questionAnswers: CloudProject['questionAnswers'] } {
  const { state, revision } = loaded;
  const document = documentOf(state);
  return { path: state.manifest.id, manifest: state.manifest, document, versions: state.versions.map(({ document: _d, ops: _o, ...v }) => v), assets: state.assets,
    usedAssetIds: document ? [...documentAssetIds(document)] : [], budget: ledger(state).summary(), checkpoints: state.manifest.checkpoints,
    messages: [], generations: state.generations, runState: state.pendingQuestion || state.pendingApprovals.length ? 'waiting_user' : 'idle',
    pendingQuestion: state.pendingQuestion, pendingApprovals: state.pendingApprovals, activities: [], cloudRevision: revision, jobs: state.jobs,
    siteFiles: state.siteFiles, updates: state.updates, questionAnswers: state.questionAnswers };
}
function ledger(state: CloudProject): BudgetLedger { return new BudgetLedger({ entries: state.ledger, approvals: state.manifest.budgetApprovals }, now, () => id('led')); }
function captureLedger(state: CloudProject, value: BudgetLedger) { state.ledger = [...value.listEntries()]; state.manifest.budgetApprovals = [...value.listApprovals()]; }
function asset(state: CloudProject, assetId: unknown): Asset { const found = state.assets.find(a => a.id === string.parse(assetId)); if (!found) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Asset not found.'); return found; }
function checkpoint(state: CloudProject, checkpointId: unknown) { const found = state.manifest.checkpoints.find(c => c.id === string.parse(checkpointId)); if (!found) throw new ApiError(404, 'CHECKPOINT_NOT_FOUND', 'Checkpoint not found.'); return found; }
function commit(state: CloudProject, doc: StudioDocument, ops: DocumentOp[], note: string, restoredFrom?: number): Version {
  const parent = head(state);
  const v: Version = { number: (parent?.number ?? 0) + 1, parentNumber: parent?.number ?? null, document: doc, ops, note, author: 'director', createdAt: now(), opsCount: ops.length, ...(restoredFrom === undefined ? {} : { restoredFrom }) };
  state.versions.push(v); if (doc.kind === 'site') state.siteVersions[String(v.number)] = structuredClone(state.siteFiles);
  return v;
}
export class DirectorService {
  constructor(readonly store: CloudStore, readonly env: WorkerEnv) {}
  async list(): Promise<RecentProject[]> { return (await this.store.list()).map(({ state }) => {
    const cp = currentCheckpoint(state.manifest.checkpoints); const budget = ledger(state).summary();
    return { path: state.manifest.id, title: state.manifest.title, category: state.manifest.category, updatedAt: state.manifest.updatedAt,
      budget: { spentUsd: budget.spentUsd, approvedUsd: budget.approvedUsd }, ...(cp ? { checkpoint: { index: state.manifest.checkpoints.indexOf(cp) + 1, total: state.manifest.checkpoints.length, title: cp.title, status: cp.status } } : {}) };
  }); }
  async create(value: unknown) {
    const input = z.object({ title: string.max(200), category: z.enum(PROJECT_CATEGORIES).nullable(), formats: z.array(formatSpecSchema).optional() }).parse(value) as CreateProjectInput;
    const formats = input.formats?.length ? input.formats : [STANDARD_FORMATS['16:9']!];
    const settings = await this.store.settings(); const stamp = now();
    const state: CloudProject = { manifest: { schema: PROJECT_SCHEMA_VERSION, id: id('prj'), title: input.title, category: input.category, createdAt: stamp, updatedAt: stamp, formats,
      brief: null, pickers: Object.fromEntries(Object.entries({ ...DEFAULT_PICKERS, ...settings.defaultPickers }).filter(([k]) => k !== 'director')), checkpoints: input.category ? createCheckpoints(input.category) : [], budgetApprovals: [], director: { effort: settings.defaultEffort, runtime: 'native-host' }, phase: 'planning' },
      versions: [], assets: [], lineage: [], ledger: [], generations: [], jobs: [], pendingQuestion: null, questionAnswers: [], pendingApprovals: [], decisions: [], siteFiles: {}, siteVersions: {}, updates: [] };
    if (input.category) commit(state, createDocument(input.category, { formats, format: formats[0] }), [], 'Project created');
    return snapshot(await this.store.create(state));
  }
  async get(projectId: string) { return snapshot(await this.store.load(projectId)); }
  async action(projectId: string, method: string, params: unknown = {}): Promise<unknown> {
    const loaded = await this.store.load(projectId); const state = loaded.state; const p = obj.parse(params);
    let result: unknown; let mutate = true;
    if (p.expectedRevision !== undefined && p.expectedRevision !== loaded.revision) throw new ApiError(409, 'PROJECT_CONFLICT', 'Project revision differs from expectedRevision.');
    switch (method) {
      case 'getSnapshot': return snapshot(loaded);
      case 'getMusicProviders': return { defaultProvider: 'fal', providers: [SUNO_CAPABILITIES] };
      case 'listSunoHandoffs': return state.musicHandoffs ?? [];
      case 'prepareSunoMusic': { const { projectId: _projectId, ...input } = p; result = prepareSunoHandoff(state, input); break; }
      case 'recordSunoImport': {
        const { projectId: _projectId, ...input } = p;
        const recorded = recordSunoImport(state, input);
        if (recorded.alreadyRecorded) return recorded;
        if (recorded.ops.length) {
          const changed = applyDocumentOps(documentOf(state)!, recorded.ops, { assetKind: assetId => state.assets.find(a => a.id === assetId)?.kind });
          commit(state, changed, recorded.ops, 'Imported Suno audio with common stem origin');
        }
        result = recorded; break;
      }
      case 'importSunoUrl': return this.importUrl(projectId, { url: p.url, title: p.title, expectedMimePrefix: 'audio/', metadata: { forceNewAssetRecord: true } });
      case 'searchAssets': return filterAssets(state.assets, (p.query ?? p) as AssetQuery);
      case 'getAsset': return asset(state, p.assetId ?? p.id);
      case 'getLineage': { const a = asset(state, p.assetId); return { parents: state.lineage.filter(e => e.childId === a.id), children: state.lineage.filter(e => e.parentId === a.id) }; }
      case 'getVersion': { const v = state.versions.find(v => v.number === z.number().int().positive().parse(p.number)); if (!v) throw new ApiError(404, 'VERSION_NOT_FOUND', 'Version not found.'); return v.document.kind === 'site' ? { ...v, siteFiles: structuredClone(state.siteVersions[String(v.number)] ?? {}) } : v; }
      case 'getDocument': return { document: documentOf(state), head: head(state)?.number ?? null, summary: documentOf(state) ? summarizeDocument(documentOf(state)!) : null, cloudRevision: loaded.revision };
      case 'assetPeaks': { const a = asset(state, p.assetId); const value = a.metadata?.peaks; if (Array.isArray(value)) return { peaks: value, durationMs: a.durationMs ?? 0 }; if (value && typeof value === 'object' && Array.isArray((value as { peaks?: unknown }).peaks)) return value; return null; }
      case 'updateAsset': { const a = asset(state, p.assetId ?? p.id); const patch = obj.parse(p.patch); const protectedFields = ['id', 'path', 'sha256', 'source', 'generationId', 'costUsd', 'modelId', 'sourceUrl', 'createdAt']; if (protectedFields.some(k => k in patch)) throw new ApiError(400, 'PROTECTED_ASSET_FIELD', 'Provenance and storage fields cannot be edited.'); const metadataPatch = patch.metadata === undefined ? undefined : obj.parse(patch.metadata); if (metadataPatch && ('fal' in metadataPatch || 'musicProvider' in metadataPatch)) throw new ApiError(400, 'PROTECTED_ASSET_FIELD', 'Provider provenance can only be recorded through the dedicated provider tools.'); result = assetSchema.parse({ ...a, ...patch, ...(metadataPatch ? { metadata: { ...a.metadata, ...metadataPatch } } : {}) }); state.assets = state.assets.map(v => v.id === a.id ? result as Asset : v); break; }
      case 'rejectAsset': { const a = asset(state, p.assetId ?? p.id); a.status = 'rejected'; result = a; break; }
      case 'setBrief': {
        state.manifest.brief = projectBriefSchema.parse(p.brief ?? p);
        if (p.category) {
          const category = z.enum(PROJECT_CATEGORIES).parse(p.category);
          if (state.manifest.category && state.manifest.category !== category) throw new ApiError(409, 'CATEGORY_FIXED', 'An existing document cannot change category.');
          if (!state.manifest.category) { state.manifest.category = category; state.manifest.checkpoints = createCheckpoints(category); commit(state, createDocument(category, { formats: state.manifest.formats, format: state.manifest.formats[0] }), [], 'Brief defines document'); }
        }
        state.manifest.phase = state.manifest.category ? 'production' : 'planning'; result = state.manifest; break;
      }
      case 'setEffort': state.manifest.director.effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).parse(p.effort); result = undefined; break;
      case 'setPicker': { const modality = z.enum(MODALITIES).parse(p.modality) as Modality; if (modality === 'director') throw new ApiError(400, 'HOST_MODEL', 'Select the Director model in the native host.'); state.manifest.pickers[modality] = z.discriminatedUnion('mode', [z.object({ mode: z.literal('auto') }), z.object({ mode: z.literal('model'), modelId: string })]).parse(p.selection) as PickerSelection; result = undefined; break; }
      case 'applyDocumentOps': {
        const doc = documentOf(state); if (!doc) throw new ApiError(409, 'DOCUMENT_MISSING', 'Set a category before editing.');
        const actual = head(state)!.number; if (p.expectedHead !== undefined && p.expectedHead !== actual) throw new ApiError(409, 'VERSION_CONFLICT', `Expected v${String(p.expectedHead)}, current v${actual}.`);
        const ops = z.array(obj).min(1).max(1000).parse(p.ops) as DocumentOp[];
        const changed = applyDocumentOps(doc, ops, { assetKind: assetId => state.assets.find(a => a.id === assetId && a.status !== 'rejected')?.kind });
        result = commit(state, changed, ops, z.string().max(2000).parse(p.note ?? 'Native Director edit')); break;
      }
      case 'restoreVersion': {
        const target = state.versions.find(v => v.number === z.number().int().positive().parse(p.number)); if (!target) throw new ApiError(404, 'VERSION_NOT_FOUND', 'Version not found.');
        if (target.document.kind === 'site') state.siteFiles = structuredClone(state.siteVersions[String(target.number)] ?? {});
        result = commit(state, structuredClone(target.document), [], `Restored v${target.number}`, target.number); break;
      }
      case 'proposeCheckpoint': { const cp = checkpoint(state, p.checkpointId); const payload = z.object({ summary: string, assetIds: z.array(string).optional(), budgetRequestedUsd: finite.optional() }).parse(p); for (const a of payload.assetIds ?? []) asset(state, a); state.manifest.checkpoints = proposeCheckpoint(state.manifest.checkpoints, cp.id, payload, now()); result = state.manifest.checkpoints; break; }
      case 'mergeCheckpoints': state.manifest.checkpoints = mergeCheckpoints(state.manifest.checkpoints, z.array(string).parse(p.ids), string.parse(p.title)); result = state.manifest.checkpoints; break;
      case 'decideCheckpoint': { const cp = checkpoint(state, p.checkpointId); const decision = z.discriminatedUnion('decision', [z.object({ decision: z.literal('approve'), budgetApprovedUsd: finite.optional() }), z.object({ decision: z.literal('request_changes'), feedback: string }), z.object({ decision: z.literal('skip') })]).parse(p.decision) as CheckpointDecision;
        state.manifest.checkpoints = decideCheckpoint(state.manifest.checkpoints, cp.id, decision, now());
        if (decision.decision === 'approve') { const amount = decision.budgetApprovedUsd ?? cp.budgetRequestedUsd ?? 0; if (amount > 0) { const l = ledger(state); l.approve(cp.id, amount); captureLedger(state, l); } }
        state.decisions.push({ kind: 'checkpoint', id: cp.id, value: decision, at: now() }); result = undefined; break;
      }
      case 'askUser': { if (state.pendingQuestion) throw new ApiError(409, 'QUESTION_PENDING', 'Resolve the current questions first.'); const questions = z.array(z.object({ id: string, question: string, header: z.string().optional(), options: z.array(z.object({ label: string, description: z.string().optional() })).max(20), multiSelect: z.boolean().optional() })).min(1).max(10).parse(p.questions); state.pendingQuestion = { questionId: id('question'), questions }; result = state.pendingQuestion; break; }
      case 'answerQuestion': { if (!state.pendingQuestion || state.pendingQuestion.questionId !== p.questionId) throw new ApiError(409, 'QUESTION_STALE', 'This question is no longer pending.'); const answers = z.record(z.string(), z.string()).parse(p.answers); for (const q of state.pendingQuestion.questions) if (!answers[q.id]?.trim()) throw new ApiError(400, 'ANSWER_REQUIRED', `Answer ${q.id}.`); state.questionAnswers.push({ questionId: state.pendingQuestion.questionId, answers, answeredAt: now() }); state.pendingQuestion = null; result = undefined; break; }
      case 'postUpdate': { const update = { id: id('update'), text: string.max(10000).parse(p.text), createdAt: now() }; state.updates.push(update); result = update; break; }
      case 'prepareGeneration': {
        const input = z.object({ endpointId: string, modality: z.enum(MODALITIES).refine(v => v !== 'director'), estimateUsd: finite, purpose: string, input: obj, checkpointId: string.optional(), inputAssetIds: z.array(string).default([]) }).parse(p);
        const gate = checkModelAllowed(state.manifest.pickers, input.modality, input.endpointId); if (!gate.ok) throw new ApiError(400, 'PICKER_LOCK', gate.reason);
        for (const a of input.inputAssetIds) asset(state, a); if (input.checkpointId) checkpoint(state, input.checkpointId);
        const generation: Generation = { ...input, id: id('gen'), status: 'queued', outputAssetIds: [], createdAt: now() };
        state.generations.push(generation);
        const approval = { id: id('approval'), kind: 'budget' as const, title: `Fal: ${input.endpointId}`, detail: `${input.purpose}. Quoted estimate $${input.estimateUsd}. Your native Fal plugin submits this job only after approval.`, amountUsd: input.estimateUsd, createdAt: now(), generationId: generation.id };
        state.pendingApprovals.push(approval); result = { generation, approval, hostAction: 'Wait for the user approval in Director Studio, then use the installed official Fal plugin. This tool performs no paid submission.' }; break;
      }
      case 'decideApproval': {
        const approval = state.pendingApprovals.find(a => a.id === p.approvalId); if (!approval) throw new ApiError(409, 'APPROVAL_STALE', 'This approval is no longer pending.'); const approved = z.boolean().parse(p.approved);
        const g = state.generations.find(g => g.id === approval.generationId);
        if (g) { const l = ledger(state); if (approved) { const check = l.check(g.estimateUsd, g.checkpointId); if (!check.ok) { if (check.invalid) throw new ApiError(400, 'INVALID_COST', check.reason); l.approve(g.checkpointId ?? `_generation_${g.id}`, check.shortfallUsd, 'Explicit generation approval'); } l.reserve(g.id, g.estimateUsd, { source: 'fal', checkpointId: g.checkpointId }); } else { g.status = 'canceled'; g.finishedAt = now(); } captureLedger(state, l); }
        state.decisions.push({ kind: 'approval', id: approval.id, value: approved, at: now() }); state.pendingApprovals = state.pendingApprovals.filter(a => a !== approval); result = undefined; break;
      }
      case 'recordGeneration': {
        const receipt = z.object({ generationId: string, requestId: string.optional(), status: z.enum(['running', 'completed', 'failed', 'canceled']), actualCostUsd: finite.optional(), outputAssetIds: z.array(string).optional(), error: z.string().optional() }).parse(p);
        const g = state.generations.find(g => g.id === receipt.generationId); if (!g) throw new ApiError(404, 'GENERATION_NOT_FOUND', 'Generation not found.');
        const approved = state.decisions.some(d => d.kind === 'approval' && d.value === true && !state.pendingApprovals.some(a => a.id === d.id) && ledger(state).listEntries().some(e => e.refId === g.id && e.kind === 'reservation'));
        if (!approved) throw new ApiError(403, 'GENERATION_UNAPPROVED', 'Approve this specific generation before recording a submission.');
        if (g.costUsd !== undefined && receipt.actualCostUsd !== undefined && g.costUsd !== receipt.actualCostUsd) throw new ApiError(409, 'BILLING_CONFLICT', 'Recorded actual billing is immutable; do not substitute a new estimate.');
        if (g.requestId && receipt.requestId && g.requestId !== receipt.requestId) throw new ApiError(409, 'RECEIPT_CONFLICT', 'A generation cannot be attached to a different Fal request.');
        if (['completed','failed','canceled'].includes(g.status) && g.status !== receipt.status) throw new ApiError(409, 'JOB_TERMINAL', 'A terminal generation cannot change status.');
        for (const a of receipt.outputAssetIds ?? []) { const item = asset(state, a); if (item.generationId && item.generationId !== g.id) throw new ApiError(409, 'LINEAGE_CONFLICT', 'Output belongs to another generation.'); item.source = 'generated'; item.generationId = g.id; item.modelId = g.endpointId; item.metadata = { ...item.metadata, fal: { requestId: receipt.requestId ?? g.requestId, estimateUsd: g.estimateUsd, actualCostUsd: receipt.actualCostUsd ?? null, receiptSource: 'native-host-fal-plugin' } }; if (receipt.actualCostUsd !== undefined) item.costUsd = receipt.actualCostUsd; for (const parentId of g.inputAssetIds) if (!state.lineage.some(e => e.childId === item.id && e.parentId === parentId)) state.lineage.push({ parentId, childId: item.id, relation: 'input' }); }
        g.status = receipt.status; g.requestId = receipt.requestId ?? g.requestId; g.submittedAt ??= now(); g.outputAssetIds = receipt.outputAssetIds ?? g.outputAssetIds; g.error = receipt.error;
        const l = ledger(state); if (receipt.status === 'completed') { g.finishedAt = now(); if (receipt.actualCostUsd !== undefined) { g.costUsd = receipt.actualCostUsd; l.settle(g.id, receipt.actualCostUsd); } } else if (receipt.status === 'failed' || receipt.status === 'canceled') { g.finishedAt = now(); l.release(g.id); }
        captureLedger(state, l); result = { generation: g, actualBillingKnown: g.costUsd !== undefined }; break;
      }
      case 'awaitGenerations': return state.generations.filter(g => !p.ids || (p.ids as string[]).includes(g.id));
      case 'cancelGeneration': { const g = state.generations.find(g => g.id === p.generationId); if (!g) throw new ApiError(404, 'GENERATION_NOT_FOUND', 'Generation not found.'); return { generation: g, hostAction: 'Cancel through the native Fal plugin, then record its confirmed canceled or failed receipt. Local status has not been changed.' }; }
      case 'createJob': { const input = z.object({ kind: string, input: obj.default({}) }).parse(p); const stamp = now(); const job: PersistentJob = { ...input, id: id('job'), status: 'queued', createdAt: stamp, updatedAt: stamp, projectVersion: head(state)?.number, input: { ...input.input, projectVersion: head(state)?.number } }; state.jobs.push(job); result = job; break; }
      case 'retryJob': { const previous = state.jobs.find(j => j.id === p.jobId); if (!previous) throw new ApiError(404,'JOB_NOT_FOUND','Job not found.'); if (!['failed','canceled'].includes(previous.status)) throw new ApiError(409,'JOB_NOT_RETRYABLE','Only failed or canceled jobs can be retried.'); const stamp=now(); const job:PersistentJob={id:id('job'),kind:previous.kind,input:{...previous.input,retryOf:previous.id,projectVersion:previous.projectVersion},projectVersion:previous.projectVersion,status:'queued',createdAt:stamp,updatedAt:stamp}; state.jobs.push(job);result=job;break; }
      case 'claimJob': { const job = state.jobs.find(j => j.id === p.jobId); if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.'); const executorId = string.parse(p.executorId); const leaseMs = z.number().int().min(10000).max(120000).parse(p.leaseMs ?? 60000); const stamp = now(); if (['completed','failed','canceled'].includes(job.status) || job.status === 'running' && job.executorId !== executorId && (job.leaseUntil ?? '') > stamp) return { claimed: false, job }; job.status = 'running'; job.executorId = executorId; job.leaseUntil = new Date(Date.now() + leaseMs).toISOString(); job.updatedAt = stamp; result = { claimed: true, job }; break; }
      case 'updateJob': { const job = state.jobs.find(j => j.id === p.jobId); if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.'); if (job.executorId && (p.executorId !== job.executorId || (job.leaseUntil ?? '') < now())) throw new ApiError(409, 'JOB_LEASE_LOST', 'Job lease expired or belongs to another editor.'); const patch = z.object({ status: z.enum(['queued','running','completed','failed','canceled']), output: obj.optional(), error: z.string().optional() }).parse(p.patch ?? p); if (['completed','failed','canceled'].includes(job.status) && job.status !== patch.status) throw new ApiError(409, 'JOB_TERMINAL', 'Terminal jobs cannot be restarted.'); Object.assign(job, patch, { updatedAt: now() }); result = job; break; }
      case 'listJobs': return state.jobs;
      case 'cancelJob': { const job = state.jobs.find(j => j.id === p.jobId); if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.'); if (job.status === 'queued' || job.status === 'running') { job.status = 'canceled'; job.updatedAt = now(); } result = job; break; }
      case 'recordAnalysis': { const a = asset(state, p.assetId); const kind = z.enum(['peaks','beats','loudness','transcript','avSync','frames','rotoscope','pose']).parse(p.kind); a.metadata = { ...a.metadata, [kind]: p.result }; result = a; break; }
      case 'createTextAsset': { const content = z.string().max(2_000_000).parse(p.content); return this.upload(projectId, new TextEncoder().encode(content), z.string().parse(p.title ?? 'Document.txt'), z.string().parse(p.mime ?? 'text/plain'), { ...p, source: 'director' }); }
      case 'writeComponent': return this.upload(projectId, new TextEncoder().encode(string.max(2_000_000).parse(p.code)), z.string().parse(p.title ?? p.componentId ?? 'Component.tsx'), 'text/tsx', { kind: 'code', subtype: 'component', source: 'director', forceNewAssetRecord: true, metadata: { componentId: string.parse(p.componentId), isolation: 'sandboxed-ui' } });
      case 'importUrl': return this.importUrl(projectId, p);
      case 'importFalResult': return this.importFalResult(projectId, p);
      case 'writeSiteFile': { const path = string.parse(p.path); if (!isSafeSitePath(path) || path.split('/').some(v => /^\.env(?:\.|$)/.test(v) || v === 'node_modules' || v === '.git')) throw new ApiError(400, 'UNSAFE_PATH', 'Site path is not allowed.'); const doc = documentOf(state); if (doc?.kind !== 'site') throw new ApiError(409, 'NOT_SITE', 'This project has no Site document.'); state.siteFiles[path] = z.string().max(2_000_000).parse(p.content); const hash = await sha256(new TextEncoder().encode(state.siteFiles[path])); const changed = applyDocumentOps(doc, [{ op: 'snapshot_files', files: Object.fromEntries(await Promise.all(Object.entries(state.siteFiles).map(async ([name, content]) => [name, await sha256(new TextEncoder().encode(content))]))) }] as DocumentOp[]); result = { path, sha256: hash, version: commit(state, changed, [], `Wrote ${path}`).number }; break; }
      case 'readSiteFile': { const path = string.parse(p.path); if (!(path in state.siteFiles)) throw new ApiError(404, 'FILE_NOT_FOUND', 'Site file not found.'); return { path, content: state.siteFiles[path] }; }
      case 'readComponent': {
        const candidates = state.assets.filter(a => a.kind === 'code' && a.metadata?.componentId === p.componentId);
        const a = p.assetId ? candidates.find(a => a.id === string.parse(p.assetId)) : candidates.at(-1);
        if (!a) throw new ApiError(404, 'COMPONENT_NOT_FOUND', 'Component source not found in this project.');
        const stored = a.path ? await this.env.MEDIA.get(a.path) : null;
        if (!stored) throw new ApiError(404, 'ASSET_MISSING', 'Component bytes missing; import or relink the asset.');
        return { code: await new Response(stored.body).text(), assetId: a.id };
      }
      case 'previewOpen': { if (documentOf(state)?.kind !== 'site') throw new ApiError(409, 'NOT_SITE', 'This project has no Site document.'); return { url: `/api/projects/${encodeURIComponent(projectId)}/site-preview/index.html` }; }
      case 'requestTranscription': { const a = asset(state, p.assetId); return { assetId: a.id, hostAction: 'Use the installed official Fal plugin to obtain its transcription model schema and price. Call prepare_generation for approval, then submit via Fal and record transcript word timings with record_analysis. No paid job has been submitted.' }; }
      case 'listSiteFiles': return Object.entries(state.siteFiles).map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length }));
      case 'interrupt': return { hostAction: 'Use the native host Stop control. Director Studio has no separate model run.' };
      case 'previewSetBounds': case 'previewSetPickMode': result = undefined; mutate = false; break;
      default: throw new ApiError(400, 'UNKNOWN_ACTION', `Unknown Director action: ${method}`);
    }
    if (mutate) await this.store.save(projectId, state, loaded.revision);
    return result ?? null;
  }
  async upload(projectId: string, bytes: Uint8Array, name: string, mime: string, metadata: Record<string, unknown> = {}): Promise<Asset> {
    const loaded = await this.store.load(projectId);
    const provenance = metadata.metadata as Record<string, unknown> | undefined;
    if (provenance && ('fal' in provenance || 'musicProvider' in provenance)) throw new ApiError(400, 'PROTECTED_ASSET_FIELD', 'Provider provenance requires its dedicated recording tool.');
    const cap = Number(this.env.MAX_IMPORT_BYTES ?? 134217728); if (bytes.length > cap) throw new ApiError(413, 'IMPORT_TOO_LARGE', `Maximum upload ${cap} bytes.`);
    const parents = z.array(z.object({assetId:string,relation:z.enum(['derived','extracted','input','reference'])})).parse(metadata.parents ?? []);
    for (const parent of parents) asset(loaded.state,parent.assetId);
    const hash = await sha256(bytes); const duplicate = loaded.state.assets.find(a => a.sha256 === hash); if (duplicate && !metadata.replaceAssetId && !metadata.forceNewAssetRecord && !parents.length) return duplicate; const key = `${await sha256(new TextEncoder().encode(this.store.owner.id))}/${projectId}/${hash}`;
    // Content-addressed objects are immutable. A CAS conflict may leave an unreferenced
    // object; it cannot overwrite an existing asset or expose it to another owner.
    await this.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    const allowed = z.object({ kind: z.enum(ASSET_KINDS).optional(), subtype: z.string().optional(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), durationMs: finite.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), fps: z.number().positive().optional(), sourceUrl: z.string().url().optional(), metadata: obj.optional() }).parse(metadata);
    const replacement = metadata.replaceAssetId ? asset(loaded.state, metadata.replaceAssetId) : undefined;
    const item = assetSchema.parse({ ...replacement, ...allowed, id: replacement?.id ?? id('ast'), title: allowed.title ?? name, kind: allowed.kind ?? assetKindFromMime(mime), source: replacement?.source ?? (metadata.source === 'director' ? 'director' : metadata.source === 'derived' ? 'derived' : metadata.sourceUrl ? 'web' : 'imported'), path: key, mime, sha256: hash, bytes: bytes.length, createdAt: now() });
    if (replacement) loaded.state.assets = loaded.state.assets.map(a => a.id === replacement.id ? item : a); else loaded.state.assets.push(item);
    for(const parent of parents) if(parent.assetId!==item.id&&!loaded.state.lineage.some(e=>e.parentId===parent.assetId&&e.childId===item.id&&e.relation===parent.relation))loaded.state.lineage.push({parentId:parent.assetId,childId:item.id,relation:parent.relation});
    await this.store.save(projectId, loaded.state, loaded.revision); return item;
  }
  async importFalResult(projectId: string, value: Record<string, unknown>) {
    const receipt = z.object({ url: string, endpointId: string, requestId: string, estimateUsd: finite, actualCostUsd: finite.optional(), title: z.string().optional(), metadata: obj.optional() }).parse(value);
    const original = await this.store.load(projectId); const prior = original.state.generations.find(g => g.requestId === receipt.requestId);
    if (prior) { if (prior.endpointId !== receipt.endpointId) throw new ApiError(409, 'RECEIPT_CONFLICT', 'This request is already associated with a different model.'); return { generation: prior, assets: original.state.assets.filter(a => prior.outputAssetIds.includes(a.id)), actualBillingKnown: prior.costUsd !== undefined, alreadyImported: true }; }
    const imported = await this.importUrl(projectId, { url: receipt.url, title: receipt.title, metadata: receipt.metadata });
    const loaded = await this.store.load(projectId);
    const existing = loaded.state.generations.find(g => g.requestId === receipt.requestId);
    if (existing) return { generation: existing, assets: loaded.state.assets.filter(a => existing.outputAssetIds.includes(a.id)), actualBillingKnown: existing.costUsd !== undefined, alreadyImported: true };
    const generation: Generation = { id: id('gen'), endpointId: receipt.endpointId, modality: imported.kind === 'video' ? 'video' : imported.kind === 'audio' ? 'sound' : imported.kind === 'image' ? 'image' : 'tools', status: 'completed', input: {}, purpose: 'Imported existing native Fal result; no new generation or charge', requestId: receipt.requestId, estimateUsd: receipt.estimateUsd, inputAssetIds: [], outputAssetIds: [imported.id], createdAt: now(), finishedAt: now(), ...(receipt.actualCostUsd === undefined ? {} : { costUsd: receipt.actualCostUsd }) };
    const item = asset(loaded.state, imported.id); item.source = 'generated'; item.generationId = generation.id; item.modelId = receipt.endpointId; if (receipt.actualCostUsd !== undefined) item.costUsd = receipt.actualCostUsd;
    item.metadata = { ...item.metadata, fal: { requestId: receipt.requestId, estimateUsd: receipt.estimateUsd, actualCostUsd: receipt.actualCostUsd ?? null, receiptSource: 'native-host-fal-plugin', previouslyCompleted: true } };
    loaded.state.generations.push(generation);
    if (receipt.actualCostUsd !== undefined) { const l = ledger(loaded.state); l.recordUsage(generation.id, receipt.actualCostUsd, 'fal', 'Imported prior billed generation'); captureLedger(loaded.state, l); }
    await this.store.save(projectId, loaded.state, loaded.revision);
    return { generation, assets: [item], actualBillingKnown: receipt.actualCostUsd !== undefined, alreadyImported: false };
  }
  async importUrl(projectId: string, value: Record<string, unknown>) {
    await this.store.load(projectId); // authorize before the network request
    const url = safeRemoteUrl(string.parse(value.url));
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if (!response.ok || (response.status >= 300 && response.status < 400)) throw new ApiError(400, 'IMPORT_HTTP_ERROR', `Remote download returned HTTP ${response.status}. Redirects require their final URL.`);
    const mime = response.headers.get('content-type')?.split(';')[0] || mimeFromExtension(url.pathname);
    if (value.expectedMimePrefix && !mime.startsWith(String(value.expectedMimePrefix))) throw new ApiError(400, 'SUNO_AUDIO_REQUIRED', 'Use a direct downloadable audio URL, not a Suno song webpage.');
    const cap = Number(this.env.MAX_IMPORT_BYTES ?? 134217728);
    if (Number(response.headers.get('content-length') ?? 0) > cap) throw new ApiError(413, 'IMPORT_TOO_LARGE', 'Remote file is too large.');
    if (!response.body) throw new ApiError(400, 'IMPORT_EMPTY', 'Remote response has no body.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.length; if (size > cap) { await reader.cancel(); throw new ApiError(413, 'IMPORT_TOO_LARGE', 'Remote file exceeds the import limit.'); } chunks.push(chunk); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const name = url.pathname.split('/').pop() || 'download';
    return this.upload(projectId, bytes, name, response.headers.get('content-type')?.split(';')[0] || mimeFromExtension(name), { ...obj.parse(value.metadata ?? {}), title: value.title ?? name, sourceUrl: url.toString() });
  }
}
/** Worker fetch cannot resolve DNS itself. HTTPS + deny IP/local host + no redirects
 * prevents common SSRF paths; Sites' egress boundary must also reject private DNS. */
export function safeRemoteUrl(value: string): URL {
  const url = new URL(value); const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.includes('[')) throw new ApiError(400, 'UNSAFE_URL', 'Import requires a public HTTPS URL without credentials or redirects.');
  return url;
}
