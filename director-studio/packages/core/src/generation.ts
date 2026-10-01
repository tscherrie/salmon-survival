import type { Modality } from './models.ts';

/** Eine Modell-Generierung (fal-Job). Wird vor dem Absenden journalisiert. */
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface Generation {
  id: string;
  endpointId: string;
  modality: Modality;
  status: GenerationStatus;
  /** Validierte Eingabe (lokale Pfade bereits durch Upload-URLs ersetzt). */
  input: Record<string, unknown>;
  /** Zweck in Worten (für Panel und Asset-Beschreibung). */
  purpose: string;
  /** fal request_id, sobald eingereicht. */
  requestId?: string | undefined;
  queuePosition?: number | undefined;
  estimateUsd: number;
  costUsd?: number | undefined;
  checkpointId?: string | undefined;
  /** Assets, die als Eingabe/Referenz dienten (Lineage). */
  inputAssetIds: string[];
  outputAssetIds: string[];
  /** Titel/Tags für erzeugte Assets. */
  outputTitle?: string | undefined;
  outputTags?: string[] | undefined;
  error?: string | undefined;
  logs?: string[] | undefined;
  createdAt: string;
  submittedAt?: string | undefined;
  finishedAt?: string | undefined;
}

export function isTerminal(status: GenerationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}
