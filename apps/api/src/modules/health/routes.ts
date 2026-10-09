import { sql } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import { API_VERSION } from '../../plugins/openapi.ts'

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  database: z.enum(['ok', 'unavailable']),
})

export const healthRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: '运行状态',
        response: { 200: HealthSchema },
      },
    },
    async (request): Promise<z.infer<typeof HealthSchema>> => {
      let database: 'ok' | 'unavailable' = 'ok'
      try {
        await db.execute(sql`select 1`)
      } catch (error) {
        request.log.error({ err: error }, 'database health check failed')
        database = 'unavailable'
      }
      return { status: database === 'ok' ? 'ok' : 'degraded', version: API_VERSION, database }
    },
  )
}
