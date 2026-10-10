import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  MAX_RENDER_BYTES,
  NodeRenderListSchema,
  RenderImageSchema,
  RenderModeSchema,
} from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import * as service from './service.ts'

const NodeParams = z.object({ nodeId: z.uuid() })
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }

export const renderRoutes: FastifyPluginAsyncZod<{ db: Database; roots: StorageRoots }> = async (
  app,
  { db, roots },
) => {
  // Rendered images are uploaded as raw PNG bytes (only within this plugin).
  app.addContentTypeParser(
    'image/png',
    { parseAs: 'buffer', bodyLimit: MAX_RENDER_BYTES },
    (_request, body, done) => done(null, body),
  )

  app.get(
    '/nodes/:nodeId/renders',
    {
      schema: {
        tags: ['renders'],
        summary: '渲染节点的渲染图（每个视角每种模式最新一张，标明是否过期）',
        params: NodeParams,
        response: { 200: NodeRenderListSchema, ...errors },
      },
    },
    (request) => service.listRenders(db, request.ctx, request.params.nodeId),
  )

  app.put(
    '/nodes/:nodeId/renders/:cameraId/:mode',
    {
      bodyLimit: MAX_RENDER_BYTES,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['renders'],
        summary: '保存浏览器渲染的一张视角图（请求体为 PNG）',
        consumes: ['image/png'],
        params: NodeParams.extend({ cameraId: z.uuid(), mode: RenderModeSchema }),
        body: z.unknown().describe('PNG 图片'),
        response: { 201: RenderImageSchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError('VALIDATION_FAILED', '请求体必须是 PNG 图片（Content-Type: image/png）')
      }
      const image = await service.saveRender(db, request.ctx, roots, {
        ...request.params,
        png: request.body,
      })
      return reply.code(201).send(image)
    },
  )

  app.get(
    '/nodes/:nodeId/renders/archive',
    {
      schema: {
        tags: ['renders'],
        summary: '下载渲染节点当前的全部渲染图（ZIP）',
        params: NodeParams,
        response: { 200: z.unknown().describe('ZIP 文件（二进制）'), ...errors },
      },
    },
    async (request, reply) => {
      const { fileName, zip } = await service.renderArchive(
        db,
        request.ctx,
        roots,
        request.params.nodeId,
      )
      return reply
        .header('content-type', 'application/zip')
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .send(Buffer.from(zip))
    },
  )
}
