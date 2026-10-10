import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { RENDER_MODE_LABELS } from '@store/shared'
import type { Camera, NodeRenderList, RenderImage, RenderMode } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { catalogAssets } from '../assets/service.ts'
import { fileUrl } from '../files/routes.ts'
import { requireActiveProject, resolveSpace } from '../nodes/service.ts'

const { designNodes, nodeCameras, projects, renders, storedFiles } = schema
type NodeRow = typeof designNodes.$inferSelect
type RenderRow = typeof renders.$inferSelect

const ENGINE = 'three'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MIN_SIDE = 64
const MAX_SIDE = 4096

/** JSON with sorted keys, so equal content always hashes the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')

/** Only the pose decides what a view shows; renaming a view keeps its images current. */
export function cameraSignature(camera: Camera): string {
  return hash({ position: camera.position, target: camera.target, fovDeg: camera.fovDeg })
}

interface RenderContext {
  node: NodeRow
  siStyle: NonNullable<NodeRow['siStyle']>
  market: (typeof projects.$inferSelect)['market']
  /** Space, shop type, layout, style, market and the model files used. */
  layoutSignature: string
  /** Active views in order. */
  cameras: { id: string; camera: Camera; signature: string }[]
}

async function findNode(db: Database, nodeId: string): Promise<NodeRow> {
  const [row] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!row) throw notFound('节点')
  return row
}

async function renderContext(db: Database, node: NodeRow): Promise<RenderContext> {
  if (node.kind !== 'render' || !node.layout || !node.siStyle) {
    throw new AppError('INVALID_STATE', '只有渲染节点可以保存渲染图')
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, node.projectId))
  if (!project) throw notFound('项目')
  const space = await resolveSpace(db, node.id)
  const catalog = await catalogAssets(db)
  // A model file that changes in the library makes the images stale too.
  const models = [...new Set(node.layout.items.map((i) => i.assetId).filter((id) => id !== null))]
    .sort()
    .map((id) => {
      const asset = catalog.get(id)
      return [id, asset?.glb?.sha256 ?? null, asset?.whiteGlb?.sha256 ?? null]
    })
  const layoutSignature = hash({
    space,
    shopType: project.shopType,
    layout: node.layout,
    siStyle: node.siStyle,
    market: project.market,
    models,
  })
  const rows = await db
    .select()
    .from(nodeCameras)
    .where(and(eq(nodeCameras.nodeId, node.id), isNull(nodeCameras.deletedAt)))
    .orderBy(asc(nodeCameras.sort), asc(nodeCameras.createdAt))
  return {
    node,
    siStyle: node.siStyle,
    market: project.market,
    layoutSignature,
    cameras: rows.map((row) => ({
      id: row.id,
      camera: row.camera,
      signature: cameraSignature(row.camera),
    })),
  }
}

/** Newest image per active view and mode, in view order, each marked current or stale. */
async function newestImages(
  db: Database,
  context: RenderContext,
): Promise<{ row: RenderRow; image: RenderImage; camera: Camera; sort: number }[]> {
  const rows = await db
    .select()
    .from(renders)
    .where(eq(renders.nodeId, context.node.id))
    .orderBy(desc(renders.createdAt))
  const newest = new Map<string, RenderRow>()
  for (const row of rows) {
    const key = `${row.cameraId}:${row.mode}`
    if (!newest.has(key)) newest.set(key, row)
  }
  const result: { row: RenderRow; image: RenderImage; camera: Camera; sort: number }[] = []
  context.cameras.forEach((view, sort) => {
    for (const mode of ['white', 'material'] as const) {
      const row = newest.get(`${view.id}:${mode}`)
      if (!row) continue
      const stale =
        row.engine !== ENGINE ||
        row.siStyle !== context.siStyle ||
        row.market !== context.market ||
        row.layoutSignature !== context.layoutSignature ||
        row.cameraSignature !== view.signature
      result.push({ row, camera: view.camera, sort, image: toImage(row, stale) })
    }
  })
  return result
}

function toImage(row: RenderRow, stale: boolean): RenderImage {
  return {
    id: row.id,
    cameraId: row.cameraId,
    mode: row.mode,
    url: fileUrl(row.fileId),
    width: row.width,
    height: row.height,
    stale,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listRenders(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
): Promise<NodeRenderList> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'render:read', { projectId: node.projectId })
  if (node.kind !== 'render') return { nodeId, images: [] }
  const context = await renderContext(db, node)
  return { nodeId, images: (await newestImages(db, context)).map((entry) => entry.image) }
}

/** Width and height from the PNG header; anything that is not a PNG is refused. */
export function pngSize(data: Buffer): { width: number; height: number } {
  if (
    data.length < 24 ||
    !data.subarray(0, 8).equals(PNG_SIGNATURE) ||
    data.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    throw new AppError('VALIDATION_FAILED', '渲染图必须是 PNG 图片')
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if ([width, height].some((side) => side < MIN_SIDE || side > MAX_SIDE)) {
    throw new AppError('VALIDATION_FAILED', `渲染图边长须在 ${MIN_SIDE}–${MAX_SIDE} 像素之间`)
  }
  return { width, height }
}

/**
 * Stores one browser-rendered image of a view. The signatures are computed here from what
 * the node holds now, so an image can only be filed against the state it was made from.
 */
export async function saveRender(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  input: { nodeId: string; cameraId: string; mode: RenderMode; png: Buffer },
): Promise<RenderImage> {
  const node = await findNode(db, input.nodeId)
  authorize(ctx.actor, 'render:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  const context = await renderContext(db, node)
  const view = context.cameras.find((c) => c.id === input.cameraId)
  if (!view) throw notFound('视角')
  const { width, height } = pngSize(input.png)

  const sha256 = createHash('sha256').update(input.png).digest('hex')
  const storageKey = [
    'renders',
    node.projectId,
    node.id,
    `${view.id}-${input.mode}-${sha256.slice(0, 16)}.png`,
  ].join('/')
  const file = path.resolve(roots.storage, storageKey)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, input.png)

  const row = await db.transaction(async (tx) => {
    // The same picture uploaded twice is one file.
    await tx
      .insert(storedFiles)
      .values({
        root: 'storage',
        storageKey,
        kind: 'render',
        contentType: 'image/png',
        bytes: input.png.length,
        sha256,
        originalName: `${view.camera.name}-${RENDER_MODE_LABELS[input.mode]}.png`,
      })
      .onConflictDoNothing()
    const [stored] = await tx
      .select({ id: storedFiles.id })
      .from(storedFiles)
      .where(and(eq(storedFiles.root, 'storage'), eq(storedFiles.storageKey, storageKey)))
    if (!stored) throw new Error('Stored file row missing after insert')
    const [saved] = await tx
      .insert(renders)
      .values({
        nodeId: node.id,
        cameraId: view.id,
        mode: input.mode,
        engine: ENGINE,
        siStyle: context.siStyle,
        market: context.market,
        layoutSignature: context.layoutSignature,
        cameraSignature: view.signature,
        fileId: stored.id,
        width,
        height,
      })
      .onConflictDoUpdate({
        target: [
          renders.cameraId,
          renders.mode,
          renders.engine,
          renders.siStyle,
          renders.market,
          renders.layoutSignature,
          renders.cameraSignature,
        ],
        set: { fileId: stored.id, width, height, createdAt: new Date() },
      })
      .returning()
    if (!saved) throw new Error('Render insert returned no row')
    return saved
  })
  return toImage(row, false)
}

/** Characters Windows and macOS refuse in file names. */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, '_')

/** The current images of a render node as one ZIP (PNG is already compressed: stored as is). */
export async function renderArchive(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  nodeId: string,
): Promise<{ fileName: string; zip: Uint8Array }> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'render:read', { projectId: node.projectId })
  const context = await renderContext(db, node)
  const current = (await newestImages(db, context)).filter((entry) => !entry.image.stale)
  if (!current.length) throw new AppError('INVALID_STATE', '还没有可下载的渲染图，请先渲染')
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {}
  for (const { row, camera, sort } of current) {
    const [stored] = await db.select().from(storedFiles).where(eq(storedFiles.id, row.fileId))
    if (!stored) continue
    const { file } = await resolveStoredFile(roots, 'storage', stored.storageKey)
    const name = `${String(sort + 1).padStart(2, '0')}-${safeName(camera.name)}-${RENDER_MODE_LABELS[row.mode]}.png`
    entries[name] = [new Uint8Array(await readFile(file)), { level: 0 }]
  }
  return { fileName: `渲染图-${safeName(node.name)}.zip`, zip: zipSync(entries) }
}
