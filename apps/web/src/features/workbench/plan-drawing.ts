import {
  WALL_THICKNESS_M,
  distance,
  distanceToSegment,
  edges,
  isClockwise,
  openingPieces,
  polygonArea,
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

/**
 * The lines of an entrance or open edge: one per boundary edge it runs along (an opening may
 * span several edges, see openingPieces, e.g. a whole arc storefront), so it follows the
 * boundary instead of cutting across it. An opening with an end off the boundary is its chord.
 */
export function openingLines(space: Space, opening: { a: Point; b: Point }): [Point, Point][] {
  const pieces = openingPieces(space, opening)
  if (!pieces) return [[opening.a, opening.b]]
  return pieces.map((piece): [Point, Point] => [piece.a, piece.b])
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

/** Edges shorter than this are not dimensioned (and do not split a side). */
const MIN_EDGE_M = 0.05
/** Neighbouring edges turning less than this read as one straight side, whatever their length. */
const STRAIGHT_TURN_DEG = 1
/** Short neighbouring edges turning less than this are pieces of one arc. */
const ARC_TURN_DEG = 20
/** "Short" for arc pieces: up to this length, or this share of the larger plan extent. */
const ARC_PIECE_M = 2
const ARC_PIECE_SHARE = 0.15
/** A merged side never turns more than this in total, so a round shop keeps several chains. */
const SIDE_TURN_DEG = 90
/**
 * A side whose chain would need more room than this many dimension offsets before it meets
 * the facing boundary (a narrow notch) is not dimensioned: the chains of both faces would
 * cross. The notch still shows through the chain of its bottom.
 */
const NOTCH_OFFSETS = 2.5

const turnDeg = (u: Point, v: Point) =>
  (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI

interface Edge {
  a: Point
  b: Point
  dir: Point
  length: number
}

/**
 * The boundary as sides to dimension: runs of consecutive edges that are straight in line, or
 * short pieces of an arc (a polyline from a discretised curve). Each other edge is a side.
 */
export function boundarySides(boundary: readonly Point[]): Point[][] {
  const ring: Edge[] = edges(boundary)
    .map(([a, b]) => ({ a, b, dir: direction(a, b), length: distance(a, b) }))
    .filter((e) => e.length >= MIN_EDGE_M)
  if (!ring.length) return []
  const xs = boundary.map((p) => p[0])
  const zs = boundary.map((p) => p[1])
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
  const piece = Math.max(ARC_PIECE_M, span * ARC_PIECE_SHARE)
  const joins = (e: Edge, f: Edge) => {
    const turn = turnDeg(e.dir, f.dir)
    return (
      turn < STRAIGHT_TURN_DEG || (turn < ARC_TURN_DEG && e.length <= piece && f.length <= piece)
    )
  }
  // Start at a corner, so a side is never split where the ring happens to begin.
  const n = ring.length
  let start = ring.findIndex((e, i) => !joins(ring[(i - 1 + n) % n] as Edge, e))
  if (start < 0) start = 0
  const sides: Edge[][] = []
  for (let k = 0; k < n; k++) {
    const edge = ring[(start + k) % n] as Edge
    const side = sides[sides.length - 1]
    const last = side?.[side.length - 1]
    const first = side?.[0]
    if (side && last && first && joins(last, edge) && turnDeg(first.dir, edge.dir) <= SIDE_TURN_DEG)
      side.push(edge)
    else sides.push([edge])
  }
  return sides.map((side) => [(side[0] as Edge).a, ...side.map((e) => e.b)])
}

/** Distance from `p` along `dir` to the first of `segments` it meets, or Infinity. */
function rayHit(p: Point, dir: Point, segments: readonly [Point, Point][]): number {
  let best = Infinity
  for (const [c, d] of segments) {
    const s: Point = [d[0] - c[0], d[1] - c[1]]
    const denom = dir[0] * s[1] - dir[1] * s[0]
    if (Math.abs(denom) < 1e-12) continue
    const qx = c[0] - p[0]
    const qz = c[1] - p[1]
    const t = (qx * s[1] - qz * s[0]) / denom
    const u = (qx * dir[1] - qz * dir[0]) / denom
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t)
  }
  return best
}

/**
 * True when most of the side faces other boundary edges closer than `room`: rays cast outwards
 * from points along it meet the boundary again (the faces of a narrow notch).
 */
function cramped(side: Point[], outward: Point, ring: [Point, Point][], room: number) {
  const own = new Set(side.slice(0, -1))
  const others = ring.filter(([a]) => !own.has(a))
  let blocked = 0
  let samples = 0
  for (let i = 1; i < side.length; i++) {
    const a = side[i - 1] as Point
    const b = side[i] as Point
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      samples++
      const p: Point = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      if (rayHit(p, outward, others) < room) blocked++
    }
  }
  return blocked * 2 > samples
}

/**
 * One dimension chain per side of the boundary (see boundarySides), `offset` metres outside
 * it, split where entrances and open edges start and end (as on store drawings). A side made
 * of several edges (an arc) is measured along its chord, outside its outermost point. Sides
 * facing each other across a narrow notch are left out. Labels are millimetres.
 */
export function dimensionChains(space: Space, offset: number): Dimension[] {
  const clockwise = isClockwise(space.boundary)
  const openings = [...space.entrances, ...space.openEdges]
  const ring = edges(space.boundary)
  const out: Dimension[] = []
  for (const side of boundarySides(space.boundary)) {
    const a = side[0] as Point
    const b = side[side.length - 1] as Point
    const length = distance(a, b)
    if (length < MIN_EDGE_M) continue
    const dir = direction(a, b)
    const outward: Point = clockwise ? [dir[1] + 0, -dir[0] + 0] : [-dir[1] + 0, dir[0] + 0]
    if (cramped(side, outward, ring, offset * NOTCH_OFFSETS)) continue
    const along = (p: Point) => (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]
    const bulge = Math.max(
      0,
      ...side.map((p) => (p[0] - a[0]) * outward[0] + (p[1] - a[1]) * outward[1]),
    )
    const pieces = side.slice(1).map((q, i): [Point, Point] => [side[i] as Point, q])
    /** The boundary point measured at station t (on the chord itself for a single edge). */
    const onBoundary = (t: number): Point => {
      if (pieces.length === 1) return add(a, dir, t)
      for (const [p, q] of pieces) {
        const [tp, tq] = [along(p), along(q)]
        if ((t - tp) * (t - tq) <= 0 && tp !== tq) {
          const f = (t - tp) / (tq - tp)
          return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
        }
      }
      return add(a, dir, t)
    }
    const stations = [0, length]
    for (const opening of openings) {
      for (const p of [opening.a, opening.b]) {
        if (!pieces.some(([s, e]) => distanceToSegment(p, s, e) <= 0.02)) continue
        stations.push(Math.min(length, Math.max(0, along(p))))
      }
    }
    const sorted = [...new Set(stations.map((t) => Math.round(t * 1000) / 1000))].sort(
      (x, y) => x - y,
    )
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i - 1] ?? 0
      const e = sorted[i] ?? 0
      if (e - s < 0.001) continue
      out.push({
        a: add(add(a, dir, s), outward, offset + bulge),
        b: add(add(a, dir, e), outward, offset + bulge),
        from: onBoundary(s),
        to: onBoundary(e),
        outward,
        label: String(Math.round((e - s) * 1000)),
        angle: readableAngle(dir),
      })
    }
  }
  return out
}

/**
 * Overall width (above the plan) and depth (left of it), `gap` metres outside the outermost
 * dimension chain on that side. A rectangle gets none: its edge chains are the overall sizes.
 */
export function overallDimensions(
  space: Space,
  chains: readonly Dimension[],
  offset: number,
  gap: number,
): Dimension[] {
  const boundary = space.boundary
  const xs = boundary.map((p) => p[0])
  const zs = boundary.map((p) => p[1])
  const [minX, maxX, minZ, maxZ] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ]
  const width = maxX - minX
  const depth = maxZ - minZ
  if (Math.abs(polygonArea(boundary) - width * depth) <= 1e-6 * Math.max(1, width * depth))
    return []
  const ends = chains.flatMap((d) => [d.a, d.b])
  const top = Math.min(minZ - offset, ...ends.map((p) => p[1])) - gap
  const left = Math.min(minX - offset, ...ends.map((p) => p[0])) - gap
  /** The extreme vertex on one side; among equals the one nearest the dimension line. */
  const extreme = (key: (p: Point) => number, near: (p: Point) => number) =>
    boundary.reduce((best, p) =>
      key(p) < key(best) - 1e-9 || (Math.abs(key(p) - key(best)) <= 1e-9 && near(p) < near(best))
        ? p
        : best,
    )
  const westmost = extreme(
    (p) => p[0],
    (p) => p[1],
  )
  const eastmost = extreme(
    (p) => -p[0],
    (p) => p[1],
  )
  const northmost = extreme(
    (p) => p[1],
    (p) => p[0],
  )
  const southmost = extreme(
    (p) => -p[1],
    (p) => p[0],
  )
  // A side whose total is already one chain (a straight full-width or full-depth edge) needs no
  // overall dimension: it would only repeat that number.
  const spans = (horizontal: boolean, total: number) =>
    chains.some((d) => {
      const along = horizontal ? Math.abs(d.b[0] - d.a[0]) : Math.abs(d.b[1] - d.a[1])
      const across = horizontal ? Math.abs(d.b[1] - d.a[1]) : Math.abs(d.b[0] - d.a[0])
      return across < 1e-6 && Math.abs(along - total) < 0.001
    })
  const overall: Dimension[] = []
  if (!spans(true, width))
    overall.push({
      a: [westmost[0], top],
      b: [eastmost[0], top],
      from: westmost,
      to: eastmost,
      outward: [0, -1],
      label: String(Math.round(width * 1000)),
      angle: 0,
    })
  if (!spans(false, depth))
    overall.push({
      a: [left, northmost[1]],
      b: [left, southmost[1]],
      from: northmost,
      to: southmost,
      outward: [-1, 0],
      label: String(Math.round(depth * 1000)),
      angle: 90,
    })
  return overall
}

/**
 * Half of the 45° tick at a dimension end, as a vector. The legacy tick runs along (1, −1)
 * for lines along x or z; on a slanted line it turns with the line, so it always crosses the
 * line at 45° and never lies on it (a 45° edge).
 */
export function tickHalf(a: Point, b: Point, size: number): Point {
  const theta = Math.atan2(b[1] - a[1], b[0] - a[0])
  const quarter = Math.PI / 2
  const residual = theta - Math.round(theta / quarter) * quarter
  if (Math.abs(residual) < 1e-9) return [size / 2, -size / 2]
  const angle = -Math.PI / 4 + residual
  const half = size / Math.SQRT2
  return [Math.cos(angle) * half, Math.sin(angle) * half]
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
