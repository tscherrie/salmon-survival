import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  activeBudgetCheckpoint,
  CATEGORY_LABELS,
  CLAUDE_MODELS,
  clipEnd,
  clipsAtFrame,
  clipsInRange,
  exampleCost,
  findClip,
  findLayer,
  formatPrice,
  formatTimecode,
  formatUsd,
  markersInRange,
  MODALITIES,
  MODALITY_LABELS,
  selectionFor,
  serializeComposer,
  summarizeDocument,
  type Asset,
  type ComposerMessage,
  type ComposerSegment,
  type Marker,
  type Ref,
  type StudioDocument,
  type Timeline,
} from '@studio/core';
import type { ProjectStore } from '@studio/project';
import type { MediaPort, ModelCatalogPort, RenderPort } from './ports.ts';
import { assetPreviewImage, describeAssetLine } from './preview.ts';
import type { SkillLibrary } from './skills.ts';
import { resolveSitePath } from './tools/code.ts';
import { assetNames } from './tools/documents.ts';
import { errorMessage, escapeXmlAttr, projectTempDir, readImageBlock, stableJson, truncate, wrapUntrusted, type ImageBlockData } from './util.ts';

// ───────────────────────── Kontextblöcke ─────────────────────────

export interface ContextBlock {
  name: string;
  content: string;
}

export interface ContextOptions {
  skills?: SkillLibrary | undefined;
  /** Maximale Anzahl Assets im Index (Standard 40). */
  maxAssets?: number;
  /** Laufende Generierungen (IDs), falls die Session sie kennt. */
  includeGenerations?: boolean;
}

const PLANNING_PHASE = `Phase: PLANNING – this is the clarifying planning conversation. Before generating anything,
understand goal, audience/platform, formats and length, source material, tone and references,
constraints, budget and deadline. Ask in small batches with ask_user (2–4 concrete options each, your
recommendation first). When you can make a strong proposal, call set_brief (setting the category if it
is still open), then prepare and present the first checkpoint with propose_checkpoint. Do not spend
money in this phase except for tiny, clearly announced tests.`;

const PRODUCTION_PHASE = `Phase: PRODUCTION – the brief is set. Work through the checkpoints; within an approved budget act
without asking, before exceeding it stop and ask.`;

function modelSummaryLine(id: string, catalog: ModelCatalogPort): string {
  const model = catalog.get(id) ?? CLAUDE_MODELS.find((m) => m.id === id);
  if (!model) return `${id} (nicht im Katalog)`;
  const example = exampleCost(model);
  return `${id} – ${model.displayName} · ${formatPrice(model.price)}${example ? ` · ${example}` : ''}`;
}

/** Kontextblöcke als Liste (für Diffing: nur geänderte Blöcke werden erneut gesendet). */
export async function buildContextBlockList(project: ProjectStore, catalog: ModelCatalogPort, options: ContextOptions = {}): Promise<ContextBlock[]> {
  const manifest = project.manifest;
  const blocks: ContextBlock[] = [];

  blocks.push({ name: 'phase', content: manifest.phase === 'planning' ? PLANNING_PHASE : PRODUCTION_PHASE });

  const formats = manifest.formats.map((f) => `${f.id} (${f.width}×${f.height})`).join(', ');
  const briefLines = [
    `Projekt: „${manifest.title}“ · Kategorie: ${manifest.category ? CATEGORY_LABELS[manifest.category] : 'noch offen'} · Formate: ${formats || '—'}`,
  ];
  if (manifest.brief) {
    const b = manifest.brief;
    briefLines.push(
      ...[
        b.goal && `Ziel: ${b.goal}`,
        b.audience && `Zielgruppe: ${b.audience}`,
        b.platforms.length ? `Plattformen: ${b.platforms.join(', ')}` : '',
        b.formats.length ? `Formate (Brief): ${b.formats.join(', ')}` : '',
        b.lengthSec ? `Länge: ${b.lengthSec} s` : '',
        b.tone && `Ton: ${b.tone}`,
        b.references.length ? `Referenzen: ${b.references.join(' · ')}` : '',
        b.constraints && `Constraints: ${b.constraints}`,
        b.budgetUsd !== undefined ? `Budgetrahmen: ${formatUsd(b.budgetUsd)}` : '',
        b.deadline ? `Deadline: ${b.deadline}` : '',
        `Sprache: ${b.language}`,
        b.notes && `Notizen: ${b.notes}`,
      ].filter((x): x is string => !!x),
    );
  } else {
    briefLines.push('Noch kein Brief (Planungsgespräch läuft).');
  }
  blocks.push({ name: 'project_brief', content: briefLines.join('\n') });

  const pickerLines = MODALITIES.map((modality) => {
    const sel = selectionFor(manifest.pickers, modality);
    const label = MODALITY_LABELS[modality];
    return sel.mode === 'auto' ? `${label} (${modality}): Auto – du wählst und begründest` : `${label} (${modality}): verbindlich ${modelSummaryLine(sel.modelId, catalog)}`;
  });
  blocks.push({ name: 'model_selection', content: pickerLines.join('\n') });

  const budget = project.budgetSummary();
  const active = activeBudgetCheckpoint(manifest.checkpoints);
  const budgetLines = [
    `Freigegeben ${formatUsd(budget.approvedUsd)} · verbraucht ${formatUsd(budget.spentUsd)} (fal ${formatUsd(budget.bySource.fal)}, Director ${formatUsd(budget.bySource.director)}) · reserviert ${formatUsd(budget.reservedUsd)} · verfügbar ${formatUsd(budget.availableUsd)}`,
    `Aktiver Budget-Checkpoint: ${active ? `${active.id} (${active.title})` : 'keiner – jede kostenpflichtige Generierung braucht eine Freigabe'}`,
  ];
  for (const [id, b] of Object.entries(budget.byCheckpoint)) {
    if (id === '_' || (b.approvedUsd === 0 && b.spentUsd === 0 && b.reservedUsd === 0)) continue;
    budgetLines.push(`  ${id}: freigegeben ${formatUsd(b.approvedUsd)}, verbraucht ${formatUsd(b.spentUsd)}, reserviert ${formatUsd(b.reservedUsd)}`);
  }
  blocks.push({ name: 'budget', content: budgetLines.join('\n') });

  const cpLines = manifest.checkpoints.map(
    (c) =>
      `${c.id} · ${c.title} · ${c.status}${c.budgetRequestedUsd !== undefined ? ` · beantragt ${formatUsd(c.budgetRequestedUsd)}` : ''}${c.budgetApprovedUsd !== undefined ? ` · freigegeben ${formatUsd(c.budgetApprovedUsd)}` : ''}${c.feedback ? ` · Feedback: ${c.feedback}` : ''}`,
  );
  blocks.push({ name: 'checkpoints', content: cpLines.join('\n') || 'Noch keine Checkpoints (Kategorie offen).' });

  const head = await project.head();
  blocks.push({
    name: 'document_summary',
    content: head ? `v${head.number} · ${head.note}\n${truncate(summarizeDocument(head.document, assetNames(project)), 12000)}` : 'Noch kein Dokument.',
  });

  const used = head ? await project.usedAssetIds() : new Set<string>();
  const assets = project.listAssets({ limit: options.maxAssets ?? 40 });
  const total = project.listAssets({}).length;
  blocks.push({
    name: 'asset_index',
    content: assets.length
      ? `${assets.map((a) => `${describeAssetLine(a)}${used.has(a.id) ? ' · im Dokument' : ''}`).join('\n')}${total > assets.length ? `\n… ${total - assets.length} weitere (search_assets)` : ''}`
      : 'Noch keine Assets.',
  });

  if (options.includeGenerations ?? true) {
    const running = project.listGenerations(['queued', 'running']);
    if (running.length) {
      blocks.push({ name: 'active_generations', content: running.map((g) => `${g.id} · ${g.endpointId} · ${g.status}${g.queuePosition !== undefined ? ` (Position ${g.queuePosition})` : ''} · ${truncate(g.purpose, 100)}`).join('\n') });
    } else {
      blocks.push({ name: 'active_generations', content: 'Keine.' });
    }
  }

  if (options.skills) blocks.push({ name: 'skills_index', content: options.skills.indexText() || 'Keine Skills.' });
  return blocks;
}

export function renderContextBlocks(blocks: readonly ContextBlock[]): string {
  return blocks.map((b) => `<${b.name}>\n${b.content}\n</${b.name}>`).join('\n');
}

/** Alle Kontextblöcke als Text: `<project_brief>`, `<model_selection>`, `<budget>`, … */
export async function buildContextBlocks(project: ProjectStore, catalog: ModelCatalogPort, options: ContextOptions = {}): Promise<string> {
  return renderContextBlocks(await buildContextBlockList(project, catalog, options));
}

/** Merkt sich den zuletzt gesendeten Stand je Block und liefert nur Änderungen. */
export class ContextTracker {
  private readonly sent = new Map<string, string>();

  diff(blocks: readonly ContextBlock[]): ContextBlock[] {
    const changed = blocks.filter((b) => this.sent.get(b.name) !== b.content);
    for (const b of changed) this.sent.set(b.name, b.content);
    return changed;
  }

  reset(): void {
    this.sent.clear();
  }
}

// ───────────────────────── Referenzen auflösen ─────────────────────────

export interface ReferencePorts {
  render?: RenderPort | undefined;
  media?: MediaPort | undefined;
}

export interface ResolvedReferences {
  /** Serialisierter Composer-Text mit `<ref …/>`-Tags. */
  text: string;
  /** `<ref_context>`-Blöcke. */
  contexts: string;
  images: Array<{ refId: string; label: string; image: ImageBlockData }>;
}

const NEAR_SEC = 1;

function fpsOf(doc: StudioDocument | null): number {
  return doc?.kind === 'timeline' ? doc.fps : 30;
}

function clipLine(project: ProjectStore, doc: Timeline, track: Timeline['tracks'][number], clip: Timeline['tracks'][number]['clips'][number], atFrame?: number): string {
  const tc = (f: number) => formatTimecode(f, doc.fps);
  const asset = clip.assetId ? project.getAsset(clip.assetId) : undefined;
  const what =
    clip.text !== undefined
      ? `„${truncate(clip.text, 80)}“${clip.style ? ` [${clip.style}]` : ''}`
      : clip.componentId
        ? `Komponente ${clip.componentId}${clip.props ? ` props=${truncate(JSON.stringify(clip.props), 200)}` : ''}`
        : asset
          ? `${asset.id} „${asset.title}“${asset.modelId ? `, ${asset.modelId}` : ''}`
          : (clip.assetId ?? '?');
  const local = atFrame !== undefined ? ` · Clip-Zeit ${((atFrame - clip.start + clip.in) / doc.fps).toFixed(2)} s` : '';
  return `${track.id} ${clip.id} ${tc(clip.start)}–${tc(clipEnd(clip))} ${what}${local}`;
}

function markerText(doc: Timeline, markers: Marker[]): string[] {
  const tc = (f: number) => formatTimecode(f, doc.fps);
  const words = markers.filter((m) => m.kind === 'word');
  const beats = markers.filter((m) => m.kind === 'beat' || m.kind === 'downbeat');
  const other = markers.filter((m) => m.kind !== 'word' && m.kind !== 'beat' && m.kind !== 'downbeat');
  const lines: string[] = [];
  if (words.length) lines.push(`Wörter: ${words.map((w) => `${w.label ?? ''}@${(w.frame / doc.fps).toFixed(2)}`).join(' ')}`);
  if (beats.length) lines.push(`Beats: ${beats.slice(0, 24).map((b) => `${(b.frame / doc.fps).toFixed(2)}${b.kind === 'downbeat' ? '*' : ''}`).join(' ')}${beats.length > 24 ? ' …' : ''}`);
  if (other.length) lines.push(`Marker: ${other.map((m) => `${tc(m.frame)} ${m.kind}${m.label ? ` ${m.label}` : ''}`).join(' · ')}`);
  return lines;
}

function assetContext(project: ProjectStore, asset: Asset): string[] {
  const lineage = project.lineage(asset.id);
  return [
    describeAssetLine(asset),
    asset.prompt ? `Prompt: ${truncate(asset.prompt, 400)}` : '',
    asset.description ? `Beschreibung: ${truncate(asset.description, 300)}` : '',
    lineage.parents.length ? `Eltern: ${lineage.parents.map((e) => `${e.parentId} (${e.relation})`).join(', ')}` : '',
  ].filter(Boolean);
}

async function sourceExcerpt(project: ProjectStore, file: string, line: number): Promise<string | undefined> {
  try {
    const abs = resolveSitePath(project.siteDir, file);
    const lines = (await readFile(abs, 'utf8')).split('\n');
    const from = Math.max(1, line - 8);
    const to = Math.min(lines.length, line + 8);
    return lines
      .slice(from - 1, to)
      .map((l, i) => `${String(from + i).padStart(5)}${from + i === line ? '>' : ' '} ${l}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

/**
 * Löst die Referenzen einer Composer-Nachricht auf: Was liegt dort (je Spur), welche Wörter/Marker,
 * Clip-/Asset-Metadaten, Folien-/Element-JSON, Quellstelle – plus Bilder (Frame, Folie, Asset-Vorschau),
 * höchstens `maxImages`.
 */
export async function resolveReferences(
  segments: ComposerSegment[] | ComposerMessage,
  project: ProjectStore,
  ports: ReferencePorts = {},
  options: { maxImages?: number } = {},
): Promise<ResolvedReferences> {
  const message: ComposerMessage = Array.isArray(segments) ? { segments } : segments;
  const doc = await project.getDocument();
  const fps = fpsOf(doc);
  const serialized = serializeComposer(message, fps);
  const maxImages = options.maxImages ?? 4;
  const images: ResolvedReferences['images'] = [];
  const contexts: string[] = [];
  let tmpDir: string | undefined;
  const tmp = async () => (tmpDir ??= await projectTempDir(project.dir, 'refs'));

  const addImage = async (refId: string, label: string, load: () => Promise<ImageBlockData | undefined>): Promise<void> => {
    if (images.length >= maxImages) return;
    try {
      const image = await load();
      if (image) images.push({ refId, label, image });
    } catch {
      // Bilder sind Beigabe; Fehler blockieren die Nachricht nicht.
    }
  };
  const timelineFrame = (refId: string, frame: number, label: string) =>
    addImage(refId, label, async () => {
      if (!ports.render) return undefined;
      const out = await ports.render.renderTimelineStill({ frame, out: join(await tmp(), `${refId}-${frame}.png`) });
      return readImageBlock(out);
    });
  const documentPng = (refId: string, slideId: string | undefined, label: string) =>
    addImage(refId, label, async () => {
      if (!ports.render) return undefined;
      const out = await ports.render.renderDocumentPng({ out: join(await tmp(), `${refId}.png`), ...(slideId ? { slideId } : {}) });
      return readImageBlock(out);
    });

  for (const { id, ref } of serialized.refs) {
    const lines: string[] = [];
    try {
      await describeRef(ref);
    } catch (error) {
      lines.push(`(Auflösung fehlgeschlagen: ${errorMessage(error)})`);
    }
    contexts.push(`<ref_context id="${escapeXmlAttr(id)}">\n${lines.join('\n')}\n</ref_context>`);

    async function describeRef(r: Ref): Promise<void> {
      switch (r.kind) {
        case 'time': {
          if (doc?.kind !== 'timeline') {
            lines.push(`Zeitpunkt Frame ${r.frame} (kein Timeline-Dokument).`);
            return;
          }
          lines.push(`Zeitpunkt ${formatTimecode(r.frame, fps)} (Frame ${r.frame}):`);
          const hits = clipsAtFrame(doc, r.frame);
          lines.push(...(hits.length ? hits.map(({ track, clip }) => clipLine(project, doc, track, clip, r.frame)) : ['(auf keiner Spur liegt hier etwas)']));
          const near = Math.round(NEAR_SEC * fps);
          lines.push(...markerText(doc, markersInRange(doc, Math.max(0, r.frame - near), r.frame + near)));
          await timelineFrame(id, r.frame, `Frame ${formatTimecode(r.frame, fps)}`);
          return;
        }
        case 'range': {
          if (doc?.kind !== 'timeline') {
            lines.push(`Bereich Frames ${r.from}–${r.to} (kein Timeline-Dokument).`);
            return;
          }
          lines.push(`Bereich ${formatTimecode(r.from, fps)}–${formatTimecode(r.to, fps)} (${((r.to - r.from) / fps).toFixed(2)} s)${r.trackId ? ` auf Spur ${r.trackId}` : ''}:`);
          const hits = clipsInRange(doc, r.from, r.to, r.trackId);
          lines.push(...(hits.length ? hits.map(({ track, clip }) => clipLine(project, doc, track, clip)) : ['(leer)']));
          lines.push(...markerText(doc, markersInRange(doc, r.from, r.to)));
          const mid = Math.round((r.from + r.to) / 2);
          for (const [frame, label] of [
            [r.from, 'Anfang'],
            [mid, 'Mitte'],
            [Math.max(r.from, r.to - 1), 'Ende'],
          ] as const) {
            await timelineFrame(id, frame, `${label} ${formatTimecode(frame, fps)}`);
          }
          return;
        }
        case 'clip': {
          if (doc?.kind !== 'timeline') {
            lines.push(`Clip ${r.clipId} (kein Timeline-Dokument).`);
            return;
          }
          const found = findClip(doc, r.clipId);
          if (!found) {
            lines.push(`Clip ${r.clipId} existiert nicht (mehr).`);
            return;
          }
          lines.push(clipLine(project, doc, found.track, found.clip));
          const { clip } = found;
          const extra = { gainDb: clip.gainDb, opacity: clip.opacity, transform: clip.transform, transitionIn: clip.transitionIn, notes: clip.notes, speed: clip.speed !== 1 ? clip.speed : undefined };
          const extraJson = stableJson(extra);
          if (extraJson !== '{}') lines.push(`Eigenschaften: ${truncate(extraJson, 600)}`);
          const asset = clip.assetId ? project.getAsset(clip.assetId) : undefined;
          if (asset) lines.push(...assetContext(project, asset));
          lines.push(...markerText(doc, markersInRange(doc, clip.start, clipEnd(clip), ['section', 'word', 'note', 'qa'])));
          await timelineFrame(id, clip.start + Math.floor(clip.duration / 2), `Clip ${clip.id} Mitte`);
          return;
        }
        case 'marker': {
          if (doc?.kind !== 'timeline') return void lines.push(`Marker ${r.markerId}.`);
          const marker = doc.markers.find((m) => m.id === r.markerId);
          if (!marker) return void lines.push(`Marker ${r.markerId} existiert nicht (mehr).`);
          lines.push(`Marker ${marker.id} ${marker.kind}${marker.label ? ` „${marker.label}“` : ''} bei ${formatTimecode(marker.frame, fps)}${marker.data ? ` ${truncate(JSON.stringify(marker.data), 300)}` : ''}`);
          lines.push(...clipsAtFrame(doc, marker.frame).map(({ track, clip }) => clipLine(project, doc, track, clip, marker.frame)));
          await timelineFrame(id, marker.frame, `Marker ${formatTimecode(marker.frame, fps)}`);
          return;
        }
        case 'asset': {
          const asset = project.getAsset(r.assetId);
          if (!asset) return void lines.push(`Asset ${r.assetId} existiert nicht.`);
          lines.push(...assetContext(project, asset));
          if (asset.kind === 'text' || asset.kind === 'code' || asset.kind === 'data') {
            try {
              const text = truncate(await project.readAssetText(asset.id), 1500);
              lines.push(asset.source === 'director' ? `Auszug:\n${text}` : wrapUntrusted(`asset:${asset.id}`, text));
            } catch {
              // ohne Auszug
            }
          }
          await addImage(id, `Asset ${asset.id}`, () => assetPreviewImage({ project, media: ports.media }, asset));
          return;
        }
        case 'slide': {
          if (doc?.kind !== 'deck') return void lines.push(`Folie ${r.slideId} (kein Deck).`);
          const index = doc.slides.findIndex((s) => s.id === r.slideId);
          if (index < 0) return void lines.push(`Folie ${r.slideId} existiert nicht (mehr).`);
          lines.push(`Folie ${index + 1} von ${doc.slides.length}:`, truncate(JSON.stringify(doc.slides[index]), 4000));
          await documentPng(id, r.slideId, `Folie ${index + 1}`);
          return;
        }
        case 'element': {
          if (r.doc === 'deck' && doc?.kind === 'deck') {
            const slide = doc.slides.find((s) => s.id === r.slideId) ?? doc.slides.find((s) => s.elements.some((e) => e.id === r.elementId));
            const el = slide?.elements.find((e) => e.id === r.elementId);
            lines.push(el ? `Element auf Folie ${slide!.id}: ${truncate(JSON.stringify(el), 2000)}` : `Element ${r.elementId ?? '?'} nicht gefunden.`);
            if (slide) await documentPng(id, slide.id, `Folie ${slide.id} (Element ${r.elementId ?? ''})`);
          } else if (r.doc === 'canvas' && doc?.kind === 'canvas') {
            const layer = r.elementId ? findLayer(doc.layers, r.elementId) : undefined;
            lines.push(layer ? `Ebene: ${truncate(JSON.stringify(layer), 2000)}` : `Ebene ${r.elementId ?? '?'} nicht gefunden.`);
            await documentPng(id, undefined, 'Leinwand');
          } else if (r.doc === 'site') {
            lines.push(`Web-Element${r.page ? ` auf ${r.page}` : ''}: ${r.selector ?? r.elementId ?? '?'}${r.bbox ? ` · Box ${Math.round(r.bbox.x)},${Math.round(r.bbox.y)} ${Math.round(r.bbox.width)}×${Math.round(r.bbox.height)}` : ''}`);
            if (r.source) {
              lines.push(`Quelle: site/${r.source.file}:${r.source.line}`);
              const excerpt = await sourceExcerpt(project, r.source.file, r.source.line);
              if (excerpt) lines.push(wrapUntrusted(`site/${r.source.file}`, excerpt));
            }
          } else {
            lines.push(`Element (${r.doc}) ${r.elementId ?? r.selector ?? ''}`);
          }
          if (r.bbox && r.doc !== 'site') lines.push(`Box ${Math.round(r.bbox.x)},${Math.round(r.bbox.y)} ${Math.round(r.bbox.width)}×${Math.round(r.bbox.height)}`);
          return;
        }
        case 'region': {
          const rect = `${Math.round(r.rect.x)},${Math.round(r.rect.y)} ${Math.round(r.rect.width)}×${Math.round(r.rect.height)}`;
          if (r.doc === 'timeline' && doc?.kind === 'timeline') {
            const frame = r.frame ?? 0;
            lines.push(`Bildregion ${rect} (Pixel im ${doc.width}×${doc.height}-Raster) bei ${formatTimecode(frame, fps)}:`);
            lines.push(...clipsAtFrame(doc, frame).map(({ track, clip }) => clipLine(project, doc, track, clip, frame)));
            await timelineFrame(id, frame, `Frame ${formatTimecode(frame, fps)} (Region ${rect})`);
          } else if (r.doc === 'deck' && doc?.kind === 'deck') {
            const slide = doc.slides.find((s) => s.id === r.slideId);
            const inside = slide?.elements.filter((e) => e.x < r.rect.x + r.rect.width && e.x + e.width > r.rect.x && e.y < r.rect.y + r.rect.height && e.y + e.height > r.rect.y) ?? [];
            lines.push(`Region ${rect} auf Folie ${r.slideId ?? '?'}; Elemente darin: ${inside.map((e) => `${e.id} (${e.type})`).join(', ') || 'keine'}`);
            await documentPng(id, r.slideId, `Folie ${r.slideId ?? ''} (Region ${rect})`);
          } else if (r.doc === 'canvas') {
            lines.push(`Region ${rect} auf der Leinwand.`);
            await documentPng(id, undefined, `Leinwand (Region ${rect})`);
          } else {
            lines.push(`Region ${rect} (${r.doc}${r.page ? `, ${r.page}` : ''}).`);
          }
          return;
        }
        case 'version': {
          const version = await project.getVersion(r.versionNumber);
          if (!version) return void lines.push(`Version ${r.versionNumber} existiert nicht.`);
          lines.push(`Version v${version.number} · ${version.createdAt} · ${version.author}: ${version.note}`);
          lines.push(truncate(summarizeDocument(version.document, assetNames(project)), 3000));
          return;
        }
      }
    }
  }
  return { text: serialized.text, contexts: contexts.join('\n'), images };
}
