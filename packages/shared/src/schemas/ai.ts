import { z } from 'zod'

/** What a model is used for. Both share one daily budget. */
export const AI_PURPOSES = ['agent', 'recognition'] as const
export const AiPurposeSchema = z.enum(AI_PURPOSES)
export type AiPurpose = z.infer<typeof AiPurposeSchema>

export const AI_PROVIDERS = ['local', 'deepseek', 'dashscope', 'anthropic'] as const
export const AiProviderSchema = z.enum(AI_PROVIDERS)

/** A model the user may pick. Only models with a configured key (and overseas ones when switched on) are listed. */
export const AiModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: AiProviderSchema,
  purposes: z.array(AiPurposeSchema),
  /** Can read pictures (plan recognition needs it, apart from the local recogniser). */
  vision: z.boolean(),
  overseas: z.boolean(),
  /** Price per million tokens in CNY (estimate, see ai/models.ts); null for the local recogniser. */
  price: z.object({ inputCny: z.number(), outputCny: z.number() }).nullable(),
})
export type AiModel = z.infer<typeof AiModelSchema>

export const AiSettingsSchema = z.object({
  /** null while no listed model can act as the agent (no key configured). */
  agentModel: z.string().nullable(),
  /** The model that reads uploaded plans; `local` runs on this machine and costs nothing. */
  recognitionModel: z.string(),
  /** Tried when local recognition fails (scale unknown, outline open, confidence < 0.6). */
  recognitionFallback: z.string().nullable(),
  /**
   * Whether plans may be sent to a remote vision model at all (off by default: plans are read
   * on this machine). While off, the two choices above other than `local` are not used.
   */
  recognitionCloud: z.boolean(),
})
export type AiSettings = z.infer<typeof AiSettingsSchema>

export const AiSettingsUpdateSchema = AiSettingsSchema.partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: '至少修改一项' })
export type AiSettingsUpdate = z.output<typeof AiSettingsUpdateSchema>

/** Today's spending in Beijing time; the budget resets at 00:00 there. */
export const AiBudgetSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limitCny: z.number(),
  spentCny: z.number(),
  remainingCny: z.number(),
  exceeded: z.boolean(),
})
export type AiBudget = z.infer<typeof AiBudgetSchema>

export const AiOverviewSchema = z.object({
  models: z.array(AiModelSchema),
  settings: AiSettingsSchema,
  budget: AiBudgetSchema,
})
export type AiOverview = z.infer<typeof AiOverviewSchema>
