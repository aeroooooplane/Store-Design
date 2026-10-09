import { AppError } from './app-error.ts'

/** ETag value for a revision number. */
export function etag(revision: number): string {
  return `"${revision}"`
}

/**
 * Writes must name the revision they were based on (`If-Match: "3"`), so that a stale
 * browser tab cannot silently overwrite someone else's change.
 */
export function requireRevision(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw new AppError('REVISION_REQUIRED', '缺少 If-Match 版本号，请刷新后重试')
  }
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim())
  const revision = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AppError('VALIDATION_FAILED', 'If-Match 版本号格式无效')
  }
  return revision
}
