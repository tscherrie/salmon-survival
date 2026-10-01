import type { ProjectCategory } from './documents/index.ts';

/** Checkpoints strukturieren jede Produktion; jeder braucht eine Freigabe (inkl. Budget). */

export type CheckpointKind =
  | 'treatment'
  | 'style_bible'
  | 'storyboard'
  | 'production'
  | 'finishing'
  | 'concept'
  | 'rough_cut'
  | 'mix_master'
  | 'outline'
  | 'theme'
  | 'full_deck'
  | 'polish'
  | 'layouts'
  | 'sitemap'
  | 'mockups'
  | 'implementation'
  | 'qa';

export type CheckpointStatus = 'pending' | 'proposed' | 'approved' | 'changes_requested' | 'skipped';

export interface Checkpoint {
  id: string;
  kind: CheckpointKind;
  title: string;
  status: CheckpointStatus;
  /** Vom Director vorgelegte Zusammenfassung (Markdown). */
  summary?: string | undefined;
  /** Belege: Treatment-Text, Style-Bible-Bilder, Shotliste … */
  assetIds?: string[] | undefined;
  budgetRequestedUsd?: number | undefined;
  budgetApprovedUsd?: number | undefined;
  feedback?: string | undefined;
  proposedAt?: string | undefined;
  decidedAt?: string | undefined;
  /** Vom Director hier hineingelegte Checkpoints (siehe {@link mergeCheckpoints}). */
  mergedFrom?: Array<{ id: string; kind: CheckpointKind; title: string }> | undefined;
}

export const CHECKPOINT_SEQUENCES: Record<ProjectCategory, Array<{ kind: CheckpointKind; title: string }>> = {
  video: [
    { kind: 'treatment', title: 'Treatment' },
    { kind: 'style_bible', title: 'Style Bible' },
    { kind: 'storyboard', title: 'Storyboard & Animatic' },
    { kind: 'production', title: 'Produktion' },
    { kind: 'finishing', title: 'Finishing' },
  ],
  audio: [
    { kind: 'concept', title: 'Konzept & Schnittplan' },
    { kind: 'rough_cut', title: 'Rohschnitt' },
    { kind: 'mix_master', title: 'Mix & Master' },
  ],
  slides: [
    { kind: 'outline', title: 'Storyline & Gliederung' },
    { kind: 'theme', title: 'Theme & Beispielfolien' },
    { kind: 'full_deck', title: 'Vollständiges Deck' },
    { kind: 'polish', title: 'Feinschliff & Export' },
  ],
  graphic: [
    { kind: 'concept', title: 'Konzept & Moodboard' },
    { kind: 'layouts', title: 'Layout-Entwürfe' },
    { kind: 'production', title: 'Ausarbeitung' },
    { kind: 'finishing', title: 'Export' },
  ],
  web: [
    { kind: 'sitemap', title: 'Sitemap & Inhalte' },
    { kind: 'mockups', title: 'Mockups & Style Bible' },
    { kind: 'implementation', title: 'Implementierung' },
    { kind: 'qa', title: 'QA & Export' },
  ],
};

export function createCheckpoints(category: ProjectCategory): Checkpoint[] {
  return CHECKPOINT_SEQUENCES[category].map((c, i) => ({
    id: `cp_${i + 1}_${c.kind}`,
    kind: c.kind,
    title: c.title,
    status: 'pending' as const,
  }));
}

/** Erster Checkpoint, der noch nicht freigegeben oder übersprungen ist. */
export function currentCheckpoint(list: readonly Checkpoint[]): Checkpoint | undefined {
  return list.find((c) => c.status !== 'approved' && c.status !== 'skipped');
}

/** Letzter freigegebener Checkpoint: auf dessen Budget laufen Ausgaben. */
export function activeBudgetCheckpoint(list: readonly Checkpoint[]): Checkpoint | undefined {
  return [...list].reverse().find((c) => c.status === 'approved');
}

export function proposeCheckpoint(
  list: readonly Checkpoint[],
  checkpointId: string,
  payload: { summary: string; assetIds?: string[]; budgetRequestedUsd?: number },
  now: string,
): Checkpoint[] {
  return list.map((c) => {
    if (c.id !== checkpointId) return c;
    if (c.status === 'approved') throw new Error(`Checkpoint "${c.title}" ist bereits freigegeben`);
    if (payload.budgetRequestedUsd !== undefined && payload.budgetRequestedUsd < 0) throw new Error('Budgetantrag muss ≥ 0 sein');
    return {
      ...c,
      status: 'proposed' as const,
      summary: payload.summary,
      assetIds: payload.assetIds ?? c.assetIds,
      budgetRequestedUsd: payload.budgetRequestedUsd,
      proposedAt: now,
      feedback: undefined,
    };
  });
}

export type CheckpointDecision =
  | { decision: 'approve'; budgetApprovedUsd?: number }
  | { decision: 'request_changes'; feedback: string }
  | { decision: 'skip' };

export function decideCheckpoint(list: readonly Checkpoint[], checkpointId: string, decision: CheckpointDecision, now: string): Checkpoint[] {
  return list.map((c) => {
    if (c.id !== checkpointId) return c;
    switch (decision.decision) {
      case 'approve':
        if (c.status !== 'proposed') throw new Error(`Checkpoint "${c.title}" ist nicht zur Freigabe vorgelegt`);
        return { ...c, status: 'approved' as const, budgetApprovedUsd: decision.budgetApprovedUsd ?? c.budgetRequestedUsd ?? 0, decidedAt: now };
      case 'request_changes':
        if (c.status !== 'proposed') throw new Error(`Checkpoint "${c.title}" ist nicht zur Freigabe vorgelegt`);
        return { ...c, status: 'changes_requested' as const, feedback: decision.feedback, decidedAt: now };
      case 'skip':
        if (c.status === 'approved') throw new Error(`Checkpoint "${c.title}" ist bereits freigegeben`);
        return { ...c, status: 'skipped' as const, decidedAt: now };
    }
  });
}

/**
 * Legt mehrere noch offene Checkpoints (`pending` bzw. `changes_requested`) zu einem zusammen (PLAN 5.3: „der
 * Director darf zusammenlegen“). Der zusammengelegte Checkpoint behält ID, Art und Position des in der
 * Reihenfolge ersten beteiligten Checkpoints und bekommt den neuen Titel; die übrigen verschwinden aus der
 * Liste und werden unter `mergedFrom` vermerkt. Ergebnisse früherer Runden (Zusammenfassung, Budgetantrag)
 * werden verworfen – der neue Checkpoint muss neu vorgelegt werden; offenes Änderungs-Feedback bleibt erhalten.
 */
export function mergeCheckpoints(list: readonly Checkpoint[], ids: readonly string[], title: string): Checkpoint[] {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('Zusammengelegter Checkpoint braucht einen Titel');
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error('Checkpoint-IDs dürfen nicht doppelt vorkommen');
  if (unique.length < 2) throw new Error('Zum Zusammenlegen sind mindestens zwei Checkpoints nötig');
  const members: Checkpoint[] = [];
  for (const c of list) if (unique.includes(c.id)) members.push(c);
  const missing = unique.filter((id) => !members.some((c) => c.id === id));
  if (missing.length) throw new Error(`Unbekannte Checkpoints: ${missing.join(', ')}`);
  const locked = members.filter((c) => c.status !== 'pending' && c.status !== 'changes_requested');
  if (locked.length) {
    throw new Error(
      `Nur offene Checkpoints lassen sich zusammenlegen; ${locked.map((c) => `„${c.title}“ (${c.status})`).join(', ')} ist bereits vorgelegt, freigegeben oder übersprungen`,
    );
  }
  const [first, ...rest] = members as [Checkpoint, ...Checkpoint[]];
  const feedback = members
    .filter((c) => c.status === 'changes_requested' && c.feedback?.trim())
    .map((c) => `${c.title}: ${c.feedback!.trim()}`);
  const assetIds = [...new Set(members.flatMap((c) => c.assetIds ?? []))];
  const merged: Checkpoint = {
    id: first.id,
    kind: first.kind,
    title: cleanTitle,
    status: members.some((c) => c.status === 'changes_requested') ? 'changes_requested' : 'pending',
    ...(assetIds.length ? { assetIds } : {}),
    ...(feedback.length ? { feedback: feedback.join('\n') } : {}),
    mergedFrom: [
      ...(first.mergedFrom ?? []),
      ...rest.flatMap((c) => [...(c.mergedFrom ?? []), { id: c.id, kind: c.kind, title: c.title }]),
    ],
  };
  const removed = new Set(rest.map((c) => c.id));
  return list.filter((c) => !removed.has(c.id)).map((c) => (c.id === first.id ? merged : c));
}
