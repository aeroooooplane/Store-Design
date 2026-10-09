import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectListSchema,
  ProjectSchema,
  ProjectUpdateSchema,
} from '@store/shared'
import { etag, requireRevision } from '../../lib/revision.ts'
import * as service from './service.ts'

const ParamsSchema = z.object({ projectId: z.uuid() })
const IfMatchHeadersSchema = z.object({
  'if-match': z.string().optional().describe('当前版本号，例如 "3"'),
})

const errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  428: ApiErrorSchema,
}

/** Stricter limit for writes than the global read limit. */
const writeLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } }

export const projectRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/projects',
    {
      schema: {
        tags: ['projects'],
        summary: '项目列表（分页、按名称搜索、回收站）',
        querystring: ProjectListQuerySchema,
        response: { 200: ProjectListSchema, 400: ApiErrorSchema },
      },
    },
    (request) => service.listProjects(db, request.ctx, request.query),
  )

  app.post(
    '/projects',
    {
      config: writeLimit,
      schema: {
        tags: ['projects'],
        summary: '新建项目',
        body: ProjectCreateSchema,
        response: { 201: ProjectSchema, 400: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const project = await service.createProject(db, request.ctx, request.body)
      return reply.code(201).header('etag', etag(project.revision)).send(project)
    },
  )

  app.get(
    '/projects/:projectId',
    {
      schema: {
        tags: ['projects'],
        summary: '项目详情（含回收站中的项目）',
        params: ParamsSchema,
        response: { 200: ProjectSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const project = await service.getProject(db, request.ctx, request.params.projectId)
      return reply.header('etag', etag(project.revision)).send(project)
    },
  )

  app.patch(
    '/projects/:projectId',
    {
      config: writeLimit,
      schema: {
        tags: ['projects'],
        summary: '修改项目',
        params: ParamsSchema,
        headers: IfMatchHeadersSchema,
        body: ProjectUpdateSchema,
        response: { 200: ProjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const revision = requireRevision(request.headers['if-match'])
      const project = await service.updateProject(
        db,
        request.ctx,
        request.params.projectId,
        revision,
        request.body,
      )
      return reply.header('etag', etag(project.revision)).send(project)
    },
  )

  app.delete(
    '/projects/:projectId',
    {
      config: writeLimit,
      schema: {
        tags: ['projects'],
        summary: '移入回收站（软删除）',
        params: ParamsSchema,
        headers: IfMatchHeadersSchema,
        response: { 200: ProjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const revision = requireRevision(request.headers['if-match'])
      const project = await service.deleteProject(
        db,
        request.ctx,
        request.params.projectId,
        revision,
      )
      return reply.header('etag', etag(project.revision)).send(project)
    },
  )

  app.post(
    '/projects/:projectId/restore',
    {
      config: writeLimit,
      schema: {
        tags: ['projects'],
        summary: '从回收站恢复',
        params: ParamsSchema,
        headers: IfMatchHeadersSchema,
        response: { 200: ProjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const revision = requireRevision(request.headers['if-match'])
      const project = await service.restoreProject(
        db,
        request.ctx,
        request.params.projectId,
        revision,
      )
      return reply.header('etag', etag(project.revision)).send(project)
    },
  )
}
