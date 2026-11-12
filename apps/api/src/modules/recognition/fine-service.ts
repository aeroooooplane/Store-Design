import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { and, desc, eq, like } from 'drizzle-orm'
import sharp from 'sharp'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { registerStoredFile, writeStorageFile } from '../../lib/stored-files.ts'
import { createNode, requireActiveProject } from '../nodes/service.ts'
import { extractFineGeometry } from './fine-geometry.ts'
import type { FineGeometry } from './fine-geometry.ts'
import { readPageTexts } from './ocr.ts'
import { FineDraftSchema } from './fine-contract.ts'
import type { FineDraft } from './fine-contract.ts'
import { convertFine } from './fine-convert.ts'
const { planUploads, storedFiles } = schema
export interface FineRecord {
  schemaVersion: 1
  revision: number
  uploadId: string
  sourceSha256: string
  raw: FineGeometry
  draft: FineDraft
  elapsedSeconds: number
  createdAt: string
  savedAt: string
  confirmedNodeId: string | null
  cloudRequests: 0
}
async function upload(db: Database, ctx: RequestContext, id: string, write = false) {
  const [u] = await db.select().from(planUploads).where(eq(planUploads.id, id))
  if (!u) throw notFound('上传图纸')
  authorize(ctx.actor, write ? 'recognition:write' : 'recognition:read', { projectId: u.projectId })
  if (write) await requireActiveProject(db, u.projectId)
  return u
}
async function latest(db: Database, roots: StorageRoots, id: string): Promise<FineRecord | null> {
  const [f] = await db
    .select()
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.kind, 'fine-recognition'),
        like(storedFiles.storageKey, `fine-recognition/${id}/%`),
      ),
    )
    .orderBy(desc(storedFiles.storageKey))
    .limit(1)
  if (!f) return null
  const resolved = await resolveStoredFile(roots, 'storage', f.storageKey)
  return JSON.parse(await readFile(resolved.file, 'utf8')) as FineRecord
}
async function persist(db: Database, roots: StorageRoots, r: FineRecord) {
  const bytes = Buffer.from(JSON.stringify(r)),
    storageKey = `fine-recognition/${r.uploadId}/${String(r.revision).padStart(10, '0')}-${randomUUID()}.json`
  await writeStorageFile(roots, storageKey, bytes)
  await registerStoredFile(db, {
    storageKey,
    kind: 'fine-recognition',
    contentType: 'application/json',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    originalName: '精细几何草稿与自动原始记录.json',
  })
  return r
}
export async function getFine(db: Database, ctx: RequestContext, roots: StorageRoots, id: string) {
  await upload(db, ctx, id)
  return latest(db, roots, id)
}
let extracting = false
export async function extractFine(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  id: string,
) {
  const u = await upload(db, ctx, id, true),
    old = await latest(db, roots, id)
  if (old) return old
  if (u.width > 4000 || u.height > 4000 || u.width * u.height > 12_000_000)
    throw new AppError(
      'VALIDATION_FAILED',
      '精细提取支持边长4000像素、总像素1200万以内；请先裁出目标图面',
    )
  if (extracting) throw new AppError('INVALID_STATE', '本机正在精细提取，请稍后重试')
  extracting = true
  try {
    const started = performance.now(),
      [f] = await db.select().from(storedFiles).where(eq(storedFiles.id, u.fileId))
    if (!f) throw notFound('图纸文件')
    const file = await resolveStoredFile(roots, 'storage', f.storageKey),
      bytes = await readFile(file.file)
    const { data, info } = await sharp(bytes)
      .flatten({ background: '#fff' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const first = extractFineGeometry(data, info.width, info.height)
    const image = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 1 },
    })
      .negate(first.inverted)
      .png()
      .toBuffer()
    const texts = await readPageTexts(image, {
      width: info.width,
      height: info.height,
      texts: [],
      rects: [],
      lines: first.lines.map((l) => ({
        x1: l.a[0],
        y1: l.a[1],
        x2: l.b[0],
        y2: l.b[1],
        w: l.width,
      })),
    })
    const raw = extractFineGeometry(data, info.width, info.height, texts),
      now = new Date().toISOString()
    const record: FineRecord = {
      schemaVersion: 1,
      revision: 0,
      uploadId: id,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      raw,
      draft: {
        objects: raw.candidates.map((c) => ({
          id: c.id,
          candidateId: c.id,
          kind: c.kind,
          label: c.label || '待确认',
          points: c.geometry.points,
          status: 'pending',
          heightMm: null,
        })),
        boundary: [],
        calibration: null,
        heightMm: null,
        openEdges: [],
        entrances: [],
        structureReviewed: false,
        reviewer: '',
        notes: '',
      },
      elapsedSeconds: (performance.now() - started) / 1000,
      createdAt: now,
      savedAt: now,
      confirmedNodeId: null,
      cloudRequests: 0,
    }
    return db.transaction(async (tx) => {
      await tx.select().from(planUploads).where(eq(planUploads.id, id)).for('update')
      const existing = await latest(tx, roots, id)
      return existing ?? persist(tx, roots, record)
    })
  } finally {
    extracting = false
  }
}
export async function saveFine(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  id: string,
  revision: number,
  input: FineDraft,
  confirm?: { name: string; acknowledgedOmissions: string[] },
) {
  const u = await upload(db, ctx, id, true),
    draft = FineDraftSchema.parse(input)
  const ids = new Set<string>()
  for (const o of draft.objects) {
    if (ids.has(o.id)) throw new AppError('VALIDATION_FAILED', '对象编号重复')
    ids.add(o.id)
  }
  const points = [
    ...draft.boundary,
    ...draft.objects.flatMap((o) => o.points),
    ...draft.entrances.flatMap((e) => [e.a, e.b]),
    ...(draft.calibration ? [draft.calibration.a, draft.calibration.b] : []),
  ]
  if (points.some((p) => p[0] > u.width || p[1] > u.height))
    throw new AppError('VALIDATION_FAILED', '坐标超出原图')
  return db.transaction(async (tx) => {
    await tx.select().from(planUploads).where(eq(planUploads.id, id)).for('update')
    const old = await latest(tx, roots, id)
    if (!old) throw notFound('精细识别草稿')
    if (old.confirmedNodeId)
      throw new AppError('INVALID_STATE', '此草稿已生成空间，请在空间编辑器继续修改')
    if (old.revision !== revision)
      throw new AppError('REVISION_CONFLICT', '草稿已更新，请重新读取，避免覆盖他人的修改')
    const candidateIds = new Set(old.raw.candidates.map((c) => c.id))
    for (const o of draft.objects)
      if (o.candidateId && !candidateIds.has(o.candidateId))
        throw new AppError('VALIDATION_FAILED', '对象引用了不存在的自动候选')
    let nodeId: string | null = null
    if (confirm) {
      const converted = convertFine(draft),
        expected = converted.omissions.map((o) => o.id).sort()
      if (
        JSON.stringify([...new Set(confirm.acknowledgedOmissions)].sort()) !==
        JSON.stringify(expected)
      )
        throw new AppError('VALIDATION_FAILED', '请核对并明确保留二维的对象清单')
      const created = await createNode(
        tx,
        ctx,
        u.projectId,
        {
          parentId: null,
          kind: 'space',
          name: confirm.name,
          space: converted.space,
          layout: converted.layout,
        },
        { origin: 'recognition', originRef: id },
      )
      nodeId = created.node.id
    }
    return persist(tx, roots, {
      ...old,
      draft,
      revision: old.revision + 1,
      savedAt: new Date().toISOString(),
      confirmedNodeId: nodeId,
    })
  })
}
