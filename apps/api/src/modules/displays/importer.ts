import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { desc } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { checkRules, diffRules } from '@store/shared'
import type { DisplayRules } from '@store/shared'
import { contentTypeFor, isLfsPointer, resolveStoredFile, sha256File } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { DISPLAY_RESOURCE_DIR, DISPLAY_WORKBOOK, parseDisplayWorkbook } from './workbook.ts'

const { displayRuleSets, storedFiles } = schema

export interface DisplayImportReport {
  /** imported: a new version is in force; unchanged: the same workbook was imported before. */
  status: 'imported' | 'unchanged' | 'rejected'
  version: string | null
  problems: string[]
  /** Changes against the version in force before, empty for the first import. */
  changes: string[]
  photos: number
  missingPhotos: string[]
}

/** The rule set in force: the newest import. */
export async function currentDisplayRules(db: Database) {
  const [row] = await db
    .select()
    .from(displayRuleSets)
    .orderBy(desc(displayRuleSets.importedAt))
    .limit(1)
  return row ?? null
}

/**
 * Imports 资源库/10_产品与陈列/展陈规则.xlsx (`pnpm display:import`). The workbook must pass
 * checkRules, in particular every layout must add up to the guide's own counts; otherwise
 * nothing is written. Photos are registered in place (root 'resource'). Re-importing the same
 * workbook changes nothing.
 */
export async function importDisplayRules(
  db: Database,
  roots: StorageRoots,
): Promise<DisplayImportReport> {
  const { file } = await resolveStoredFile(roots, 'resource', DISPLAY_WORKBOOK)
  const data = await readFile(file)
  const sourceSha256 = createHash('sha256').update(data).digest('hex')
  const parsed = await parseDisplayWorkbook(data)
  const report: DisplayImportReport = {
    status: 'rejected',
    version: parsed.rules?.version ?? null,
    problems: parsed.problems,
    changes: [],
    photos: 0,
    missingPhotos: [],
  }
  if (!parsed.rules) return report
  const problems = checkRules(parsed.rules)
  if (problems.length) {
    report.problems = problems
    return report
  }

  const previous = await currentDisplayRules(db)
  if (previous?.sourceSha256 === sourceSha256) {
    report.status = 'unchanged'
    report.photos = previous.rules.photos.filter((p) => p.fileId).length
    return report
  }

  const rules: DisplayRules = { ...parsed.rules, photos: [] }
  for (const photo of parsed.rules.photos) {
    const key = `${DISPLAY_RESOURCE_DIR}/${photo.file}`
    let fileId: string | null = null
    try {
      const resolved = await resolveStoredFile(roots, 'resource', key)
      if (await isLfsPointer(resolved.file, resolved.bytes)) throw new Error('lfs pointer')
      const [row] = await db
        .insert(storedFiles)
        .values({
          root: 'resource',
          storageKey: key,
          kind: 'display-photo',
          contentType: contentTypeFor(key),
          bytes: resolved.bytes,
          sha256: await sha256File(resolved.file),
        })
        .onConflictDoUpdate({
          target: [storedFiles.root, storedFiles.storageKey],
          set: { kind: 'display-photo' },
        })
        .returning({ id: storedFiles.id })
      fileId = row?.id ?? null
    } catch {
      report.missingPhotos.push(photo.file)
    }
    rules.photos.push({ ...photo, fileId })
    if (fileId) report.photos++
  }
  report.changes = previous ? diffRules(previous.rules, rules) : []
  await db.insert(displayRuleSets).values({ version: rules.version, sourceSha256, rules })
  report.status = 'imported'
  return report
}
