import { createReadStream } from 'node:fs'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { ApiErrorSchema } from '@store/shared'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { isLfsPointer, resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots, StorageRootName } from '../../lib/storage.ts'

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

/** Streams a registered file by id; there is no path-based access. */
export const fileRoutes: FastifyPluginAsyncZod<{ db: Database; roots: StorageRoots }> = async (
  app,
  { db, roots },
) => {
  app.get(
    '/files/:fileId',
    {
      schema: {
        tags: ['files'],
        summary: '读取已登记的文件（模型、预览图、渲染图、交付文件）',
        params: z.object({ fileId: z.uuid() }),
        querystring: z.object({ v: z.string().max(64).optional() }),
        response: {
          200: z.unknown().describe('文件内容（二进制）'),
          304: z.unknown().describe('未修改'),
          400: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      authorize(request.ctx.actor, 'file:read')
      const [row] = await db
        .select()
        .from(schema.storedFiles)
        .where(eq(schema.storedFiles.id, request.params.fileId))
      if (!row) throw notFound('文件')
      const { file, bytes } = await resolveStoredFile(
        roots,
        row.root as StorageRootName,
        row.storageKey,
      )
      if (await isLfsPointer(file, bytes)) {
        throw new AppError(
          'NOT_FOUND',
          '文件实体尚未下载（Git LFS 指针），请在仓库中运行 git lfs pull',
          {
            reason: 'lfs_pointer',
          },
        )
      }
      const etag = `"${row.sha256}"`
      // Addressed by content (?v= the hash): never changes, so it is cached for a year.
      const versioned = request.query.v !== undefined && row.sha256.startsWith(request.query.v)
      reply
        .header('etag', etag)
        .header(
          'cache-control',
          versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=3600',
        )
      if (request.headers['if-none-match'] === etag) return reply.code(304).send(undefined)
      reply.header('content-type', row.contentType).header('content-length', bytes)
      // A plan symbol is a drawing; even opened on its own it may not run anything.
      if (row.contentType.startsWith('image/svg+xml')) {
        reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      }
      if (row.originalName) {
        reply.header(
          'content-disposition',
          `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
        )
      }
      return reply.send(createReadStream(file))
    },
  )
}
