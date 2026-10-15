import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  DISPLAY_ORIENTATION_LABELS,
  RENDER_SIZE,
  SHOP_TYPE_LABELS,
  emptyDisplayEdits,
  entranceFrame,
  onPicture,
  planDisplay,
  projectToView,
  storeTitle,
} from '@store/shared'
import type {
  Asset,
  DisplayEdits,
  DisplayExport,
  DisplayMark,
  DisplayTable,
  DisplayTableInput,
  Layout,
  NodeDisplay,
  NodeDisplayExportBody,
} from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { fileUrl } from '../../lib/file-url.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { catalogAssets } from '../assets/service.ts'
import { requireActiveProject, resolveSpace } from '../nodes/service.ts'
import { newestImages, renderContext } from '../renders/service.ts'
import {
  applyEdits,
  buildDisplayFiles,
  deckImage,
  keepExports,
  loadPhotos,
  pendingOf,
  requireRules,
  storeDisplayFiles,
  tableShots,
} from './common.ts'
import type { DisplayFiles } from './common.ts'

const { designNodes, nodeDisplays, projects, storedFiles } = schema

/** Side tables the guide lays out: side cabinets whose model carries trays (带托盘). */
export function hasTrays(
  asset: Pick<Asset, 'function' | 'standardName' | 'variant' | 'name'> | undefined,
) {
  return (
    !!asset &&
    asset.function === 'side_cabinet' &&
    /托盘/.test(`${asset.standardName}${asset.variant}${asset.name}`)
  )
}

async function findRenderNode(db: Database, nodeId: string) {
  const [node] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!node) throw notFound('节点')
  if (node.kind !== 'render') throw new AppError('INVALID_STATE', '展陈方案在渲染节点上生成')
  return node
}

interface Computed {
  display: NodeDisplay
  heights: Map<string, number>
  project: typeof projects.$inferSelect
  /** Current material image file of each view. */
  imageFiles: Map<string, string>
}

async function compute(db: Database, nodeId: string): Promise<Computed> {
  const node = await findRenderNode(db, nodeId)
  const context = await renderContext(db, node)
  const [project] = await db.select().from(projects).where(eq(projects.id, node.projectId))
  if (!project) throw notFound('项目')
  const space = await resolveSpace(db, node.id)
  const catalog = await catalogAssets(db)
  const ruleSet = await requireRules(db)
  const [saved] = await db.select().from(nodeDisplays).where(eq(nodeDisplays.nodeId, node.id))
  const edits: DisplayEdits = saved?.edits ?? emptyDisplayEdits()

  const layout = node.layout as Layout
  const heights = new Map<string, number>()
  const inputs = layout.items.flatMap((item): DisplayTableInput[] => {
    const kind: DisplayTableInput['kind'] | null =
      item.function === 'island_table'
        ? 'island'
        : hasTrays(item.assetId ? catalog.get(item.assetId) : undefined)
          ? 'side'
          : null
    if (!kind) return []
    heights.set(item.id, item.h)
    return [
      {
        id: item.id,
        kind,
        cx: item.cx,
        cz: item.cz,
        w: item.w,
        d: item.d,
      },
    ]
  })
  const tables = applyEdits(
    planDisplay(ruleSet.rules, {
      tables: inputs,
      entrance: entranceFrame(space),
      market: project.market,
      landscapeEnd: edits.landscapeEnd,
      orientation: edits.orientation,
    }),
    edits,
  )

  const images = (await newestImages(db, context)).filter(
    (e) => e.row.mode === 'material' && !e.image.stale,
  )
  const imageByCamera = new Map(images.map((e) => [e.row.cameraId, e]))
  const views = context.cameras.map((view) => {
    const image = imageByCamera.get(view.id)
    const aspect = image
      ? image.image.width / image.image.height
      : RENDER_SIZE.width / RENDER_SIZE.height
    const marks: Record<string, DisplayMark & { depth: number }> = {}
    for (const t of tables) {
      const p = projectToView(view.camera, aspect, [
        t.plan.cx,
        heights.get(t.sourceId) ?? 0.9,
        t.plan.cz,
      ])
      if (onPicture(p)) marks[t.label] = { x: p.x, y: p.y, depth: p.depth }
    }
    return { view, image, marks }
  })
  // Each table on the view where it is nearest and nearest the middle of the picture.
  const tableViews: Record<string, string | null> = {}
  for (const t of tables) {
    let best: { id: string; score: number } | null = null
    for (const v of views) {
      const m = v.marks[t.label]
      if (!m) continue
      const score = m.depth * (1 + 2 * Math.hypot(m.x - 0.5, m.y - 0.55))
      if (!best || score < best.score) best = { id: v.view.id, score }
    }
    tableViews[t.label] = best?.id ?? null
  }
  const overview = [...views].sort(
    (a, b) => Object.keys(b.marks).length - Object.keys(a.marks).length,
  )[0]
  return {
    project,
    heights,
    imageFiles: new Map(images.map((e) => [e.row.cameraId, e.row.fileId])),
    display: {
      nodeId: node.id,
      revision: saved?.revision ?? 0,
      edits,
      tables,
      views: views.map((v) => ({
        cameraId: v.view.id,
        name: v.view.camera.name,
        imageUrl: v.image ? fileUrl(v.image.row.fileId) : null,
        marks: Object.fromEntries(Object.entries(v.marks).map(([k, m]) => [k, { x: m.x, y: m.y }])),
      })),
      overviewCameraId: overview && Object.keys(overview.marks).length ? overview.view.id : null,
      tableViews,
      ruleVersion: ruleSet.version,
      exports: saved?.exports ?? [],
    },
  }
}

export async function getNodeDisplay(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
): Promise<NodeDisplay> {
  const node = await findRenderNode(db, nodeId)
  authorize(ctx.actor, 'display:read', { projectId: node.projectId })
  return (await compute(db, nodeId)).display
}

export async function updateNodeDisplay(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
  revision: number,
  edits: DisplayEdits,
): Promise<NodeDisplay> {
  const node = await findRenderNode(db, nodeId)
  authorize(ctx.actor, 'display:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  const [saved] = await db.select().from(nodeDisplays).where(eq(nodeDisplays.nodeId, nodeId))
  if ((saved?.revision ?? 0) !== revision) {
    throw new AppError('REVISION_CONFLICT', '展陈方案已被修改，请刷新后再保存', {
      revision: saved?.revision ?? 0,
    })
  }
  if (saved) {
    await db
      .update(nodeDisplays)
      .set({ edits, revision: saved.revision + 1, updatedAt: new Date() })
      .where(eq(nodeDisplays.nodeId, nodeId))
  } else {
    await db.insert(nodeDisplays).values({ nodeId, edits })
  }
  return (await compute(db, nodeId)).display
}

async function readImage(db: Database, roots: StorageRoots, fileId: string) {
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, fileId))
  if (!file) throw notFound('图片')
  const { file: path } = await resolveStoredFile(
    roots,
    file.root as keyof StorageRoots,
    file.storageKey,
  )
  return readFile(path)
}

/**
 * The PPT and checklist of a render node: the plan picture comes from the browser (the same
 * drawing as the delivery plan) with the area it shows, so labels land on the tables.
 */
export async function nodeDisplayFiles(
  db: Database,
  roots: StorageRoots,
  nodeId: string,
  request: NodeDisplayExportBody,
): Promise<{ files: DisplayFiles; tables: DisplayTable[]; ruleVersion: string }> {
  const { display, project, imageFiles } = await compute(db, nodeId)
  if (!display.tables.length) {
    throw new AppError('INVALID_STATE', '这个方案里没有中岛桌或带托盘的边桌，无法生成展陈方案')
  }
  const ruleSet = await requireRules(db)
  const [vx, vz, vw, vh] = request.planViewBox
  const planMarks = Object.fromEntries(
    display.tables.map((t) => [t.label, { x: (t.plan.cx - vx) / vw, y: (t.plan.cz - vz) / vh }]),
  )
  const images = new Map<string, Awaited<ReturnType<typeof deckImage>>>()
  const imageOf = async (cameraId: string | null) => {
    const fileId = cameraId ? imageFiles.get(cameraId) : undefined
    if (!cameraId || !fileId) return null
    if (!images.has(cameraId))
      images.set(cameraId, await deckImage(await readImage(db, roots, fileId)))
    return images.get(cameraId) ?? null
  }
  const marksOf = (cameraId: string | null) =>
    display.views.find((v) => v.cameraId === cameraId)?.marks ?? {}
  const overviewImage = await imageOf(display.overviewCameraId)
  const tableViews: Record<
    string,
    { image: Awaited<ReturnType<typeof deckImage>>; mark: DisplayMark } | undefined
  > = {}
  for (const t of display.tables) {
    const cameraId = display.tableViews[t.label] ?? null
    const image = await imageOf(cameraId)
    const mark = marksOf(cameraId)[t.label]
    tableViews[t.label] = image && mark ? { image, mark } : undefined
  }
  const islands = display.tables.filter((t) => t.kind === 'island')
  const [node] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  const si = node?.siStyle ?? project.siStyle
  const files = await buildDisplayFiles({
    name: project.name,
    title: storeTitle(project.name),
    date: new Date().toISOString().slice(0, 10),
    market: project.market,
    subtitle: [
      si,
      SHOP_TYPE_LABELS[project.shopType],
      `中岛桌 ${islands.length} 张${islands[0] ? `（${DISPLAY_ORIENTATION_LABELS[islands[0].orientation]}）` : ''}`,
      ...(display.tables.length > islands.length
        ? [`边桌 ${display.tables.length - islands.length} 张`]
        : []),
    ].join(' · '),
    rules: ruleSet.rules,
    tables: display.tables,
    plan: await deckImage(Buffer.from(request.planPng, 'base64'), 2400),
    planMarks,
    overview: overviewImage
      ? { image: overviewImage, marks: marksOf(display.overviewCameraId) }
      : null,
    tableViews,
    photos: await loadPhotos(roots, ruleSet.rules, si, display.tables),
    landscapeEnd: display.edits.landscapeEnd,
    views: request.views,
    tables3d: await tableShots(display.tables, request.tables3d),
    pending: pendingOf(display.tables),
  })
  return { files, tables: display.tables, ruleVersion: ruleSet.version }
}

export async function exportNodeDisplay(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  nodeId: string,
  request: NodeDisplayExportBody,
): Promise<DisplayExport> {
  const node = await findRenderNode(db, nodeId)
  authorize(ctx.actor, 'display:write', { projectId: node.projectId })
  const { files, ruleVersion } = await nodeDisplayFiles(db, roots, nodeId, request)
  const record = await storeDisplayFiles(db, roots, `displays/nodes/${nodeId}`, files, ruleVersion)
  const [saved] = await db.select().from(nodeDisplays).where(eq(nodeDisplays.nodeId, nodeId))
  if (saved) {
    await db
      .update(nodeDisplays)
      .set({ exports: keepExports(saved.exports, record), updatedAt: new Date() })
      .where(eq(nodeDisplays.nodeId, nodeId))
  } else {
    await db
      .insert(nodeDisplays)
      .values({ nodeId, edits: emptyDisplayEdits(), exports: [record], revision: 0 })
  }
  return record
}
