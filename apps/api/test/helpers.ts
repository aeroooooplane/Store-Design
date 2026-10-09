import type { FastifyInstance } from 'fastify'
import { createDatabase } from '@store/database'
import type { DatabaseHandle } from '@store/database'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config/env.ts'

export interface TestApp {
  app: FastifyInstance
  database: DatabaseHandle
  close(): Promise<void>
}

/** A real Fastify app over a fresh in-memory PostgreSQL with all migrations applied. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const database = createDatabase('pglite://memory')
  await database.migrate()
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', ...env }), db: database.db })
  await app.ready()
  return {
    app,
    database,
    async close() {
      await app.close()
      await database.close()
    },
  }
}
