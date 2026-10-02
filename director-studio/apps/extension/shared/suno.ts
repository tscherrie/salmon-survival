import { z } from 'zod';

export const SUNO_CREATE_URL = 'https://suno.com/create';
export const SUNO_PLATFORM_URL = 'https://platform.suno.com/';
/** Capabilities of this implementation, not claims about every Suno account. */
export const SUNO_CAPABILITIES = {
  provider: 'suno', mode: 'web-handoff', promptHandoff: true, fileImport: true,
  directAudioUrlImport: true, synchronizedStems: true, nativeGeneration: false,
  accountLink: false, generationCancellation: 'in-suno',
  apiAccess: 'official-platform-exists-contract-not-configured',
} as const;

export const sunoPromptSchema = z.object({
  title: z.string().trim().min(1).max(200), prompt: z.string().trim().min(1).max(10000),
  lyrics: z.string().max(20000).optional(), style: z.string().max(2000).optional(),
  instrumental: z.boolean().default(false),
}).strict();
export type SunoPrompt = z.input<typeof sunoPromptSchema>;
export interface SunoHandoff extends z.output<typeof sunoPromptSchema> {
  id: string; createdAt: string; status: 'prepared'; createUrl: typeof SUNO_CREATE_URL;
}
export function sunoPromptText(input: SunoPrompt): string {
  const p = sunoPromptSchema.parse(input);
  return [p.title, p.prompt, p.style && `Style: ${p.style}`, p.instrumental && 'Instrumental, no vocals.', p.lyrics && `Lyrics:\n${p.lyrics}`].filter(Boolean).join('\n\n');
}
export const sunoSourceUrlSchema = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && ['suno.com', 'www.suno.com'].includes(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/(song|s)\/[A-Za-z0-9-]+\/?$/.test(url.pathname);
}, 'Use an official Suno song/share URL without login parameters.');
export const sunoReceiptSchema = z.object({
  title: z.string().trim().min(1).max(200), sourceUrl: sunoSourceUrlSchema.optional(),
  model: z.string().trim().max(200).optional(), createdAt: z.string().datetime().optional(),
  planAtCreation: z.enum(['free', 'pro', 'premier', 'other', 'unknown']),
  intendedUse: z.enum(['personal', 'commercial', 'undecided']),
  rightsNote: z.string().max(2000).optional(), rightsAcknowledged: z.literal(true),
  handoffId: z.string().min(1).optional(),
}).strict();
export type SunoReceipt = z.input<typeof sunoReceiptSchema>;
export const sunoRecordSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(24), receipt: sunoReceiptSchema,
  kind: z.enum(['song', 'stems']),
  placement: z.object({ startFrame: z.number().int().nonnegative(), expectedHead: z.number().int().positive() }).strict().optional(),
}).strict();
export type SunoRecordInput = z.input<typeof sunoRecordSchema>;

/** Future server adapter contract. No endpoint, credential UI or transport is invented. */
export interface OfficialMusicProviderAdapter {
  readonly provider: 'suno';
  readonly credentialScope: 'server-only';
  capabilities(): Promise<{ models: string[]; cancel: boolean; stems: boolean }>;
  quote(input: SunoPrompt): Promise<{ quoteId: string; amount: number; currency: string; expiresAt: string }>;
  submit(input: SunoPrompt, authorization: { quoteId: string; userApproved: true; idempotencyKey: string; maxAmount: number }): Promise<{ requestId: string }>;
  status(requestId: string): Promise<{ state: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'; outputs?: Array<{ url: string; role: string }>; error?: string; actualCost?: { amount: number; currency: string } }>;
  cancel(requestId: string): Promise<{ confirmed: boolean }>;
}
