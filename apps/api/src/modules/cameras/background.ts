import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { MAX_BACKGROUND_BYTES } from '@store/shared'
import type { BackgroundImage } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { fileUrl } from '../../lib/file-url.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import { registerStoredFile } from '../../lib/stored-files.ts'
import { findNode, requireActiveProject } from '../nodes/repository.ts'

export async function uploadBackgroundImage(
  db: Database,
  ctx: RequestContext,
  roots: StorageRoots,
  cameraId: string,
  image: Buffer,
): Promise<BackgroundImage> {
  const [camera] = await db
    .select()
    .from(schema.nodeCameras)
    .where(eq(schema.nodeCameras.id, cameraId))
  if (!camera) throw notFound('视角')
  const node = await findNode(db, camera.nodeId)
  authorize(ctx.actor, 'camera:write', { projectId: node.projectId })
  await requireActiveProject(db, node.projectId)
  if (node.kind !== 'render' || camera.deletedAt) {
    throw new AppError('INVALID_STATE', '请在有效渲染视角添加背景图片')
  }
  if (!image.length || image.length > MAX_BACKGROUND_BYTES) {
    throw new AppError('VALIDATION_FAILED', '背景图片需小于16MiB')
  }
  let pixels: Buffer
  let width: number
  let height: number
  try {
    const pipeline = sharp(image, { limitInputPixels: 40_000_000 })
    const meta = await pipeline.metadata()
    if (!['png', 'jpeg'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) {
      throw new Error('unsupported image')
    }
    const normalized = await pipeline
      .rotate()
      .resize({
        width: 8192,
        height: 8192,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    pixels = normalized.data
    width = normalized.info.width
    height = normalized.info.height
    if (pixels.length > MAX_BACKGROUND_BYTES) throw new Error('normalized image too large')
  } catch {
    throw new AppError('VALIDATION_FAILED', '请选用可读取的PNG或JPEG图片，解码后需小于16MiB')
  }
  const sha256 = createHash('sha256').update(pixels).digest('hex')
  const storageKey = `backgrounds/${node.projectId}/${sha256}.png`
  await publishBackgroundFile(roots, storageKey, pixels, sha256)
  const fileId = await registerStoredFile(db, {
    storageKey,
    kind: 'render-background',
    contentType: 'image/png',
    bytes: pixels.length,
    sha256,
    originalName: '背景图片.png',
  })
  return { fileId, url: fileUrl(fileId), width, height, name: '背景图片.png' }
}

export async function validateBackgroundImage(
  db: Database,
  projectId: string,
  image: BackgroundImage,
  roots: StorageRoots,
) {
  const [file] = await db
    .select()
    .from(schema.storedFiles)
    .where(eq(schema.storedFiles.id, image.fileId))
  if (
    !file ||
    file.kind !== 'render-background' ||
    file.root !== 'storage' ||
    !file.storageKey.startsWith(`backgrounds/${projectId}/`) ||
    image.url !== fileUrl(file.id)
  ) {
    throw new AppError('VALIDATION_FAILED', '背景图片不属于当前项目，请重新上传')
  }
  const resolved = await resolveStoredFile(roots, 'storage', file.storageKey)
  const meta = await sharp(resolved.file).metadata()
  if (meta.width !== image.width || meta.height !== image.height) {
    throw new AppError('VALIDATION_FAILED', '背景尺寸与原图不一致，请重新上传')
  }
}

/** Complete the immutable image before making its path visible to readers. */
async function publishBackgroundFile(
  roots: StorageRoots,
  key: string,
  pixels: Buffer,
  sha256: string,
) {
  const file = path.join(roots.storage, key)
  try {
    const existing = await readFile(file)
    if (createHash('sha256').update(existing).digest('hex') !== sha256) {
      throw new Error('Stored background checksum mismatch')
    }
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, pixels, { flag: 'wx' })
    try {
      await rename(temporary, file)
    } catch (error) {
      // Another uploader may already have published the same complete content on Windows.
      const existing = await readFile(file).catch(() => null)
      if (!existing || createHash('sha256').update(existing).digest('hex') !== sha256) throw error
    }
  } finally {
    await rm(temporary, { force: true })
  }
}
