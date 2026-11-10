import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  BackgroundImageSchema,
  MAX_BACKGROUND_BYTES,
  CameraCreateSchema,
  CameraUpdateSchema,
  NodeCameraListSchema,
  NodeCameraSchema,
} from '@store/shared'
import * as service from './service.ts'
import { uploadBackgroundImage } from './background.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { AppError } from '../../lib/app-error.ts'

const NodeParams = z.object({ nodeId: z.uuid() })
const CameraParams = z.object({ cameraId: z.uuid() })
const writeLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } }
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }

export const cameraRoutes: FastifyPluginAsyncZod<{ db: Database; roots: StorageRoots }> = async (
  app,
  { db, roots },
) => {
  for (const type of ['image/png', 'image/jpeg']) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: MAX_BACKGROUND_BYTES },
      (_request, body, done) => done(null, body),
    )
  }
  app.post(
    '/cameras/:cameraId/background-image',
    {
      bodyLimit: MAX_BACKGROUND_BYTES,
      config: writeLimit,
      schema: {
        tags: ['cameras'],
        summary: '上传当前渲染视角的背景图片',
        params: CameraParams,
        consumes: ['image/png', 'image/jpeg'],
        body: z.unknown(),
        response: { 201: BackgroundImageSchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body))
        throw new AppError('VALIDATION_FAILED', '请上传PNG或JPEG图片')
      return reply
        .code(201)
        .send(
          await uploadBackgroundImage(
            db,
            request.ctx,
            roots,
            request.params.cameraId,
            request.body,
          ),
        )
    },
  )
  app.get(
    '/nodes/:nodeId/cameras',
    {
      schema: {
        tags: ['cameras'],
        summary: '白模节点的视角列表（按顺序；includeDeleted=true 含已删除）',
        params: NodeParams,
        querystring: z.object({ includeDeleted: z.enum(['true', 'false']).default('false') }),
        response: { 200: NodeCameraListSchema, ...errors },
      },
    },
    (request) =>
      service.listCameras(
        db,
        request.ctx,
        request.params.nodeId,
        request.query.includeDeleted === 'true',
      ),
  )

  app.post(
    '/nodes/:nodeId/cameras',
    {
      config: writeLimit,
      schema: {
        tags: ['cameras'],
        summary: '添加视角（通常取自当前三维视图）',
        params: NodeParams,
        body: CameraCreateSchema,
        response: { 201: NodeCameraSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.addCamera(db, request.ctx, request.params.nodeId, request.body)),
  )

  app.patch(
    '/cameras/:cameraId',
    {
      config: writeLimit,
      schema: {
        tags: ['cameras'],
        summary: '重命名或调整视角；调整默认视角后其来源变为用户',
        params: CameraParams,
        body: CameraUpdateSchema,
        response: { 200: NodeCameraSchema, ...errors },
      },
    },
    (request) =>
      service.updateCamera(db, request.ctx, request.params.cameraId, request.body, roots),
  )

  for (const [method, path, deleted] of [
    ['delete', '/cameras/:cameraId', true],
    ['post', '/cameras/:cameraId/restore', false],
  ] as const) {
    app[method](
      path,
      {
        config: writeLimit,
        schema: {
          tags: ['cameras'],
          summary: deleted ? '删除视角（可恢复）' : '恢复已删除的视角',
          params: CameraParams,
          response: { 200: NodeCameraSchema, ...errors },
        },
      },
      (request) => service.setCameraDeleted(db, request.ctx, request.params.cameraId, deleted),
    )
  }
}
