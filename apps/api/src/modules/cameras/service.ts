import { and, asc, count, eq, isNull, max, sql } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { MAX_CAMERAS_PER_NODE, MAX_NODES_PER_PROJECT, defaultCameras } from '@store/shared'
import type {
  Camera,
  CameraCreate,
  CameraUpdate,
  NodeCamera,
  NodeCameraList,
  Space,
} from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { findNode, requireActiveProject } from '../nodes/repository.ts'
import { validateBackgroundImage } from './background.ts'
import { resolveSpace } from '../nodes/service.ts'
import type { StorageRoots } from '../../lib/storage.ts'

const { nodeCameras } = schema
type CameraRow = typeof nodeCameras.$inferSelect

/** Every saved design stage owns its own view records. */
const CAMERA_NODE_KINDS = new Set(['space', 'plan', 'white', 'render'])

function toNodeCamera(row: CameraRow): NodeCamera {
  return {
    id: row.id,
    nodeId: row.nodeId,
    sort: row.sort,
    camera: row.camera,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

async function findCamera(db: Database, cameraId: string): Promise<CameraRow> {
  const [row] = await db.select().from(nodeCameras).where(eq(nodeCameras.id, cameraId))
  if (!row) throw notFound('视角')
  return row
}

async function activeCount(db: Database, nodeId: string): Promise<number> {
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(nodeCameras)
    .where(and(eq(nodeCameras.nodeId, nodeId), isNull(nodeCameras.deletedAt)))
  return total
}

function requireRoom(total: number): void {
  if (total >= MAX_CAMERAS_PER_NODE) {
    throw new AppError('INVALID_STATE', `每个阶段最多 ${MAX_CAMERAS_PER_NODE} 个视角`)
  }
}

/** Copies the nearest configured stage poses, stopping at the owning space. */
export async function initialCameras(
  db: Database,
  parentId: string | null,
  space: Space,
): Promise<Camera[]> {
  let current = parentId
  for (let depth = 0; current && depth <= MAX_NODES_PER_PROJECT; depth++) {
    const node = await findNode(db, current)
    const rows = await db
      .select()
      .from(nodeCameras)
      .where(eq(nodeCameras.nodeId, node.id))
      .orderBy(asc(nodeCameras.sort))
    if (rows.length)
      return rows
        .filter((row) => !row.deletedAt)
        .map((row) => ({
          name: row.camera.name,
          position: row.camera.position,
          target: row.camera.target,
          fovDeg: row.camera.fovDeg,
          source: row.camera.source,
        }))
    if (node.kind === 'space') break
    current = node.parentId
  }
  return defaultCameras(space)
}

/** Writes independent view records inside the owning stage transaction. */
export async function insertCameras(db: Database, nodeId: string, cameras: Camera[]) {
  if (!cameras.length) return
  await db.insert(nodeCameras).values(cameras.map((camera, sort) => ({ nodeId, sort, camera })))
}

export async function listCameras(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  includeDeleted: boolean,
): Promise<NodeCameraList> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'camera:read', { projectId: node.projectId })
  const filters = [eq(nodeCameras.nodeId, nodeId)]
  if (!includeDeleted) filters.push(isNull(nodeCameras.deletedAt))
  const rows = await db
    .select()
    .from(nodeCameras)
    .where(and(...filters))
    .orderBy(asc(nodeCameras.sort), asc(nodeCameras.createdAt))
  return { nodeId, cameras: rows.map(toNodeCamera) }
}

/** Explicit and idempotent first opening of a stage's saved views. */
export async function initializeCameras(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
): Promise<NodeCameraList> {
  return db.transaction(async (tx) => {
    const [node] = await tx
      .select()
      .from(schema.designNodes)
      .where(eq(schema.designNodes.id, nodeId))
      .for('update')
    if (!node) throw notFound('节点')
    authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
    await requireActiveProject(tx, node.projectId)
    if (!CAMERA_NODE_KINDS.has(node.kind))
      throw new AppError('INVALID_STATE', '当前节点不支持视角设置')
    const existing = await tx.select().from(nodeCameras).where(eq(nodeCameras.nodeId, nodeId))
    if (!existing.length) {
      const space = await resolveSpace(tx, node.id)
      const views =
        node.kind === 'space'
          ? defaultCameras(space)
          : await initialCameras(tx, node.parentId, space)
      await insertCameras(tx, nodeId, views)
    }
    return listCameras(tx, ctx, nodeId, true)
  })
}

export async function addCamera(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  input: CameraCreate,
): Promise<NodeCamera> {
  return db.transaction(async (tx) => {
    const [node] = await tx
      .select()
      .from(schema.designNodes)
      .where(eq(schema.designNodes.id, nodeId))
      .for('update')
    if (!node) throw notFound('节点')
    authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
    await requireActiveProject(tx, node.projectId)
    if (!CAMERA_NODE_KINDS.has(node.kind)) {
      throw new AppError('INVALID_STATE', '当前节点不支持视角设置')
    }
    requireRoom(await activeCount(tx, nodeId))
    const [{ last } = { last: null }] = await tx
      .select({ last: max(nodeCameras.sort) })
      .from(nodeCameras)
      .where(eq(nodeCameras.nodeId, nodeId))
    const [row] = await tx
      .insert(nodeCameras)
      .values({ nodeId, sort: (last ?? -1) + 1, camera: { ...input, source: 'user' } })
      .returning()
    if (!row) throw new Error('Camera insert returned no row')
    return toNodeCamera(row)
  })
}

/**
 * Renames or re-aims a view. Re-aiming a default view makes it the user's own. Renders keep
 * a signature of the pose they were made with, so older images become stale, not wrong.
 */
export async function updateCamera(
  db: Database,
  ctx: RequestContext,
  cameraId: string,
  patch: CameraUpdate,
  roots?: StorageRoots,
): Promise<NodeCamera> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(nodeCameras)
      .where(eq(nodeCameras.id, cameraId))
      .for('update')
    if (!row) throw notFound('视角')
    const node = await findNode(tx, row.nodeId)
    authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
    await requireActiveProject(tx, node.projectId)
    if (row.deletedAt) throw new AppError('INVALID_STATE', '视角已删除，请先恢复')
    const { expectedBackgroundRevision, ...fields } = patch
    const changingBackground = Object.hasOwn(fields, 'background')
    if (changingBackground) {
      if (node.kind !== 'render') throw new AppError('INVALID_STATE', '请在渲染步骤设置背景')
      if (expectedBackgroundRevision !== (row.camera.backgroundRevision ?? 0)) {
        throw new AppError('REVISION_CONFLICT', '背景已更新，请重新读取后再保存')
      }
      if (fields.background) {
        if (!roots) throw new Error('Background storage roots missing')
        await validateBackgroundImage(tx, node.projectId, fields.background.image, roots)
      }
    }
    const reaimed = patch.position ?? patch.target ?? patch.fovDeg
    const camera: Camera = {
      ...row.camera,
      ...fields,
      ...(changingBackground || reaimed !== undefined
        ? { backgroundRevision: (row.camera.backgroundRevision ?? 0) + 1 }
        : {}),
      source: reaimed === undefined ? row.camera.source : 'user',
    }
    const [updated] = await tx
      .update(nodeCameras)
      .set({ camera })
      .where(eq(nodeCameras.id, cameraId))
      .returning()
    if (!updated) throw notFound('视角')
    return toNodeCamera(updated)
  })
}

export async function setCameraDeleted(
  db: Database,
  ctx: RequestContext,
  cameraId: string,
  deleted: boolean,
): Promise<NodeCamera> {
  return db.transaction(async (tx) => {
    const row = await findCamera(tx, cameraId)
    const [node] = await tx
      .select()
      .from(schema.designNodes)
      .where(eq(schema.designNodes.id, row.nodeId))
      .for('update')
    if (!node) throw notFound('节点')
    authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
    await requireActiveProject(tx, node.projectId)
    if (!deleted && row.deletedAt) requireRoom(await activeCount(tx, row.nodeId))
    const [updated] = await tx
      .update(nodeCameras)
      .set({ deletedAt: deleted ? (row.deletedAt ?? sql`now()`) : null })
      .where(eq(nodeCameras.id, cameraId))
      .returning()
    if (!updated) throw notFound('视角')
    return toNodeCamera(updated)
  })
}
