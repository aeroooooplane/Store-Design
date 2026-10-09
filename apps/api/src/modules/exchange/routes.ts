import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  ProjectExportSchema,
  ProjectImportSchema,
  ProjectImportedSchema,
} from '@store/shared'
import * as service from './service.ts'

export const exchangeRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/projects/import',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['projects'],
        summary: '导入项目文件为新项目（新格式或旧版工作台备份）',
        description:
          '请求体上限 5 MB。旧版矩形空间转为多边形，结构占位转为障碍物，与当前模型不符的道具改为占位，并逐条返回说明。',
        body: ProjectImportSchema,
        response: { 201: ProjectImportedSchema, 400: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await service.importProject(db, request.ctx, request.body)),
  )

  app.get(
    '/projects/:projectId/export',
    {
      schema: {
        tags: ['projects'],
        summary: '导出项目文件（全部节点与草稿）',
        params: z.object({ projectId: z.uuid() }),
        response: {
          200: ProjectExportSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const file = await service.exportProject(db, request.ctx, request.params.projectId)
      const filename = encodeURIComponent(`${file.project.name}.store-design.json`)
      return reply
        .header('content-disposition', `attachment; filename*=UTF-8''${filename}`)
        .send(file)
    },
  )
}
