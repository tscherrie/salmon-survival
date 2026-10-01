import type { Asset, Generation, LineageEdge } from '@studio/core';

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
 * Lineage-Kanten aus Generierungen (Eingaben → Ausgaben, Relation `input`) und `metadata.parentIds`
 * (Relation `derived`). Das echte Backend liefert sie über `getLineage`; das Fake-Backend leitet sie hiermit ab.
 */
export function lineageEdgesOf(asset: Asset, assets: readonly Asset[], generations: readonly Generation[]): { parents: LineageEdge[]; children: LineageEdge[] } {
  const parentEdges = (a: Asset): LineageEdge[] => {
    const edges = new Map<string, LineageEdge>();
    for (const g of generations) {
      if (!g.outputAssetIds.includes(a.id) && g.id !== a.generationId) continue;
      for (const id of g.inputAssetIds) if (id !== a.id && !edges.has(id)) edges.set(id, { parentId: id, childId: a.id, relation: 'input' });
    }
    const meta = a.metadata?.parentIds;
    if (Array.isArray(meta)) {
      for (const id of meta) if (typeof id === 'string' && id !== a.id && !edges.has(id)) edges.set(id, { parentId: id, childId: a.id, relation: 'derived' });
    }
    return [...edges.values()];
  };
  const parents = parentEdges(asset);
  const children = assets.filter((a) => a.id !== asset.id).flatMap((a) => parentEdges(a).filter((e) => e.parentId === asset.id));
  return { parents, children };
}

/** Wie {@link lineageEdgesOf}, nur die IDs (Eltern bzw. Kinder). */
export function lineageOf(asset: Asset, assets: readonly Asset[], generations: readonly Generation[]): { parents: string[]; children: string[] } {
  const edges = lineageEdgesOf(asset, assets, generations);
  return { parents: edges.parents.map((e) => e.parentId), children: edges.children.map((e) => e.childId) };
}

export type LinkedFileState = 'ok' | 'missing' | 'unknown';

/**
 * Prüft, ob die Datei eines verknüpften Assets noch erreichbar ist: `metadata.missing` (vom Backend bzw. Fake
 * gesetzt) oder eine HEAD-Anfrage auf die Asset-URL (`studio-asset://…` antwortet mit 404, wenn die Datei fehlt).
 * Daten-/Blob-URLs (Browser-Modus) lassen sich nicht prüfen → `unknown`.
 */
export async function probeLinkedFile(asset: Asset, url: string, fetchImpl: typeof fetch | undefined = globalThis.fetch): Promise<LinkedFileState> {
  if (asset.source !== 'linked') return 'ok';
  if (asset.metadata?.missing === true) return 'missing';
  if (!url || /^(data|blob):/i.test(url) || typeof fetchImpl !== 'function') return 'unknown';
  try {
    const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
    if (response.status === 404) return 'missing';
    return response.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Kurzname eines Modells (letzte sinnvolle Pfadsegmente der Endpoint-ID). */
export function shortModelName(modelId: string, names?: ReadonlyMap<string, string>): string {
  const known = names?.get(modelId);
  if (known) return known;
  const parts = modelId.split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : (parts[parts.length - 1] ?? modelId);
}
