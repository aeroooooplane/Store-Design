import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  DisplayDetectRequestSchema,
  DisplayExportSchema,
  DisplayRulesViewSchema,
  DisplayTaskCreateSchema,
  DisplayTaskListSchema,
  DisplayTaskSchema,
  DisplayTaskUpdateSchema,
  NodeDisplayExportRequestSchema,
  NodeDisplaySchema,
  NodeDisplayUpdateSchema,
  UPLOAD_MAX_BYTES,
  DisplayTaskExportRequestSchema,
} from '@store/shared'
import type { AppConfig } from '../../config/env.ts'
import { requireRevision } from '../../lib/revision.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { rulesView } from './common.ts'
import { exportNodeDisplay, getNodeDisplay, updateNodeDisplay } from './node.ts'
import * as tasks from './tasks.ts'

const TaskParams = z.object({ taskId: z.uuid() })
const NodeParams = z.object({ nodeId: z.uuid() })
const PictureParams = TaskParams.extend({ which: z.enum(['plan', 'render']) })
const IfMatch = z.object({ 'if-match': z.string().optional().describe('版本号') })
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
const writeLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } }
/** The plan PNG travels as base64 inside the JSON body. */
const EXPORT_BODY_LIMIT = 40 * 1024 * 1024

/** First save of a node display has no revision yet (0). */
const revisionOrZero = (header: string | undefined) =>
  header === undefined ? 0 : requireRevision(header)

export const displayRoutes: FastifyPluginAsyncZod<{
  db: Database
  config: AppConfig
  roots: StorageRoots
}> = async (app, { db, config, roots }) => {
  for (const type of ['image/png', 'image/jpeg']) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: UPLOAD_MAX_BYTES },
      (_request, body, done) => done(null, body),
    )
  }

  app.get(
    '/display-rules/current',
    {
      schema: {
        tags: ['displays'],
        summary: '现行展陈规则（含托盘照片链接）',
        response: { 200: DisplayRulesViewSchema, ...errors },
      },
    },
    () => rulesView(db),
  )

  // ---- Workflow 2: display tasks from uploaded pictures ----

  app.get(
    '/display-tasks',
    {
      schema: {
        tags: ['displays'],
        summary: '展陈任务列表（最近修改在前）',
        response: { 200: DisplayTaskListSchema, ...errors },
      },
    },
    (request) => tasks.listTasks(db, request.ctx),
  )

  app.post(
    '/display-tasks',
    {
      config: writeLimit,
      schema: {
        tags: ['displays'],
        summary: '新建展陈任务（上传平面图与效果图生成展陈方案）',
        body: DisplayTaskCreateSchema,
        response: { 201: DisplayTaskSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await tasks.createTask(db, request.ctx, request.body)),
  )

  app.get(
    '/display-tasks/:taskId',
    {
      schema: {
        tags: ['displays'],
        summary: '一个展陈任务',
        params: TaskParams,
        response: { 200: DisplayTaskSchema, ...errors },
      },
    },
    (request) => tasks.getTask(db, request.ctx, request.params.taskId),
  )

  app.patch(
    '/display-tasks/:taskId',
    {
      config: writeLimit,
      schema: {
        tags: ['displays'],
        summary: '修改展陈任务：名称、市场、SI、桌子位置与人工修改（需 If-Match）',
        params: TaskParams,
        headers: IfMatch,
        body: DisplayTaskUpdateSchema,
        response: { 200: DisplayTaskSchema, ...errors },
      },
    },
    (request) =>
      tasks.updateTask(
        db,
        request.ctx,
        request.params.taskId,
        requireRevision(request.headers['if-match']),
        request.body,
      ),
  )

  app.delete(
    '/display-tasks/:taskId',
    {
      config: writeLimit,
      schema: {
        tags: ['displays'],
        summary: '删除展陈任务',
        params: TaskParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await tasks.deleteTask(db, request.ctx, request.params.taskId)
      return reply.code(204).send(null)
    },
  )

  app.put(
    '/display-tasks/:taskId/:which',
    {
      config: writeLimit,
      schema: {
        tags: ['displays'],
        summary:
          '上传任务的平面图或效果图（请求体为 PNG 或 JPEG；PDF 由浏览器按页转成图片，需 If-Match）',
        params: PictureParams,
        headers: IfMatch,
        querystring: z.object({
          originalName: z.string().max(200).optional(),
          page: z.coerce.number().int().positive().optional(),
        }),
        body: z.unknown().describe('图片二进制'),
        response: { 200: DisplayTaskSchema, ...errors, 413: ApiErrorSchema },
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
      return tasks.uploadPicture(db, request.ctx, roots, {
        id: request.params.taskId,
        revision: requireRevision(request.headers['if-match']),
        which: request.params.which,
        data: request.body as Buffer,
        contentType,
        originalName: request.query.originalName ?? null,
        page: request.query.page ?? null,
      })
    },
  )

  app.post(
    '/display-tasks/:taskId/detect',
    {
      bodyLimit: 20 * 1024 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['displays'],
        summary: '识别平面图上的中岛桌与边桌、主入口方向，并在效果图上标出（需 If-Match）',
        params: TaskParams,
        headers: IfMatch,
        body: DisplayDetectRequestSchema,
        response: { 200: DisplayTaskSchema, ...errors, 402: ApiErrorSchema, 502: ApiErrorSchema },
      },
    },
    (request) =>
      tasks.detect(
        db,
        request.ctx,
        config,
        roots,
        request.params.taskId,
        requireRevision(request.headers['if-match']),
        request.body,
      ),
  )

  app.post(
    '/display-tasks/:taskId/export',
    {
      bodyLimit: EXPORT_BODY_LIMIT,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['displays'],
        summary: '生成展陈方案 PPT 与展陈清单 Excel',
        description: '请求体可选：每张桌出三维页、平面页或两者，以及浏览器画好的各桌三维图。',
        params: TaskParams,
        body: DisplayTaskExportRequestSchema.nullish(),
        response: { 201: DisplayExportSchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await tasks.exportTask(
            db,
            request.ctx,
            roots,
            request.params.taskId,
            DisplayTaskExportRequestSchema.parse(request.body ?? {}),
          ),
        ),
  )

  // ---- Workflow 1: the display of a render node ----

  app.get(
    '/nodes/:nodeId/display',
    {
      schema: {
        tags: ['displays'],
        summary: '渲染节点的展陈方案：按布局与视角自动编号、套用规则，并给出效果图上的标签位置',
        params: NodeParams,
        response: { 200: NodeDisplaySchema, ...errors },
      },
    },
    (request) => getNodeDisplay(db, request.ctx, request.params.nodeId),
  )

  app.put(
    '/nodes/:nodeId/display',
    {
      config: writeLimit,
      schema: {
        tags: ['displays'],
        summary: '保存渲染节点展陈方案的人工修改（首次保存不带 If-Match）',
        params: NodeParams,
        headers: IfMatch,
        body: NodeDisplayUpdateSchema,
        response: { 200: NodeDisplaySchema, ...errors },
      },
    },
    (request) =>
      updateNodeDisplay(
        db,
        request.ctx,
        request.params.nodeId,
        revisionOrZero(request.headers['if-match']),
        request.body.edits,
      ),
  )

  app.post(
    '/nodes/:nodeId/display/export',
    {
      bodyLimit: EXPORT_BODY_LIMIT,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['displays'],
        summary: '生成渲染节点的展陈方案 PPT 与展陈清单 Excel',
        params: NodeParams,
        body: NodeDisplayExportRequestSchema,
        response: { 201: DisplayExportSchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await exportNodeDisplay(db, request.ctx, roots, request.params.nodeId, request.body)),
  )
}
