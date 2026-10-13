import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { StorageRoots } from './storage.ts'

const { storedFiles } = schema

/** Writes app data (renders, uploads, pictures) under STORAGE_ROOT at its key. */
export async function writeStorageFile(
  roots: StorageRoots,
  storageKey: string,
  data: Buffer,
): Promise<void> {
  const file = path.resolve(roots.storage, storageKey)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
}

/**
 * Registers a file written with writeStorageFile and returns its id. The same key registered
 * twice (the same bytes uploaded again) is one row. Works inside a transaction too.
 */
export async function registerStoredFile(
  db: Database,
  file: {
    storageKey: string
    kind: string
    contentType: string
    bytes: number
    sha256: string
    originalName: string | null
  },
): Promise<string> {
  await db
    .insert(storedFiles)
    .values({ root: 'storage', ...file })
    .onConflictDoNothing()
  const [stored] = await db
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(and(eq(storedFiles.root, 'storage'), eq(storedFiles.storageKey, file.storageKey)))
  if (!stored) throw new Error('Stored file row missing after insert')
  return stored.id
}
