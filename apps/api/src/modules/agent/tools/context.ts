import type { z } from 'zod'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { Asset, DesignNode, Project, Space } from '@store/shared'
import type { AppConfig } from '../../../config/env.ts'
import type { RequestContext } from '../../../context/actor.ts'
import { AppError } from '../../../lib/app-error.ts'
import { catalogAssets } from '../../assets/service.ts'
import { getNode, resolveSpace } from '../../nodes/service.ts'
import { eq } from 'drizzle-orm'

const { designNodes } = schema

/** What every tool sees: the project, the node on screen (if any) and its space. */
export interface ToolContext {
  db: Database
  ctx: RequestContext
  config: AppConfig
  project: Project
  node: DesignNode | null
  space: Space | null
  /** The space node above `node` (or `node` itself). */
  spaceNodeId: string | null
  selectedItemIds: string[]
  catalog: Map<string, Asset>
}

export interface ToolOutcome {
  /** Shown to the model (and kept in the record). */
  result: Record<string, unknown>
  /** A node the tool created; the conversation continues from it. */
  nodeId?: string
}

export interface AgentTool<T extends z.ZodType = z.ZodType> {
  name: string
  description: string
  schema: T
  run(tools: ToolContext, input: z.output<T>): Promise<ToolOutcome>
}

/** Keeps the input type of `run` tied to the tool's schema. */
export function tool<T extends z.ZodType>(spec: AgentTool<T>): AgentTool {
  return spec
}

/** The space node at or above a node. */
export async function spaceNodeOf(db: Database, nodeId: string): Promise<string | null> {
  let current: string | null = nodeId
  for (let depth = 0; current && depth < 500; depth++) {
    const [row] = await db
      .select({ id: designNodes.id, kind: designNodes.kind, parentId: designNodes.parentId })
      .from(designNodes)
      .where(eq(designNodes.id, current))
    if (!row) return null
    if (row.kind === 'space') return row.id
    current = row.parentId
  }
  return null
}

export function requireSpace(tools: ToolContext): Space {
  if (!tools.space) throw new AppError('INVALID_STATE', '项目还没有空间，请先录入或识别空间')
  return tools.space
}

/** Loads what the tools need for a project and the node the user is looking at. */
export async function buildToolContext(
  db: Database,
  ctx: RequestContext,
  config: AppConfig,
  project: Project,
  nodeId: string | null,
  selectedItemIds: string[],
): Promise<ToolContext> {
  const node = nodeId ? await getNode(db, ctx, nodeId) : null
  if (node && node.projectId !== project.id)
    throw new AppError('VALIDATION_FAILED', '节点不属于这个项目')
  const spaceNodeId = node ? await spaceNodeOf(db, node.id) : null
  const space = spaceNodeId ? await resolveSpace(db, spaceNodeId) : null
  return {
    db,
    ctx,
    config,
    project,
    node,
    space,
    spaceNodeId,
    selectedItemIds,
    catalog: await catalogAssets(db),
  }
}

/** The tools see the node a change just made. */
export async function refreshNode(tools: ToolContext, nodeId: string): Promise<void> {
  tools.node = await getNode(tools.db, tools.ctx, nodeId)
  tools.spaceNodeId = await spaceNodeOf(tools.db, nodeId)
  tools.space = tools.spaceNodeId ? await resolveSpace(tools.db, tools.spaceNodeId) : null
}
