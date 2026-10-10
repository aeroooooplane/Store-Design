import {
  WALL_THICKNESS_M,
  distance,
  distanceToSegment,
  edges,
  isClockwise,
  wallSegments,
} from '@store/shared'
import type { FrontAxis, Point, ShopType, Space, WallSegment } from '@store/shared'

/** Drawing geometry for the plan, in metres (x right, z down), independent of SVG. */

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
 * Walls as hatched bands outside the boundary (the same walls as the 3D model). Neighbouring
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
      // Very sharp corners would spike; they get a plain (bevelled) end instead.
      return point && distance(point, at) < thickness * 4 ? point : fallback
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

export interface Dimension {
  /** Dimension line ends, already moved outside the plan. */
  a: Point
  b: Point
  /** Where the measured stretch starts and ends on the boundary (for extension lines). */
  from: Point
  to: Point
  /** Unit vector pointing away from the plan. */
  outward: Point
  label: string
  /** Text angle in degrees, turned so it never reads upside down. */
  angle: number
}

/** Angle of a direction in degrees, folded into (−90°, 90°] so text stays readable. */
export function readableAngle(dir: Point): number {
  let degrees = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
  if (degrees > 90) degrees -= 180
  if (degrees <= -90) degrees += 180
  return degrees + 0
}

/**
 * One dimension chain per boundary edge, `offset` metres outside it, split where entrances and
 * open edges start and end (as on store drawings). Labels are millimetres.
 */
export function dimensionChains(space: Space, offset: number): Dimension[] {
  const clockwise = isClockwise(space.boundary)
  const openings = [...space.entrances, ...space.openEdges]
  const out: Dimension[] = []
  for (const [a, b] of edges(space.boundary)) {
    const length = distance(a, b)
    if (length < 0.05) continue
    const dir = direction(a, b)
    const outward: Point = clockwise ? [dir[1] + 0, -dir[0] + 0] : [-dir[1] + 0, dir[0] + 0]
    const stations = [0, length]
    for (const opening of openings) {
      for (const p of [opening.a, opening.b]) {
        if (distanceToSegment(p, a, b) > 0.02) continue
        const t = (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]
        stations.push(Math.min(length, Math.max(0, t)))
      }
    }
    const sorted = [...new Set(stations.map((t) => Math.round(t * 1000) / 1000))].sort(
      (x, y) => x - y,
    )
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i - 1] ?? 0
      const e = sorted[i] ?? 0
      if (e - s < 0.001) continue
      const from = add(a, dir, s)
      const to = add(a, dir, e)
      out.push({
        a: add(from, outward, offset),
        b: add(to, outward, offset),
        from,
        to,
        outward,
        label: String(Math.round((e - s) * 1000)),
        angle: readableAngle(dir),
      })
    }
  }
  return out
}

/** Size of a plan symbol drawing in metres, without its transparent margin. */
export interface SymbolSize {
  w: number
  d: number
}

/** The plan-symbol SVGs keep an 18 mm transparent margin on every side (资源库 使用说明). */
export const SYMBOL_MARGIN_M = 0.018

/** Reads the drawn size from an SVG's viewBox (1 unit = 1 mm). */
export function symbolSizeFromSvg(svg: string): SymbolSize | null {
  const match = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg)
  if (!match) return null
  const w = Number(match[1]) / 1000 - SYMBOL_MARGIN_M * 2
  const d = Number(match[2]) / 1000 - SYMBOL_MARGIN_M * 2
  return w > 0 && d > 0 ? { w, d } : null
}

/**
 * How far to turn a symbol (front drawn at the bottom) so it lies like the unrotated model:
 * the model's front direction decides; a model without a front lies whichever way matches
 * its footprint. The item's own rotation is added on top (SVG rotate, same sense as 3D).
 */
export function symbolBaseRotation(
  front: FrontAxis | null,
  footprint: { w: number; d: number },
  symbol: SymbolSize,
): number {
  if (front === '+Z') return 0
  if (front === '-Z') return 180
  if (front === '+X') return -90
  if (front === '-X') return 90
  const straight = Math.abs(symbol.w - footprint.w) + Math.abs(symbol.d - footprint.d)
  const turned = Math.abs(symbol.w - footprint.d) + Math.abs(symbol.d - footprint.w)
  return turned < straight ? 90 : 0
}
