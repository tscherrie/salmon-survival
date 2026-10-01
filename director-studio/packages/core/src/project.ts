import { z } from 'zod';
import type { Checkpoint } from './checkpoints.ts';
import { PROJECT_CATEGORIES, formatSpecSchema, type FormatSpec, type ProjectCategory } from './documents/index.ts';
import type { BudgetApproval } from './budget.ts';
import type { PickerState } from './models.ts';

/** Ergebnis des Planungsgesprächs. */
export const projectBriefSchema = z.object({
  goal: z.string().default(''),
  audience: z.string().default(''),
  platforms: z.array(z.string()).default([]),
  formats: z.array(z.string()).default([]),
  lengthSec: z.number().positive().optional(),
  tone: z.string().default(''),
  references: z.array(z.string()).default([]),
  constraints: z.string().default(''),
  budgetUsd: z.number().nonnegative().optional(),
  deadline: z.string().optional(),
  language: z.string().default('de'),
  notes: z.string().default(''),
});
export type ProjectBrief = z.infer<typeof projectBriefSchema>;

export const PROJECT_SCHEMA_VERSION = 'director-studio/project@1';

export interface ProjectManifest {
  schema: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  title: string;
  category: ProjectCategory | null;
  createdAt: string;
  updatedAt: string;
  formats: FormatSpec[];
  brief: ProjectBrief | null;
  pickers: PickerState;
  checkpoints: Checkpoint[];
  budgetApprovals: BudgetApproval[];
  director: {
    effort: DirectorEffort;
    /** Zuletzt verwendete Laufzeit (anthropic | fal | agent-sdk). */
    runtime?: string | undefined;
  };
  /** Projektphase: Planungsgespräch läuft, bis ein Brief existiert. */
  phase: 'planning' | 'production';
}

export const DIRECTOR_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DirectorEffort = (typeof DIRECTOR_EFFORTS)[number];

export const projectManifestSchema = z.object({
  schema: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(PROJECT_CATEGORIES).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  formats: z.array(formatSpecSchema),
  brief: projectBriefSchema.nullable(),
  pickers: z.record(z.string(), z.unknown()),
  checkpoints: z.array(z.record(z.string(), z.unknown())),
  budgetApprovals: z.array(
    z.object({ checkpointId: z.string(), amountUsd: z.number(), approvedAt: z.string(), note: z.string().optional() }),
  ),
  director: z.object({ effort: z.enum(DIRECTOR_EFFORTS), runtime: z.string().optional() }),
  phase: z.enum(['planning', 'production']),
});

export function parseManifest(value: unknown): ProjectManifest {
  return projectManifestSchema.parse(value) as unknown as ProjectManifest;
}
