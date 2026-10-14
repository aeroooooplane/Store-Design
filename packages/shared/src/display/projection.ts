import type { Camera } from '../schemas/camera.ts'

type Vec3 = readonly [number, number, number]

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export interface ViewPoint {
  /** 0–1 across the picture from the left. */
  x: number
  /** 0–1 down the picture from the top. */
  y: number
  /** Distance in front of the camera (metres); smaller is nearer. */
  depth: number
}

/**
 * Where a scene point (x, y up, z — plan x and z, height y) lands on a render of this view, as
 * the browser's Three.js camera draws it: vertical field of view fovDeg, world up +y. Null
 * when the point is behind the camera.
 */
export function projectToView(
  camera: Pick<Camera, 'position' | 'target' | 'fovDeg'>,
  aspect: number,
  point: Vec3,
): ViewPoint | null {
  const forward = norm(sub(camera.target, camera.position))
  const right = norm(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const rel = sub(point, camera.position)
  const depth = dot(rel, forward)
  if (depth <= 1e-6) return null
  const half = Math.tan((camera.fovDeg * Math.PI) / 360)
  const ndcX = dot(rel, right) / (depth * half * aspect)
  const ndcY = dot(rel, up) / (depth * half)
  return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2, depth }
}

/** On the picture with a margin (0–1 units) so labels are not cut at the border. */
export const onPicture = (p: ViewPoint | null, margin = 0.04): p is ViewPoint =>
  !!p && p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin
