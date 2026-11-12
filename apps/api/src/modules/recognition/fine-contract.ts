import { z } from 'zod'
const P = z.tuple([z.number().finite().min(0).max(4000), z.number().finite().min(0).max(4000)])
export const FineObjectSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  candidateId: z.string().nullable(),
  kind: z.enum(['unknown', 'furniture', 'column', 'wall-display', 'service', 'sign']),
  label: z.string().trim().min(1).max(100),
  points: z.array(P).min(3).max(100),
  status: z.enum(['pending', 'keep', 'reject']),
  heightMm: z.number().min(1).max(20000).nullable(),
})
export const FineDraftSchema = z.object({
  objects: z.array(FineObjectSchema).max(2000),
  boundary: z.array(P).max(200),
  calibration: z.object({ a: P, b: P, mm: z.number().positive().max(1000000) }).nullable(),
  heightMm: z.number().min(1500).max(20000).nullable(),
  openEdges: z.array(z.number().int().min(0).max(199)).max(200),
  entrances: z.array(z.object({ a: P, b: P, kind: z.enum(['main', 'side']) })).max(20),
  structureReviewed: z.boolean(),
  reviewer: z.string().max(100),
  notes: z.string().max(3000),
})
export const FineSaveSchema = z.object({
  revision: z.number().int().nonnegative(),
  draft: FineDraftSchema,
})
export const FineConfirmSchema = FineSaveSchema.extend({
  name: z.string().trim().min(1).max(100),
  acknowledgedOmissions: z.array(z.string()).max(2000),
})
export type FineDraft = z.infer<typeof FineDraftSchema>
