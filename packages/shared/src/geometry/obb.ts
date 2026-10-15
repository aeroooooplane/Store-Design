import { EPSILON_M } from '../units.ts'
import { distanceToSegment, edges, locatePoint, segmentsIntersect } from './polygon.ts'
import {
  polygonOverlapsRect,
  rectCorners,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
} from './rect.ts'
import type { Point, Polygon, Rect } from './types.ts'

/**
 * A rectangle turned on the plan: `w` × `d` about its centre, then turned by `angle` degrees
 * with the layout's convention (three.js rotation.y = −angle: a quarter turn takes +X to +Z).
 * At angle 0 every function here gives exactly the result of its axis-aligned counterpart in
 * rect.ts, which it then calls.
 */
export interface Obb {
  cx: number
  cz: number
  w: number
  d: number
  angle: number
}

/** An offset (x, z) turned by `angle` degrees with the layout's convention. */
export function turnPoint(x: number, z: number, angle: number): [number, number] {
  const theta = (-angle * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v)
  return [clean(x * cos + z * sin), clean(-x * sin + z * cos)]
}

const square = (o: Obb) => o.angle % 360 === 0

/** The rectangle of an unturned box. */
function asRect(o: Obb): Rect {
  return rectFromCenter(o.cx, o.cz, o.w, o.d)
}

/** Corners in the same order as rectCorners at angle 0. */
export function obbCorners(o: Obb): [Point, Point, Point, Point] {
  if (square(o)) return rectCorners(asRect(o))
  const at = (x: number, z: number): Point => {
    const [dx, dz] = turnPoint(x, z, o.angle)
    return [o.cx + dx, o.cz + dz]
  }
  const hw = o.w / 2
  const hd = o.d / 2
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)]
}

/** Axis-aligned bounding rectangle. */
export function obbBounds(o: Obb): Rect {
  if (square(o)) return asRect(o)
  const corners = obbCorners(o)
  const xs = corners.map((c) => c[0])
  const zs = corners.map((c) => c[1])
  return {
    minX: Math.min(...xs),
    minZ: Math.min(...zs),
    maxX: Math.max(...xs),
    maxZ: Math.max(...zs),
  }
}

/** A point in the box's own frame (centre at the origin, unturned). */
function toLocal(o: Obb, p: Point): Point {
  return turnPoint(p[0] - o.cx, p[1] - o.cz, -o.angle)
}

const localRect = (o: Obb): Rect => rectFromCenter(0, 0, o.w, o.d)

/** Whether segment ab passes through the interior (see segmentIntersectsRectInterior). */
export function segmentIntersectsObbInterior(a: Point, b: Point, o: Obb, eps = EPSILON_M): boolean {
  if (square(o)) return segmentIntersectsRectInterior(a, b, asRect(o), eps)
  return segmentIntersectsRectInterior(toLocal(o, a), toLocal(o, b), localRect(o), eps)
}

/** Interiors overlap by more than the tolerance; touching edges do not count (separating axes). */
export function obbsOverlap(a: Obb, b: Obb, eps = EPSILON_M): boolean {
  if (square(a) && square(b)) return rectsOverlap(asRect(a), asRect(b), eps)
  const ca = obbCorners(a)
  const cb = obbCorners(b)
  const axes = [a.angle, a.angle + 90, b.angle, b.angle + 90].map((angle) => turnPoint(1, 0, angle))
  for (const [ux, uz] of axes) {
    const project = (corners: Point[]) => corners.map((c) => c[0] * ux + c[1] * uz)
    const pa = project(ca)
    const pb = project(cb)
    if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps)
      return false
  }
  return true
}

/** Lies inside or on a (possibly concave) polygon. */
export function obbInsidePolygon(o: Obb, polygon: Polygon, eps = EPSILON_M): boolean {
  if (square(o)) return rectInsidePolygon(asRect(o), polygon, eps)
  if (obbCorners(o).some((corner) => locatePoint(corner, polygon, eps) === 'outside')) return false
  return !edges(polygon).some(([a, b]) => segmentIntersectsObbInterior(a, b, o, eps))
}

/** Polygon and box interiors overlap (touching does not count). */
export function polygonOverlapsObb(polygon: Polygon, o: Obb, eps = EPSILON_M): boolean {
  if (square(o)) return polygonOverlapsRect(polygon, asRect(o), eps)
  if (edges(polygon).some(([a, b]) => segmentIntersectsObbInterior(a, b, o, eps))) return true
  return locatePoint([o.cx, o.cz], polygon, eps) === 'inside'
}

/** Shortest distance between two boxes; 0 when they touch or overlap. */
export function obbGap(a: Obb, b: Obb): number {
  if (square(a) && square(b)) return rectGap(asRect(a), asRect(b))
  if (obbsOverlap(a, b, 0)) return 0
  const sides = (o: Obb) => edges(obbCorners(o))
  let best = Infinity
  for (const [p, q] of sides(a)) {
    for (const [r, s] of sides(b)) {
      if (segmentsIntersect(p, q, r, s)) return 0
      best = Math.min(
        best,
        distanceToSegment(p, r, s),
        distanceToSegment(q, r, s),
        distanceToSegment(r, p, q),
        distanceToSegment(s, p, q),
      )
    }
  }
  return best
}

/** The quarter turn nearest an angle in degrees: 0, 90, 180 or 270 (45° rounds up). */
export function nearestQuarter(angle: number): 0 | 90 | 180 | 270 {
  const quarter = ((Math.round(angle / 90) % 4) + 4) % 4
  return ([0, 90, 180, 270] as const)[quarter] ?? 0
}

/** What an angle adds to its nearest quarter turn, in degrees: −45 ≤ tilt < 45. */
export function quarterTilt(angle: number): number {
  const tilt = angle - nearestQuarter(angle)
  const wrapped = ((((tilt + 180) % 360) + 360) % 360) - 180
  return Math.abs(wrapped) < 1e-9 ? 0 : wrapped
}

/**
 * The box a placed item takes on the plan. Its `w` × `d` are the size at its nearest quarter turn
 * (width and depth swapped at 90° and 270°), turned by what the rotation adds to that quarter.
 * Without a rotation, or at a quarter turn, the box is axis-aligned.
 */
export function placedBox(item: {
  cx: number
  cz: number
  w: number
  d: number
  rotation?: number | undefined
}): Obb {
  return { cx: item.cx, cz: item.cz, w: item.w, d: item.d, angle: quarterTilt(item.rotation ?? 0) }
}
