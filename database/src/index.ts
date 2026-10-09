import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from '../schema/index.ts'

export { schema }

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export interface DatabaseHandle {
  db: Database
  driver: 'pglite' | 'postgres'
  /** Applies pending SQL migrations from database/migrations. */
  migrate(): Promise<void>
  close(): Promise<void>
}

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url))

const PGLITE_PREFIX = 'pglite://'

/**
 * Connects to PostgreSQL. `postgres://…` uses a real server; `pglite://<dir>` runs an embedded
 * PostgreSQL for development and tests (`pglite://memory` keeps everything in memory).
 * Relative pglite directories resolve from the repository root.
 */
export function createDatabase(url: string): DatabaseHandle {
  if (url.startsWith(PGLITE_PREFIX)) {
    const target = url.slice(PGLITE_PREFIX.length)
    let client: PGlite
    if (target === 'memory') {
      client = new PGlite()
    } else {
      const directory = path.resolve(REPOSITORY_ROOT, target)
      mkdirSync(directory, { recursive: true })
      client = new PGlite(directory)
    }
    const db = drizzlePglite({ client, schema })
    return {
      db,
      driver: 'pglite',
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    }
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const client = postgres(url, { max: 10, onnotice: () => {} })
    const db = drizzlePostgres({ client, schema })
    return {
      db,
      driver: 'postgres',
      migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.end(),
    }
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://')
}
