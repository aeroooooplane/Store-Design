import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  NodeCreatedSchema,
  PlanUploadSchema,
  RecognitionConfirmSchema,
  RecognitionRunSchema,
  RecognizeRequestSchema,
  RecognizeResponseSchema,
  UPLOAD_MAX_BYTES,
} from '@store/shared'
import type { AppConfig } from '../../config/env.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import * as service from './service.ts'

const ProjectParams = z.object({ projectId: z.uuid() })
const UploadParams = z.object({ uploadId: z.uuid() })
const RunParams = z.object({ runId: z.uuid() })
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
const writeLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } }

export const recognitionRoutes: FastifyPluginAsyncZod<{
  db: Database
  config: AppConfig
  roots: StorageRoots
}> = async (app, { db, config, roots }) => {
  // Plan pictures arrive as raw image bytes (only within this plugin).
  for (const type of ['image/png', 'image/jpeg']) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: UPLOAD_MAX_BYTES },
      (_request, body, done) => done(null, body),
    )
  }

  app.post(
    '/projects/:projectId/uploads',
    {
      config: writeLimit,
      schema: {
        tags: ['recognition'],
        summary: '上传平面简图（请求体为 PNG 或 JPEG，20 MB 内；PDF 由浏览器按页转成图片后上传）',
        params: ProjectParams,
        querystring: z.object({
          originalName: z.string().max(200).optional(),
          /** PDF page the picture was rendered from. */
          page: z.coerce.number().int().positive().optional(),
        }),
        body: z.unknown().describe('图片二进制'),
        response: { 201: PlanUploadSchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const contentType = request.headers['content-type']?.split(';')[0]?.trim()
      if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_FAILED',
            message: '请求体须为 image/png 或 image/jpeg',
            requestId: request.id,
          },
        })
      }
      const upload = await service.uploadPlan(db, request.ctx, roots, {
        projectId: request.params.projectId,
        data: request.body as Buffer,
        contentType,
        originalName: request.query.originalName ?? null,
        page: request.query.page ?? null,
      })
      return reply.code(201).send(upload)
    },
  )

  app.get(
    '/projects/:projectId/uploads',
    {
      schema: {
        tags: ['recognition'],
        summary: '项目最近上传的简图',
        params: ProjectParams,
        response: { 200: z.array(PlanUploadSchema), ...errors },
      },
    },
    (request) => service.listUploads(db, request.ctx, request.params.projectId),
  )

  app.post(
    '/uploads/:uploadId/recognize',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['recognition'],
        summary: '识别简图：默认按设置先本地（需浏览器提取的矢量内容），不合格时自动改用兜底模型',
        params: UploadParams,
        body: RecognizeRequestSchema,
        response: {
          200: RecognizeResponseSchema,
          ...errors,
          402: ApiErrorSchema,
          502: ApiErrorSchema,
        },
      },
    },
    (request) =>
      service.recognize(db, request.ctx, config, roots, request.params.uploadId, request.body),
  )

  app.get(
    '/uploads/:uploadId/runs',
    {
      schema: {
        tags: ['recognition'],
        summary: '一张简图的识别记录（最新在前）',
        params: UploadParams,
        response: { 200: z.array(RecognitionRunSchema), ...errors },
      },
    },
    (request) => service.listRuns(db, request.ctx, request.params.uploadId),
  )

  app.get(
    '/recognition-runs/:runId',
    {
      schema: {
        tags: ['recognition'],
        summary: '一次识别的结果',
        params: RunParams,
        response: { 200: RecognitionRunSchema, ...errors },
      },
    },
    (request) => service.getRun(db, request.ctx, request.params.runId),
  )

  app.post(
    '/recognition-runs/:runId/confirm',
    {
      config: writeLimit,
      schema: {
        tags: ['recognition'],
        summary: '确认校对后的空间（与保留的道具），生成来源为“识别”的空间节点',
        params: RunParams,
        body: RecognitionConfirmSchema,
        response: { 201: NodeCreatedSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.confirmRun(db, request.ctx, request.params.runId, request.body)),
  )
}
