import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, inArray, like } from 'drizzle-orm'
import { zipSync } from 'fflate'
import sharp from 'sharp'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  MARKET_LABELS,
  SHOP_TYPE_LABELS,
  deliveryFileNames,
  deliveryFolderName,
  deliveryLegend,
  polygonArea,
  safeFileName,
  storeTitle,
  validateLayout,
} from '@store/shared'
import type { Delivery, DeliveryCreate, DeliveryList, Layout, Space } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { catalogAssets } from '../assets/service.ts'
import { exportProject } from '../exchange/service.ts'
import { fileUrl } from '../files/routes.ts'
import { requireActiveProject, resolveSpace } from '../nodes/service.ts'
import { newestImages, pngSize, renderContext } from '../renders/service.ts'
import { fullPdf, showPdf } from './pdf.ts'
import type { DeliveryContent } from './pdf.ts'

const { deliveries, designNodes, projects, storedFiles } = schema
type DeliveryRow = typeof deliveries.$inferSelect
type FileRow = typeof storedFiles.$inferSelect

export interface DeliveryDirs {
  roots: StorageRoots
  /** Where delivery folders are archived on the server (ARCHIVE_ROOT). */
  archiveRoot: string
}

const RULE_LABELS: Record<string, string> = {
  clearance: '道具间距',
  aisle: '主通道',
  entranceBuffer: '入口缓冲',
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const pad = (n: number) => String(n).padStart(2, '0')

function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

async function findNode(db: Database, nodeId: string) {
  const [row] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!row) throw notFound('节点')
  return row
}

/** Names of the plan / white-model steps this render continues, for the record. */
async function stepNames(db: Database, parentId: string | null): Promise<string[]> {
  const names: string[] = []
  let current = parentId
  for (let depth = 0; current && depth < 10; depth++) {
    const row = await findNode(db, current)
    if (row.kind === 'space') break
    names.unshift(row.name)
    current = row.parentId
  }
  return names
}

function notesFor(space: Space, layout: Layout, placeholderNames: string[]): string[] {
  const notes: string[] = []
  for (const r of layout.planning?.relaxations ?? []) {
    notes.push(`${RULE_LABELS[r.rule] ?? r.rule}让步：指导值 ${r.target} m，实际 ${r.actual} m`)
  }
  const warnings = new Set(
    validateLayout(space, layout)
      .filter((i) => i.severity === 'warning')
      .map((i) => i.message),
  )
  for (const message of warnings) notes.push(`检查提示：${message}`)
  for (const name of placeholderNames) notes.push(`占位：${name} 暂无三维模型，按真实尺寸方框表示`)
  notes.push('效果图为浏览器实时渲染（Three.js）；正式渲染上线后可按同一视角替换。')
  notes.push('灯箱画面与品牌 Logo 尚未放入渲染；平面尺寸单位为毫米。')
  return notes
}

async function readStored(roots: StorageRoots, row: FileRow): Promise<Buffer> {
  const { file } = await resolveStoredFile(roots, row.root as keyof StorageRoots, row.storageKey)
  return readFile(file)
}

/** Next free folder name: the same shop, type, area and day gets _修订02, _修订03, … */
async function freeFolderName(
  db: Database,
  archiveRoot: string,
  name: (revision: number) => string,
): Promise<string> {
  const base = name(1)
  const taken = new Set(
    (
      await db
        .select({ folderName: deliveries.folderName })
        .from(deliveries)
        .where(like(deliveries.folderName, `${base.replace(/[%_\\]/g, '\\$&')}%`))
    ).map((r) => r.folderName),
  )
  for (const entry of await readdir(archiveRoot).catch(() => [] as string[])) taken.add(entry)
  for (let revision = 1; revision < 100; revision++) {
    if (!taken.has(name(revision))) return name(revision)
  }
  throw new AppError('INVALID_STATE', '同一天的交付修订已超过 99 次')
}

/**
 * Builds the two PDFs of a render node (双PDF交付规则), stores them with a ZIP of the whole
 * delivery folder, and writes that folder to the archive. Every view must have a current white
 * and material image: a delivery never mixes images of different layouts or poses.
 */
export async function createDelivery(
  db: Database,
  ctx: RequestContext,
  dirs: DeliveryDirs,
  nodeId: string,
  input: DeliveryCreate,
): Promise<Delivery> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'delivery:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  const context = await renderContext(db, node)
  if (!context.cameras.length) throw new AppError('INVALID_STATE', '渲染节点没有视角')
  const newest = new Map(
    (await newestImages(db, context)).map((e) => [`${e.row.cameraId}:${e.row.mode}`, e]),
  )
  let missing = 0
  let stale = 0
  for (const view of context.cameras) {
    for (const mode of ['white', 'material'] as const) {
      const entry = newest.get(`${view.id}:${mode}`)
      if (!entry) missing++
      else if (entry.image.stale) stale++
    }
  }
  if (missing || stale) {
    throw new AppError(
      'INVALID_STATE',
      `还有 ${missing + stale} 张渲染图缺失或已过期，请先重新渲染`,
      { missing, stale },
    )
  }
  const plan = Buffer.from(input.planPng, 'base64')
  // Print size: an A3 page at 300 dpi is about 5000 px wide.
  pngSize(plan, { what: '平面图', maxSide: 8192 })

  const [project] = await db.select().from(projects).where(eq(projects.id, node.projectId))
  if (!project) throw notFound('项目')
  const layout = node.layout as Layout
  const space = await resolveSpace(db, node.id)
  const catalog = await catalogAssets(db)
  const legend = deliveryLegend(layout.items, catalog)
  const now = new Date()
  const date = localDate(now)
  const area = polygonArea(space.boundary)
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const mm = (m: number) => Math.round(m * 1000)

  // Image files of every view, in view order.
  const fileIds = [...newest.values()].map((e) => e.row.fileId)
  const fileRows = new Map(
    (await db.select().from(storedFiles).where(inArray(storedFiles.id, fileIds))).map((r) => [
      r.id,
      r,
    ]),
  )
  const views = await Promise.all(
    context.cameras.map(async (view, index) => {
      const pick = async (mode: 'white' | 'material') => {
        const entry = newest.get(`${view.id}:${mode}`)
        const row = entry ? fileRows.get(entry.row.fileId) : undefined
        if (!entry || !row) throw new Error(`render file missing for ${view.id} ${mode}`)
        return { renderId: entry.row.id, row, data: await readStored(dirs.roots, row) }
      }
      return { no: index + 1, view, material: await pick('material'), white: await pick('white') }
    }),
  )

  const title = storeTitle(project.name)
  const steps = await stepNames(db, node.parentId)
  const content: DeliveryContent = {
    title,
    subtitle: `${SHOP_TYPE_LABELS[project.shopType]} · ${MARKET_LABELS[project.market]} · ${node.siStyle}`,
    date,
    plan,
    legend: legend.entries,
    facts: [
      `面积 ${area.toFixed(1)} ㎡，外包尺寸 ${mm(Math.max(...xs) - Math.min(...xs))} × ${mm(Math.max(...zs) - Math.min(...zs))} mm，层高 ${mm(space.height)} mm`,
      `道具 ${layout.items.length} 件，${legend.entries.length} 种（编号见图例）`,
      `方案：${[...steps, node.name].join(' → ')}`,
      `效果图 ${views.length} 个视角，与白模同一相机`,
    ],
    notes: notesFor(
      space,
      layout,
      legend.entries.filter((e) => e.placeholder).map((e) => e.name),
    ),
    // JPEG keeps the PDFs small; the archive keeps the original PNGs.
    views: await Promise.all(
      views.map(async (v) => ({
        no: v.no,
        name: v.view.camera.name,
        material: await sharp(v.material.data).jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
        white: await sharp(v.white.data).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
      })),
    ),
  }
  const [full, show] = await Promise.all([fullPdf(content), showPdf(content)])

  const folderName = await freeFolderName(db, dirs.archiveRoot, (revision) =>
    deliveryFolderName(project.name, project.shopType, area, date, revision),
  )
  const names = deliveryFileNames(project.name)
  const viewFile = (v: (typeof views)[number], suffix = '') =>
    `${pad(v.no)}-${safeFileName(v.view.camera.name)}${suffix}.png`
  const exported = await exportProject(db, ctx, project.id)
  const record = {
    format: 'store-design-delivery',
    version: 1,
    createdAt: now.toISOString(),
    title,
    folderName,
    project: {
      id: project.id,
      name: project.name,
      shopType: project.shopType,
      market: project.market,
    },
    node: { id: node.id, name: node.name, siStyle: node.siStyle, steps },
    layoutSignature: context.layoutSignature,
    renderer: 'three（浏览器）',
    views: views.map((v) => ({
      no: v.no,
      cameraId: v.view.id,
      name: v.view.camera.name,
      material: { renderId: v.material.renderId, sha256: v.material.row.sha256 },
      white: { renderId: v.white.renderId, sha256: v.white.row.sha256 },
    })),
    pages: { full: full.pages, show: show.pages },
    legend: legend.entries,
    notes: content.notes,
    files: {
      full: { name: names.full, bytes: full.data.length, sha256: sha256(full.data) },
      show: { name: names.show, bytes: show.data.length, sha256: sha256(show.data) },
    },
  }
  const folder: [string, Uint8Array][] = [
    [names.full, full.data],
    [names.show, show.data],
    ['01_平面图/平面图.png', plan],
    ...(input.planSvg
      ? ([['01_平面图/平面图.svg', Buffer.from(input.planSvg, 'utf8')]] as [string, Uint8Array][])
      : []),
    ...views.map((v) => [`02_效果图/${viewFile(v)}`, v.material.data] as [string, Uint8Array]),
    ...views.map((v) => [`03_总览/${viewFile(v, '-白模')}`, v.white.data] as [string, Uint8Array]),
    ['04_源文件与记录/项目.json', Buffer.from(`${JSON.stringify(exported, null, 2)}\n`)],
    ['04_源文件与记录/交付记录.json', Buffer.from(`${JSON.stringify(record, null, 2)}\n`)],
  ]
  // Pictures and PDFs are compressed already.
  const zip = zipSync(
    Object.fromEntries(
      folder.map(([name, data]) => [
        `${folderName}/${name}`,
        [data, { level: /\.(png|pdf)$/.test(name) ? 0 : 6 }],
      ]),
    ),
  )

  const deliveryId = randomUUID()
  const store = async (kind: string, name: string, data: Uint8Array, contentType: string) => {
    const storageKey = ['deliveries', project.id, deliveryId, name].join('/')
    const file = path.resolve(dirs.roots.storage, storageKey)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
    const [row] = await db
      .insert(storedFiles)
      .values({
        root: 'storage',
        storageKey,
        kind,
        contentType,
        bytes: data.length,
        sha256: sha256(data),
        originalName: name,
      })
      .returning()
    if (!row) throw new Error('Stored file insert returned no row')
    return row
  }
  const fullRow = await store('pdf', names.full, full.data, 'application/pdf')
  const showRow = await store('pdf', names.show, show.data, 'application/pdf')
  const zipRow = await store('zip', `${folderName}.zip`, zip, 'application/zip')

  let archivePath: string | null = path.join(dirs.archiveRoot, folderName)
  try {
    for (const [name, data] of folder) {
      const file = path.join(archivePath, name)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, data)
    }
  } catch {
    // The download still works; the record says the archive copy is missing.
    archivePath = null
  }

  const [row] = await db
    .insert(deliveries)
    .values({
      id: deliveryId,
      projectId: project.id,
      nodeId: node.id,
      folderName,
      fullPdfFileId: fullRow.id,
      showPdfFileId: showRow.id,
      zipFileId: zipRow.id,
      archivePath,
      manifest: record,
    })
    .returning()
  if (!row) throw new Error('Delivery insert returned no row')
  return toDelivery(row, new Map([fullRow, showRow, zipRow].map((r) => [r.id, r])))
}

function toDelivery(row: DeliveryRow, files: ReadonlyMap<string, FileRow>): Delivery {
  const file = (id: string | null) => {
    const stored = id ? files.get(id) : undefined
    if (!stored) throw new Error(`delivery ${row.id} lost a file`)
    return { url: fileUrl(stored.id), name: stored.originalName ?? '', bytes: stored.bytes }
  }
  const manifest = row.manifest as {
    pages?: { full?: unknown[]; show?: unknown[] }
    views?: unknown[]
  }
  return {
    id: row.id,
    nodeId: row.nodeId,
    folderName: row.folderName,
    archivePath: row.archivePath,
    fullPdf: file(row.fullPdfFileId),
    showPdf: file(row.showPdfFileId),
    zip: file(row.zipFileId),
    pages: { full: manifest.pages?.full?.length ?? 0, show: manifest.pages?.show?.length ?? 0 },
    views: manifest.views?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listDeliveries(
  db: Database,
  ctx: RequestContext,
  nodeId: string,
): Promise<DeliveryList> {
  const node = await findNode(db, nodeId)
  authorize(ctx.actor, 'delivery:read', { projectId: node.projectId })
  const rows = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.projectId, node.projectId), eq(deliveries.nodeId, nodeId)))
    .orderBy(desc(deliveries.createdAt))
  const ids = rows
    .flatMap((r) => [r.fullPdfFileId, r.showPdfFileId, r.zipFileId])
    .filter((id): id is string => id !== null)
  const files = new Map(
    ids.length
      ? (await db.select().from(storedFiles).where(inArray(storedFiles.id, ids))).map((r) => [
          r.id,
          r,
        ])
      : [],
  )
  return { nodeId, deliveries: rows.map((row) => toDelivery(row, files)) }
}
