import { z } from 'zod'
import { RenderModeSchema } from '../enums.ts'

/** Browser renders: fixed pixel size, VIEW_ASPECT (3:2), large enough for a full PDF page. */
export const RENDER_SIZE = { width: 1800, height: 1200 } as const

/** Upper bound on one uploaded image; a 1800 × 1200 PNG is usually 1–4 MB. */
export const MAX_RENDER_BYTES = 16 * 1024 * 1024

export const RENDER_MODE_LABELS = { white: '白模', material: '材质' } as const

/**
 * The newest image of one view in one mode. `stale` means the layout, the models or the
 * camera pose changed since it was made; the image stays available until it is re-rendered.
 */
export const RenderImageSchema = z.object({
  id: z.uuid(),
  cameraId: z.uuid(),
  mode: RenderModeSchema,
  url: z.string(),
  width: z.int(),
  height: z.int(),
  stale: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type RenderImage = z.infer<typeof RenderImageSchema>

export const NodeRenderListSchema = z.object({
  nodeId: z.uuid(),
  /** Only images of views that are not deleted, newest per view and mode. */
  images: z.array(RenderImageSchema),
})
export type NodeRenderList = z.infer<typeof NodeRenderListSchema>
