import { z } from 'zod';
import { DocumentOpError, assertAssetKind, assertUniqueId, deepClone, mergePatch, type OpContext } from './common.ts';

/** Grafik/Collage: Leinwand mit Ebenenbaum. Koordinaten in Pixeln der Leinwand. */

export const LAYER_TYPES = ['image', 'text', 'shape', 'group'] as const;

export const layerEffectSchema = z.object({
  type: z.enum(['shadow', 'paper', 'grain', 'blur', 'outline', 'halftone', 'tear']),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export interface Layer {
  id: string;
  type: (typeof LAYER_TYPES)[number];
  name?: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number | undefined;
  opacity?: number | undefined;
  blend?: string | undefined;
  hidden?: boolean | undefined;
  assetId?: string | undefined;
  /** Bildausschnitt im Quellbild (normiert 0..1). */
  crop?: { x: number; y: number; width: number; height: number } | undefined;
  /** Maske (z. B. Freisteller) als Asset. */
  maskAssetId?: string | undefined;
  text?: string | undefined;
  shape?: 'rect' | 'ellipse' | 'path' | undefined;
  path?: string | undefined;
  style?: Record<string, string | number> | undefined;
  effects?: Array<z.infer<typeof layerEffectSchema>> | undefined;
  children?: Layer[] | undefined;
}

export const layerSchema: z.ZodType<Layer> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum(LAYER_TYPES),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    blend: z.string().optional(),
    hidden: z.boolean().optional(),
    assetId: z.string().optional(),
    crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    maskAssetId: z.string().optional(),
    text: z.string().optional(),
    shape: z.enum(['rect', 'ellipse', 'path']).optional(),
    path: z.string().optional(),
    style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    effects: z.array(layerEffectSchema).optional(),
    children: z.array(layerSchema).optional(),
  }),
);

export const canvasSchema = z.object({
  kind: z.literal('canvas'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  unit: z.enum(['px', 'mm']).default('px'),
  dpi: z.number().positive().default(72),
  /** Beschnittzugabe für Druck (in `unit`). */
  bleed: z.number().nonnegative().default(0),
  background: z.string().default('#ffffff'),
  layers: z.array(layerSchema).default([]),
});
export type Canvas = z.infer<typeof canvasSchema>;
export type CanvasInput = z.input<typeof canvasSchema>;

export function createCanvas(options: { width?: number; height?: number; background?: string } = {}): Canvas {
  return canvasSchema.parse({
    kind: 'canvas',
    width: options.width ?? 1080,
    height: options.height ?? 1350,
    background: options.background ?? '#ffffff',
  });
}

export const canvasOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_layer'),
    layer: layerSchema,
    parentId: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal('update_layer'), layerId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('remove_layer'), layerId: z.string() }),
  z.object({
    op: z.literal('move_layer'),
    layerId: z.string(),
    parentId: z.string().nullable().optional(),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    op: z.literal('update_canvas'),
    patch: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        unit: z.enum(['px', 'mm']),
        dpi: z.number().positive(),
        bleed: z.number().nonnegative(),
        background: z.string(),
      })
      .partial(),
  }),
]);
export type CanvasOp = z.infer<typeof canvasOpSchema>;
export type CanvasOpInput = z.input<typeof canvasOpSchema>;

export function applyCanvasOps(doc: Canvas, ops: readonly CanvasOpInput[], ctx: OpContext = {}): Canvas {
  let next = deepClone(doc);
  ops.forEach((raw, index) => {
    const parsed = canvasOpSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DocumentOpError(index, String((raw as { op?: unknown }).op ?? '?'), parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    try {
      next = applyOne(next, parsed.data, ctx);
    } catch (error) {
      throw new DocumentOpError(index, parsed.data.op, (error as Error).message);
    }
  });
  validateCanvas(next);
  return next;
}

function applyOne(doc: Canvas, op: CanvasOp, ctx: OpContext): Canvas {
  switch (op.op) {
    case 'add_layer': {
      const ids = allLayerIds(doc.layers);
      for (const id of allLayerIds([op.layer])) assertUniqueId(ids, id, 'Ebene');
      checkLayer(op.layer, ctx);
      const siblings = op.parentId ? groupChildren(doc, op.parentId) : doc.layers;
      siblings.splice(Math.min(op.index ?? siblings.length, siblings.length), 0, op.layer);
      return doc;
    }
    case 'update_layer': {
      const { siblings, index, layer } = locate(doc.layers, op.layerId);
      if ('id' in op.patch || 'children' in op.patch) throw new Error('id/children können nicht per update_layer geändert werden');
      const style = op.patch.style as Record<string, string | number> | undefined;
      const merged = layerSchema.parse({
        ...mergePatch(layer as unknown as Record<string, unknown>, op.patch),
        ...(style ? { style: { ...(layer.style ?? {}), ...style } } : {}),
      });
      checkLayer(merged, ctx);
      siblings[index] = merged;
      return doc;
    }
    case 'remove_layer': {
      const { siblings, index } = locate(doc.layers, op.layerId);
      siblings.splice(index, 1);
      return doc;
    }
    case 'move_layer': {
      const { siblings, index, layer } = locate(doc.layers, op.layerId);
      if (op.parentId && allLayerIds([layer]).includes(op.parentId)) {
        throw new Error('Eine Ebene kann nicht in sich selbst verschoben werden');
      }
      siblings.splice(index, 1);
      const target = op.parentId ? groupChildren(doc, op.parentId) : doc.layers;
      target.splice(Math.min(op.index, target.length), 0, layer);
      return doc;
    }
    case 'update_canvas': {
      Object.assign(doc, op.patch);
      return doc;
    }
  }
}

function checkLayer(layer: Layer, ctx: OpContext): void {
  if (layer.type === 'image') {
    if (!layer.assetId) throw new Error(`Ebene "${layer.id}" (image) braucht assetId`);
    assertAssetKind(ctx, layer.assetId, ['image', 'video'], `Ebene "${layer.id}"`);
  }
  if (layer.maskAssetId) assertAssetKind(ctx, layer.maskAssetId, ['image', 'data'], `Maske von "${layer.id}"`);
  if (layer.type === 'text' && layer.text === undefined) throw new Error(`Ebene "${layer.id}" (text) braucht text`);
  if (layer.type === 'shape' && layer.shape === 'path' && !layer.path) throw new Error(`Ebene "${layer.id}" braucht path`);
  if (layer.type !== 'group' && layer.children?.length) throw new Error(`Nur Gruppen haben Kinder ("${layer.id}")`);
  for (const child of layer.children ?? []) checkLayer(child, ctx);
}

export function validateCanvas(doc: Canvas): void {
  const ids = allLayerIds(doc.layers);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Doppelte Ebenen-ID "${id}"`);
    seen.add(id);
  }
}

export function allLayerIds(layers: readonly Layer[]): string[] {
  return layers.flatMap((l) => [l.id, ...allLayerIds(l.children ?? [])]);
}

export function findLayer(layers: readonly Layer[], layerId: string): Layer | undefined {
  for (const layer of layers) {
    if (layer.id === layerId) return layer;
    const inChild = findLayer(layer.children ?? [], layerId);
    if (inChild) return inChild;
  }
  return undefined;
}

function locate(layers: Layer[], layerId: string): { siblings: Layer[]; index: number; layer: Layer } {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index >= 0) return { siblings: layers, index, layer: layers[index]! };
  for (const layer of layers) {
    if (layer.children) {
      try {
        return locate(layer.children, layerId);
      } catch {
        // weiter suchen
      }
    }
  }
  throw new Error(`Ebene "${layerId}" existiert nicht`);
}

function groupChildren(doc: Canvas, groupId: string): Layer[] {
  const group = findLayer(doc.layers, groupId);
  if (!group) throw new Error(`Gruppe "${groupId}" existiert nicht`);
  if (group.type !== 'group') throw new Error(`Ebene "${groupId}" ist keine Gruppe`);
  group.children ??= [];
  return group.children;
}

/** Oberste sichtbare Ebene an einem Punkt (ohne Rotation; Gruppen werden durchsucht). */
export function canvasLayersAt(doc: Canvas, x: number, y: number): Layer[] {
  const hits: Layer[] = [];
  const visit = (layers: readonly Layer[]) => {
    for (const layer of layers) {
      if (layer.hidden) continue;
      if (layer.type === 'group') visit(layer.children ?? []);
      else if (x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height) hits.push(layer);
    }
  };
  visit(doc.layers);
  return hits.reverse();
}

export function summarizeCanvas(doc: Canvas): string {
  const lines = [`Leinwand ${doc.width}×${doc.height} ${doc.unit} @ ${doc.dpi} dpi · Hintergrund ${doc.background}${doc.bleed ? ` · Beschnitt ${doc.bleed}` : ''}`];
  const visit = (layers: readonly Layer[], depth: number) => {
    for (const l of layers) {
      const what = l.type === 'text' ? `„${(l.text ?? '').slice(0, 40)}“` : l.type === 'image' ? `Bild ${l.assetId}` : l.type;
      lines.push(`${'  '.repeat(depth)}- ${l.id}${l.name ? ` (${l.name})` : ''}: ${what} @ ${Math.round(l.x)},${Math.round(l.y)} ${Math.round(l.width)}×${Math.round(l.height)}${l.hidden ? ' (ausgeblendet)' : ''}`);
      if (l.children) visit(l.children, depth + 1);
    }
  };
  visit(doc.layers, 0);
  return lines.join('\n');
}
