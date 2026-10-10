import { z } from 'zod'
import { Vec3Schema } from './common.ts'

export const CAMERA_SOURCES = ['auto', 'user'] as const

/** Upper bound on views per node (default 8 plus the user's own). */
export const MAX_CAMERAS_PER_NODE = 24

const CameraNameSchema = z.string().trim().min(1).max(40)

/** A render viewpoint. White-model and material images of one camera share this exact pose. */
export const CameraSchema = z.object({
  name: CameraNameSchema,
  position: Vec3Schema,
  target: Vec3Schema,
  fovDeg: z.number().finite().min(10).max(120),
  source: z.enum(CAMERA_SOURCES),
})

export type Camera = z.output<typeof CameraSchema>

/** A view stored on a white-model (or render) node; removed views can be restored. */
export const NodeCameraSchema = z.object({
  id: z.uuid(),
  nodeId: z.uuid(),
  sort: z.int(),
  camera: CameraSchema,
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type NodeCamera = z.infer<typeof NodeCameraSchema>

export const NodeCameraListSchema = z.object({
  nodeId: z.uuid(),
  cameras: z.array(NodeCameraSchema),
})
export type NodeCameraList = z.infer<typeof NodeCameraListSchema>

/** A view the user adds, usually from the current orbit position. */
export const CameraCreateSchema = z.strictObject({
  name: CameraNameSchema,
  position: Vec3Schema,
  target: Vec3Schema,
  fovDeg: CameraSchema.shape.fovDeg,
})
export type CameraCreate = z.output<typeof CameraCreateSchema>

/** Rename or re-aim a view; at least one field. */
export const CameraUpdateSchema = CameraCreateSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: '至少修改一项' },
)
export type CameraUpdate = z.output<typeof CameraUpdateSchema>
