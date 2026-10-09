import { z } from 'zod'
import { MarketSchema, ShopTypeSchema, SiStyleSchema } from '../enums.ts'
import { NameSchema } from './common.ts'

export const ProjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  shopType: ShopTypeSchema,
  market: MarketSchema,
  siStyle: SiStyleSchema,
  revision: z.int().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type Project = z.infer<typeof ProjectSchema>

export const ProjectCreateSchema = z.strictObject({
  name: NameSchema,
  shopType: ShopTypeSchema,
  market: MarketSchema.default('domestic'),
  siStyle: SiStyleSchema.default('SI1.0'),
})
export type ProjectCreate = z.output<typeof ProjectCreateSchema>
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>

export const ProjectUpdateSchema = z
  .strictObject({
    name: NameSchema.optional(),
    shopType: ShopTypeSchema.optional(),
    market: MarketSchema.optional(),
    siStyle: SiStyleSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: '至少修改一个字段',
  })
export type ProjectUpdate = z.output<typeof ProjectUpdateSchema>

export const PROJECT_STATUSES = ['active', 'deleted', 'all'] as const

export const ProjectListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PROJECT_STATUSES).default('active'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type ProjectListQuery = z.output<typeof ProjectListQuerySchema>

export const ProjectListSchema = z.object({
  items: z.array(ProjectSchema),
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1),
})
export type ProjectList = z.infer<typeof ProjectListSchema>
