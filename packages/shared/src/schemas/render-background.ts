import { z } from 'zod'
import { isSimplePolygon } from '../geometry/polygon.ts'

export const MAX_BACKGROUND_BYTES = 16 * 1024 * 1024

export const BackgroundPointSchema = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
])
export type BackgroundPoint = z.output<typeof BackgroundPointSchema>

export const BackgroundImageSchema = z.object({
  fileId: z.uuid(),
  url: z.string().regex(/^\/api\/v1\/files\/[0-9a-f-]+$/i),
  width: z.int().min(1).max(8192),
  height: z.int().min(1).max(8192),
  name: z.string().min(1).max(180),
})
export type BackgroundImage = z.output<typeof BackgroundImageSchema>

const BackgroundMaskSchema = z.object({
  id: z.string().min(1).max(64),
  points: z
    .array(BackgroundPointSchema)
    .min(3)
    .max(100)
    .refine((points) => isSimplePolygon(points, 1e-9), '遮罩需为没有自交的闭合面'),
})

export const RenderBackgroundSchema = z
  .object({
    image: BackgroundImageSchema,
    transform: z.object({
      x: z.number().finite().min(-10).max(10),
      y: z.number().finite().min(-10).max(10),
      width: z.number().finite().min(0.01).max(20),
      rotationDeg: z.number().finite().min(-360).max(360),
    }),
    masks: z.array(BackgroundMaskSchema).max(32),
    guides: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          points: z.tuple([BackgroundPointSchema, BackgroundPointSchema]),
        }),
      )
      .max(100),
    guidesVisible: z.boolean(),
    showTransparentWalls: z.boolean(),
    showFloor: z.boolean().optional(),
    modelOpacity: z.number().finite().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    for (const key of ['masks', 'guides'] as const) {
      const ids = value[key].map((item) => item.id)
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', path: [key], message: '对象编号不能重复' })
      }
    }
  })
export type RenderBackground = z.output<typeof RenderBackgroundSchema>
