import { locatePoint } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type { Entrance, Space } from '../schemas/space.ts'

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
