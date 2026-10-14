import { z } from 'zod'
import { MarketSchema, SiStyleSchema } from '../enums.ts'
import { NameSchema } from '../schemas/common.ts'
import { RecognitionDraftSchema, VectorContentSchema } from '../schemas/recognition.ts'
import { DisplayTableSchema, ENTRANCE_SIDES } from './engine.ts'
import { DisplayOrientationSchema, DisplayRulesSchema } from './rules.ts'

/** A label position on a picture, 0–1 from the top-left corner. */
export const DisplayMarkSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})
export type DisplayMark = z.infer<typeof DisplayMarkSchema>

const TableIdSchema = z.string().trim().min(1).max(64)
const SlotIdSchema = z.string().trim().min(1).max(8)

/**
 * What a person changed on top of the rules, kept per table id (layout item id or the id of a
 * table on an uploaded plan) so that renumbering does not move an edit to another table.
 */
export const DisplayEditsSchema = z.object({
  /** null: from the table nearest the entrance. */
  orientation: DisplayOrientationSchema.nullable().default(null),
  landscapeEnd: z.enum(['left', 'right']).default('left'),
  /** Table id → slot → unit id (null empties the slot). */
  slots: z.record(TableIdSchema, z.record(SlotIdSchema, z.string().max(60).nullable())).default({}),
  /** Table id → accessory modules replacing the guide's. */
  modules: z.record(TableIdSchema, z.array(z.string().max(20)).max(12)).default({}),
})
export type DisplayEdits = z.output<typeof DisplayEditsSchema>
export const emptyDisplayEdits = (): DisplayEdits => ({
  orientation: null,
  landscapeEnd: 'left',
  slots: {},
  modules: {},
})

const FileLinkSchema = z.object({ url: z.string(), name: z.string(), bytes: z.int().min(0) })
export const DisplayExportSchema = z.object({
  pptx: FileLinkSchema,
  xlsx: FileLinkSchema,
  ruleVersion: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type DisplayExport = z.infer<typeof DisplayExportSchema>

/** The rules in force for the browser, with the tray photos as file links. */
export const DisplayRulesViewSchema = z.object({
  version: z.string(),
  importedAt: z.iso.datetime({ offset: true }),
  rules: DisplayRulesSchema,
  photos: z.array(
    z.object({
      unit: z.string(),
      si: SiStyleSchema,
      kind: z.enum(['photo', 'render']),
      url: z.string(),
    }),
  ),
})
export type DisplayRulesView = z.infer<typeof DisplayRulesViewSchema>

// ---------------------------------------------------------------------------------------------
// Workflow 2: a display task from an uploaded plan and render (no project).

/** A table found on (or placed on) the uploaded plan; positions are 0–1 of the picture. */
export const TaskTableSchema = z.object({
  id: TableIdSchema,
  kind: z.enum(['island', 'side']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  /** Where the table is on the render; null until found or placed. */
  render: DisplayMarkSchema.nullable().default(null),
  /** Text read beside the table, e.g. “1.8米X系列中岛桌”. */
  label: z.string().max(100).nullable().default(null),
})
export type TaskTable = z.output<typeof TaskTableSchema>

export const DisplayTaskStateSchema = z.object({
  entrance: z.enum(ENTRANCE_SIDES).default('bottom'),
  tables: z.array(TaskTableSchema).max(40).default([]),
  edits: DisplayEditsSchema.default(emptyDisplayEdits),
  detection: z
    .object({
      method: z.enum(['local', 'model', 'manual']),
      notes: z.array(z.string().max(300)).max(30),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable()
    .default(null),
  /** The plan as recognised (space, scale), kept so that a task can later become a project. */
  recognition: RecognitionDraftSchema.nullable().default(null),
})
export type DisplayTaskState = z.output<typeof DisplayTaskStateSchema>

const PictureSchema = z.object({
  url: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  originalName: z.string().nullable(),
  /** PDF page the picture was rendered from. */
  page: z.int().positive().nullable(),
})

export const DisplayTaskSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  market: MarketSchema,
  siStyle: SiStyleSchema,
  revision: z.int(),
  plan: PictureSchema.nullable(),
  render: PictureSchema.nullable(),
  state: DisplayTaskStateSchema,
  exports: z.array(DisplayExportSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export type DisplayTask = z.output<typeof DisplayTaskSchema>

export const DisplayTaskListSchema = z.array(
  DisplayTaskSchema.pick({
    id: true,
    name: true,
    market: true,
    siStyle: true,
    updatedAt: true,
  }).extend({
    tables: z.int().min(0),
    exported: z.boolean(),
  }),
)
export type DisplayTaskList = z.infer<typeof DisplayTaskListSchema>

export const DisplayTaskCreateSchema = z.strictObject({
  name: NameSchema,
  market: MarketSchema.default('domestic'),
  siStyle: SiStyleSchema.default('SI2.0'),
})
export type DisplayTaskCreate = z.output<typeof DisplayTaskCreateSchema>

export const DisplayTaskUpdateSchema = z.strictObject({
  name: NameSchema.optional(),
  market: MarketSchema.optional(),
  siStyle: SiStyleSchema.optional(),
  state: DisplayTaskStateSchema.optional(),
})
export type DisplayTaskUpdate = z.output<typeof DisplayTaskUpdateSchema>

/** Find the tables: the vector content of a PDF page lets the local engine work. */
export const DisplayDetectRequestSchema = z.strictObject({
  vector: VectorContentSchema.optional(),
  /** Use the vision model (plan pictures without vector content, and the render). */
  useModel: z.boolean().default(true),
})
export type DisplayDetectRequest = z.output<typeof DisplayDetectRequestSchema>

// ---------------------------------------------------------------------------------------------
// Workflow 1: the display of a render node, from its layout and views.

export const NodeDisplayViewSchema = z.object({
  cameraId: z.uuid(),
  name: z.string(),
  /** Current material image of the view; null while it is missing or stale. */
  imageUrl: z.string().nullable(),
  /** Table label → where its top is on the image. */
  marks: z.record(z.string(), DisplayMarkSchema),
})

export const NodeDisplaySchema = z.object({
  nodeId: z.uuid(),
  revision: z.int(),
  edits: DisplayEditsSchema,
  tables: z.array(DisplayTableSchema),
  views: z.array(NodeDisplayViewSchema),
  /** View with the most tables in sight, for the overview slide. */
  overviewCameraId: z.uuid().nullable(),
  /** Table label → the view that shows it best. */
  tableViews: z.record(z.string(), z.uuid().nullable()),
  ruleVersion: z.string().nullable(),
  exports: z.array(DisplayExportSchema),
})
export type NodeDisplay = z.infer<typeof NodeDisplaySchema>

export const NodeDisplayUpdateSchema = z.strictObject({ edits: DisplayEditsSchema })
export type NodeDisplayUpdate = z.output<typeof NodeDisplayUpdateSchema>

/** The browser draws the plan (as for deliveries) and says which plan area the picture shows. */
export const NodeDisplayExportRequestSchema = z.strictObject({
  planPng: z
    .string()
    .min(16)
    .max(40 * 1024 * 1024),
  /** SVG viewBox of the drawing in plan metres: x, z, width, depth. */
  planViewBox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
})
export type NodeDisplayExportRequest = z.output<typeof NodeDisplayExportRequestSchema>
