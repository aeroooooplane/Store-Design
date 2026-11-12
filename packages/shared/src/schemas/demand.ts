import { z } from 'zod'
import { ItemFunctionSchema } from '../enums.ts'
import { SizeSchema } from './common.ts'

/** 数量按实体计；组合台的多个功能不重复采购。尺寸单位：毫米。 */
export const DemandEntrySchema = z.object({
  id: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(120),
  roles: z.array(ItemFunctionSchema).min(1).max(8),
  quantity: z.int().min(0).max(200),
  dimensions: z
    .object({
      length: z.number().positive().max(50000).optional(),
      width: z.number().positive().max(50000).optional(),
      depth: z.number().positive().max(50000).optional(),
      height: z.number().positive().max(50000).optional(),
      attachedSeats: z.int().min(0).max(100).optional(),
    })
    .default({}),
  placeholderFootprint: z
    .object({ w: SizeSchema, d: SizeSchema, h: SizeSchema })
    .nullable()
    .default(null),
  origin: z.string().max(100).optional(),
  sourceAnnotationHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})
export const DemandSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceStoreId: z.string().max(100).optional(),
    entities: z.array(DemandEntrySchema).max(100),
  })
  .superRefine((d, ctx) => {
    if (d.entities.reduce((sum, e) => sum + e.quantity, 0) > 200)
      ctx.addIssue({ code: 'custom', message: '道具总数不能超过200件', path: ['entities'] })
    if (new Set(d.entities.map((e) => e.id)).size !== d.entities.length)
      ctx.addIssue({ code: 'custom', message: '清单编号不能重复', path: ['entities'] })
  })
export type Demand = z.output<typeof DemandSchema>
export type DemandEntry = z.output<typeof DemandEntrySchema>
