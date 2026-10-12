import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { RecognitionDraft, RecognitionScale } from '@store/shared'
import { storedFiles } from './files.ts'
import { designNodes, projects } from './projects.ts'

/** A picture of a plan sketch uploaded for recognition (a PDF page is rendered to one). */
export const planUploads = pgTable(
  'plan_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFiles.id),
    /** PDF page the picture came from (1-based); null for a plain picture. */
    page: integer('page'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plan_uploads_project_idx').on(t.projectId, t.createdAt),
    check('plan_uploads_size_positive', sql`${t.width} > 0 AND ${t.height} > 0`),
  ],
)

/**
 * One attempt to read an upload. The draft keeps what was read with confidences and open
 * points; a failed local attempt stays next to the model run that took over from it.
 */
export const recognitionRuns = pgTable(
  'recognition_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => planUploads.id),
    method: text('method').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    draft: jsonb('draft').$type<RecognitionDraft>(),
    scale: jsonb('scale').$type<RecognitionScale>(),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'number' }),
    error: text('error'),
    fallbackOf: uuid('fallback_of'),
    confirmedNodeId: uuid('confirmed_node_id').references(() => designNodes.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('recognition_runs_upload_idx').on(t.uploadId, t.createdAt),
    check('recognition_runs_method_known', sql`${t.method} IN ('local', 'llm')`),
    check('recognition_runs_status_known', sql`${t.status} IN ('succeeded', 'failed')`),
  ],
)
