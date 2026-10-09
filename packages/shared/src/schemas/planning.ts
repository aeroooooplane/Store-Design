import { z } from 'zod'
import { ShopTypeSchema, SiStyleSchema } from '../enums.ts'
import { LayoutSchema } from './layout.ts'
import { IssueSchema } from './node.ts'
import { SpaceSchema } from './space.ts'

export const GENERATED_STRATEGIES = ['max', 'area', 'min'] as const

export const LayoutGenerateSchema = z.strictObject({
  space: SpaceSchema,
  shopType: ShopTypeSchema,
  siStyle: SiStyleSchema.default('SI1.0'),
  strategies: z
    .array(z.enum(GENERATED_STRATEGIES))
    .min(1)
    .max(3)
    .default([...GENERATED_STRATEGIES]),
})
export type LayoutGenerate = z.output<typeof LayoutGenerateSchema>

export const LayoutCandidateSchema = z.object({
  strategy: z.enum(GENERATED_STRATEGIES),
  layout: LayoutSchema,
  issues: z.array(IssueSchema),
  /** Plain-language remarks: missing models, tables that did not fit, missing entrance … */
  notes: z.array(z.string()),
})
export type LayoutCandidate = z.infer<typeof LayoutCandidateSchema>

export const LayoutCandidatesSchema = z.object({
  /** The normalised space the candidates were planned in. */
  space: SpaceSchema,
  candidates: z.array(LayoutCandidateSchema),
})
export type LayoutCandidates = z.infer<typeof LayoutCandidatesSchema>

export const LayoutValidateSchema = z.strictObject({ space: SpaceSchema, layout: LayoutSchema })

export const LayoutIssuesSchema = z.object({ issues: z.array(IssueSchema) })
