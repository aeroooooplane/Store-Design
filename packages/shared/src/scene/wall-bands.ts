import { distance } from '../geometry/polygon.ts'
import type { Point } from '../geometry/types.ts'
import type { ShopType } from '../enums.ts'
import type { Space } from '../schemas/space.ts'
import { WALL_THICKNESS_M, wallSegments } from './walls.ts'
import type { WallSegment } from './walls.ts'
import { wallUnion } from './wall-union.ts'

const add = (p: Point, v: Point, s = 1): Point => [p[0] + v[0] * s, p[1] + v[1] * s]
const same = (p: Point, q: Point) => distance(p, q) < 1e-6
const direction = (a: Point, b: Point): Point => {
  const length = distance(a, b) || 1
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
}

function lineIntersection(p: Point, r: Point, q: Point, s: Point): Point | null {
  const denom = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denom) < 1e-9) return null
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denom
  return add(p, r, t)
}

export interface WallBand {
  /** Filled area of one wall run: inner face a→b, outer face mitred against its neighbours. */
  polygon: Point[]
  /** Lines to stroke: inner and outer faces, plus end caps where the wall stops at an opening. */
  outline: [Point, Point][]
}

/**
 * Mitred wall bands outside the boundary (the same walls as the 3D model). Neighbouring
 * runs meet in a mitre, so the outline is continuous and overlapping fills show no seam.
 */
export function wallBands(
  space: Space,
  shopType: ShopType,
  thickness = WALL_THICKNESS_M,
): WallBand[] {
  const walls = wallSegments(space, shopType)
  const outerLine = (w: WallSegment) => ({
    p: add(w.a, w.outward, thickness),
    r: direction(w.a, w.b),
  })
  return walls.map((wall, i) => {
    const prev = walls[(i - 1 + walls.length) % walls.length]
    const next = walls[(i + 1) % walls.length]
    const own = outerLine(wall)
    const plainA = add(wall.a, wall.outward, thickness)
    const plainB = add(wall.b, wall.outward, thickness)
    const mitre = (other: WallSegment | undefined, at: Point, fallback: Point) => {
      if (!other || other === wall) return null
      const line = outerLine(other)
      const point = lineIntersection(own.p, own.r, line.p, line.r)
      // Both neighbouring runs must share the same capped mitre, even at acute corners.
      if (!point) return fallback
      const reach = distance(point, at)
      return reach <= thickness * 4 ? point : add(at, direction(at, point), thickness * 4)
    }
    const joinsPrev = prev !== undefined && prev !== wall && same(prev.b, wall.a)
    const joinsNext = next !== undefined && next !== wall && same(wall.b, next.a)
    const outerA = (joinsPrev ? mitre(prev, wall.a, plainA) : null) ?? plainA
    const outerB = (joinsNext ? mitre(next, wall.b, plainB) : null) ?? plainB
    const outline: [Point, Point][] = [
      [wall.a, wall.b],
      [outerA, outerB],
    ]
    if (!joinsPrev) outline.push([wall.a, outerA])
    if (!joinsNext) outline.push([wall.b, outerB])
    return { polygon: [wall.a, wall.b, outerB, outerA], outline }
  })
}

/** Actual wall silhouette, with coincident/overlapping runs merged and the lease interior cut out. */
export function wallContours(
  space: Space,
  shopType: ShopType,
  thickness = WALL_THICKNESS_M,
): Point[][] {
  const walls = wallSegments(space, shopType),
    bands = wallBands(space, shopType, thickness)
  const polygons: Point[][] = []
  walls.forEach((wall, i) => {
    const band = bands[i]!,
      a = add(wall.a, wall.outward, thickness),
      b = add(wall.b, wall.outward, thickness)
    polygons.push([wall.a, wall.b, b, a])
    // Corner wedges close both sides of each mitre. Using simple triangles also handles
    // very short steps whose single four-point mitre band would fold over itself.
    polygons.push([wall.a, a, band.polygon[3]!], [wall.b, band.polygon[2]!, b])
  })
  return wallUnion(polygons, space.boundary)
}
