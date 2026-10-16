import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { desc, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type {
  NodeCreated,
  PlanUpload,
  RecognitionConfirm,
  RecognitionDraft,
  RecognitionRun,
  RecognizeRequest,
  RecognizeResponse,
  VectorContent,
} from '@store/shared'
import { chat } from '../../ai/chat.ts'
import { LOCAL_MODEL_ID, findModel } from '../../ai/models.ts'
import { readSettings } from '../../ai/settings.ts'
import type { AppConfig } from '../../config/env.ts'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { catalogAssets } from '../assets/service.ts'
import { fileUrl } from '../../lib/file-url.ts'
import { registerStoredFile, writeStorageFile } from '../../lib/stored-files.ts'
import { createNode, requireActiveProject } from '../nodes/service.ts'
import { checkDraft, failureReason } from './check.ts'
import { RELATIVE, answerToDraft, buildPrompt, parseAnswer, toPixels } from './llm.ts'
import { recognizeVector } from './local.ts'
import { cachedDimensionChains, readDimensionChains } from './ocr.ts'
import type { ChainReading } from './ocr.ts'

const { planUploads, projects, recognitionRuns, storedFiles } = schema
type UploadRow = typeof planUploads.$inferSelect
type RunRow = typeof recognitionRuns.$inferSelect

const MAX_SIDE_PX = 8192
/** Pictures are shrunk to this before they go to a model: enough to read, fewer tokens. */
const MODEL_SIDE_PX = 2000

function toUpload(row: UploadRow, originalName: string | null): PlanUpload {
  return {
    id: row.id,
    projectId: row.projectId,
    fileId: row.fileId,
    url: fileUrl(row.fileId),
    originalName,
    page: row.page,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  }
}

function toRun(row: RunRow): RecognitionRun {
  return {
    id: row.id,
    uploadId: row.uploadId,
    method: row.method as RecognitionRun['method'],
    provider: row.provider,
    model: row.model,
    status: row.status as RecognitionRun['status'],
    draft: row.draft ?? null,
    error: row.error,
    fallbackOf: row.fallbackOf,
    confirmedNodeId: row.confirmedNodeId,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

async function findUpload(db: Database, uploadId: string): Promise<UploadRow> {
  const [row] = await db.select().from(planUploads).where(eq(planUploads.id, uploadId))
  if (!row) throw notFound('上传的简图')
  return row
}

export interface UploadInput {
  projectId: string
  data: Buffer
  contentType: 'image/png' | 'image/jpeg'
  originalName: string | null
  page: number | null
}

/** Stores an uploaded plan picture (a PDF page is rendered by the browser first). */
export async function uploadPlan(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  input: UploadInput,
): Promise<PlanUpload> {
  authorize(ctx.actor, 'recognition:write', { projectId: input.projectId })
  await requireActiveProject(db, input.projectId)
  let width: number | undefined
  let height: number | undefined
  let format: string | undefined
  try {
    ;({ width, height, format } = await sharp(input.data).metadata())
  } catch {
    throw new AppError('VALIDATION_FAILED', '不是有效的图片文件')
  }
  const expected = input.contentType === 'image/png' ? 'png' : 'jpeg'
  if (format !== expected || !width || !height) {
    throw new AppError('VALIDATION_FAILED', `文件内容不是 ${expected.toUpperCase()} 图片`)
  }
  if (width > MAX_SIDE_PX || height > MAX_SIDE_PX) {
    throw new AppError('VALIDATION_FAILED', `图片边长不能超过 ${MAX_SIDE_PX} 像素`)
  }
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const ext = expected === 'png' ? 'png' : 'jpg'
  const storageKey = `uploads/${input.projectId}/${sha256.slice(0, 16)}.${ext}`
  await writeStorageFile(roots, storageKey, input.data)

  const row = await db.transaction(async (tx) => {
    const storedId = await registerStoredFile(tx, {
      storageKey,
      kind: 'upload',
      contentType: input.contentType,
      bytes: input.data.length,
      sha256,
      originalName: input.originalName,
    })
    const [inserted] = await tx
      .insert(planUploads)
      .values({ projectId: input.projectId, fileId: storedId, page: input.page, width, height })
      .returning()
    if (!inserted) throw new Error('Upload insert returned no row')
    return inserted
  })
  return toUpload(row, input.originalName)
}

export async function listUploads(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<PlanUpload[]> {
  authorize(ctx.actor, 'recognition:read', { projectId })
  const rows = await db
    .select({ upload: planUploads, name: storedFiles.originalName })
    .from(planUploads)
    .innerJoin(storedFiles, eq(storedFiles.id, planUploads.fileId))
    .where(eq(planUploads.projectId, projectId))
    .orderBy(desc(planUploads.createdAt))
    .limit(20)
  return rows.map((r) => toUpload(r.upload, r.name))
}

interface RunInput {
  uploadId: string
  method: 'local' | 'llm'
  provider: string
  model: string
  draft: RecognitionDraft | null
  error: string | null
  fallbackOf: string | null
}

async function saveRun(db: Database, input: RunInput): Promise<RunRow> {
  const [row] = await db
    .insert(recognitionRuns)
    .values({
      uploadId: input.uploadId,
      method: input.method,
      provider: input.provider,
      model: input.model,
      status: input.error ? 'failed' : 'succeeded',
      draft: input.draft,
      scale: input.draft?.scale ?? null,
      confidence: input.draft?.confidence ?? null,
      error: input.error,
      fallbackOf: input.fallbackOf,
      finishedAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('Run insert returned no row')
  return row
}

async function recognizeWithModel(
  db: Database,
  config: AppConfig,
  roots: StorageRoots,
  upload: UploadRow,
  modelId: string,
  request: RecognizeRequest,
  catalog: Awaited<ReturnType<typeof catalogAssets>>,
  siStyle: string,
): Promise<{ draft: RecognitionDraft; provider: string }> {
  const spec = findModel(modelId)
  if (!spec || spec.provider === 'local' || !spec.vision) {
    throw new AppError(
      'VALIDATION_FAILED',
      '没有可用的平面识别模型（需要能看图的联网模型），请到设置中选择',
    )
  }
  const [stored] = await db.select().from(storedFiles).where(eq(storedFiles.id, upload.fileId))
  if (!stored) throw notFound('简图文件')
  const { file } = await resolveStoredFile(roots, 'storage', stored.storageKey)
  const original = await readFile(file)
  const longest = Math.max(upload.width, upload.height)
  const shrink = longest > MODEL_SIDE_PX ? MODEL_SIDE_PX / longest : 1
  const sent =
    shrink < 1
      ? await sharp(original)
          .resize({ width: Math.round(upload.width * shrink) })
          .png()
          .toBuffer()
      : original
  // The model answers in relative coordinates; the crop is given to it the same way.
  const relative = (v: number, size: number) => (v / size) * RELATIVE
  const prompt = buildPrompt(
    [...catalog.values()],
    request.crop
      ? {
          x: relative(request.crop.x, upload.width),
          y: relative(request.crop.y, upload.height),
          w: relative(request.crop.w, upload.width),
          h: relative(request.crop.h, upload.height),
        }
      : undefined,
  )
  const result = await chat(db, config, {
    purpose: 'recognition',
    modelId,
    json: true,
    maxTokens: 6000,
    ref: { type: 'plan_upload', id: upload.id },
    messages: [
      { role: 'system', content: prompt.system },
      {
        role: 'user',
        content: prompt.user,
        images: [
          {
            mediaType:
              shrink < 1 || stored.contentType === 'image/png' ? 'image/png' : 'image/jpeg',
            base64: sent.toString('base64'),
          },
        ],
      },
    ],
  })
  const { answer, scale } = toPixels(parseAnswer(result.text), upload.width, upload.height)
  const draft = checkDraft(
    answerToDraft(answer, [...catalog.values()], request.calibration, siStyle, scale),
  )
  draft.notes.push(
    `模型 ${spec.label}，${result.tokensIn + result.tokensOut} token，${result.costCny.toFixed(4)} 元`,
  )
  return { draft, provider: spec.provider }
}

/**
 * The dimension chains of an upload's page with their numbers, read on this machine (OCR of the
 * picture where the vector content has the chains). A failure only costs the scale its best
 * evidence: it is noted, not raised.
 */
async function uploadChains(
  db: Database,
  roots: StorageRoots,
  upload: UploadRow,
  vector: VectorContent,
): Promise<{ chains: ChainReading[]; note: string | null }> {
  try {
    const chains = await cachedDimensionChains(
      `${upload.id}:${vector.width}x${vector.height}:${vector.lines.length}`,
      async () => {
        const [stored] = await db
          .select()
          .from(storedFiles)
          .where(eq(storedFiles.id, upload.fileId))
        if (!stored) return []
        const { file } = await resolveStoredFile(roots, 'storage', stored.storageKey)
        return readDimensionChains(await readFile(file), vector)
      },
    )
    return { chains, note: null }
  } catch (error) {
    return {
      chains: [],
      note: `尺寸数字没能读取（${error instanceof Error ? error.message : String(error)}），比例改用其他依据`,
    }
  }
}

/**
 * Reads an upload: locally from the vector content when the setting says so (and the browser
 * could extract any), otherwise with the chosen model. A local attempt that fails the rules
 * (scale, closed boundary, confidence) is kept and the fallback model takes over.
 */
export async function recognize(
  db: Database,
  ctx: RequestContext,
  config: AppConfig,
  roots: StorageRoots,
  uploadId: string,
  request: RecognizeRequest,
): Promise<RecognizeResponse> {
  const upload = await findUpload(db, uploadId)
  authorize(ctx.actor, 'recognition:write', { projectId: upload.projectId })
  await requireActiveProject(db, upload.projectId)
  const settings = await readSettings(db, config.ai)
  const catalog = await catalogAssets(db)
  const [project] = await db
    .select({ siStyle: projects.siStyle })
    .from(projects)
    .where(eq(projects.id, upload.projectId))
  const siStyle = project?.siStyle ?? 'SI1.0'
  const method = request.method ?? (settings.recognitionModel === LOCAL_MODEL_ID ? 'local' : 'llm')

  if (method === 'local') {
    let draft: RecognitionDraft | null = null
    let reason: string
    if (request.vector) {
      const { chains, note } = await uploadChains(db, roots, upload, request.vector)
      draft = checkDraft(
        recognizeVector(request.vector, request, [...catalog.values()], siStyle, chains),
      )
      if (note) draft.notes.push(note)
      reason = failureReason(draft) ?? ''
    } else {
      reason = '图片没有可读的矢量内容（本地识别只能读矢量 PDF）'
    }
    const attempted = await saveRun(db, {
      uploadId,
      method: 'local',
      provider: 'local',
      model: LOCAL_MODEL_ID,
      draft,
      error: reason || null,
      fallbackOf: null,
    })
    if (!reason) return { run: toRun(attempted), attempted: null }
    const fallback = settings.recognitionFallback
    if (!fallback) return { run: toRun(attempted), attempted: null }
    const { draft: modelDraft, provider } = await recognizeWithModel(
      db,
      config,
      roots,
      upload,
      fallback,
      request,
      catalog,
      siStyle,
    )
    modelDraft.notes.unshift(`本地识别未通过（${reason}），已改用模型识别`)
    const run = await saveRun(db, {
      uploadId,
      method: 'llm',
      provider,
      model: fallback,
      draft: modelDraft,
      error: failureReason(modelDraft),
      fallbackOf: attempted.id,
    })
    return { run: toRun(run), attempted: toRun(attempted) }
  }

  const modelId =
    settings.recognitionModel !== LOCAL_MODEL_ID
      ? settings.recognitionModel
      : settings.recognitionFallback
  if (!modelId) {
    throw new AppError('VALIDATION_FAILED', '没有可用的平面识别模型，请到设置中选择或配置密钥')
  }
  const { draft, provider } = await recognizeWithModel(
    db,
    config,
    roots,
    upload,
    modelId,
    request,
    catalog,
    siStyle,
  )
  const run = await saveRun(db, {
    uploadId,
    method: 'llm',
    provider,
    model: modelId,
    draft,
    error: failureReason(draft),
    fallbackOf: null,
  })
  return { run: toRun(run), attempted: null }
}

export async function listRuns(
  db: Database,
  ctx: RequestContext,
  uploadId: string,
): Promise<RecognitionRun[]> {
  const upload = await findUpload(db, uploadId)
  authorize(ctx.actor, 'recognition:read', { projectId: upload.projectId })
  const rows = await db
    .select()
    .from(recognitionRuns)
    .where(eq(recognitionRuns.uploadId, uploadId))
    .orderBy(desc(recognitionRuns.createdAt))
  return rows.map(toRun)
}

export async function getRun(
  db: Database,
  ctx: RequestContext,
  runId: string,
): Promise<RecognitionRun> {
  const [row] = await db.select().from(recognitionRuns).where(eq(recognitionRuns.id, runId))
  if (!row) throw notFound('识别记录')
  const upload = await findUpload(db, row.uploadId)
  authorize(ctx.actor, 'recognition:read', { projectId: upload.projectId })
  return toRun(row)
}

/**
 * The user has corrected the drawing: the space (and the props kept) become a root space
 * node with origin `recognition`, so the history shows where it came from.
 *
 * One transaction: the run row is locked while the "already confirmed" check runs, and the
 * node is never left behind without the run pointing at it.
 */
export async function confirmRun(
  db: Database,
  ctx: RequestContext,
  runId: string,
  input: RecognitionConfirm,
): Promise<NodeCreated> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(recognitionRuns)
      .where(eq(recognitionRuns.id, runId))
      .for('update')
    if (!row) throw notFound('识别记录')
    const upload = await findUpload(tx, row.uploadId)
    authorize(ctx.actor, 'recognition:write', { projectId: upload.projectId })
    if (row.confirmedNodeId) {
      throw new AppError('INVALID_STATE', '这次识别已经确认过，生成了空间节点')
    }
    const created = await createNode(
      tx,
      ctx,
      upload.projectId,
      {
        parentId: null,
        kind: 'space',
        name: input.name,
        space: input.space,
        ...(input.layout ? { layout: input.layout } : {}),
      },
      { origin: 'recognition', originRef: row.id },
    )
    await tx
      .update(recognitionRuns)
      .set({ confirmedNodeId: created.node.id })
      .where(eq(recognitionRuns.id, runId))
    return created
  })
}
