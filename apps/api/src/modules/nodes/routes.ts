import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  NodeCreateSchema,
  NodeCreatedSchema,
  NodeRenameSchema,
  NodeSchema,
  NodeTreeSchema,
} from '@store/shared'
import * as service from './service.ts'

const ProjectParams = z.object({ projectId: z.uuid() })
const NodeParams = z.object({ nodeId: z.uuid() })
const writeLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } }
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }

export const nodeRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/projects/:projectId/nodes',
    {
      schema: {
        tags: ['nodes'],
        summary: '历史树（节点摘要，不含空间与布局）',
        params: ProjectParams,
        querystring: z.object({ includeHidden: z.enum(['true', 'false']).default('false') }),
        response: { 200: NodeTreeSchema, ...errors },
      },
    },
    (request) =>
      service.getTree(
        db,
        request.ctx,
        request.params.projectId,
        request.query.includeHidden === 'true',
      ),
  )

  app.post(
    '/projects/:projectId/nodes',
    {
      config: writeLimit,
      schema: {
        tags: ['nodes'],
        summary: '新建历史节点（空间、方案、编辑、白模确认、渲染）',
        description:
          '布局中的模型必须存在且保持真实尺寸，否则 400。越界、重叠等问题随结果返回；白模确认与渲染节点不允许有错误级问题。',
        params: ProjectParams,
        body: NodeCreateSchema,
        response: { 201: NodeCreatedSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.createNode(db, request.ctx, request.params.projectId, request.body)),
  )

  app.get(
    '/nodes/:nodeId',
    {
      schema: {
        tags: ['nodes'],
        summary: '节点详情（含空间与布局）',
        params: NodeParams,
        response: { 200: NodeSchema, ...errors },
      },
    },
    (request) => service.getNode(db, request.ctx, request.params.nodeId),
  )

  app.patch(
    '/nodes/:nodeId',
    {
      config: writeLimit,
      schema: {
        tags: ['nodes'],
        summary: '重命名节点（节点内容不可修改）',
        params: NodeParams,
        body: NodeRenameSchema,
        response: { 200: NodeSchema, ...errors },
      },
    },
    (request) => service.renameNode(db, request.ctx, request.params.nodeId, request.body.name),
  )

  for (const [action, hidden] of [
    ['hide', true],
    ['restore', false],
  ] as const) {
    app.post(
      `/nodes/:nodeId/${action}`,
      {
        config: writeLimit,
        schema: {
          tags: ['nodes'],
          summary: hidden ? '在树图中隐藏节点（不删除）' : '恢复显示节点',
          params: NodeParams,
          response: { 200: NodeSchema, ...errors },
        },
      },
      (request) => service.setHidden(db, request.ctx, request.params.nodeId, hidden),
    )
  }
}
