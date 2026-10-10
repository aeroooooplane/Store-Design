import { z } from 'zod'

/** The numbered plan as PNG, base64; a whole-shop drawing at print size stays well below this. */
export const MAX_PLAN_PNG_BASE64 = 24 * 1024 * 1024

/** Generating the two PDFs of a render node. The plan is drawn by the browser (same as on screen). */
export const DeliveryCreateSchema = z.strictObject({
  /** Numbered plan (PNG, base64 without a data: prefix). */
  planPng: z.string().min(16).max(MAX_PLAN_PNG_BASE64),
  /** The same drawing as self-contained SVG, kept in the archive. */
  planSvg: z
    .string()
    .max(8 * 1024 * 1024)
    .optional(),
})
export type DeliveryCreate = z.output<typeof DeliveryCreateSchema>

const DeliveryFileSchema = z.object({ url: z.string(), name: z.string(), bytes: z.int() })

export const DeliverySchema = z.object({
  id: z.uuid(),
  nodeId: z.uuid(),
  /** `门店名称_门店类型_面积_日期[_修订NN]`, also the archive folder name. */
  folderName: z.string(),
  /** Where the folder was written on the server (ARCHIVE_ROOT). */
  archivePath: z.string().nullable(),
  fullPdf: DeliveryFileSchema,
  showPdf: DeliveryFileSchema,
  zip: DeliveryFileSchema,
  pages: z.object({ full: z.int(), show: z.int() }),
  views: z.int(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type Delivery = z.infer<typeof DeliverySchema>

export const DeliveryListSchema = z.object({
  nodeId: z.uuid(),
  deliveries: z.array(DeliverySchema),
})
export type DeliveryList = z.infer<typeof DeliveryListSchema>
