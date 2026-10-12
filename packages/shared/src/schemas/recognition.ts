import { z } from 'zod'
import { ItemFunctionSchema } from '../enums.ts'
import { NameSchema, PointSchema } from './common.ts'
import { LayoutSchema } from './layout.ts'
import { SpaceSchema } from './space.ts'

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const UPLOAD_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const

/** Which engine read the plan. */
export const RECOGNITION_METHODS = ['local', 'llm'] as const
export const RecognitionMethodSchema = z.enum(RECOGNITION_METHODS)
export type RecognitionMethod = z.infer<typeof RecognitionMethodSchema>

export const RECOGNITION_STATUSES = ['succeeded', 'failed'] as const

/** Where a recognised prop belongs: already there, asked for (red marks), or outside the shop. */
export const ITEM_SOURCES = ['existing', 'requested', 'outside'] as const
export const ItemSourceSchema = z.enum(ITEM_SOURCES)
export type ItemSource = z.infer<typeof ItemSourceSchema>
export const ITEM_SOURCE_LABELS: Record<ItemSource, string> = {
  existing: '现状',
  requested: '新增需求',
  outside: '区域外',
}

/** Local recognition fails below this overall confidence and hands over to the fallback model. */
export const RECOGNITION_MIN_CONFIDENCE = 0.6

const Px = z.number().finite().min(-100_000).max(100_000)
const Colour = z
  .string()
  .regex(/^#[0-9a-f]{6}$/)
  .optional()

/**
 * What the browser pulls out of a vector PDF page (pdf.js): text runs, straight lines and
 * rectangles in pixels of the rendered page, each with its drawn colour when known. The
 * server infers the plan from this without any OCR.
 */
export const VectorContentSchema = z.object({
  width: z.number().positive().max(100_000),
  height: z.number().positive().max(100_000),
  texts: z
    .array(
      z.object({
        text: z.string().max(200),
        x: Px,
        y: Px,
        w: Px,
        h: Px,
        color: Colour,
      }),
    )
    .max(5000),
  lines: z.array(z.object({ x1: Px, y1: Px, x2: Px, y2: Px, color: Colour })).max(20_000),
  rects: z.array(z.object({ x: Px, y: Px, w: Px, h: Px, color: Colour })).max(5000),
})
export type VectorContent = z.infer<typeof VectorContentSchema>

/** How pixels of the uploaded picture map to metres of the plan. */
export const ScaleSchema = z.object({
  method: z.enum(['dimension', 'item_label', 'area', 'manual', 'llm']),
  /** What the scale was read from, e.g. "5400 mm 与 540 px 的尺寸线". */
  reference: z.string().max(500),
  mmPerPixel: z.number().positive(),
  /** Picture pixel that is the plan origin (0, 0). */
  originPx: z.tuple([Px, Px]),
  /** Several dimensions agreed (or the user calibrated). */
  verified: z.boolean(),
})
export type RecognitionScale = z.infer<typeof ScaleSchema>

export const DraftItemSchema = z.object({
  ref: z.string().min(1).max(64),
  /** Text seen on the plan ("中岛桌", "1.2米配件柜", "边桌配件柜*2"). */
  label: z.string().max(100),
  /** Catalogue model this is taken to be, when a name matched. */
  assetId: z.string().nullable(),
  function: ItemFunctionSchema,
  source: ItemSourceSchema,
  /** Metres in plan coordinates, like layout items. */
  cx: z.number().finite(),
  cz: z.number().finite(),
  w: z.number().positive().max(50),
  d: z.number().positive().max(50),
  rotation: z.number().finite(),
  confidence: z.number().min(0).max(1),
  note: z.string().max(300).nullable(),
})
export type DraftItem = z.infer<typeof DraftItemSchema>

/**
 * What recognition produced: the space as far as it could be read, the props seen, the scale,
 * and everything the user still has to settle. Unknown parts are null, never guessed.
 */
export const RecognitionDraftSchema = z.object({
  space: z
    .object({
      boundary: z.array(PointSchema).min(3).max(200),
      entrances: SpaceSchema.shape.entrances,
      obstacles: SpaceSchema.shape.obstacles,
      /** Ceiling height is rarely on a plan; null until the user enters it. */
      height: z.number().positive().max(20).nullable(),
    })
    .nullable(),
  items: z.array(DraftItemSchema).max(200),
  scale: ScaleSchema.nullable(),
  /** Things to confirm by hand, in Chinese ("未找到层高", "比例只有一处依据"). */
  pending: z.array(z.string().max(300)).max(50),
  confidence: z.number().min(0).max(1),
  /** How the result was reached, for the record. */
  notes: z.array(z.string().max(300)).max(50),
})
export type RecognitionDraft = z.infer<typeof RecognitionDraftSchema>

export const PlanUploadSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  fileId: z.uuid(),
  url: z.string(),
  originalName: z.string().nullable(),
  /** Page of the PDF this picture came from (1-based); null for a plain picture. */
  page: z.int().positive().nullable(),
  width: z.int().positive(),
  height: z.int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type PlanUpload = z.infer<typeof PlanUploadSchema>

export const RecognitionRunSchema = z.object({
  id: z.uuid(),
  uploadId: z.uuid(),
  method: RecognitionMethodSchema,
  provider: z.string(),
  model: z.string(),
  status: z.enum(RECOGNITION_STATUSES),
  draft: RecognitionDraftSchema.nullable(),
  /** Why it failed, or why local recognition handed over to the model. */
  error: z.string().nullable(),
  /** When this run was the fallback for a failed one. */
  fallbackOf: z.uuid().nullable(),
  confirmedNodeId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type RecognitionRun = z.infer<typeof RecognitionRunSchema>

/** Starting recognition; vector content lets the local engine work, a picture alone needs a model. */
export const RecognizeRequestSchema = z.strictObject({
  /** Omitted: the site setting (local first, model as fallback). */
  method: RecognitionMethodSchema.optional(),
  vector: VectorContentSchema.optional(),
  /** Picture pixels to recognise within (several shops on one sheet). */
  crop: z.object({ x: Px, y: Px, w: z.number().positive(), h: z.number().positive() }).optional(),
  /** A known length the user points out when no dimension could be read: pixels and millimetres. */
  calibration: z
    .object({ a: z.tuple([Px, Px]), b: z.tuple([Px, Px]), mm: z.number().positive() })
    .optional(),
})
export type RecognizeRequest = z.output<typeof RecognizeRequestSchema>

/** The result of recognising: the run, plus the fallback run when local recognition failed. */
export const RecognizeResponseSchema = z.object({
  run: RecognitionRunSchema,
  /** The local attempt that failed before the model took over, for the record. */
  attempted: RecognitionRunSchema.nullable(),
})
export type RecognizeResponse = z.infer<typeof RecognizeResponseSchema>

/** What the user confirms after correcting the drawing: a full space and the props to keep. */
export const RecognitionConfirmSchema = z.strictObject({
  name: NameSchema,
  space: SpaceSchema,
  layout: LayoutSchema.optional(),
})
export type RecognitionConfirm = z.output<typeof RecognitionConfirmSchema>
