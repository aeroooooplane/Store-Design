import { distanceToSegment, edges, isClockwise } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type { ShopType } from '../enums.ts'
import type { Space } from '../schemas/space.ts'
import { roundM } from '../units.ts'
import { sceneFrame } from './views.ts'

/** Walls are drawn outside the boundary so the floor area stays exactly as planned. */
export const WALL_THICKNESS_M = 0.16
/** Side and front walls are cut down so the default views can look in (as in the legacy viewer). */
export const CUTAWAY_WALL_HEIGHT_M = 0.7

export interface WallSegment {
  a: Point
  b: Point
  /** Unit normal pointing out of the shop; the wall's thickness lies on this side. */
  outward: Point
  height: number
  kind: 'full' | 'cutaway'
}

const ON_EDGE_M = 0.02
const MIN_WALL_M = 0.05

/** Parameter of `p` along a → b (0 at a, `length` at b), or null if p is not on the edge. */
function along(a: Point, b: Point, p: Point, length: number): number | null {
  if (distanceToSegment(p, a, b) > ON_EDGE_M) return null
  return ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length
}

/** Subtracts the [start, end] gaps from [0, length]. */
function remaining(length: number, gaps: [number, number][]): [number, number][] {
  const pieces: [number, number][] = []
  let cursor = 0
  for (const [start, end] of [...gaps].sort((x, y) => x[0] - y[0])) {
    if (start > cursor) pieces.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < length) pieces.push([cursor, length])
  return pieces.filter(([s, e]) => e - s >= MIN_WALL_M)
}

/**
 * White-model walls: every boundary edge except entrances and open edges. Walls facing away
 * from the entrance are full height; the others are cut away. Island shops have no walls.
 */
export function wallSegments(space: Space, shopType: ShopType): WallSegment[] {
  if (shopType === 'island') return []
  const { front } = sceneFrame(space)
  const openings = [...space.entrances, ...space.openEdges]
  const clockwise = isClockwise(space.boundary)
  return edges(space.boundary).flatMap(([a, b]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < MIN_WALL_M) return []
    const dir: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    // Plan z points down, so a clockwise-on-screen boundary has its outside on the left.
    const outward: Point = clockwise ? [dir[1] + 0, -dir[0] + 0] : [-dir[1] + 0, dir[0] + 0]
    const gaps = openings.flatMap((o) => {
      const s = along(a, b, o.a, length)
      const t = along(a, b, o.b, length)
      return s === null || t === null ? [] : [[Math.min(s, t), Math.max(s, t)] as [number, number]]
    })
    const back = outward[0] * front[0] + outward[1] * front[1] < -0.5
    return remaining(length, gaps).map(([s, e]): WallSegment => ({
      a: [roundM(a[0] + dir[0] * s), roundM(a[1] + dir[1] * s)],
      b: [roundM(a[0] + dir[0] * e), roundM(a[1] + dir[1] * e)],
      outward,
      height: back ? space.height : Math.min(CUTAWAY_WALL_HEIGHT_M, space.height),
      kind: back ? 'full' : 'cutaway',
    }))
  })
}
