import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/** Widths a caller may ask for; a model card shows its picture at 56 × 42 CSS px. */
export const THUMBNAIL_WIDTHS = ['160', '480'] as const
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number]

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function canThumbnail(contentType: string): boolean {
  return RASTER_TYPES.has(contentType)
}

/**
 * A downscaled WebP of a raster image, made on first request and kept under `<storage>/thumbs`
 * by content hash. Like the light models it is not in Git: every machine makes its own.
 */
export async function thumbnail(
  storageRoot: string,
  source: string,
  sha256: string,
  width: ThumbnailWidth,
): Promise<{ file: string; bytes: number }> {
  const dir = path.join(storageRoot, 'thumbs')
  const file = path.join(dir, `${sha256}-w${width}.webp`)
  const existing = await stat(file).catch(() => null)
  if (existing?.isFile()) return { file, bytes: existing.size }
  await mkdir(dir, { recursive: true })
  // Written aside and renamed, so a parallel request never reads a half-written file.
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await sharp(source)
      .resize({ width: Number(width), withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(temp)
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true })
  }
  const info = await stat(file)
  return { file, bytes: info.size }
}
