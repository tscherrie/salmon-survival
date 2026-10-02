import { clipAssetIds, type Canvas, type StudioDocument } from '@studio/core';
import type { AssetMedia } from '@studio/render/browser';
import { MediaRepairError, checkAbort } from './types.ts';

export function usedAssets(document: StudioDocument): string[] {
  const ids = new Set<string>();
  if (document.kind === 'timeline') {
    for (const t of document.tracks) for (const c of t.clips) for (const id of clipAssetIds(c)) ids.add(id);
    for (const c of Object.values(document.components)) ids.add(c.assetId);
  } else if (document.kind === 'deck') {
    for (const s of document.slides) {
      if (typeof s.background === 'object') ids.add(s.background.assetId);
      for (const e of s.elements) if (e.assetId) ids.add(e.assetId);
    }
    for (const id of Object.values(document.theme.fontAssets ?? {})) ids.add(id);
  } else if (document.kind === 'canvas') {
    const visit = (layers: Canvas['layers']) => { for (const l of layers) { if (l.assetId) ids.add(l.assetId); if (l.maskAssetId) ids.add(l.maskAssetId); if (l.children) visit(l.children); } };
    visit(document.layers);
  }
  return [...ids];
}
export async function fetchAsset(asset: AssetMedia, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  if (asset.error || !asset.url) throw new MediaRepairError([{ assetId: asset.id, reason: asset.error ?? 'Datei fehlt' }]);
  let response: Response;
  try { response = await fetch(asset.url, { signal, credentials: 'same-origin' }); }
  catch { checkAbort(signal); throw new MediaRepairError([{ assetId: asset.id, reason: 'Datei nicht erreichbar oder CORS nicht freigegeben' }]); }
  if (!response.ok) throw new MediaRepairError([{ assetId: asset.id, reason: `HTTP ${response.status}` }]);
  const blob = await response.blob();
  if (!blob.size) throw new MediaRepairError([{ assetId: asset.id, reason: 'Leere Datei' }]);
  return blob;
}
export async function materializeAssets(document: StudioDocument, assets: Record<string, AssetMedia>, signal?: AbortSignal): Promise<Record<string, AssetMedia>> {
  const missing = usedAssets(document).filter((id) => !assets[id]);
  if (missing.length) throw new MediaRepairError(missing.map((assetId) => ({ assetId, reason: 'Asset fehlt im Projekt' })));
  const out: Record<string, AssetMedia> = {};
  for (const id of usedAssets(document)) {
    const asset = assets[id]!; let blob = await fetchAsset(asset, signal), width = asset.width, height = asset.height;
    // The shared SVG sanitizer deliberately rejects data:image/svg+xml. Rasterize imported
    // SVG images in image mode (scripts do not execute) before embedding them as safe PNG.
    if (asset.kind === 'image' && blob.type.split(';')[0] === 'image/svg+xml') {
      const url = URL.createObjectURL(blob), image = new Image();
      try { image.src = url; await image.decode(); checkAbort(signal); width = image.naturalWidth; height = image.naturalHeight; const canvas = globalThis.document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d')!.drawImage(image, 0, 0); blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new MediaRepairError([{ assetId: id, reason: 'SVG nicht rasterisierbar' }])), 'image/png')); }
      finally { URL.revokeObjectURL(url); }
    }
    out[id] = { ...asset, width, height, url: await blobToDataUrl(blob) };
  }
  return out;
}
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
