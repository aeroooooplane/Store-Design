import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { DisplayEdits, DisplayExport, DisplayTaskState } from '@store/shared'
import { market, siStyle } from './enums.ts'
import { storedFiles } from './files.ts'
import { designNodes } from './projects.ts'

/**
 * Display plan (展陈方案) of a render node: what the user changed on top of the rules. The
 * tables, numbering and labels are worked out from the node's layout and views each time.
 * 【未来按用户隔离】via the node's project.
 */
export const nodeDisplays = pgTable('node_displays', {
  nodeId: uuid('node_id')
    .primaryKey()
    .references(() => designNodes.id),
  edits: jsonb('edits').$type<DisplayEdits>().notNull(),
  exports: jsonb('exports').$type<DisplayExport[]>().notNull().default([]),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A display task: a display plan made from an uploaded store plan and render, without a
 * project (workflow 2). 【未来按用户隔离】
 */
export const displayTasks = pgTable(
  'display_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    market: market('market').notNull().default('domestic'),
    siStyle: siStyle('si_style').notNull().default('SI2.0'),
    planFileId: uuid('plan_file_id').references(() => storedFiles.id),
    planWidth: integer('plan_width'),
    planHeight: integer('plan_height'),
    planPage: integer('plan_page'),
    renderFileId: uuid('render_file_id').references(() => storedFiles.id),
    renderWidth: integer('render_width'),
    renderHeight: integer('render_height'),
    renderPage: integer('render_page'),
    state: jsonb('state').$type<DisplayTaskState>().notNull(),
    exports: jsonb('exports').$type<DisplayExport[]>().notNull().default([]),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('display_tasks_updated_idx').on(t.updatedAt)],
)
