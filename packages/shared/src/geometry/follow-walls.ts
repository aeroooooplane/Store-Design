import { EPSILON_M, roundM } from '../units.ts'
import { edges, locatePoint } from './polygon.ts'
import type { Point, Polygon, Rect } from './types.ts'

/** A prop side this close to a wall counts as standing against it. */
export const AGAINST_WALL_M = 0.01
/** Boundary edges within this angle of an axis count as straight walls. */
const STRAIGHT_DEG = 3

interface Face {
  /** The axis the wall runs along: 'x' is a wall at z = `at`, 'z' a wall at x = `at`. */
  along: 'x' | 'z'
  at: number
  from: number
  to: number
  /** +1 when the shop lies on the larger-coordinate side of the wall. */
  inward: 1 | -1
}

function faces(boundary: Polygon): Face[] {
  const tan = Math.tan((STRAIGHT_DEG * Math.PI) / 180)
  const list: Face[] = []
  for (const [a, b] of edges(boundary)) {
    const dx = Math.abs(b[0] - a[0])
    const dz = Math.abs(b[1] - a[1])
    if (Math.hypot(dx, dz) < EPSILON_M) continue
    const along = dz <= dx * tan ? 'x' : dx <= dz * tan ? 'z' : null
    if (!along) continue
    const i = along === 'x' ? 0 : 1
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const probe: Point = along === 'x' ? [mid[0], mid[1] + 0.01] : [mid[0] + 0.01, mid[1]]
    list.push({
      along,
      at: along === 'x' ? mid[1] : mid[0],
      from: Math.min(a[i], b[i]),
      to: Math.max(a[i], b[i]),
      inward: locatePoint(probe, boundary) === 'inside' ? 1 : -1,
    })
  }
  return list
}

/**
 * How far a prop standing against a wall moves when the boundary changes from `before` to
 * `after`: each straight wall it touches is matched to the nearest parallel wall facing the same
 * way that still runs past the prop, and the prop follows that wall's shift, so its back stays
 * on the wall. [0, 0] for a prop that touches no wall or whose walls stayed put.
 */
export function wallShift(rect: Rect, before: Polygon, after: Polygon): [dx: number, dz: number] {
  const next = faces(after)
  let dx = 0
  let dz = 0
  for (const face of faces(before)) {
    const side =
      face.along === 'x'
        ? face.inward > 0
          ? rect.minZ
          : rect.maxZ
        : face.inward > 0
          ? rect.minX
          : rect.maxX
    if (Math.abs(side - face.at) > AGAINST_WALL_M + EPSILON_M) continue
    const [s0, s1] = face.along === 'x' ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ]
    const runsPast = (f: Face) => s0 < f.to - EPSILON_M && s1 > f.from + EPSILON_M
    if (!runsPast(face)) continue
    let best: Face | null = null
    for (const f of next) {
      if (f.along !== face.along || f.inward !== face.inward || !runsPast(f)) continue
      if (!best || Math.abs(f.at - face.at) < Math.abs(best.at - face.at)) best = f
    }
    if (!best) continue
    const shift = roundM(best.at - face.at)
    if (face.along === 'x' && dz === 0) dz = shift
    if (face.along === 'z' && dx === 0) dx = shift
  }
  return [dx, dz]
}
