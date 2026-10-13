/** Addresses of registered files; they are served only by id (modules/files/routes.ts). */
export function fileUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`
}

/**
 * A library file's address with its content hash: a browser may keep it for good, because a
 * changed file gets another address.
 */
export function versionedFileUrl(fileId: string, sha256: string): string {
  return `${fileUrl(fileId)}?v=${sha256.slice(0, 16)}`
}
