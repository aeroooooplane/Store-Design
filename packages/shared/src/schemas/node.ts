import { z } from 'zod'
import { NodeKindSchema, NodeOriginSchema, PlanStrategySchema, SiStyleSchema } from '../enums.ts'
import { NameSchema } from './common.ts'
import { LayoutSchema } from './layout.ts'
import { SpaceSchema } from './space.ts'

export const MAX_NODES_PER_PROJECT = 500

/** A space or layout problem, as returned with saved nodes and drafts. */
export const IssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  itemIds: z.array(z.string()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
})
export type Issue = z.infer<typeof IssueSchema>

export const NodeSummarySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: NodeKindSchema,
  name: z.string(),
  strategy: PlanStrategySchema.nullable(),
  siStyle: SiStyleSchema.nullable(),
  origin: NodeOriginSchema,
  importedFrom: z.string().nullable(),
  hidden: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type NodeSummary = z.infer<typeof NodeSummarySchema>

export const NodeSchema = NodeSummarySchema.extend({
  projectId: z.uuid(),
  space: SpaceSchema.nullable(),
  layout: LayoutSchema.nullable(),
})
export type DesignNode = z.infer<typeof NodeSchema>

export const NodeTreeSchema = z.object({
  projectId: z.uuid(),
  nodes: z.array(NodeSummarySchema),
})
export type NodeTree = z.infer<typeof NodeTreeSchema>

/**
 * A new history node. `space` nodes hold a space (and may carry a layout over); every other
 * kind holds a layout and inherits the space of its nearest `space` ancestor.
 */
export const NodeCreateSchema = z
  .strictObject({
    parentId: z.uuid().nullable(),
    kind: NodeKindSchema,
    name: NameSchema,
    space: SpaceSchema.optional(),
    layout: LayoutSchema.optional(),
    strategy: PlanStrategySchema.optional(),
    siStyle: SiStyleSchema.optional(),
    /** The node this one copies (新建副本); its views carry over to a white model or render. */
    sourceNodeId: z.uuid().optional(),
  })
  .superRefine((node, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] })
    if (node.kind === 'space') {
      if (!node.space) issue('空间节点必须包含空间', 'space')
    } else {
      if (node.space) issue('只有空间节点可以包含空间', 'space')
      if (!node.layout) issue('该节点必须包含布局', 'layout')
      if (node.parentId === null) issue('该节点必须有父节点', 'parentId')
    }
    if (node.strategy && node.kind !== 'plan') issue('只有生成方案节点可以记录排布策略', 'strategy')
    if (node.kind === 'render' && !node.siStyle) issue('渲染节点必须指定 SI 风格', 'siStyle')
  })
export type NodeCreate = z.output<typeof NodeCreateSchema>
export type NodeCreateInput = z.input<typeof NodeCreateSchema>

export const NodeRenameSchema = z.strictObject({ name: NameSchema })

export const NodeCreatedSchema = z.object({ node: NodeSchema, issues: z.array(IssueSchema) })
export type NodeCreated = z.infer<typeof NodeCreatedSchema>

export const DraftSchema = z.object({
  projectId: z.uuid(),
  baseNodeId: z.uuid(),
  layout: LayoutSchema,
  revision: z.int().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
})
export type Draft = z.infer<typeof DraftSchema>

export const DraftPutSchema = z.strictObject({ baseNodeId: z.uuid(), layout: LayoutSchema })
export type DraftPut = z.output<typeof DraftPutSchema>

export const DraftSavedSchema = z.object({ draft: DraftSchema, issues: z.array(IssueSchema) })
export type DraftSaved = z.infer<typeof DraftSavedSchema>
