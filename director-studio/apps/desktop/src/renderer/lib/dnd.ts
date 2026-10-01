import { refSchema, type Ref } from '@studio/core';

/** MIME-Typ für Referenzen per Drag & Drop (JSON einer core-`Ref`). */
export const REF_MIME = 'application/x-studio-ref';

export function setRefDragData(dataTransfer: DataTransfer, ref: Ref, text: string): void {
  dataTransfer.setData(REF_MIME, JSON.stringify(ref));
  dataTransfer.setData('text/plain', text);
  dataTransfer.effectAllowed = 'copy';
}

/** Liest und validiert eine Referenz aus dem DataTransfer (`null` bei fremden/ungültigen Daten). */
export function readRefDragData(dataTransfer: Pick<DataTransfer, 'getData'>): Ref | null {
  const raw = dataTransfer.getData(REF_MIME);
  if (!raw) return null;
  try {
    const parsed = refSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function hasDragType(dataTransfer: Pick<DataTransfer, 'types'> | null, type: string): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(type);
}
