import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import { ApiErrorSchema, DraftPutSchema, DraftSavedSchema, DraftSchema } from '@store/shared'
import { etag, requireRevision } from '../../lib/revision.ts'
import * as service from './service.ts'

const Params = z.object({ projectId: z.uuid() })
const Headers = z.object({
  'if-match': z.string().optional().describe('草稿版本号；首次保存可省略'),
})
const errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  428: ApiErrorSchema,
}
// Drafts autosave while editing, so they get a looser limit than other writes.
const autosaveLimit = { rateLimit: { max: 240, timeWindow: '1 minute' } }

export const draftRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/projects/:projectId/draft',
    {
      schema: {
        tags: ['drafts'],
        summary: '读取项目的共享编辑草稿',
        params: Params,
        response: { 200: DraftSchema, ...errors },
      },
    },
    async (request, reply) => {
      const draft = await service.getDraft(db, request.ctx, request.params.projectId)
      return reply.header('etag', etag(draft.revision)).send(draft)
    },
  )

  app.put(
    '/projects/:projectId/draft',
    {
      config: autosaveLimit,
      schema: {
        tags: ['drafts'],
        summary: '保存草稿（首次保存不带 If-Match，之后必须带）',
        params: Params,
        headers: Headers,
        body: DraftPutSchema,
        response: { 200: DraftSavedSchema, ...errors },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match']
      const revision = header === undefined ? null : requireRevision(header)
      const saved = await service.saveDraft(
        db,
        request.ctx,
        request.params.projectId,
        revision,
        request.body,
      )
      return reply.header('etag', etag(saved.draft.revision)).send(saved)
    },
  )

  app.delete(
    '/projects/:projectId/draft',
    {
      config: autosaveLimit,
      schema: {
        tags: ['drafts'],
        summary: '丢弃草稿',
        params: Params,
        headers: Headers,
        response: { 204: z.null().describe('已丢弃'), ...errors },
      },
    },
    async (request, reply) => {
      await service.discardDraft(
        db,
        request.ctx,
        request.params.projectId,
        requireRevision(request.headers['if-match']),
      )
      return reply.code(204).send(null)
    },
  )
}
