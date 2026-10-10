import { locatePoint } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type { Camera } from '../schemas/camera.ts'
import type { Entrance, Space } from '../schemas/space.ts'
import { roundM } from '../units.ts'

/**
 * The shop seen from its main entrance: `front` points out through the entrance, `right` is
 * the visitor's right when walking in. Extents are measured along these axes, so the same
 * view names work for any polygon and any entrance side. Without an entrance the front is
 * the bottom of the plan (+z), as in the legacy viewer.
 */
export interface SceneFrame {
  front: Point
  right: Point
  center: Point
  width: number
  depth: number
  /** Midpoint of the main entrance, or of the front side when there is none. */
  entrance: Point
}

export function mainEntrance(space: Space): Entrance | null {
  return space.entrances.find((e) => e.kind === 'main') ?? space.entrances[0] ?? null
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
/** Direction with -0 folded into 0, so axis-aligned directions compare equal. */
const unit = (x: number, z: number): Point => [x + 0, z + 0]

/** Unit normal of the entrance pointing out of the shop. */
function outwardNormal(space: Space, entrance: Entrance): Point | null {
  const dx = entrance.b[0] - entrance.a[0]
  const dz = entrance.b[1] - entrance.a[1]
  const length = Math.hypot(dx, dz)
  if (length === 0) return null
  const normal = unit(dz / length, -dx / length)
  const mid: Point = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
  const probe: Point = [mid[0] + normal[0] * 0.05, mid[1] + normal[1] * 0.05]
  return locatePoint(probe, space.boundary) === 'inside' ? unit(-normal[0], -normal[1]) : normal
}

export function sceneFrame(space: Space): SceneFrame {
  const entrance = mainEntrance(space)
  const front = (entrance && outwardNormal(space, entrance)) ?? [0, 1]
  const right = unit(front[1], -front[0])
  const us = space.boundary.map((p) => dot(p, right))
  const vs = space.boundary.map((p) => dot(p, front))
  const [uMin, uMax, vMin, vMax] = [
    Math.min(...us),
    Math.max(...us),
    Math.min(...vs),
    Math.max(...vs),
  ]
  const u = (uMin + uMax) / 2
  const v = (vMin + vMax) / 2
  const center: Point = [right[0] * u + front[0] * v, right[1] * u + front[1] * v]
  const depth = vMax - vMin
  return {
    front,
    right,
    center,
    width: uMax - uMin,
    depth,
    entrance: entrance
      ? [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
      : [center[0] + (front[0] * depth) / 2, center[1] + (front[1] * depth) / 2],
  }
}

/**
 * The legacy default views, as [name, across, height, along]: `across` runs 0 → 1 from the
 * visitor's left to right, `along` 0 → 1 from the back wall to the entrance, `height` is a
 * multiple of the larger plan extent. Values outside 0–1 stand outside the shop.
 */
const ORBIT_VIEWS: readonly [string, number, number, number][] = [
  ['正面鸟瞰', 0.5, 1.15, 1.8],
  ['左前方', -0.7, 1, 1.4],
  ['右前方', 1.7, 1, 1.4],
  ['右后方', 1.7, 1, -0.4],
  ['左后方', -0.7, 1, -0.4],
  ['背面鸟瞰', 0.5, 1.3, -0.85],
  ['顶部俯视', 0.5, 2.4, 0.501],
]

export const DEFAULT_VIEW_NAMES = [...ORBIT_VIEWS.map((v) => v[0]), '入口方向'] as const

/** Image aspect ratio of every view (legacy 960 × 640). */
export const VIEW_ASPECT = 1.5

const vec = (p: Point, y: number): [number, number, number] => [
  roundM(p[0]),
  roundM(y),
  roundM(p[1]),
]

/** The eight default views of a white model, deterministic for a given space. */
export function defaultCameras(space: Space): Camera[] {
  const f = sceneFrame(space)
  const at = (across: number, along: number): Point => {
    const a = (across - 0.5) * f.width
    const b = (along - 0.5) * f.depth
    return [
      f.center[0] + f.right[0] * a + f.front[0] * b,
      f.center[1] + f.right[1] * a + f.front[1] * b,
    ]
  }
  const span = Math.max(f.width, f.depth)
  const target = vec(f.center, space.height * 0.25)
  const orbit = ORBIT_VIEWS.map(([name, across, height, along]) => ({
    name,
    position: vec(at(across, along), span * height),
    target,
    fovDeg: 48,
    source: 'auto' as const,
  }))
  const outside: Point = [f.entrance[0] + f.front[0] * 0.8, f.entrance[1] + f.front[1] * 0.8]
  const inside: Point = [
    f.entrance[0] - f.front[0] * f.depth * 0.75,
    f.entrance[1] - f.front[1] * f.depth * 0.75,
  ]
  return [
    ...orbit,
    {
      name: '入口方向',
      position: vec(outside, Math.min(1.65, space.height * 0.6)),
      target: vec(inside, Math.min(1.35, space.height * 0.45)),
      fovDeg: 72,
      source: 'auto',
    },
  ]
}
