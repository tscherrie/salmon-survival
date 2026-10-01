import { activeBudgetCheckpoint, checkModelAllowed, formatUsd, MODALITY_LABELS, type Modality, type ModelInfo, type StudioEvent } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import type { UiPort } from './ports.ts';

/**
 * Gates – im Code durchgesetzt, nicht im Prompt (PLAN 16/19a): Modell-Picker und Budget. Werden vom
 * `generate`-Tool und vom `canUseTool`-Hook des Agent SDK gleichermaßen benutzt.
 */

/** Checkpoint, auf den fal-Ausgaben ohne freigegebenen Checkpoint gebucht werden. */
export const EXTRA_BUDGET_CHECKPOINT = 'cp_extra';

export type PickerGateResult = { ok: true; modality: Modality } | { ok: false; reason: string };

/** Picker-Gate: verweigert Modelle einer Modalität, deren Picker auf ein anderes Modell festgelegt ist. */
export function pickerGate(project: ProjectStore, model: ModelInfo | undefined, endpointId: string): PickerGateResult {
  if (!model) {
    return { ok: false, reason: `Unbekanntes Modell „${endpointId}“. Suche es zuerst mit search_models und prüfe das Schema mit get_model_schema.` };
  }
  const check = checkModelAllowed(project.manifest.pickers, model.modality, endpointId);
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, modality: model.modality };
}

export interface BudgetGateContext {
  project: ProjectStore;
  ui: UiPort;
  signal: AbortSignal;
  projectId: string;
  /** Lauf, aus dem die Freigabe-Anfrage stammt (an die UI durchgereicht). */
  runId?: string | undefined;
}

export type BudgetGateResult = { ok: true; checkpointId: string; approvedExtraUsd: number } | { ok: false; reason: string };

/**
 * Budget-Gate: passt die Schätzung nicht in das freigegebene Budget des aktiven Checkpoints, wird eine
 * Approval-Karte vorgelegt. Bei Freigabe wird der Fehlbetrag als zusätzliche Freigabe gebucht
 * (auf den aktiven Checkpoint bzw. {@link EXTRA_BUDGET_CHECKPOINT}).
 */
export async function budgetGate(ctx: BudgetGateContext, amountUsd: number, purpose: string): Promise<BudgetGateResult> {
  const active = activeBudgetCheckpoint(ctx.project.manifest.checkpoints);
  const checkpointId = active?.id ?? EXTRA_BUDGET_CHECKPOINT;
  const check = ctx.project.budgetCheck(amountUsd, checkpointId);
  if (check.ok) return { ok: true, checkpointId, approvedExtraUsd: 0 };
  // Ungültige Schätzung (NaN, unendlich, negativ): keine Freigabekarte – eine Nachfreigabe könnte sie nicht decken.
  if (check.invalid || !Number.isFinite(check.shortfallUsd)) {
    return { ok: false, reason: `Kostenschätzung unbrauchbar: ${check.reason}. Prüfe Modell und Parameter (estimate_cost) statt es erneut zu versuchen.` };
  }
  // Fehlbetrag unterhalb der Buchungsgenauigkeit (gerundet $0): passt.
  if (check.shortfallUsd <= 0) return { ok: true, checkpointId, approvedExtraUsd: 0 };
  const where = active ? `Checkpoint „${active.title}“` : 'kein freigegebener Checkpoint';
  const approved = await ctx.ui.requestApproval(
    {
      kind: 'budget',
      title: `Budget-Freigabe: ${formatUsd(check.shortfallUsd)} zusätzlich`,
      detail: `${purpose}\n${check.reason} (${where}).`,
      amountUsd: check.shortfallUsd,
    },
    ctx.signal,
    { runId: ctx.runId },
  );
  if (!approved) {
    return { ok: false, reason: `Budget nicht freigegeben: ${check.reason}. Frage den Nutzer mit konkreten Optionen (günstigeres Modell, kürzere Dauer, Budget erhöhen) statt es erneut zu versuchen.` };
  }
  await ctx.project.approveBudget(checkpointId, check.shortfallUsd, `Nachfreigabe: ${purpose}`);
  emitBudget(ctx.project, ctx.projectId, ctx.ui);
  return { ok: true, checkpointId, approvedExtraUsd: check.shortfallUsd };
}

export function emitBudget(project: ProjectStore, projectId: string, ui: { emit(event: StudioEvent): void }): void {
  ui.emit({ type: 'budget', projectId, summary: project.budgetSummary() });
}

export function modalityLabel(modality: Modality): string {
  return MODALITY_LABELS[modality];
}
