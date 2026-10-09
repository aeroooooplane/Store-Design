import { z } from 'zod'
import {
  MarketSchema,
  NodeKindSchema,
  NodeOriginSchema,
  PlanStrategySchema,
  ShopTypeSchema,
  SiStyleSchema,
} from '../enums.ts'
import { NameSchema } from './common.ts'
import { LayoutSchema } from './layout.ts'
import { MAX_NODES_PER_PROJECT } from './node.ts'
import { ProjectSchema } from './project.ts'
import { SpaceSchema } from './space.ts'

export const EXPORT_FORMAT = 'store-design-project'

/** Portable project file: backup, hand-over between computers, re-import as a new project. */
export const ProjectExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime({ offset: true }),
  project: z.object({
    name: NameSchema,
    shopType: ShopTypeSchema,
    market: MarketSchema,
    siStyle: SiStyleSchema,
  }),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        parentId: z.string().min(1).max(128).nullable(),
        kind: NodeKindSchema,
        name: NameSchema,
        space: SpaceSchema.nullable(),
        layout: LayoutSchema.nullable(),
        strategy: PlanStrategySchema.nullable(),
        siStyle: SiStyleSchema.nullable(),
        origin: NodeOriginSchema,
        importedFrom: z.string().max(128).nullable(),
        hidden: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_NODES_PER_PROJECT),
  draft: z.object({ baseNodeId: z.string().min(1).max(128), layout: LayoutSchema }).nullable(),
})
export type ProjectExport = z.infer<typeof ProjectExportSchema>

export const ProjectImportSchema = z.strictObject({
  /** Overrides the project name stored in the file. */
  name: NameSchema.optional(),
  /** A file from GET /projects/:id/export, or a legacy workbench backup (schemaVersion 1/2). */
  data: z.unknown(),
})

export const ProjectImportedSchema = z.object({
  project: ProjectSchema,
  nodesImported: z.int().min(0),
  draftImported: z.boolean(),
  format: z.enum(['store-design-project', 'legacy']),
  /** What was converted or downgraded, item by item. */
  warnings: z.array(z.string()),
})
export type ProjectImported = z.infer<typeof ProjectImportedSchema>
