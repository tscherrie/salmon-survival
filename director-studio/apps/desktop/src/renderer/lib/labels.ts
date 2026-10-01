import { refLabel, slideNumbers, type Asset, type Clip, type Layer, type Ref, type RefLabelContext, type StudioDocument } from '@studio/core';

/** Anzeigename eines Clips: Name → Text → Asset-Titel → ID. */
export function clipDisplayName(clip: Clip, assetTitles: ReadonlyMap<string, string> | Record<string, string>): string {
  const lookup = (id: string) => (assetTitles instanceof Map ? assetTitles.get(id) : (assetTitles as Record<string, string>)[id]);
  return clip.name ?? clip.text ?? (clip.assetId ? (lookup(clip.assetId) ?? clip.assetId) : (clip.componentId ?? clip.id));
}

function layerName(layer: Layer): string {
  return layer.name ?? (layer.type === 'text' ? (layer.text ?? layer.id).slice(0, 30) : layer.id);
}

/** Kontext für `refLabel`: Namen für Assets, Spuren, Clips, Marker, Folien, Elemente und Ebenen. */
export function labelContextFor(doc: StudioDocument | null, assets: readonly Asset[]): RefLabelContext {
  const names: Record<string, string> = {};
  for (const a of assets) names[a.id] = a.title;
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
  return { names, fps, ...(numbers ? { slideNumbers: numbers } : {}) };
}

/**
 * Chip-Beschriftung: wie `refLabel`, aber Element-Referenzen, deren `elementId` im Kontext keinen Namen hat
 * (z. B. `data-sid` aus der Web-Vorschau), zeigen stattdessen Tag und sichtbaren Text („h1 „Guten Morgen““).
 */
export function refChipLabel(ref: Ref, ctx: RefLabelContext): string {
  if (ref.kind === 'element' && ref.elementId && !ctx.names?.[ref.elementId] && ref.text) {
    const { elementId: _unnamed, ...rest } = ref;
    return refLabel(rest, ctx);
  }
  return refLabel(ref, ctx);
}

/** Tooltip eines Chips: Beschriftung plus (bei Elementen) Tag, voller Text, Selektor und Quelle. */
export function refChipTitle(ref: Ref, ctx: RefLabelContext): string {
  const label = refChipLabel(ref, ctx);
  if (ref.kind !== 'element') return label;
  const parts = [label];
  const what = [ref.tag ? `<${ref.tag}>` : '', ref.text ? `„${ref.text}“` : ''].filter(Boolean).join(' ');
  if (what) parts.push(what);
  if (ref.selector) parts.push(ref.selector);
  if (ref.source) parts.push(`${ref.source.file}:${ref.source.line}${ref.source.column ? `:${ref.source.column}` : ''}`);
  return parts.join('\n');
}
