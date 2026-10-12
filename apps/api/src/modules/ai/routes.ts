import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '@store/database'
import {
  AiBudgetSchema,
  AiOverviewSchema,
  AiSettingsSchema,
  AiSettingsUpdateSchema,
  ApiErrorSchema,
} from '@store/shared'
import { budgetStatus } from '../../ai/budget.ts'
import { availableModels, toAiModel } from '../../ai/models.ts'
import { readSettings, writeSettings } from '../../ai/settings.ts'
import type { AppConfig } from '../../config/env.ts'
import { authorize } from '../../context/policy.ts'

/**
 * Site-wide AI settings and the daily budget. Keys never leave the server: the list only says
 * which models are usable. Per-user settings arrive with the account system.
 */
export const aiRoutes: FastifyPluginAsyncZod<{ db: Database; config: AppConfig }> = async (
  app,
  { db, config },
) => {
  app.get(
    '/ai',
    {
      schema: {
        tags: ['ai'],
        summary: '可用模型、当前设置与今日额度',
        response: { 200: AiOverviewSchema },
      },
    },
    async (request) => {
      authorize(request.ctx.actor, 'ai:read')
      return {
        models: availableModels(config.ai).map(toAiModel),
        settings: await readSettings(db, config.ai),
        budget: await budgetStatus(db, config.ai.dailyBudgetCny),
      }
    },
  )

  app.patch(
    '/ai/settings',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['ai'],
        summary: '修改 Agent 与平面识别所用模型（全站统一）',
        body: AiSettingsUpdateSchema,
        response: { 200: AiSettingsSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => {
      authorize(request.ctx.actor, 'ai:write')
      return writeSettings(db, config.ai, request.body)
    },
  )

  app.get(
    '/ai/budget',
    {
      schema: {
        tags: ['ai'],
        summary: '今日 AI 额度（北京时间 0 点重置）',
        response: { 200: AiBudgetSchema },
      },
    },
    async (request) => {
      authorize(request.ctx.actor, 'ai:read')
      return budgetStatus(db, config.ai.dailyBudgetCny)
    },
  )
}
