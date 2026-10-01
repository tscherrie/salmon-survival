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
  /**
   * Queue-URLs aus der Submit-Antwort von fal. Werden mitjournalisiert, damit Status-Abfrage, Ergebnis und
   * Abbruch nach einem Neustart exakt dieselben Endpunkte treffen (nicht aus der Endpoint-ID rekonstruiert).
   */
  queueHandle?: GenerationQueueHandle | undefined;
  queuePosition?: number | undefined;
  /** Geschätzte Restdauer in Sekunden (aus Queue-Position bzw. Fortschritt), für die Anzeige im Panel. */
  etaSec?: number | undefined;
  /** Abgerechnete Menge in der Preiseinheit des Modells (z. B. Sekunden, Bilder), falls fal sie meldet. */
  billableUnits?: number | undefined;
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

export interface GenerationQueueHandle {
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

export function isTerminal(status: GenerationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}
