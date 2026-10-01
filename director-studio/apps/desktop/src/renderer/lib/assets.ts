import type { Asset, Generation } from '@studio/core';

export type AssetUiStatus = 'used' | 'unused' | 'rejected' | 'linked';

/** Status für Chip/Filter: verworfen > im Dokument > verknüpft > ungenutzt. */
export function assetUiStatus(asset: Asset, used: ReadonlySet<string>): AssetUiStatus {
  if (asset.status === 'rejected' || asset.status === 'archived') return 'rejected';
  if (used.has(asset.id)) return 'used';
  if (asset.source === 'linked') return 'linked';
  return 'unused';
}

export function matchesStatusFilter(asset: Asset, used: ReadonlySet<string>, filter: AssetUiStatus | 'all'): boolean {
  if (filter === 'all') return true;
  if (filter === 'linked') return asset.source === 'linked';
  return assetUiStatus(asset, used) === filter;
}

/**
 * Herkunft (Lineage) aus Generierungen (Eingaben → Ausgaben) und `metadata.parentIds`.
 * Der Vertrag liefert noch keine Lineage-Kanten im Snapshot (siehe Bericht).
 */
export function lineageOf(asset: Asset, assets: readonly Asset[], generations: readonly Generation[]): { parents: string[]; children: string[] } {
  const parentsOf = (a: Asset): string[] => {
    const set = new Set<string>();
    const meta = a.metadata?.parentIds;
    if (Array.isArray(meta)) for (const id of meta) if (typeof id === 'string') set.add(id);
    for (const g of generations) if (g.outputAssetIds.includes(a.id) || g.id === a.generationId) for (const id of g.inputAssetIds) set.add(id);
    set.delete(a.id);
    return [...set];
  };
  const parents = parentsOf(asset);
  const children = assets.filter((a) => a.id !== asset.id && parentsOf(a).includes(asset.id)).map((a) => a.id);
  return { parents, children };
}

/** Kurzname eines Modells (letzte sinnvolle Pfadsegmente der Endpoint-ID). */
export function shortModelName(modelId: string, names?: ReadonlyMap<string, string>): string {
  const known = names?.get(modelId);
  if (known) return known;
  const parts = modelId.split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : (parts[parts.length - 1] ?? modelId);
}
