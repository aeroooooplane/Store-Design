import {
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
import { market, renderEngine, renderMode, siStyle } from './enums.ts'
import { jobs, storedFiles } from './files.ts'
import { designNodes, nodeCameras, projects } from './projects.ts'

/**
 * A rendered image. Signatures hash the layout and camera used; when either changes the
 * image is stale and a new row is written instead of overwriting.
 */
export const renders = pgTable(
  'renders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => designNodes.id),
    cameraId: uuid('camera_id')
      .notNull()
      .references(() => nodeCameras.id),
    mode: renderMode('mode').notNull(),
    engine: renderEngine('engine').notNull(),
    siStyle: siStyle('si_style').notNull(),
    market: market('market').notNull(),
    layoutSignature: text('layout_signature').notNull(),
    cameraSignature: text('camera_signature').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFiles.id),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('renders_variant_key').on(
      t.cameraId,
      t.mode,
      t.engine,
      t.siStyle,
      t.market,
      t.layoutSignature,
      t.cameraSignature,
    ),
    index('renders_node_idx').on(t.nodeId),
  ],
)

/** A delivery package (two PDFs + folder + ZIP) produced from a frozen node. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    nodeId: uuid('node_id').notNull(),
    folderName: text('folder_name').notNull(),
    fullPdfFileId: uuid('full_pdf_file_id').references(() => storedFiles.id),
    showPdfFileId: uuid('show_pdf_file_id').references(() => storedFiles.id),
    zipFileId: uuid('zip_file_id').references(() => storedFiles.id),
    archivePath: text('archive_path'),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull().default({}),
    jobId: uuid('job_id').references(() => jobs.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'deliveries_node_same_project_fk',
      columns: [t.projectId, t.nodeId],
      foreignColumns: [designNodes.projectId, designNodes.id],
    }),
    index('deliveries_project_idx').on(t.projectId, t.createdAt),
  ],
)
