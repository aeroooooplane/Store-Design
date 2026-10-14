import { NEAR_AXIS_DEG, distanceToBoundary, edges, signedArea, sceneFrame } from '@store/shared'
import type { Point, Polygon, SceneFrame, Space } from '@store/shared'

/** The four walls as seen from the main entrance. */
export const SIDES = ['back', 'front', 'left', 'right'] as const
export type Side = (typeof SIDES)[number]

export const SIDE_LABELS: Record<Side, string> = {
  back: '后墙',
  front: '前边',
  left: '左墙',
  right: '右墙',
}

/**
 * An edge counts as square to its wall within NEAR_AXIS_DEG (3°), the tolerance the automatic
 * planner allows before it stops standing props against an edge.
 */
const SQUARE_COS = Math.cos((NEAR_AXIS_DEG * Math.PI) / 180)

export const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
export const neg = (v: Point): Point => [-v[0] + 0, -v[1] + 0]

/** One boundary edge, from vertex `index` to the next. */
export interface WallEdge {
  index: number
  a: Point
  b: Point
  length: number
  /** Unit direction a → b. */
  tangent: Point
  /** Unit normal pointing into the shop. */
  inward: Point
  /** The wall whose outward direction is nearest to the edge's. */
  side: Side
  /** More than NEAR_AXIS_DEG (3°) off that wall's direction. */
  slanted: boolean
}

/** Outward direction of each wall in a scene frame. */
export function sideDirections(f: SceneFrame): Record<Side, Point> {
  return { back: neg(f.front), front: f.front, left: neg(f.right), right: f.right }
}

/** Every edge of the boundary with its length, inward normal and wall. */
export function wallEdges(space: Space, frame: SceneFrame = sceneFrame(space)): WallEdge[] {
  // With x right and z down a positive signed area is a clockwise ring: (dz, −dx) points out.
  const clockwise = signedArea(space.boundary) > 0
  const directions = sideDirections(frame)
  return edges(space.boundary).map(([a, b], index) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const tangent: Point = length > 0 ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0]
    const out: Point = clockwise ? [tangent[1], -tangent[0]] : [-tangent[1], tangent[0]]
    let side: Side = 'back'
    let best = -Infinity
    for (const s of SIDES) {
      const score = dot(out, directions[s])
      if (score > best + 1e-9) {
        best = score
        side = s
      }
    }
    return { index, a, b, length, tangent, inward: neg(out), side, slanted: best < SQUARE_COS }
  })
}

/** Length of segment pq lying along the edge (within `tol` of its line and between its ends). */
export function overlapOnEdge(p: Point, q: Point, edge: WallEdge, tol = 0.02): number {
  const offset = (r: Point) => Math.abs(dot([r[0] - edge.a[0], r[1] - edge.a[1]], edge.inward))
  if (offset(p) > tol || offset(q) > tol) return 0
  const along = (r: Point) => dot([r[0] - edge.a[0], r[1] - edge.a[1]], edge.tangent)
  const [s0, s1] = [along(p), along(q)].sort((x, y) => x - y) as [number, number]
  return Math.max(0, Math.min(edge.length, s1) - Math.max(0, s0))
}

/** Distance from `from` along the unit direction `dir` to the nearest boundary edge; null if none. */
export function rayToBoundary(from: Point, dir: Point, polygon: Polygon): number | null {
  let nearest: number | null = null
  for (const [a, b] of edges(polygon)) {
    const e: Point = [b[0] - a[0], b[1] - a[1]]
    const denom = dir[0] * e[1] - dir[1] * e[0]
    if (Math.abs(denom) < 1e-12) continue
    const w: Point = [a[0] - from[0], a[1] - from[1]]
    const t = (w[0] * e[1] - w[1] * e[0]) / denom
    const s = (w[0] * dir[1] - w[1] * dir[0]) / denom
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && (nearest === null || t < nearest)) nearest = t
  }
  return nearest
}

/** Even–odd test without a boundary tolerance (the distance takes care of points on it). */
function inside(p: Point, polygon: Polygon): boolean {
  let result = false
  for (const [a, b] of edges(polygon)) {
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
      if (p[0] < x) result = !result
    }
  }
  return result
}

/** How far a point is from the nearest wall or obstacle; negative outside the floor. */
export function clearance(p: Point, space: Space): number {
  const wall = distanceToBoundary(p, space.boundary)
  let d = inside(p, space.boundary) ? wall : -wall
  for (const o of space.obstacles) {
    const edge = distanceToBoundary(p, o.polygon)
    d = Math.min(d, inside(p, o.polygon) ? -edge : edge)
  }
  return d
}

interface Cell {
  x: number
  z: number
  h: number
  d: number
  max: number
}

/**
 * The most open point of the floor (pole of inaccessibility, after Mapbox's polylabel): the
 * point farthest from every wall and obstacle, found to within `precision` metres. `prefer`
 * (the bounding-box centre) wins when it is as open, so a plain rectangle keeps its middle.
 */
export function interiorPoint(space: Space, prefer: Point, precision = 0.01): Point {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const size = Math.min(x1 - x0, z1 - z0)
  if (!(size > 0)) return prefer
  const cell = (x: number, z: number, h: number): Cell => {
    const d = clearance([x, z], space)
    return { x, z, h, d, max: d + h * Math.SQRT2 }
  }
  const queue: Cell[] = []
  for (let x = x0; x < x1; x += size) {
    for (let z = z0; z < z1; z += size) queue.push(cell(x + size / 2, z + size / 2, size / 2))
  }
  let best = cell(prefer[0], prefer[1], 0)
  while (queue.length) {
    let top = 0
    for (let i = 1; i < queue.length; i++)
      if ((queue[i]?.max ?? 0) > (queue[top]?.max ?? 0)) top = i
    const [current] = queue.splice(top, 1)
    if (!current) break
    if (current.d > best.d) best = current
    if (current.max - best.d <= precision) continue
    const h = current.h / 2
    queue.push(
      cell(current.x - h, current.z - h, h),
      cell(current.x + h, current.z - h, h),
      cell(current.x - h, current.z + h, h),
      cell(current.x + h, current.z + h, h),
    )
  }
  return clearance(prefer, space) >= best.d - precision ? prefer : [best.x, best.z]
}
