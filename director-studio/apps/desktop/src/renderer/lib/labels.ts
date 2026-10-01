import { slideNumbers, type Asset, type AssetKind, type Clip, type ComposerSegment, type Layer, type Ref, type RefLabelContext, type StudioDocument } from '@studio/core';
import { ASSET_KIND_ICONS, type IconName } from '../components/common/Icon.tsx';
import { t } from '../i18n.ts';
import { isPageRef } from './refNumbers.ts';
import { formatTc, tcParts } from './timecode.ts';

/** Anzeigename eines Clips: Name → Text → Asset-Titel → ID. */
export function clipDisplayName(clip: Clip, assetTitles: ReadonlyMap<string, string> | Record<string, string>): string {
  const lookup = (id: string) => (assetTitles instanceof Map ? assetTitles.get(id) : (assetTitles as Record<string, string>)[id]);
  return clip.name ?? clip.text ?? (clip.assetId ? (lookup(clip.assetId) ?? clip.assetId) : (clip.componentId ?? clip.id));
}

function layerName(layer: Layer): string {
  return layer.name ?? (layer.type === 'text' ? (layer.text ?? layer.id).slice(0, 30) : layer.id);
}

/** Kontext für Chip-Beschriftungen: Namen, Bildrate, Foliennummern und (für Icon bzw. Thumb) die Asset-Typen. */
export interface ChipLabelContext extends RefLabelContext {
  assetKinds?: Record<string, AssetKind>;
}

/** Kontext für Beschriftungen: Namen für Assets, Spuren, Clips, Marker, Folien, Elemente und Ebenen. */
export function labelContextFor(doc: StudioDocument | null, assets: readonly Asset[]): ChipLabelContext {
  const names: Record<string, string> = {};
  const assetKinds: Record<string, AssetKind> = {};
  for (const a of assets) {
    names[a.id] = a.title;
    assetKinds[a.id] = a.kind;
  }
  let fps = 30;
  let numbers: Record<string, number> | undefined;
  switch (doc?.kind) {
    case 'timeline':
      fps = doc.fps;
      for (const track of doc.tracks) {
        names[track.id] = track.name ?? track.id;
        for (const clip of track.clips) names[clip.id] = clipDisplayName(clip, names);
      }
      for (const m of doc.markers) names[m.id] = m.label ?? `${m.kind} ${m.id}`;
      break;
    case 'deck':
      numbers = slideNumbers(doc);
      for (const slide of doc.slides) {
        if (slide.title) names[slide.id] = slide.title;
        for (const el of slide.elements) names[el.id] = el.name ?? (el.type === 'text' && el.text ? el.text.slice(0, 30) : el.type);
      }
      break;
    case 'canvas': {
      const visit = (layers: readonly Layer[]) => {
        for (const l of layers) {
          names[l.id] = layerName(l);
          if (l.children) visit(l.children);
        }
      };
      visit(doc.layers);
      break;
    }
    case 'site':
      for (const page of doc.pages) names[page.id] = page.title;
      break;
    default:
      break;
  }
  return { names, fps, assetKinds, ...(numbers ? { slideNumbers: numbers } : {}) };
}

// ───────────────────────── Chip-Teile (§9.1) ─────────────────────────

/**
 * Bausteine eines Chips ohne Emoji: Icon (oder Thumb bei Bild- und Video-Assets), Text und ein gedämpfter Zusatz
 * (bei Zeit-Chips die Frames `:FF`). `mono` setzt den Text in Plex Mono (Timecodes, Pfade).
 */
export interface ChipParts {
  icon: IconName | null;
  thumbAssetId?: string;
  text: string;
  mono?: boolean;
  secondary?: string;
}

const shorten = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function slideLabel(slideId: string, ctx: RefLabelContext): string {
  const n = ctx.slideNumbers?.[slideId];
  return n ? t('ref.slide', { n }) : (ctx.names?.[slideId] ?? slideId);
}

/** Ort einer Element- oder Regionsreferenz: „Folie 3“, Seitenpfad oder Timecode. */
function placeOf(ref: Extract<Ref, { kind: 'element' | 'region' }>, ctx: RefLabelContext): string | null {
  if (ref.kind === 'region' && ref.doc === 'timeline' && ref.frame !== undefined) return formatTc(ref.frame, ctx.fps ?? 30, 'short');
  if (ref.slideId) return slideLabel(ref.slideId, ctx);
  if (ref.page) return ref.page;
  return null;
}

/** Was ein Element zeigt: Name (falls bekannt), sonst Tag und sichtbarer Text, sonst Selektor bzw. Tag. */
function elementWhat(ref: Extract<Ref, { kind: 'element' }>, ctx: RefLabelContext): string {
  const named = ref.elementId ? ctx.names?.[ref.elementId] : undefined;
  if (named) return named;
  if (ref.text) return `${ref.tag ? `${ref.tag} ` : ''}„${shorten(ref.text, 40)}“`;
  return ref.elementId ?? ref.selector ?? ref.tag ?? t('ref.element');
}

export function refChipParts(ref: Ref, ctx: ChipLabelContext): ChipParts {
  const name = (id: string) => ctx.names?.[id] ?? id;
  const fps = ctx.fps ?? 30;
  switch (ref.kind) {
    case 'time': {
      const { head, frames } = tcParts(ref.frame, fps, 'short');
      return { icon: null, text: head, secondary: frames, mono: true };
    }
    case 'range': {
      // Alt: wird nicht mehr erzeugt, kann aber in älteren Nachrichten stehen
      const track = ref.trackId ? ` · ${name(ref.trackId)}` : '';
      return { icon: null, text: `${formatTc(ref.from, fps, 'short')}–${formatTc(ref.to, fps, 'short')}${track}`, mono: true };
    }
    case 'clip':
      return { icon: 'film', text: name(ref.clipId) };
    case 'marker':
      return { icon: 'marker', text: name(ref.markerId) };
    case 'asset': {
      const kind = ctx.assetKinds?.[ref.assetId];
      const thumb = kind === 'image' || kind === 'video';
      return { icon: kind ? ASSET_KIND_ICONS[kind] : 'document', ...(thumb ? { thumbAssetId: ref.assetId } : {}), text: name(ref.assetId) };
    }
    case 'slide':
      return { icon: 'slides', text: slideLabel(ref.slideId, ctx) };
    case 'element': {
      if (isPageRef(ref)) return { icon: 'web', text: ref.page, mono: true };
      const what = elementWhat(ref, ctx);
      // Folien und Ebenen nennen den Ort („Folie 3 · Balkendiagramm“); Web-Elemente zeigen Tag und Text (Pfad im Tooltip)
      const where = ref.doc === 'deck' ? placeOf(ref, ctx) : null;
      return { icon: 'cursor', text: where ? `${where} · ${what}` : what };
    }
    case 'region': {
      const where = placeOf(ref, ctx);
      const size = `${Math.round(ref.rect.width)}×${Math.round(ref.rect.height)}`;
      return { icon: 'region', text: where ? `${where} · ${size}` : size };
    }
    case 'version':
      return { icon: 'clock', text: `v${ref.versionNumber}` };
  }
}

/** Chip-Beschriftung als ein String (Text plus Zusatz), z. B. für `aria-label` und Ansagen. Ohne Emoji. */
export function refChipLabel(ref: Ref, ctx: ChipLabelContext): string {
  const parts = refChipParts(ref, ctx);
  return parts.text + (parts.secondary ?? '');
}

/** Tooltip eines Chips: Beschriftung plus (bei Elementen und Regionen) Ort, Tag, voller Text, Selektor und Quelle. */
export function refChipTitle(ref: Ref, ctx: ChipLabelContext): string {
  const label = refChipLabel(ref, ctx);
  if (ref.kind !== 'element' && ref.kind !== 'region') return label;
  const parts = [label];
  if (ref.kind === 'region') {
    parts.push(`@ ${Math.round(ref.rect.x)},${Math.round(ref.rect.y)}`);
    return parts.join('\n');
  }
  if (ref.page && ref.doc === 'site' && !isPageRef(ref)) parts.push(ref.page);
  const what = [ref.tag ? `<${ref.tag}>` : '', ref.text ? `„${ref.text}“` : ''].filter(Boolean).join(' ');
  if (what) parts.push(what);
  if (ref.selector && !isPageRef(ref)) parts.push(ref.selector);
  if (ref.source) parts.push(`${ref.source.file}:${ref.source.line}${ref.source.column ? `:${ref.source.column}` : ''}`);
  return parts.join('\n');
}

/** Lesbarer Text eines Composer-Inhalts (Warteschlange, Ansagen): Chips als ihre Beschriftung, ohne Emoji. */
export function displayText(segments: readonly ComposerSegment[], ctx: ChipLabelContext): string {
  return segments.map((seg) => (seg.type === 'text' ? seg.text : refChipLabel(seg.ref, ctx))).join('');
}
