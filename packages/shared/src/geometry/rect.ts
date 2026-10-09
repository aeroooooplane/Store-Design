import { EPSILON_M } from '../units.ts'
import { edges, locatePoint } from './polygon.ts'
import type { Point, Polygon, Rect } from './types.ts'

export function rectFromCenter(cx: number, cz: number, w: number, d: number): Rect {
  return { minX: cx - w / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxZ: cz + d / 2 }
}

export function rectCorners(rect: Rect): [Point, Point, Point, Point] {
  return [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
  ]
}

/** Interiors overlap by more than the tolerance; touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect, eps = EPSILON_M): boolean {
  return (
    a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps
  )
}

/** Shortest distance between two rectangles; 0 when they touch or overlap. */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX)
  const dz = Math.max(0, b.minZ - a.maxZ, a.minZ - b.maxZ)
  return Math.hypot(dx, dz)
}

/**
 * Whether segment ab passes through the rectangle interior (shrunk by eps so that segments
 * lying on or touching the rectangle edges do not count). Liang–Barsky clipping.
 */
export function segmentIntersectsRectInterior(
  a: Point,
  b: Point,
  rect: Rect,
  eps = EPSILON_M,
): boolean {
  const minX = rect.minX + eps
  const maxX = rect.maxX - eps
  const minZ = rect.minZ + eps
  const maxZ = rect.maxZ - eps
  if (minX >= maxX || minZ >= maxZ) return false
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const p = [-dx, dx, -dz, dz]
  const q = [a[0] - minX, maxX - a[0], a[1] - minZ, maxZ - a[1]]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    const pi = p[i] ?? 0
    const qi = q[i] ?? 0
    if (pi === 0) {
      if (qi < 0) return false
      continue
    }
    const t = qi / pi
    if (pi < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/** Rectangle lies inside or on a (possibly concave) polygon. */
export function rectInsidePolygon(rect: Rect, polygon: Polygon, eps = EPSILON_M): boolean {
  if (rectCorners(rect).some((corner) => locatePoint(corner, polygon, eps) === 'outside'))
    return false
  return !edges(polygon).some(([a, b]) => segmentIntersectsRectInterior(a, b, rect, eps))
}

/** Polygon and rectangle interiors overlap (touching does not count). */
export function polygonOverlapsRect(polygon: Polygon, rect: Rect, eps = EPSILON_M): boolean {
  if (edges(polygon).some(([a, b]) => segmentIntersectsRectInterior(a, b, rect, eps))) return true
  // No edge enters the rectangle: either the rectangle sits inside the polygon or apart from it.
  const center: Point = [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2]
  return locatePoint(center, polygon, eps) === 'inside'
}
