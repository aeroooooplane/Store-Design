import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Camera, Layout, Space } from '@store/shared'
import { market, nodeKind, nodeOrigin, planStrategy, shopType, siStyle } from './enums.ts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}

// Future user system: projects gain an owner column through a migration with backfill.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    shopType: shopType('shop_type').notNull(),
    market: market('market').notNull().default('domestic'),
    siStyle: siStyle('si_style').notNull().default('SI1.0'),
    revision: integer('revision').notNull().default(1),
    ...timestamps,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('projects_listing_idx').on(t.deletedAt, t.updatedAt),
    check('projects_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check('projects_revision_positive', sql`${t.revision} >= 1`),
  ],
)

/**
 * History tree. Rows are immutable except `name` and `hidden_at`.
 * A `space` node holds the store space (optionally carrying a layout over from its parent);
 * every other node holds a layout and inherits the space of its nearest `space` ancestor.
 */
export const designNodes = pgTable(
  'design_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    parentId: uuid('parent_id'),
    kind: nodeKind('kind').notNull(),
    name: text('name').notNull(),
    space: jsonb('space').$type<Space>(),
    layout: jsonb('layout').$type<Layout>(),
    strategy: planStrategy('strategy'),
    siStyle: siStyle('si_style'),
    origin: nodeOrigin('origin').notNull(),
    originRef: uuid('origin_ref'),
    importedFrom: text('imported_from'),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    /** Insertion order; rows created in one transaction share created_at. */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    ...timestamps,
  },
  (t) => [
    unique('design_nodes_project_node_key').on(t.projectId, t.id),
    // Parent must belong to the same project (not checked while parent_id is NULL).
    foreignKey({
      name: 'design_nodes_parent_same_project_fk',
      columns: [t.projectId, t.parentId],
      foreignColumns: [t.projectId, t.id],
    }),
    index('design_nodes_project_idx').on(t.projectId, t.seq),
    index('design_nodes_parent_idx').on(t.parentId),
    check(
      'design_nodes_payload_matches_kind',
      sql`(${t.kind} = 'space' AND ${t.space} IS NOT NULL)
        OR (${t.kind} <> 'space' AND ${t.space} IS NULL AND ${t.layout} IS NOT NULL AND ${t.parentId} IS NOT NULL)`,
    ),
    check('design_nodes_strategy_only_on_plan', sql`${t.strategy} IS NULL OR ${t.kind} = 'plan'`),
    check('design_nodes_name_not_blank', sql`length(trim(${t.name})) > 0`),
  ],
)

/** One shared working draft per project, saved with optimistic locking. */
export const projectDrafts = pgTable(
  'project_drafts',
  {
    projectId: uuid('project_id')
      .primaryKey()
      .references(() => projects.id),
    baseNodeId: uuid('base_node_id').notNull(),
    layout: jsonb('layout').$type<Layout>().notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'project_drafts_base_node_same_project_fk',
      columns: [t.projectId, t.baseNodeId],
      foreignColumns: [designNodes.projectId, designNodes.id],
    }),
  ],
)

export const nodeCameras = pgTable(
  'node_cameras',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => designNodes.id),
    sort: integer('sort').notNull(),
    camera: jsonb('camera').$type<Camera>().notNull(),
    /** Removed views can be restored. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('node_cameras_node_idx').on(t.nodeId, t.sort)],
)
