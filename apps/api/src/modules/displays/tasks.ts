import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { DisplayTaskStateSchema, MARKET_LABELS, planTaskTables, storeTitle } from '@store/shared'
import type {
  DisplayDetectRequest,
  DisplayExport,
  DisplayTask,
  DisplayTaskExportBody,
  DisplayTaskCreate,
  DisplayTaskList,
  DisplayTaskState,
  DisplayTaskUpdate,
} from '@store/shared'
import type { AppConfig } from '../../config/env.ts'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { fileUrl } from '../../lib/file-url.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { registerStoredFile, writeStorageFile } from '../../lib/stored-files.ts'
import {
  buildDisplayFiles,
  deckImage,
  keepExports,
  loadPhotos,
  pendingOf,
  requireRules,
  storeDisplayFiles,
  tableShots,
} from './common.ts'
import { detectTables } from './detect.ts'

const { displayTasks, storedFiles } = schema
type TaskRow = typeof displayTasks.$inferSelect

/** Long side of an uploaded picture; PDF pages are rendered at 2400 px by the browser. */
const MAX_SIDE_PX = 8000

async function requireTask(db: Database, id: string): Promise<TaskRow> {
  const [row] = await db
    .select()
    .from(displayTasks)
    .where(and(eq(displayTasks.id, id), isNull(displayTasks.deletedAt)))
  if (!row) throw notFound('展陈任务')
  return row
}

async function toTask(db: Database, row: TaskRow): Promise<DisplayTask> {
  const ids = [row.planFileId, row.renderFileId].filter((id): id is string => id !== null)
  const files = new Map(
    ids.length
      ? (await db.select().from(storedFiles).where(inArray(storedFiles.id, ids))).map((f) => [
          f.id,
          f,
        ])
      : [],
  )
  const picture = (
    id: string | null,
    width: number | null,
    height: number | null,
    page: number | null,
  ) =>
    id && width && height
      ? { url: fileUrl(id), width, height, page, originalName: files.get(id)?.originalName ?? null }
      : null
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    siStyle: row.siStyle,
    revision: row.revision,
    plan: picture(row.planFileId, row.planWidth, row.planHeight, row.planPage),
    render: picture(row.renderFileId, row.renderWidth, row.renderHeight, row.renderPage),
    state: DisplayTaskStateSchema.parse(row.state),
    exports: row.exports,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listTasks(db: Database, ctx: RequestContext): Promise<DisplayTaskList> {
  authorize(ctx.actor, 'display:read')
  const rows = await db
    .select()
    .from(displayTasks)
    .where(isNull(displayTasks.deletedAt))
    .orderBy(desc(displayTasks.updatedAt))
    .limit(200)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    market: r.market,
    siStyle: r.siStyle,
    updatedAt: r.updatedAt.toISOString(),
    // A row that no longer validates still lists (it shows as having no tables).
    tables: DisplayTaskStateSchema.safeParse(r.state).data?.tables.length ?? 0,
    exported: r.exports.length > 0,
  }))
}

export async function getTask(db: Database, ctx: RequestContext, id: string): Promise<DisplayTask> {
  authorize(ctx.actor, 'display:read')
  return toTask(db, await requireTask(db, id))
}

export async function createTask(
  db: Database,
  ctx: RequestContext,
  input: DisplayTaskCreate,
): Promise<DisplayTask> {
  authorize(ctx.actor, 'display:write')
  const [row] = await db
    .insert(displayTasks)
    .values({ ...input, state: DisplayTaskStateSchema.parse({}) })
    .returning()
  if (!row) throw new Error('Display task insert returned no row')
  return toTask(db, row)
}

/** Saves a change with optimistic locking (If-Match revision). */
async function save(
  db: Database,
  row: TaskRow,
  revision: number,
  values: Partial<typeof displayTasks.$inferInsert>,
): Promise<TaskRow> {
  if (row.revision !== revision) {
    throw new AppError('REVISION_CONFLICT', '展陈任务已被修改，请刷新后再保存', {
      revision: row.revision,
    })
  }
  const [updated] = await db
    .update(displayTasks)
    .set({ ...values, revision: row.revision + 1, updatedAt: new Date() })
    .where(and(eq(displayTasks.id, row.id), eq(displayTasks.revision, revision)))
    .returning()
  if (!updated)
    throw new AppError('REVISION_CONFLICT', '展陈任务已被修改，请刷新后再保存', {
      revision: row.revision + 1,
    })
  return updated
}

export async function updateTask(
  db: Database,
  ctx: RequestContext,
  id: string,
  revision: number,
  input: DisplayTaskUpdate,
): Promise<DisplayTask> {
  authorize(ctx.actor, 'display:write')
  const row = await requireTask(db, id)
  return toTask(db, await save(db, row, revision, input))
}

export async function deleteTask(db: Database, ctx: RequestContext, id: string): Promise<void> {
  authorize(ctx.actor, 'display:write')
  await requireTask(db, id)
  await db.update(displayTasks).set({ deletedAt: new Date() }).where(eq(displayTasks.id, id))
}

/**
 * Stores the plan or the render picture of a task (PNG or JPEG; PDF pages arrive rendered by
 * the browser). A new plan clears the tables found on the old one.
 */
export async function uploadPicture(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  input: {
    id: string
    revision: number
    which: 'plan' | 'render'
    data: Buffer
    contentType: 'image/png' | 'image/jpeg'
    originalName: string | null
    page: number | null
  },
): Promise<DisplayTask> {
  authorize(ctx.actor, 'display:write')
  const row = await requireTask(db, input.id)
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    meta = await sharp(input.data).metadata()
  } catch {
    throw new AppError('VALIDATION_FAILED', '不是有效的图片文件')
  }
  const expected = input.contentType === 'image/png' ? 'png' : 'jpeg'
  if (meta.format !== expected || !meta.width || !meta.height) {
    throw new AppError('VALIDATION_FAILED', `文件内容不是 ${expected.toUpperCase()} 图片`)
  }
  if (meta.width > MAX_SIDE_PX || meta.height > MAX_SIDE_PX) {
    throw new AppError('VALIDATION_FAILED', `图片边长不能超过 ${MAX_SIDE_PX} 像素`)
  }
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const storageKey = `displays/tasks/${row.id}/${input.which}-${sha256.slice(0, 16)}.${expected === 'png' ? 'png' : 'jpg'}`
  await writeStorageFile(roots, storageKey, input.data)
  const fileId = await registerStoredFile(db, {
    storageKey,
    kind: `display-${input.which}`,
    contentType: input.contentType,
    bytes: input.data.length,
    sha256,
    originalName: input.originalName,
  })
  const state = DisplayTaskStateSchema.parse(row.state)
  const values =
    input.which === 'plan'
      ? {
          planFileId: fileId,
          planWidth: meta.width,
          planHeight: meta.height,
          planPage: input.page,
          state: { ...state, tables: [], detection: null, recognition: null },
        }
      : {
          renderFileId: fileId,
          renderWidth: meta.width,
          renderHeight: meta.height,
          renderPage: input.page,
          state: { ...state, tables: state.tables.map((t) => ({ ...t, render: null })) },
        }
  return toTask(db, await save(db, row, input.revision, values))
}

async function readPicture(db: Database, roots: StorageRoots, fileId: string): Promise<Buffer> {
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, fileId))
  if (!file) throw notFound('图片')
  const { file: path } = await resolveStoredFile(
    roots,
    file.root as keyof StorageRoots,
    file.storageKey,
  )
  return readFile(path)
}

/** Finds the tables (local engine for a vector PDF page, else the vision model) and the entrance. */
export async function detect(
  db: Database,
  ctx: RequestContext,
  config: AppConfig,
  roots: StorageRoots,
  id: string,
  revision: number,
  request: DisplayDetectRequest,
): Promise<DisplayTask> {
  authorize(ctx.actor, 'display:write')
  const row = await requireTask(db, id)
  if (!row.planFileId || !row.planWidth || !row.planHeight) {
    throw new AppError('INVALID_STATE', '请先上传平面图')
  }
  const rules = (await requireRules(db)).rules
  const plan = {
    data: await readPicture(db, roots, row.planFileId),
    width: row.planWidth,
    height: row.planHeight,
  }
  const render =
    row.renderFileId && row.renderWidth && row.renderHeight
      ? {
          data: await readPicture(db, roots, row.renderFileId),
          width: row.renderWidth,
          height: row.renderHeight,
        }
      : null
  const found = await detectTables(db, config, {
    taskId: row.id,
    rules,
    market: row.market,
    siStyle: row.siStyle,
    plan,
    render,
    vector: request.vector,
    useModel: request.useModel,
  })
  const state: DisplayTaskState = {
    ...DisplayTaskStateSchema.parse(row.state),
    tables: found.tables,
    entrance: found.entrance,
    detection: { method: found.method, notes: found.notes, at: new Date().toISOString() },
    recognition: found.recognition,
  }
  return toTask(db, await save(db, row, revision, { state }))
}

/** Builds and stores the PPT and checklist of a task. */
export async function exportTask(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  id: string,
  options: DisplayTaskExportBody,
): Promise<DisplayExport> {
  authorize(ctx.actor, 'display:write')
  const row = await requireTask(db, id)
  if (!row.planFileId) throw new AppError('INVALID_STATE', '请先上传平面图')
  const state = DisplayTaskStateSchema.parse(row.state)
  if (!state.tables.some((t) => t.kind === 'island') && !state.tables.length) {
    throw new AppError('INVALID_STATE', '平面图上还没有中岛桌或边桌，请先识别或手动添加')
  }
  const ruleSet = await requireRules(db)
  const rules = ruleSet.rules
  const tables = planTaskTables(rules, {
    market: row.market,
    siStyle: row.siStyle,
    plan: row.planWidth && row.planHeight ? { width: row.planWidth, height: row.planHeight } : null,
    state,
  })
  const byId = new Map(state.tables.map((t) => [t.id, t]))
  const plan = await deckImage(await readPicture(db, roots, row.planFileId), 2400)
  const render = row.renderFileId
    ? await deckImage(await readPicture(db, roots, row.renderFileId), 1600)
    : null
  const renderMarks = Object.fromEntries(
    tables.flatMap((t) => {
      const mark = byId.get(t.sourceId)?.render
      return mark ? [[t.label, mark]] : []
    }),
  )
  const planMarks = Object.fromEntries(
    tables.flatMap((t) => {
      const table = byId.get(t.sourceId)
      return table ? [[t.label, { x: table.x, y: table.y }]] : []
    }),
  )
  const islands = tables.filter((t) => t.kind === 'island')
  const files = await buildDisplayFiles({
    name: row.name,
    title: storeTitle(row.name),
    date: new Date().toISOString().slice(0, 10),
    market: row.market,
    subtitle: [
      row.siStyle,
      MARKET_LABELS[row.market],
      `中岛桌 ${islands.length} 张${islands[0] ? `（${islands[0].orientation === 'portrait' ? '竖版' : '横版'}）` : ''}`,
      ...(tables.length > islands.length ? [`边桌 ${tables.length - islands.length} 张`] : []),
    ].join(' · '),
    rules,
    tables,
    plan,
    planMarks,
    overview: render ? { image: render, marks: renderMarks } : null,
    tableViews: Object.fromEntries(
      tables.map((t) => {
        const mark = renderMarks[t.label]
        return [t.label, render && mark ? { image: render, mark } : undefined]
      }),
    ),
    photos: await loadPhotos(roots, rules, row.siStyle, tables),
    landscapeEnd: state.edits.landscapeEnd,
    views: options.views,
    tables3d: await tableShots(tables, options.tables3d),
    pending: pendingOf(tables, rules, row.siStyle),
  })
  const record = await storeDisplayFiles(
    db,
    roots,
    `displays/tasks/${row.id}`,
    files,
    ruleSet.version,
  )
  await db
    .update(displayTasks)
    .set({ exports: keepExports(row.exports, record), updatedAt: new Date() })
    .where(eq(displayTasks.id, row.id))
  return record
}
