import { sql } from 'drizzle-orm'
import { boolean, check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { itemFunction } from './enums.ts'
import { storedFiles } from './files.ts'

const metres = (name: string) => numeric(name, { precision: 9, scale: 3, mode: 'number' })

/**
 * Model catalogue, imported from 资源库 by `pnpm catalog:import` (read-only for the web app).
 * Facing values are relative to the model's own GLB frame.
 */
export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    standardName: text('standard_name').notNull(),
    variant: text('variant').notNull(),
    /** The user's own name for the model (模型选用表); the manual name stays in standard_name. */
    displayName: text('display_name'),
    materialCategory: text('material_category').notNull(),
    siFamily: text('si_family').notNull(),
    category: text('category').notNull().default('非标陈列'),
    function: itemFunction('function').notNull(),
    installation: text('installation'),
    width: metres('width').notNull(),
    depth: metres('depth').notNull(),
    height: metres('height').notNull(),
    footprintSource: text('footprint_source').notNull(),
    front: text('front'),
    staffSide: text('staff_side'),
    facingConfidence: text('facing_confidence'),
    placeable: boolean('placeable').notNull(),
    /** Marked 删除 in 模型选用表: kept for old layouts, no longer offered or planned. */
    retired: boolean('retired').notNull().default(false),
    judgment: text('judgment'),
    glbFileId: uuid('glb_file_id').references(() => storedFiles.id),
    /** Simplified, untextured copy for the white model (see apps/api assets/white-models.ts). */
    whiteGlbFileId: uuid('white_glb_file_id').references(() => storedFiles.id),
    previewFileId: uuid('preview_file_id').references(() => storedFiles.id),
    productImageFileId: uuid('product_image_file_id').references(() => storedFiles.id),
    productImageMatch: text('product_image_match'),
    planSymbolFileId: uuid('plan_symbol_file_id').references(() => storedFiles.id),
    sourceSha256: text('source_sha256'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assets_function_idx').on(t.function, t.placeable),
    check('assets_id_format', sql`${t.id} ~ '^asset-[0-9]+$'`),
    check(
      'assets_installation_known',
      sql`${t.installation} IS NULL OR ${t.installation} IN ('floor', 'wall')`,
    ),
    check('assets_footprint_source_known', sql`${t.footprintSource} IN ('glb', 'source')`),
    check(
      'assets_category_known',
      sql`${t.category} IN ('软装道具', '信息化物料', '品牌标识', '非标陈列', '环境设施')`,
    ),
    check(
      'assets_image_match_known',
      sql`${t.productImageMatch} IS NULL OR ${t.productImageMatch} IN ('exact', 'approximate')`,
    ),
    check(
      'assets_front_known',
      sql`${t.front} IS NULL OR ${t.front} IN ('+Z', '-Z', '+X', '-X', 'any')`,
    ),
    check('assets_dimensions_positive', sql`${t.width} > 0 AND ${t.depth} > 0 AND ${t.height} > 0`),
    check('assets_placeable_needs_glb', sql`NOT ${t.placeable} OR ${t.glbFileId} IS NOT NULL`),
  ],
)
