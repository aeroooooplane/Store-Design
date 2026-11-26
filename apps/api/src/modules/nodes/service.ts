import { isDeepStrictEqual } from 'node:util'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  MAX_NODES_PER_PROJECT,
  STAGE_PARENT_KINDS,
  SpaceSchema,
  checkAssetFit,
  emptyDisplayEdits,
  followSpaceWalls,
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
  NodeOrigin,
  NodeSummary,
  NodeSpaceUpdate,
  NodeTree,
  Space,
} from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { catalogAssets } from '../assets/service.ts'
import { initialCameras, insertCameras } from '../cameras/service.ts'
import { findNode, requireActiveProject } from './repository.ts'
import type { NodeRow } from './repository.ts'

// Other modules import the guard from here.
export { requireActiveProject }

const { designNodes, nodeCameras, projectDrafts, projects } = schema

/** Recognition uses origin_ref for a recognition run. Other nodes use it for their source. */
export function sourceNodeId(row: Pick<NodeRow, 'origin' | 'originRef'>): string | null {
  return row.origin === 'recognition' ? null : row.originRef
}

export function toSummary(row: NodeRow): NodeSummary {
  const sourceId = sourceNodeId(row)
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    strategy: row.strategy,
    siStyle: row.siStyle,
    origin: row.origin,
    importedFrom: row.importedFrom,
    ...(sourceId ? { sourceNodeId: sourceId } : {}),
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

/** A saved node can use its own space or inherit one from the nearest ancestor. */
async function effectiveSpace(db: Database, node: NodeRow): Promise<Space | null> {
  let row = node
  for (let depth = 0; depth <= MAX_NODES_PER_PROJECT; depth++) {
    if (row.space || !row.parentId) return row.space
    row = await findNode(db, row.parentId)
  }
  return null
}

export async function resolveSpace(db: Database, nodeId: string): Promise<Space> {
  const space = await effectiveSpace(db, await findNode(db, nodeId))
  if (!space) throw new AppError('INVALID_STATE', '节点缺少所属空间')
  return space
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
  /** A white model may take the layout despite overlaps (the SI switch only reports them). */
  allowErrors = false,
): Promise<Issue[]> {
  const catalog = await catalogAssets(db)
  const fit = checkAssetFit(layout, catalog)
  if (fit.length) throw new AppError('VALIDATION_FAILED', '布局中的模型引用无效', asIssues(fit))
  const issues = asIssues(validateLayout(space, layout, catalog))
  if (
    (kind === 'white' || kind === 'render') &&
    !(allowErrors && kind === 'white') &&
    issues.some((i) => i.severity === 'error')
  ) {
    const action = kind === 'render' ? '开始渲染' : '进入三维效果'
    throw new AppError('VALIDATION_FAILED', `${action}前须先解决越界、重叠等问题`, issues)
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
  return { ...toNode(row), space: await effectiveSpace(db, row) }
}

// Keyed by node kind, not stage: new 'edit' nodes are still accepted anywhere (see agent-quirks).
const STAGE_PARENTS: Partial<Record<NodeKind, { kinds: readonly NodeKind[]; message: string }>> = {
  plan: { kinds: STAGE_PARENT_KINDS.plan ?? [], message: '方案只能建在空间下' },
  white: { kinds: ['plan', 'edit'], message: '旧版三维节点只能建在方案下' },
  render: { kinds: STAGE_PARENT_KINDS.render ?? [], message: '渲染只能建在方案下' },
}

/** Who made a node and what from; the API leaves this to the defaults (user / generator). */
export interface NodeMeta {
  origin?: NodeOrigin
  /** e.g. the recognition run a space was confirmed from. */
  originRef?: string
}

export async function createNode(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  input: NodeCreate,
  meta: NodeMeta = {},
): Promise<NodeCreated> {
  authorize(ctx.actor, 'node:create', { projectId })
  return db.transaction(async (tx) => {
    await requireActiveProject(tx, projectId, true)
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(designNodes)
      .where(eq(designNodes.projectId, projectId))
    if (total >= MAX_NODES_PER_PROJECT) {
      throw new AppError(
        'INVALID_STATE',
        `项目节点已达上限 ${MAX_NODES_PER_PROJECT}，请导出备份后新建项目`,
      )
    }
    const parent = input.parentId ? await findNode(tx, input.parentId) : null
    if (parent && parent.projectId !== projectId) throw notFound('父节点')
    // Accept the legacy white node kind for older API callers.
    const allowed = STAGE_PARENTS[input.kind]
    if (allowed && (!parent || !allowed.kinds.includes(parent.kind))) {
      throw new AppError('VALIDATION_FAILED', allowed.message)
    }
    const source = input.sourceNodeId ? await findNode(tx, input.sourceNodeId) : null
    if (source && source.projectId !== projectId) throw notFound('复制来源节点')

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
    if (input.kind !== 'space' && source && source.parentId === input.parentId) {
      space = source.space
    }
    if (input.layout) {
      layoutSpace = space ?? (parent ? await effectiveSpace(tx, parent) : null)
      if (!layoutSpace) throw new AppError('VALIDATION_FAILED', '布局缺少所属空间')
      issues = [
        ...issues,
        ...(await checkLayout(tx, layoutSpace, input.layout, input.kind, input.allowLayoutErrors)),
      ]
    }

    const cameras =
      (input.kind === 'white' ||
        input.kind === 'render' ||
        (input.kind === 'plan' && input.sourceNodeId)) &&
      layoutSpace
        ? await initialCameras(tx, input.sourceNodeId ?? input.parentId, layoutSpace)
        : []

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
        origin: meta.origin ?? (input.kind === 'plan' ? 'generator' : 'user'),
        originRef: meta.originRef ?? source?.id ?? null,
      })
      .returning()
    if (!inserted) throw new Error('Node insert returned no row')
    if (input.kind === 'render' && input.siStyle === 'SI2.0') {
      let edits = emptyDisplayEdits(input.siStyle)
      if (source?.kind === 'render' && source.siStyle === input.siStyle) {
        const [display] = await tx
          .select()
          .from(schema.nodeDisplays)
          .where(eq(schema.nodeDisplays.nodeId, source.id))
        edits = display?.edits ?? emptyDisplayEdits()
      }
      await tx.insert(schema.nodeDisplays).values({
        nodeId: inserted.id,
        edits,
        exports: [],
        revision: 0,
      })
    }
    if (
      input.kind === 'space' &&
      input.layout &&
      source?.kind === 'space' &&
      source.parentId === input.parentId
    ) {
      const sourceCameras = await tx
        .select()
        .from(nodeCameras)
        .where(eq(nodeCameras.nodeId, source.id))
      if (sourceCameras.length) {
        await tx.insert(nodeCameras).values(
          sourceCameras.map(({ camera, sort, deletedAt }) => ({
            nodeId: inserted.id,
            camera,
            sort,
            deletedAt,
          })),
        )
      }
    }
    await insertCameras(tx, inserted.id, cameras)
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, projectId))
    return { node: { ...toNode(inserted), space: space ?? layoutSpace }, issues }
  })
}

export async function updateNodeSpace(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  input: NodeSpaceUpdate,
): Promise<NodeCreated> {
  const reference = await findNode(db, nodeId)
  authorize(ctx.actor, 'node:update', { projectId: reference.projectId })
  const { space, warnings } = checkSpace(input.space)
  return db.transaction(async (tx) => {
    // Serialize edits with node creation so existing and newly created children have a clear boundary.
    await requireActiveProject(tx, reference.projectId, true)
    const row = await findNode(tx, nodeId)
    const stored = await effectiveSpace(tx, row)
    if (!stored) throw new AppError('INVALID_STATE', '节点缺少所属空间')
    const previous = SpaceSchema.parse(stored)
    if (isDeepStrictEqual(previous, space))
      return { node: { ...toNode(row), space }, issues: warnings }
    if (!isDeepStrictEqual(previous, input.previousSpace)) {
      throw new AppError('REVISION_CONFLICT', '空间已在其他窗口修改，请重新打开后再编辑')
    }

    // Old direct children keep the geometry they already used. Their descendants inherit it.
    await tx
      .update(designNodes)
      .set({ space: previous })
      .where(and(eq(designNodes.parentId, nodeId), isNull(designNodes.space)))
    const [updated] = await tx
      .update(designNodes)
      .set({ space, layout: row.layout && followSpaceWalls(row.layout, previous, space) })
      .where(eq(designNodes.id, nodeId))
      .returning()
    if (!updated) throw notFound('节点')

    if (row.kind === 'render') {
      // The capture revision also protects uploads from a window still showing the previous geometry.
      await tx
        .update(nodeCameras)
        .set({
          camera: sql`jsonb_set(${nodeCameras.camera}, '{backgroundRevision}',
          to_jsonb(coalesce((${nodeCameras.camera}->>'backgroundRevision')::int, 0) + 1))`,
        })
        .where(eq(nodeCameras.nodeId, nodeId))
    }
    const [draft] = await tx
      .select()
      .from(projectDrafts)
      .where(eq(projectDrafts.baseNodeId, nodeId))
      .for('update')
    if (draft) {
      await tx
        .update(projectDrafts)
        .set({
          layout: followSpaceWalls(draft.layout, previous, space),
          revision: draft.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(projectDrafts.baseNodeId, nodeId))
    }
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, row.projectId))
    return { node: toNode(updated), issues: warnings }
  })
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
