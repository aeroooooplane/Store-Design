import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import { ApiErrorSchema, AssetListQuerySchema, AssetListSchema, AssetSchema } from '@store/shared'
import * as service from './service.ts'

export const assetRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/assets',
    {
      schema: {
        tags: ['assets'],
        summary: '模型目录（按用途、可摆放、SI 归属筛选，按编号或名称搜索）',
        querystring: AssetListQuerySchema,
        response: { 200: AssetListSchema, 400: ApiErrorSchema },
      },
    },
    (request) => service.listAssets(db, request.ctx, request.query),
  )

  app.get(
    '/assets/:assetId',
    {
      schema: {
        tags: ['assets'],
        summary: '单个模型',
        params: z.object({ assetId: z.string().regex(/^asset-\d+$/) }),
        response: { 200: AssetSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    (request) => service.getAsset(db, request.ctx, request.params.assetId),
  )
}
