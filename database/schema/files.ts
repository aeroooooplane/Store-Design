import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { jobStatus, jobType } from './enums.ts'
import { projects } from './projects.ts'

/** Files are only ever served by id; storage_key is relative to the configured root. */
export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    root: text('root').notNull(),
    storageKey: text('storage_key').notNull(),
    kind: text('kind').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    originalName: text('original_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stored_files_root_key').on(t.root, t.storageKey),
    check('stored_files_root_known', sql`${t.root} IN ('storage', 'resource')`),
    check('stored_files_sha256_hex', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('stored_files_bytes_non_negative', sql`${t.bytes} >= 0`),
  ],
)

/** Work queue for the Python worker, claimed with SELECT … FOR UPDATE SKIP LOCKED. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: jobType('type').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    projectId: uuid('project_id').references(() => projects.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAfter),
    index('jobs_project_idx').on(t.projectId),
  ],
)
