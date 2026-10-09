import { z } from 'zod'
import { ItemFunctionSchema } from '../enums.ts'

/** Native front direction of a model in its own GLB frame (Y up); `any` = no fixed front. */
export const FRONT_AXES = ['+Z', '-Z', '+X', '-X', 'any'] as const
export const FrontAxisSchema = z.enum(FRONT_AXES)
export type FrontAxis = z.infer<typeof FrontAxisSchema>

export const INSTALLATIONS = ['floor', 'wall'] as const
export const InstallationSchema = z.enum(INSTALLATIONS)

export const SI_FAMILIES = ['SI1.0', 'SI2.0', '通用', '非标'] as const

export const FileRefSchema = z.object({
  fileId: z.uuid(),
  url: z.string(),
  bytes: z.int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
export type FileRef = z.infer<typeof FileRefSchema>

const MetresSchema = z.number().finite().positive()

/**
 * One catalogue entry. `footprint` is the size used for placement: the measured GLB box when a
 * web model exists, otherwise the SketchUp face bounds. Props are never scaled to fit.
 */
export const AssetSchema = z.object({
  id: z.string().regex(/^asset-\d+$/),
  name: z.string(),
  standardName: z.string(),
  variant: z.string(),
  materialCategory: z.string(),
  siFamily: z.string(),
  function: ItemFunctionSchema,
  installation: InstallationSchema.nullable(),
  footprint: z.object({ w: MetresSchema, d: MetresSchema, h: MetresSchema }),
  footprintSource: z.enum(['glb', 'source']),
  front: FrontAxisSchema.nullable(),
  staffSide: FrontAxisSchema.nullable(),
  facingConfidence: z.enum(['high', 'medium', 'low']).nullable(),
  /** Has a verified web model and stands on the floor: the planner may use it. */
  placeable: z.boolean(),
  judgment: z.string().nullable(),
  glb: FileRefSchema.nullable(),
  preview: FileRefSchema.nullable(),
})
export type Asset = z.infer<typeof AssetSchema>

export const AssetListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  function: ItemFunctionSchema.optional(),
  placeable: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  siFamily: z.string().trim().max(10).optional(),
})
export type AssetListQuery = z.output<typeof AssetListQuerySchema>

export const AssetListSchema = z.object({ items: z.array(AssetSchema), total: z.int().min(0) })
export type AssetList = z.infer<typeof AssetListSchema>
