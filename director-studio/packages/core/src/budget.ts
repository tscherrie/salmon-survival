/**
 * Budget-Ledger: Freigaben (pro Checkpoint) gegen Schätzungen, Reservierungen und Ist-Kosten.
 * Durchgesetzt im Code (nicht im Prompt): kostenpflichtige Tools fragen `check()` vor dem Absenden.
 */

export type LedgerEntryKind = 'reservation' | 'actual' | 'release';
export type LedgerSource = 'fal' | 'director' | 'other';

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  amountUsd: number;
  source: LedgerSource;
  /** Bezug, z. B. Generierungs-ID oder Director-Lauf. */
  refId: string;
  checkpointId?: string | undefined;
  note?: string | undefined;
  createdAt: string;
}

export interface BudgetApproval {
  checkpointId: string;
  amountUsd: number;
  approvedAt: string;
  note?: string | undefined;
}

export interface BudgetSummary {
  approvedUsd: number;
  spentUsd: number;
  reservedUsd: number;
  availableUsd: number;
  bySource: Record<LedgerSource, number>;
  byCheckpoint: Record<string, { approvedUsd: number; spentUsd: number; reservedUsd: number }>;
}

export type BudgetCheck =
  | { ok: true; availableUsd: number }
  | {
      ok: false;
      availableUsd: number;
      shortfallUsd: number;
      reason: string;
      /** Gesetzt, wenn der geprüfte Betrag selbst ungültig ist (nicht endlich oder negativ); dann hilft keine Nachfreigabe. */
      invalid?: true | undefined;
    };

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export class BudgetLedger {
  private readonly entries: LedgerEntry[];
  private readonly approvals: BudgetApproval[];

  constructor(
    init: { entries?: LedgerEntry[]; approvals?: BudgetApproval[] } = {},
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => `led_${Math.random().toString(36).slice(2, 10)}`,
  ) {
    this.entries = [...(init.entries ?? [])];
    // Kaputte Freigaben (z. B. `Infinity`, das als `null` gespeichert wurde) würden jede Prüfung aushebeln.
    this.approvals = (init.approvals ?? []).filter((a) => Number.isFinite(a.amountUsd) && a.amountUsd > 0);
  }

  listEntries(): readonly LedgerEntry[] {
    return this.entries;
  }

  listApprovals(): readonly BudgetApproval[] {
    return this.approvals;
  }

  approve(checkpointId: string, amountUsd: number, note?: string): BudgetApproval {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Freigabe muss positiv und endlich sein');
    const approval = { checkpointId, amountUsd: roundUsd(amountUsd), approvedAt: this.now(), note };
    this.approvals.push(approval);
    return approval;
  }

  /**
   * Prüft, ob eine Ausgabe in das freigegebene Budget passt. Mit `checkpointId` muss sie sowohl in die
   * Restfreigabe dieses Checkpoints als auch in das projektweit verfügbare Budget passen – Ausgaben ohne
   * Checkpoint (z. B. Director-Nutzung vor einer Freigabe) zählen damit immer mit.
   */
  check(amountUsd: number, checkpointId?: string): BudgetCheck {
    const summary = this.summary();
    let available = summary.availableUsd;
    if (checkpointId) {
      const b = summary.byCheckpoint[checkpointId];
      const checkpointAvailable = (b?.approvedUsd ?? 0) - (b?.spentUsd ?? 0) - (b?.reservedUsd ?? 0);
      available = Math.min(available, checkpointAvailable);
    }
    const availableUsd = roundUsd(available);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      return { ok: false, availableUsd, shortfallUsd: 0, reason: `Ungültiger Kostenbetrag (${String(amountUsd)})`, invalid: true };
    }
    if (amountUsd <= availableUsd + 1e-9) return { ok: true, availableUsd };
    return {
      ok: false,
      availableUsd,
      shortfallUsd: roundUsd(amountUsd - availableUsd),
      reason: `Geschätzt ${formatUsd(amountUsd)}, verfügbar ${formatUsd(Math.max(0, availableUsd))}`,
    };
  }

  reserve(refId: string, amountUsd: number, options: { source?: LedgerSource; checkpointId?: string; note?: string } = {}): LedgerEntry {
    if (this.openReservation(refId)) throw new Error(`Für "${refId}" existiert bereits eine Reservierung`);
    return this.push({ kind: 'reservation', refId, amountUsd, source: options.source ?? 'fal', checkpointId: options.checkpointId, note: options.note });
  }

  /**
   * Bucht Ist-Kosten; eine offene Reservierung für `refId` wird damit abgeschlossen. Idempotent: Gibt es
   * keine offene Reservierung, aber schon eine Ist-Buchung für `refId` (z. B. erneutes Abrechnen nach einem
   * Absturz), wird nichts gebucht und die vorhandene Buchung zurückgegeben.
   */
  settle(refId: string, actualUsd: number, options: { source?: LedgerSource; checkpointId?: string; note?: string } = {}): LedgerEntry {
    const reservation = this.openReservation(refId);
    if (!reservation) {
      const prior = this.lastActual(refId);
      if (prior) return prior;
    }
    if (reservation) {
      this.push({ kind: 'release', refId, amountUsd: reservation.amountUsd, source: reservation.source, checkpointId: reservation.checkpointId });
    }
    return this.push({
      kind: 'actual',
      refId,
      amountUsd: actualUsd,
      source: options.source ?? reservation?.source ?? 'fal',
      checkpointId: options.checkpointId ?? reservation?.checkpointId,
      note: options.note,
    });
  }

  /** Gibt eine Reservierung ohne Kosten frei (z. B. abgebrochener oder fehlgeschlagener Job). */
  release(refId: string): void {
    const reservation = this.openReservation(refId);
    if (!reservation) return;
    this.push({ kind: 'release', refId, amountUsd: reservation.amountUsd, source: reservation.source, checkpointId: reservation.checkpointId });
  }

  /**
   * Director-Nutzung (Tokens) wird direkt als Ist-Kosten gebucht – mit `checkpointId` auf das Budget des
   * aktiven Checkpoints, sonst projektweit (zählt dann nur in der Gesamtprüfung).
   */
  recordUsage(refId: string, amountUsd: number, source: LedgerSource = 'director', note?: string, checkpointId?: string): LedgerEntry {
    return this.push({ kind: 'actual', refId, amountUsd, source, note, checkpointId });
  }

  openReservation(refId: string): LedgerEntry | undefined {
    let open: LedgerEntry | undefined;
    for (const e of this.entries) {
      if (e.refId !== refId) continue;
      if (e.kind === 'reservation') open = e;
      if (e.kind === 'release') open = undefined;
    }
    return open;
  }

  summary(): BudgetSummary {
    return summarizeLedger(this.entries, this.approvals);
  }

  private lastActual(refId: string): LedgerEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.refId === refId && e.kind === 'actual') return e;
    }
    return undefined;
  }

  private push(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): LedgerEntry {
    if (!Number.isFinite(entry.amountUsd) || entry.amountUsd < 0) throw new Error('Betrag muss ≥ 0 sein');
    const full: LedgerEntry = { ...entry, amountUsd: roundUsd(entry.amountUsd), id: this.newId(), createdAt: this.now() };
    this.entries.push(full);
    return full;
  }
}

export function summarizeLedger(entries: readonly LedgerEntry[], approvals: readonly BudgetApproval[]): BudgetSummary {
  const byCheckpoint: BudgetSummary['byCheckpoint'] = {};
  const bucket = (id: string | undefined) => {
    const key = id ?? '_';
    byCheckpoint[key] ??= { approvedUsd: 0, spentUsd: 0, reservedUsd: 0 };
    return byCheckpoint[key];
  };
  let approved = 0;
  for (const a of approvals) {
    approved += a.amountUsd;
    bucket(a.checkpointId).approvedUsd += a.amountUsd;
  }
  let spent = 0;
  let reserved = 0;
  const bySource: Record<LedgerSource, number> = { fal: 0, director: 0, other: 0 };
  for (const e of entries) {
    const b = bucket(e.checkpointId);
    if (e.kind === 'actual') {
      spent += e.amountUsd;
      bySource[e.source] += e.amountUsd;
      b.spentUsd += e.amountUsd;
    } else if (e.kind === 'reservation') {
      reserved += e.amountUsd;
      b.reservedUsd += e.amountUsd;
    } else {
      reserved -= e.amountUsd;
      b.reservedUsd -= e.amountUsd;
    }
  }
  for (const key of Object.keys(byCheckpoint)) {
    const b = byCheckpoint[key]!;
    b.approvedUsd = roundUsd(b.approvedUsd);
    b.spentUsd = roundUsd(b.spentUsd);
    b.reservedUsd = roundUsd(b.reservedUsd);
  }
  return {
    approvedUsd: roundUsd(approved),
    spentUsd: roundUsd(spent),
    reservedUsd: roundUsd(reserved),
    availableUsd: roundUsd(approved - spent - reserved),
    bySource: { fal: roundUsd(bySource.fal), director: roundUsd(bySource.director), other: roundUsd(bySource.other) },
    byCheckpoint,
  };
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return `$${String(value)}`;
  return `${value < 0 ? '-' : ''}$${formatAmount(Math.abs(value))}`;
}

/**
 * Betrag ohne Währung: ab $0.10 zwei, darunter drei Nachkommastellen; Beträge unter einem Zehntelcent mit
 * zwei signifikanten Stellen (z. B. `0.00003`), damit kleine Stückpreise nicht als „0.000“ erscheinen.
 */
export function formatAmount(abs: number): string {
  if (abs === 0) return '0.00';
  if (abs >= 0.1) return abs.toFixed(2);
  if (abs >= 0.001) return abs.toFixed(3);
  const significant = Number(abs.toPrecision(2));
  const decimals = Math.min(20, Math.max(3, 1 - Math.floor(Math.log10(significant))));
  return significant.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}
