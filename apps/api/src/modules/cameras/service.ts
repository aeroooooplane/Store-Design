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
import { requireActiveProject } from '../nodes/service.ts'

const { designNodes, nodeCameras } = schema
type CameraRow = typeof nodeCameras.$inferSelect
type NodeRow = typeof designNodes.$inferSelect

/** Views belong to confirmed white models and to the render nodes made from them. */
const CAMERA_NODE_KINDS = new Set(['white', 'render'])

function toNodeCamera(row: CameraRow): NodeCamera {
  return {
    id: row.id,
    nodeId: row.nodeId,
    sort: row.sort,
    camera: row.camera,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

async function findNode(db: Database, nodeId: string): Promise<NodeRow> {
  const [row] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!row) throw notFound('节点')
  return row
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
    throw new AppError('INVALID_STATE', `每个白模最多 ${MAX_CAMERAS_PER_NODE} 个视角`)
  }
}

/**
 * Views for a new white model: the active views of the white model it continues (so the
 * user's own views survive re-confirming), otherwise the eight defaults. The search stops at
 * a space node, because views of another space would point at the wrong room.
 */
export async function initialCameras(
  db: Database,
  parentId: string | null,
  space: Space,
): Promise<Camera[]> {
  let current = parentId
  for (let depth = 0; current && depth <= MAX_NODES_PER_PROJECT; depth++) {
    const node = await findNode(db, current)
    if (node.kind === 'space') break
    if (node.kind === 'white') {
      const rows = await db
        .select()
        .from(nodeCameras)
        .where(and(eq(nodeCameras.nodeId, node.id), isNull(nodeCameras.deletedAt)))
        .orderBy(asc(nodeCameras.sort))
      if (rows.length) return rows.map((row) => row.camera)
      break
    }
    current = node.parentId
  }
  return defaultCameras(space)
}

/** Writes the views of a new white-model node (inside its creation transaction). */
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

export async function addCamera(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  input: CameraCreate,
): Promise<NodeCamera> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  if (!CAMERA_NODE_KINDS.has(node.kind)) {
    throw new AppError('INVALID_STATE', '只有白模节点可以设置视角')
  }
  requireRoom(await activeCount(db, nodeId))
  const [{ last } = { last: null }] = await db
    .select({ last: max(nodeCameras.sort) })
    .from(nodeCameras)
    .where(eq(nodeCameras.nodeId, nodeId))
  const [row] = await db
    .insert(nodeCameras)
    .values({ nodeId, sort: (last ?? -1) + 1, camera: { ...input, source: 'user' } })
    .returning()
  if (!row) throw new Error('Camera insert returned no row')
  return toNodeCamera(row)
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
): Promise<NodeCamera> {
  const row = await findCamera(db, cameraId)
  const node = await findNode(db, row.nodeId)
  authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  if (row.deletedAt) throw new AppError('INVALID_STATE', '视角已删除，请先恢复')
  const reaimed = patch.position ?? patch.target ?? patch.fovDeg
  const camera: Camera = {
    ...row.camera,
    ...patch,
    source: reaimed === undefined ? row.camera.source : 'user',
  }
  const [updated] = await db
    .update(nodeCameras)
    .set({ camera })
    .where(eq(nodeCameras.id, cameraId))
    .returning()
  if (!updated) throw notFound('视角')
  return toNodeCamera(updated)
}

export async function setCameraDeleted(
  db: Database,
  ctx: RequestContext,
  cameraId: string,
  deleted: boolean,
): Promise<NodeCamera> {
  const row = await findCamera(db, cameraId)
  const node = await findNode(db, row.nodeId)
  authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  if (!deleted && row.deletedAt) requireRoom(await activeCount(db, row.nodeId))
  const [updated] = await db
    .update(nodeCameras)
    .set({ deletedAt: deleted ? (row.deletedAt ?? sql`now()`) : null })
    .where(eq(nodeCameras.id, cameraId))
    .returning()
  if (!updated) throw notFound('视角')
  return toNodeCamera(updated)
}
