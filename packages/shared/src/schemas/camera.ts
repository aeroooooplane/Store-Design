import { z } from 'zod'
import { Vec3Schema } from './common.ts'

export const CAMERA_SOURCES = ['auto', 'user'] as const

/** A render viewpoint. White-model and material images of one camera share this exact pose. */
export const CameraSchema = z.object({
  name: z.string().trim().min(1).max(40),
  position: Vec3Schema,
  target: Vec3Schema,
  fovDeg: z.number().finite().min(10).max(120),
  source: z.enum(CAMERA_SOURCES),
})

export type Camera = z.output<typeof CameraSchema>
