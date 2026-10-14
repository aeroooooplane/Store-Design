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
/**
 * A merged side never turns more than this in total, so a round shop keeps several chains. A
 * longer arc is cut into the fewest equal parts within it (store-0293's 210° arc: three of 70°,
 * not 90° + 90° + 30°).
 */
const SIDE_TURN_DEG = 90
/**
 * A side whose chain would need more room than this many dimension offsets before it meets
 * the facing boundary (a narrow notch) is not dimensioned: the chains of both faces would
 * cross. The notch still shows through the chain of its bottom.
 */
const NOTCH_OFFSETS = 2.5

const turnDeg = (u: Point, v: Point) =>
  (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI
/** Signed turn from `u` to `v` in degrees. */
const signedTurnDeg = (u: Point, v: Point) =>
  (Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI

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
  const n = ring.length
  const at = (i: number) => ring[((i % n) + n) % n] as Edge
  const short = (e: Edge) => e.length <= piece
  const straight = (e: Edge, f: Edge) => turnDeg(e.dir, f.dir) < STRAIGHT_TURN_DEG
  const curved = (e: Edge, f: Edge) => turnDeg(e.dir, f.dir) < ARC_TURN_DEG && short(e) && short(f)
  /** `e` goes on bending into `f`: both are pieces of one arc. */
  const bends = (e: Edge, f: Edge) => curved(e, f) && !straight(e, f)
  /**
   * Edge i − 1 and edge i belong to one side. The first piece of an arc tangent to a long wall
   * turns from it by only half a step (under 1° on store-0043's round corners), but it bends on
   * with the next piece: it belongs to the arc, not to the wall.
   */
  const joins = (i: number) => {
    const [e, f] = [at(i - 1), at(i)]
    if (straight(e, f)) {
      if (!short(e) && short(f) && bends(f, at(i + 1))) return false
      if (short(e) && !short(f) && bends(at(i - 2), e)) return false
      return true
    }
    return curved(e, f)
  }
  // Start at a corner, so a side is never split where the ring happens to begin.
  let start = ring.findIndex((_, i) => !joins(i))
  if (start < 0) start = 0
  const runs: Edge[][] = []
  for (let k = 0; k < n; k++) {
    const run = runs[runs.length - 1]
    if (run && joins(start + k)) run.push(at(start + k))
    else runs.push([at(start + k)])
  }
  // A run turning more than SIDE_TURN_DEG in total is cut into the fewest equal parts within it.
  const sides = runs.flatMap((run): Edge[][] => {
    // How far each edge has turned from the first one (pieces of an arc all turn the same way).
    let sum = 0
    const heading = run.map((edge, i) => {
      if (i > 0) sum += signedTurnDeg((run[i - 1] as Edge).dir, edge.dir)
      return Math.abs(sum)
    })
    const total = Math.max(...heading)
    const parts = Math.ceil(total / SIDE_TURN_DEG - 1e-9)
    if (parts <= 1) return [run]
    const out: Edge[][] = Array.from({ length: parts }, () => [])
    let part = 0
    run.forEach((edge, i) => {
      part = Math.max(part, Math.min(parts - 1, Math.floor(((heading[i] ?? 0) * parts) / total)))
      out[part]?.push(edge)
    })
    return out.filter((side) => side.length > 0)
  })
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

/** Sides shorter than this (small steps in a lease line) get no chain of their own. */
const SHORT_SIDE_M = 0.3
/** Two sides either side of small steps turning less than this share one dimension line. */
const PARALLEL_DEG = 5
/**
 * A side of several edges is an arc when its vertices lie within this share of the radius (at
 * least ARC_FIT_M) of the circle fitted to them; it is then labelled with its radius.
 */
const ARC_FIT_SHARE = 0.01
const ARC_FIT_M = 0.02
/** …and when it has at least three edges turning this much in total. */
const ARC_MIN_TURN_DEG = 15
/**
 * Radii are labelled to 5 mm: traced drafts are only good to a few millimetres, and the four
 * equal corners of store-0043 fit 1489.5–1489.8 mm (R1489 beside R1490 to the millimetre).
 */
const RADIUS_ROUND_MM = 5

export interface Circle {
  center: Point
  radius: number
}

/**
 * Least-squares circle through `points` (algebraic fit, Kåsa), with the radius taken as the
 * mean distance to the centre. Null when the points are (nearly) collinear.
 */
export function fitCircle(points: readonly Point[]): Circle | null {
  const n = points.length
  if (n < 3) return null
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const mz = points.reduce((s, p) => s + p[1], 0) / n
  let [suu, suv, svv, suw, svw] = [0, 0, 0, 0, 0]
  for (const p of points) {
    const u = p[0] - mx
    const v = p[1] - mz
    const w = u * u + v * v
    suu += u * u
    suv += u * v
    svv += v * v
    suw += u * w
    svw += v * w
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-12 * Math.max(1, suu * svv)) return null
  // Centre (uc, vc) solves [suu suv; suv svv] · (uc, vc) = (suw, svw) / 2.
  const uc = (suw * svv - svw * suv) / (2 * det)
  const vc = (svw * suu - suw * suv) / (2 * det)
  const center: Point = [mx + uc, mz + vc]
  const radius = points.reduce((s, p) => s + distance(p, center), 0) / n
  return Number.isFinite(radius) ? { center, radius } : null
}

/** Largest distance of `points` from the circle. */
const circleDeviation = (points: readonly Point[], circle: Circle) =>
  Math.max(...points.map((p) => Math.abs(distance(p, circle.center) - circle.radius)))

const fitsArc = (points: readonly Point[], circle: Circle | null): circle is Circle =>
  circle !== null &&
  circleDeviation(points, circle) < Math.max(ARC_FIT_M, circle.radius * ARC_FIT_SHARE)

/** Total signed turn along a polyline, in degrees. */
function totalTurnDeg(points: readonly Point[]): number {
  let sum = 0
  for (let i = 2; i < points.length; i++) {
    const u = direction(points[i - 2] as Point, points[i - 1] as Point)
    const v = direction(points[i - 1] as Point, points[i] as Point)
    sum += signedTurnDeg(u, v)
  }
  return sum
}

/** The circle of a side that is an arc (see ARC_FIT_SHARE), or null. */
function arcOf(points: readonly Point[]): Circle | null {
  if (points.length < 4 || Math.abs(totalTurnDeg(points)) < ARC_MIN_TURN_DEG) return null
  const circle = fitCircle(points)
  return fitsArc(points, circle) ? circle : null
}

interface PlanSide {
  points: Point[]
  chord: number
  /** The fitted circle when the side is an arc. */
  arc: Circle | null
  /** All its vertices lie on its chord (one edge, or collinear edges). */
  straight: boolean
}

function planSides(boundary: readonly Point[]): PlanSide[] {
  return boundarySides(boundary).map((points) => {
    const a = points[0] as Point
    const b = points[points.length - 1] as Point
    const dir = direction(a, b)
    const off = (p: Point) => Math.abs((p[0] - a[0]) * dir[1] - (p[1] - a[1]) * dir[0])
    return {
      points,
      chord: distance(a, b),
      arc: arcOf(points),
      straight: points.every((p) => off(p) < 0.01),
    }
  })
}

/**
 * Sides measured together on one dimension line: each side alone, except that two straight,
 * parallel sides with only small steps (shorter than SHORT_SIDE_M) between them share one
 * chain. Steps that join no such pair are left out (their depth shows in the overall sizes).
 * A plan of four sides or fewer keeps every side.
 */
function sideGroups(sides: PlanSide[]): PlanSide[][] {
  const n = sides.length
  if (n <= 4) return sides.map((side) => [side])
  const longs = sides.flatMap((side, i) => (side.chord >= SHORT_SIDE_M ? [i] : []))
  const count = longs.length
  if (!count) return []
  const sideAt = (i: number) => sides[((i % n) + n) % n] as PlanSide
  const dirOf = (side: PlanSide) =>
    direction(side.points[0] as Point, side.points[side.points.length - 1] as Point)
  /** The k-th long side joins the next one across small steps. */
  const joinsNext = (k: number) => {
    if (count < 2) return false
    const i = longs[((k % count) + count) % count] as number
    const j = longs[(((k + 1) % count) + count) % count] as number
    const steps = (j - i + n) % n
    if (steps < 2) return false
    const [p, q] = [sideAt(i), sideAt(j)]
    return p.straight && q.straight && turnDeg(dirOf(p), dirOf(q)) < PARALLEL_DEG
  }
  let start = longs.findIndex((_, k) => !joinsNext(k - 1))
  if (start < 0) start = 0
  const groups: PlanSide[][] = []
  for (let m = 0; m < count; m++) {
    const k = start + m
    const i = longs[k % count] as number
    const group = groups[groups.length - 1]
    if (group && m > 0 && joinsNext(k - 1)) {
      const prev = longs[(k - 1) % count] as number
      for (let s = prev + 1; s !== i + (i <= prev ? n : 0) + 1; s++) group.push(sideAt(s))
    } else groups.push([sideAt(i)])
  }
  return groups
}

export interface Dimension {
  /** Dimension line ends, already moved outside the plan. */
  a: Point
  b: Point
  /** Where the measured stretch starts and ends on the boundary (for extension lines). */
  from: Point
  to: Point
  /**
   * Where the extension lines start, when not just outside the wall at `from` / `to`: a short
   * stub near the dimension line, or (no extension line) the end itself.
   */
  extA?: Point
  extB?: Point
  /** Unit vector pointing away from the plan. */
  outward: Point
  label: string
  /** Text angle in degrees, turned so it never reads upside down. */
  angle: number
  /** Dimensions of one chain share this number (they move outwards together). */
  chain?: number
}

/** Radius label of an arc: a leader from the arc outwards and "R…" beyond it. */
export interface RadiusMark extends Circle {
  /** Point on the boundary halfway along the arc, where the leader arrow touches it. */
  at: Point
  /** Outer end of the leader; the label sits beyond it. */
  end: Point
  /** Unit vector along the leader, away from the plan (along the radius). */
  outward: Point
  label: string
  angle: number
}

const outwardOf = (dir: Point, clockwise: boolean): Point =>
  clockwise ? [dir[1] + 0, -dir[0] + 0] : [-dir[1] + 0, dir[0] + 0]

/**
 * Moves a dimension line end `p` measured at vertex `v` out of the wall of the neighbouring
 * edge n0 → n1 (an inner corner, where the extension line would run along that wall): back
 * along `back` to the wall's outer face. Null when the end is clear of that wall.
 */
function clearOfWall(
  p: Point,
  v: Point,
  [n0, n1]: [Point, Point],
  back: Point,
  clockwise: boolean,
): Point | null {
  const length = distance(n0, n1)
  if (length < MIN_EDGE_M) return null
  const nd = direction(n0, n1)
  const nOut = outwardOf(nd, clockwise)
  const t = (p[0] - n0[0]) * nd[0] + (p[1] - n0[1]) * nd[1]
  if (t < 1e-6 || t > length - 1e-6) return null
  const d = (p[0] - v[0]) * nOut[0] + (p[1] - v[1]) * nOut[1]
  if (d < -1e-6 || d >= WALL_THICKNESS_M - 1e-6) return null
  const rate = back[0] * nOut[0] + back[1] * nOut[1]
  if (rate < 0.3) return null
  return add(p, back, (WALL_THICKNESS_M - d) / rate)
}

/**
 * One dimension chain per side of the boundary (see boundarySides), `offset` metres outside
 * it, split where entrances and open edges start and end (as on store drawings). A side made
 * of several edges is measured along its chord, outside its outermost point; an arc among
 * them (see radiusMarks) gets its radius instead, unless an opening splits it. Small steps
 * share the chain of the parallel sides they join (see sideGroups). Sides facing each other
 * across a narrow notch are left out. At an inner corner the chain stops at the outer face of
 * the neighbouring wall. Labels are millimetres.
 */
export function dimensionChains(space: Space, offset: number): Dimension[] {
  const clockwise = isClockwise(space.boundary)
  const openings = [...space.entrances, ...space.openEdges]
  const ring = edges(space.boundary)
  const out: Dimension[] = []
  let chain = 0
  for (const group of sideGroups(planSides(space.boundary))) {
    const first = group[0] as PlanSide
    const side = group.flatMap((s, i) => (i === 0 ? s.points : s.points.slice(1)))
    const a = side[0] as Point
    const last = side[side.length - 1] as Point
    // One side: along its chord. Parallel sides across steps: along the longest of them.
    const main = group.reduce((best, s) =>
      s.chord >= SHORT_SIDE_M && s.chord > best.chord ? s : best,
    )
    const dir =
      group.length === 1
        ? direction(a, last)
        : direction(main.points[0] as Point, main.points[main.points.length - 1] as Point)
    const along = (p: Point) => (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]
    const length = group.length === 1 ? distance(a, last) : along(last)
    if (length < MIN_EDGE_M) continue
    const outward = outwardOf(dir, clockwise)
    if (cramped(side, outward, ring, offset * NOTCH_OFFSETS)) continue
    const bulge = Math.max(
      0,
      ...side.map((p) => (p[0] - a[0]) * outward[0] + (p[1] - a[1]) * outward[1]),
    )
    const pieces = side.slice(1).map((q, i): [Point, Point] => [side[i] as Point, q])
    /**
     * The boundary point measured at station t (on the chord itself for a single edge); where
     * several are (both ends of a step), the outermost.
     */
    const onBoundary = (t: number): Point => {
      if (pieces.length === 1) return add(a, dir, t)
      let best: Point | null = null
      const outer = (p: Point) => (p[0] - a[0]) * outward[0] + (p[1] - a[1]) * outward[1]
      for (const [p, q] of pieces) {
        const [tp, tq] = [along(p), along(q)]
        if ((t - tp) * (t - tq) <= 0 && tp !== tq) {
          const f = (t - tp) / (tq - tp)
          const point: Point = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
          if (!best || outer(point) > outer(best) + 1e-9) best = point
        }
      }
      return best ?? add(a, dir, t)
    }
    const stations = [0, length]
    // Sides sharing a chain across steps: each is one dimension of it.
    if (group.length > 1)
      for (const s of group) {
        if (s.chord < SHORT_SIDE_M) continue
        for (const p of [s.points[0] as Point, s.points[s.points.length - 1] as Point])
          stations.push(Math.min(length, Math.max(0, along(p))))
      }
    for (const opening of openings) {
      for (const p of [opening.a, opening.b]) {
        if (!pieces.some(([s, e]) => distanceToSegment(p, s, e) <= 0.02)) continue
        stations.push(Math.min(length, Math.max(0, along(p))))
      }
    }
    const sorted = [...new Set(stations.map((t) => Math.round(t * 1000) / 1000))].sort(
      (x, y) => x - y,
    )
    // An arc gets its radius (radiusMarks) instead of its chord, unless an opening splits it.
    if (group.length === 1 && first.arc && sorted.length <= 2) continue
    // At an inner corner the neighbouring wall would cover the chain's end: stop it outside.
    const before = ring.find(([, q]) => same(q, a))
    const after = ring.find(([p]) => same(p, last))
    const clearA = (p: Point) => (before ? clearOfWall(p, a, before, dir, clockwise) : null)
    const clearB = (p: Point) =>
      after ? clearOfWall(p, last, after, [-dir[0], -dir[1]], clockwise) : null
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i - 1] ?? 0
      const e = sorted[i] ?? 0
      if (e - s < 0.001) continue
      const dimension: Dimension = {
        a: add(add(a, dir, s), outward, offset + bulge),
        b: add(add(a, dir, e), outward, offset + bulge),
        from: onBoundary(s),
        to: onBoundary(e),
        outward,
        label: String(Math.round((e - s) * 1000)),
        angle: readableAngle(dir),
        chain,
      }
      const startClear = i === 1 ? clearA(dimension.a) : null
      if (startClear) {
        dimension.a = startClear
        dimension.extA = startClear
      }
      const endClear = i === sorted.length - 1 ? clearB(dimension.b) : null
      if (endClear) {
        dimension.b = endClear
        dimension.extB = endClear
      }
      out.push(dimension)
    }
    chain++
  }
  return out
}

/**
 * The radius of every arc side (a side of several edges fitting a circle, see arcOf), with a
 * leader from the middle of the arc `offset` metres outwards along the radius. Neighbouring
 * arc sides on one circle (a long arc cut into parts) get one label.
 */
export function radiusMarks(space: Space, offset: number): RadiusMark[] {
  const clockwise = isClockwise(space.boundary)
  const sides = planSides(space.boundary)
  const runs: Point[][] = []
  /** The previous side was an arc too (the last run may go on). */
  let afterArc = false
  for (const side of sides) {
    const run = runs[runs.length - 1]
    if (!side.arc) {
      afterArc = false
      continue
    }
    if (run && afterArc) {
      const joined = [...run, ...side.points.slice(1)]
      const smooth =
        turnDeg(
          direction(run[run.length - 2] as Point, run[run.length - 1] as Point),
          direction(side.points[0] as Point, side.points[1] as Point),
        ) < ARC_TURN_DEG
      if (smooth && arcOf(joined)) {
        runs[runs.length - 1] = joined
        continue
      }
    }
    runs.push([...side.points])
    afterArc = true
  }
  return runs.flatMap((points): RadiusMark[] => {
    const circle = arcOf(points)
    if (!circle) return []
    // Halfway along the polyline, and the piece there (for the side facing away from the plan).
    const lengths = points.slice(1).map((q, i) => distance(points[i] as Point, q))
    let rest = lengths.reduce((s, l) => s + l, 0) / 2
    let k = 0
    while (k < lengths.length - 1 && rest > (lengths[k] ?? 0)) rest -= lengths[k++] ?? 0
    const [p, q] = [points[k] as Point, points[k + 1] as Point]
    const mid = add(p, direction(p, q), rest)
    const radial = direction(circle.center, mid)
    const normal = outwardOf(direction(p, q), clockwise)
    const flip = radial[0] * normal[0] + radial[1] * normal[1] < 0 ? -1 : 1
    const outward: Point = [radial[0] * flip + 0, radial[1] * flip + 0]
    return [
      {
        ...circle,
        at: mid,
        end: add(mid, outward, offset),
        outward,
        label: `R${Math.round(circle.radius * (1000 / RADIUS_ROUND_MM)) * RADIUS_ROUND_MM}`,
        angle: readableAngle([-outward[1], outward[0]]),
      },
    ]
  })
}

/** Approximate width of a dimension label, as a share of the font size per character. */
const CHAR_EM = 0.6
/** How far a label sits beyond its dimension line, as a share of the font size (PlanView). */
export const LABEL_OFFSET_EM = 0.7

export interface TextBox {
  center: Point
  /** Unit vector along the text. */
  axis: Point
  halfW: number
  halfH: number
}

function textBox(
  at: Point,
  outward: Point,
  label: string,
  angle: number,
  fontSize: number,
): TextBox {
  const rad = (angle * Math.PI) / 180
  return {
    center: add(at, outward, fontSize * LABEL_OFFSET_EM),
    axis: [Math.cos(rad), Math.sin(rad)],
    halfW: (label.length * CHAR_EM * fontSize) / 2,
    halfH: fontSize / 2,
  }
}

/** True when two text boxes overlap (separating axis test on their own axes). */
export function boxesOverlap(p: TextBox, q: TextBox): boolean {
  const corners = (b: TextBox): Point[] => {
    const n: Point = [-b.axis[1], b.axis[0]]
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([u, v]) => [
      b.center[0] + b.axis[0] * b.halfW * (u ?? 0) + n[0] * b.halfH * (v ?? 0),
      b.center[1] + b.axis[1] * b.halfW * (u ?? 0) + n[1] * b.halfH * (v ?? 0),
    ])
  }
  const [cp, cq] = [corners(p), corners(q)]
  for (const axis of [p.axis, [-p.axis[1], p.axis[0]], q.axis, [-q.axis[1], q.axis[0]]]) {
    const project = (c: Point[]) => c.map((x) => x[0] * (axis[0] ?? 0) + x[1] * (axis[1] ?? 0))
    const [a, b] = [project(cp), project(cq)]
    if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false
  }
  return true
}

/** The label box of a dimension, for overlap checks. */
export const dimensionTextBox = (d: Dimension, fontSize: number) =>
  textBox([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], d.outward, d.label, d.angle, fontSize)

/** The label box of a radius mark, for overlap checks. */
export const radiusTextBox = (m: RadiusMark, fontSize: number) =>
  textBox(m.end, m.outward, m.label, m.angle, fontSize)

/** A dimension line as a box of no height, for overlap checks against labels. */
function lineBox(d: Dimension): TextBox {
  return {
    center: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2],
    axis: direction(d.a, d.b),
    halfW: distance(d.a, d.b) / 2,
    halfH: 0,
  }
}

/**
 * Moves a chain whose labels would overlap the labels or dimension lines of an earlier chain
 * (or a radius label), or whose line would run through an earlier label, `step` metres further
 * out, up to `layers` times. Chains are taken in order; the ones that fit stay exactly where
 * they were.
 */
export function avoidOverlaps(
  chains: readonly Dimension[],
  marks: readonly RadiusMark[],
  fontSize: number,
  step: number,
  layers = 3,
): Dimension[] {
  const texts: TextBox[] = marks.map((m) => radiusTextBox(m, fontSize))
  const lines: TextBox[] = []
  const out: Dimension[] = []
  const ids = [...new Set(chains.map((d) => d.chain))]
  const moved = (d: Dimension, by: number): Dimension =>
    by === 0 ? d : { ...d, a: add(d.a, d.outward, by * step), b: add(d.b, d.outward, by * step) }
  for (const id of ids) {
    const members = chains.filter((d) => d.chain === id)
    const clashes = (shift: number) =>
      members.some((member) => {
        const d = moved(member, shift)
        const text = dimensionTextBox(d, fontSize)
        const line = lineBox(d)
        return (
          texts.some((t) => boxesOverlap(text, t) || boxesOverlap(line, t)) ||
          lines.some((l) => boxesOverlap(text, l))
        )
      })
    let shift = 0
    while (shift < layers && clashes(shift)) shift++
    const placed = members.map((d) => moved(d, shift))
    texts.push(...placed.map((d) => dimensionTextBox(d, fontSize)))
    lines.push(...placed.map(lineBox))
    out.push(...placed)
  }
  return out
}

/**
 * Overall width (above the plan) and depth (left of it), `gap` metres outside the outermost
 * dimension chain (or radius label) on that side. A rectangle gets none: its edge chains are
 * the overall sizes. An extension line runs to the extreme vertex only when that vertex is on
 * the near side of the plan (within `offset` of it); otherwise it is a short stub at the
 * dimension line, so it does not cross the plan or other chains.
 */
export function overallDimensions(
  space: Space,
  chains: readonly Dimension[],
  offset: number,
  gap: number,
  marks: readonly RadiusMark[] = [],
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
  const ends = [...chains.flatMap((d) => [d.a, d.b]), ...marks.map((m) => m.end)]
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
  const stub = gap / 2
  const overall: Dimension[] = []
  if (!spans(true, width)) {
    const near = (p: Point) => p[1] - minZ <= offset
    overall.push({
      a: [westmost[0], top],
      b: [eastmost[0], top],
      from: westmost,
      to: eastmost,
      ...(near(westmost) ? {} : { extA: [westmost[0], top + stub] as Point }),
      ...(near(eastmost) ? {} : { extB: [eastmost[0], top + stub] as Point }),
      outward: [0, -1],
      label: String(Math.round(width * 1000)),
      angle: 0,
    })
  }
  if (!spans(false, depth)) {
    const near = (p: Point) => p[0] - minX <= offset
    overall.push({
      a: [left, northmost[1]],
      b: [left, southmost[1]],
      from: northmost,
      to: southmost,
      ...(near(northmost) ? {} : { extA: [left + stub, northmost[1]] as Point }),
      ...(near(southmost) ? {} : { extB: [left + stub, southmost[1]] as Point }),
      outward: [-1, 0],
      label: String(Math.round(depth * 1000)),
      angle: 90,
    })
  }
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
