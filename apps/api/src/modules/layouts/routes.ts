import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  LayoutCandidatesSchema,
  LayoutGenerateSchema,
  LayoutIssuesSchema,
  LayoutValidateSchema,
} from '@store/shared'
import * as service from './service.ts'

export const layoutRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/layouts/generate',
    {
      // Planning scans the floor plan, so it gets a tighter limit than plain reads.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['layouts'],
        summary: '为空间生成候选布局（尽量多放 / 按面积推荐 / 尽量少放）',
        description:
          '不保存。收银台靠后墙，中岛桌避开入口缓冲与主通道并保留通道，配件柜沿墙。通道、间距为指导值，放不下时逐级让步并记录在 planning.relaxations。',
        body: LayoutGenerateSchema,
        response: { 200: LayoutCandidatesSchema, 400: ApiErrorSchema },
      },
    },
    (request) => service.generateLayouts(db, request.ctx, request.body),
  )

  app.post(
    '/layouts/validate',
    {
      schema: {
        tags: ['layouts'],
        summary: '检查布局：越界、重叠、压障碍物或入口、超高、模型尺寸不符',
        body: LayoutValidateSchema,
        response: { 200: LayoutIssuesSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => ({
      issues: await service.validateDraftLayout(
        db,
        request.ctx,
        request.body.space,
        request.body.layout,
      ),
    }),
  )
}
