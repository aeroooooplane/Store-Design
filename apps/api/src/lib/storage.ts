import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from './app-error.ts'

/** Absolute directories behind `stored_files.root`. */
export interface StorageRoots {
  /** Files written by the app (renders, uploads, deliveries). */
  storage: string
  /** The checked-in 资源库 (models, previews, drawings); read-only for the app. */
  resource: string
}
export type StorageRootName = keyof StorageRoots

export const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
}

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function inside(base: string, file: string): boolean {
  const relative = path.relative(base, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Resolves a stored key to a real file under its root. Symlinks and `..` cannot escape the root,
 * even if a database row were tampered with.
 */
export async function resolveStoredFile(
  roots: StorageRoots,
  root: StorageRootName,
  key: string,
): Promise<{ file: string; bytes: number }> {
  const base = roots[root]
  let realBase: string
  let file: string
  try {
    realBase = await realpath(base)
    file = await realpath(path.resolve(base, key))
  } catch {
    throw new AppError('NOT_FOUND', '文件不存在')
  }
  if (!inside(realBase, file)) throw new AppError('FORBIDDEN', '文件不在允许的目录中')
  const info = await stat(file)
  if (!info.isFile()) throw new AppError('NOT_FOUND', '文件不存在')
  return { file, bytes: info.size }
}

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec'

/** A Git LFS pointer is a tiny text stub left behind when the real object was not pulled. */
export async function isLfsPointer(file: string, bytes: number): Promise<boolean> {
  if (bytes > 1024) return false
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(LFS_POINTER_PREFIX.length)
    await handle.read(buffer, 0, buffer.length, 0)
    return buffer.toString('utf8') === LFS_POINTER_PREFIX
  } finally {
    await handle.close()
  }
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}
