import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  MAX_NODES_PER_PROJECT,
  checkAssetFit,
  normalizeSpace,
  validateLayout,
  validateSpace,
} from '@store/shared'
import type {
  DesignNode,
  Issue,
  Layout,
  NodeCreate,
  NodeCreated,
  NodeKind,
  NodeSummary,
  NodeTree,
  Space,
} from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { catalogAssets } from '../assets/service.ts'
import { initialCameras, insertCameras } from '../cameras/service.ts'

const { designNodes, projects } = schema
type NodeRow = typeof designNodes.$inferSelect

export function toSummary(row: NodeRow): NodeSummary {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    strategy: row.strategy,
    siStyle: row.siStyle,
    origin: row.origin,
    importedFrom: row.importedFrom,
    hidden: row.hiddenAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toNode(row: NodeRow): DesignNode {
  return {
    ...toSummary(row),
    projectId: row.projectId,
    space: row.space ?? null,
    layout: row.layout ?? null,
  }
}

/** Projects in the recycle bin are read-only. */
export async function requireActiveProject(db: Database, projectId: string): Promise<void> {
  const [project] = await db
    .select({ deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project) throw notFound('项目')
  if (project.deletedAt) throw new AppError('INVALID_STATE', '项目在回收站中，请先恢复')
}

async function findNode(db: Database, nodeId: string): Promise<NodeRow> {
  const [row] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!row) throw notFound('节点')
  return row
}

/** The space a layout lives in: the nearest `space` node at or above `nodeId`. */
export async function resolveSpace(db: Database, nodeId: string): Promise<Space> {
  let current: string | null = nodeId
  for (let depth = 0; current && depth <= MAX_NODES_PER_PROJECT; depth++) {
    const row = await findNode(db, current)
    if (row.kind === 'space' && row.space) return row.space
    current = row.parentId
  }
  throw new AppError('INVALID_STATE', '节点缺少所属空间')
}

const asIssues = (
  issues: { code: string; severity: 'error' | 'warning'; message: string }[],
): Issue[] => issues.map((issue) => ({ ...issue }))

/**
 * Checks a layout against its space: model contract violations are rejected outright; design
 * problems (overlap, outside, …) are returned, and block only confirmed white/render nodes.
 */
export async function checkLayout(
  db: Database,
  space: Space,
  layout: Layout,
  kind: NodeKind | 'draft',
): Promise<Issue[]> {
  const fit = checkAssetFit(layout, await catalogAssets(db))
  if (fit.length) throw new AppError('VALIDATION_FAILED', '布局中的模型引用无效', asIssues(fit))
  const issues = asIssues(validateLayout(space, layout))
  if ((kind === 'white' || kind === 'render') && issues.some((i) => i.severity === 'error')) {
    throw new AppError('VALIDATION_FAILED', '确认白模前须先解决越界、重叠等问题', issues)
  }
  return issues
}

export function checkSpace(space: Space): { space: Space; warnings: Issue[] } {
  const issues = asIssues(validateSpace(space))
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length) throw new AppError('VALIDATION_FAILED', '空间不合法', errors)
  return { space: normalizeSpace(space), warnings: issues }
}

export async function getTree(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  includeHidden: boolean,
): Promise<NodeTree> {
  authorize(ctx.actor, 'node:read', { projectId })
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project) throw notFound('项目')
  const filters = [eq(designNodes.projectId, projectId)]
  if (!includeHidden) filters.push(isNull(designNodes.hiddenAt))
  const rows = await db
    .select()
    .from(designNodes)
    .where(and(...filters))
    .orderBy(asc(designNodes.seq))
  return { projectId, nodes: rows.map(toSummary) }
}

export async function getNode(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
): Promise<DesignNode> {
  const row = await findNode(db, nodeId)
  authorize(ctx.actor, 'node:read', { projectId: row.projectId })
  return toNode(row)
}

const STAGE_PARENTS: Partial<Record<NodeKind, { kinds: readonly string[]; message: string }>> = {
  plan: { kinds: ['space'], message: '方案只能建在空间下' },
  // 'edit' is the plan-level variant of earlier versions.
  white: { kinds: ['plan', 'edit'], message: '白模只能建在方案下' },
  render: { kinds: ['white'], message: '渲染只能建在白模下' },
}

export async function createNode(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  input: NodeCreate,
): Promise<NodeCreated> {
  authorize(ctx.actor, 'node:create', { projectId })
  await requireActiveProject(db, projectId)
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(designNodes)
    .where(eq(designNodes.projectId, projectId))
  if (total >= MAX_NODES_PER_PROJECT) {
    throw new AppError(
      'INVALID_STATE',
      `项目节点已达上限 ${MAX_NODES_PER_PROJECT}，请导出备份后新建项目`,
    )
  }
  const parent = input.parentId ? await findNode(db, input.parentId) : null
  if (parent && parent.projectId !== projectId) throw notFound('父节点')
  // Stages sit on fixed levels: plans under a space, white models under a plan, renders under a
  // white model. Copies are siblings, so nothing nests deeper than its stage.
  const allowed = STAGE_PARENTS[input.kind]
  if (allowed && (!parent || !allowed.kinds.includes(parent.kind))) {
    throw new AppError('VALIDATION_FAILED', allowed.message)
  }
  if (input.sourceNodeId) {
    const source = await findNode(db, input.sourceNodeId)
    if (source.projectId !== projectId) throw notFound('复制来源节点')
  }

  let space: Space | null = null
  /** The space the layout lives in (the node's own, or inherited). */
  let layoutSpace: Space | null = null
  let issues: Issue[] = []
  if (input.kind === 'space') {
    if (!input.space) throw new AppError('VALIDATION_FAILED', '空间节点必须包含空间')
    const checked = checkSpace(input.space)
    space = checked.space
    issues = checked.warnings
  }
  if (input.layout) {
    layoutSpace = space ?? (input.parentId ? await resolveSpace(db, input.parentId) : null)
    if (!layoutSpace) throw new AppError('VALIDATION_FAILED', '布局缺少所属空间')
    issues = [...issues, ...(await checkLayout(db, layoutSpace, input.layout, input.kind))]
  }

  const cameras =
    (input.kind === 'white' || input.kind === 'render') && layoutSpace
      ? await initialCameras(db, input.sourceNodeId ?? input.parentId, layoutSpace)
      : []

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(designNodes)
      .values({
        projectId,
        parentId: input.parentId,
        kind: input.kind,
        name: input.name,
        space,
        layout: input.layout ?? null,
        strategy: input.strategy ?? null,
        siStyle: input.siStyle ?? null,
        origin: input.kind === 'plan' ? 'generator' : 'user',
      })
      .returning()
    if (!inserted) throw new Error('Node insert returned no row')
    await insertCameras(tx, inserted.id, cameras)
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, projectId))
    return inserted
  })
  return { node: toNode(row), issues }
}

export async function renameNode(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  name: string,
): Promise<DesignNode> {
  const row = await findNode(db, nodeId)
  authorize(ctx.actor, 'node:update', { projectId: row.projectId })
  await requireActiveProject(db, row.projectId)
  const [updated] = await db
    .update(designNodes)
    .set({ name })
    .where(eq(designNodes.id, nodeId))
    .returning()
  if (!updated) throw notFound('节点')
  return toNode(updated)
}

/** Hidden nodes stay in the history and can be restored; nothing is deleted. */
export async function setHidden(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  hidden: boolean,
): Promise<DesignNode> {
  const row = await findNode(db, nodeId)
  authorize(ctx.actor, 'node:update', { projectId: row.projectId })
  await requireActiveProject(db, row.projectId)
  const [updated] = await db
    .update(designNodes)
    .set({ hiddenAt: hidden ? (row.hiddenAt ?? sql`now()`) : null })
    .where(eq(designNodes.id, nodeId))
    .returning()
  if (!updated) throw notFound('节点')
  return toNode(updated)
}
