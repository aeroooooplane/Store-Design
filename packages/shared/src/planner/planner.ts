import { PLAN_STRATEGY_LABELS, SHOP_TYPE_LABELS } from '../enums.ts'
import type { ItemFunction, PlanStrategy, ShopType } from '../enums.ts'
import {
  boundaryPath,
  distance,
  distanceToSegment,
  edges,
  locatePoint,
  pathMidpoint,
  polygonArea,
  polygonOverlapsRect,
  rectCorners,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
  toClockwise,
} from '../geometry/index.ts'
import type { Point, Polygon, Rect } from '../geometry/index.ts'
import type { FrontAxis } from '../schemas/asset.ts'
import { LayoutSchema, rotatedFootprint, validateLayout } from '../schemas/layout.ts'
import type { Layout, LayoutIssue, LayoutItem, Rotation } from '../schemas/layout.ts'
import type { Space } from '../schemas/space.ts'
import { EPSILON_M, roundM } from '../units.ts'
import { rotationFacing } from './orientation.ts'
import { DEFAULT_SIDE_CABINET_RULES, sideCabinetsForArea } from './side-cabinet-rules.ts'
import type { SideCabinetRules } from './side-cabinet-rules.ts'

export interface PlannerAsset {
  id: string
  name: string
  function: ItemFunction
  footprint: { w: number; d: number; h: number }
  front: FrontAxis | null
}

/** Candidate models per role, in order of preference (the caller applies SI style and defaults). */
export interface PlannerCatalog {
  island: PlannerAsset[]
  cashier: PlannerAsset[]
  cabinet: PlannerAsset[]
  /**
   * Low 配件边柜 (about 1.3 m) an island shop stands along its edge, a few at most (see
   * SideCabinetRules). Other shop types leave them out.
   */
  sideCabinet?: PlannerAsset[]
}

/** Guide values, not hard requirements: they are relaxed step by step when the space is tight. */
export interface PlannerRules {
  /** Main aisle from the main entrance to the back wall. */
  aisle: number
  /** Walkway around island tables (to other props, walls and obstacles). */
  clearance: number
  /** Kept clear inside every entrance. */
  entranceBuffer: number
  /** Gap between wall-standing props and the wall. */
  wallGap: number
  /**
   * Tallest cabinet stood along the boundary, in metres; taller models are left out and this is
   * never relaxed. Unlimited where the boundary is a wall; an island shop has no walls, only its
   * edge on the mall floor (see ISLAND_CABINET_MAX_H).
   */
  cabinetMaxHeight: number
}

/**
 * Tallest cabinet an island shop stands along its edge (confirmed by the user, 2026-10-14: island
 * tables, the cashier and low cabinets only). An island shop is seen from every side of the mall,
 * so its edge stays below eye height, about 1.5 m, and the shop stays open to view. The catalogue
 * leaves a clear gap there: 配件边柜, island tables and cashiers stand 0.9–1.43 m, 配件柜 2.4–2.43 m.
 */
export const ISLAND_CABINET_MAX_H = 1.5

export const DEFAULT_RULES: Record<ShopType, PlannerRules> = {
  side_hall: {
    aisle: 1.2,
    clearance: 0.9,
    entranceBuffer: 1.2,
    wallGap: 0.05,
    cabinetMaxHeight: Infinity,
  },
  island: {
    aisle: 1.2,
    clearance: 0.9,
    entranceBuffer: 1.0,
    wallGap: 0.3,
    cabinetMaxHeight: ISLAND_CABINET_MAX_H,
  },
  zone: {
    aisle: 1.2,
    clearance: 0.9,
    entranceBuffer: 1.0,
    wallGap: 0.05,
    cabinetMaxHeight: Infinity,
  },
}

/** Each step relaxes one guide value; applied in order until enough tables fit. */
const RELAXATION_STEPS: {
  rule: keyof Omit<PlannerRules, 'wallGap' | 'cabinetMaxHeight'>
  value: number
}[] = [
  { rule: 'clearance', value: 0.75 },
  { rule: 'clearance', value: 0.6 },
  { rule: 'aisle', value: 1.0 },
  { rule: 'aisle', value: 0.9 },
  { rule: 'entranceBuffer', value: 0.8 },
  { rule: 'entranceBuffer', value: 0.6 },
]

const RULE_NAMES: Record<string, string> = {
  clearance: '道具间距',
  aisle: '主通道',
  entranceBuffer: '入口缓冲',
}

export type GeneratedStrategy = Exclude<PlanStrategy, 'case'>

export interface PlannerInput {
  space: Space
  shopType: ShopType
  strategy: GeneratedStrategy
  catalog: PlannerCatalog
  rules?: Partial<PlannerRules>
  /** The island shop's side cabinets; DEFAULT_SIDE_CABINET_RULES unless store data replaces it. */
  sideCabinetRules?: SideCabinetRules
}

export interface PlannerResult {
  layout: Layout
  /** Hard-constraint check of the result; the planner aims for none. */
  issues: LayoutIssue[]
  notes: string[]
}

type Vec = readonly [number, number]

/**
 * A boundary edge that can carry wall-standing props, as a line along the x or z axis. For an
 * edge a few degrees off the axis (see NEAR_AXIS_DEG) the line runs through the end of the edge
 * nearer the interior, so props stood against it clear the whole edge.
 */
interface Wall {
  /** Start of the line: the edge's first end, moved square to the axis onto that line. */
  a: Point
  axis: 'x' | 'z'
  /** Unit direction along the axis, the way the edge runs. */
  u: Vec
  /** Inward normal of the line. */
  n: Vec
  /** Usable stretches along the wall, in metres from `a` (entrances and open edges removed). */
  intervals: [number, number][]
  /** Distance from the main entrance; orders the walls after the back wall. */
  distance: number
  /** How far back the wall stands, measured from the main entrance along its inward normal. */
  depth: number
}

interface EntrancePiece {
  /** Boundary edge the piece lies on; null for an entrance off the boundary. */
  edge: number | null
  a: Point
  b: Point
  /** Inward normal of that edge. */
  n: Vec
}

/** An entrance as straight pieces along the boundary (one unless it turns a corner or follows an arc). */
interface EntranceInfo {
  pieces: EntrancePiece[]
  mid: Point
  /** Inward direction of the entrance as a whole. */
  n: Vec
}

interface Placed {
  item: LayoutItem
  rect: Rect
}

const ALONG_STEP = 0.05
/** How far an entrance end may lie from the boundary (as in validateSpace). */
const ON_EDGE_M = 0.02
/**
 * Edges within this many degrees of the x or z axis count as walls along that axis (confirmed by
 * the user, 2026-10-14). Drawn and measured boundaries are often a fraction of a degree off, such
 * as the 0.55° back wall of store-0001; props still turn in quarter turns, so they stand square
 * to the axis and clear the edge at its end nearer the interior.
 */
export const NEAR_AXIS_DEG = 3
const NEAR_AXIS_TAN = Math.tan((NEAR_AXIS_DEG * Math.PI) / 180)

function inward(u: Vec): Vec {
  // The ring is clockwise on the plan (x right, z down), so the interior lies to the left of u.
  return [-u[1] + 0, u[0] + 0]
}

function expand(rect: Rect, margin: number): Rect {
  return {
    minX: rect.minX - margin,
    minZ: rect.minZ - margin,
    maxX: rect.maxX + margin,
    maxZ: rect.maxZ + margin,
  }
}

function aabb(points: Point[]): Rect {
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  return {
    minX: Math.min(...xs),
    minZ: Math.min(...zs),
    maxX: Math.max(...xs),
    maxZ: Math.max(...zs),
  }
}

function subtract(intervals: [number, number][], cut: [number, number]): [number, number][] {
  return intervals.flatMap(([s, e]): [number, number][] => {
    if (cut[1] <= s || cut[0] >= e) return [[s, e]]
    const parts: [number, number][] = []
    if (cut[0] > s) parts.push([s, cut[0]])
    if (cut[1] < e) parts.push([cut[1], e])
    return parts
  })
}

class Planner {
  readonly boundary: Polygon
  readonly bbox: Rect
  readonly notes: string[] = []
  readonly placed: Placed[] = []
  readonly walls: Wall[]
  readonly entrances: (EntranceInfo | null)[]
  readonly mainEntrance: { mid: Point; n: Vec } | null
  readonly space: Space
  private counter = new Map<string, number>()

  constructor(space: Space) {
    this.space = space
    this.boundary = toClockwise(space.boundary)
    this.bbox = aabb([...this.boundary])
    const ring = edges(this.boundary)
    const edgeNormal = (edge: number): Vec | null => {
      const [a, b] = ring[edge] ?? []
      const len = a && b ? distance(a, b) : 0
      return a && b && len > 0 ? inward([(b[0] - a[0]) / len, (b[1] - a[1]) / len]) : null
    }
    // An entrance may run along several edges (an arc storefront): each piece keeps its edge's
    // inward normal, and the entrance as a whole faces their length-weighted mean.
    this.entrances = space.entrances.map((entrance): EntranceInfo | null => {
      const path = boundaryPath(this.boundary, entrance.a, entrance.b, ON_EDGE_M)
      if (path && path.length > 1) {
        const pieces = path.flatMap((piece) => {
          const n = edgeNormal(piece.edge)
          return n ? [{ ...piece, n }] : []
        })
        const sum = pieces.reduce<Vec>(
          (s, p) => {
            const len = distance(p.a, p.b)
            return [s[0] + p.n[0] * len, s[1] + p.n[1] * len]
          },
          [0, 0],
        )
        const len = Math.hypot(sum[0], sum[1])
        const mid = pathMidpoint(path)
        if (!mid || len === 0) return null
        return { pieces, mid, n: [sum[0] / len + 0, sum[1] / len + 0] }
      }
      // One edge: the inward normal of the boundary edge nearest its midpoint.
      const mid: Point = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
      let best: { n: Vec; d: number } | null = null
      ring.forEach(([a, b], edge) => {
        const d = distanceToSegment(mid, a, b)
        const n = edgeNormal(edge)
        if (n && (!best || d < best.d)) best = { n, d }
      })
      if (!best) return null
      const { n } = best
      // An entrance off the boundary (an invalid space) still keeps props clear but frees no wall.
      return {
        pieces: [{ edge: path?.[0]?.edge ?? null, a: entrance.a, b: entrance.b, n }],
        mid,
        n,
      }
    })
    const mainIndex = Math.max(
      0,
      space.entrances.findIndex((e) => e.kind === 'main'),
    )
    const main = this.entrances[mainIndex]
    this.mainEntrance = main ? { mid: main.mid, n: main.n } : null
    if (!this.mainEntrance) this.notes.push('空间没有入口，未预留入口缓冲与主通道')

    const entrancePieces = this.entrances.flatMap((e) => e?.pieces ?? [])
    // Nothing stands against an open edge: there is no wall there.
    const openPieces = space.openEdges.flatMap(
      (edge) => boundaryPath(this.boundary, edge.a, edge.b, ON_EDGE_M) ?? [],
    )
    const walls = ring.flatMap(([a, b], index): Wall[] => {
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = Math.hypot(dx, dz)
      // Props rotate in quarter turns, so only edges along (or within NEAR_AXIS_DEG of) the x or
      // z axis can carry wall-standing props.
      const alongX = Math.abs(dz) <= Math.abs(dx) * NEAR_AXIS_TAN
      const alongZ = Math.abs(dx) <= Math.abs(dz) * NEAR_AXIS_TAN
      if (length < 0.3 || !(alongX || alongZ)) return []
      const u: Vec = alongX ? [Math.sign(dx), 0] : [0, Math.sign(dz)]
      const n = inward(u)
      // Off the axis, the far end of the edge stands this far further into the room than `a`:
      // the line of props runs through whichever end stands further in.
      const lift = Math.max(0, dx * n[0] + dz * n[1])
      const start: Point = [a[0] + n[0] * lift + 0, a[1] + n[1] * lift + 0]
      const span = dx * u[0] + dz * u[1]
      let intervals: [number, number][] = [[0, span]]
      for (const piece of entrancePieces) {
        if (piece.edge !== index) continue
        const ta = (piece.a[0] - a[0]) * u[0] + (piece.a[1] - a[1]) * u[1]
        const tb = (piece.b[0] - a[0]) * u[0] + (piece.b[1] - a[1]) * u[1]
        intervals = subtract(intervals, [Math.min(ta, tb) - 0.1, Math.max(ta, tb) + 0.1])
      }
      for (const piece of openPieces) {
        if (piece.edge !== index) continue
        const ta = (piece.a[0] - a[0]) * u[0] + (piece.a[1] - a[1]) * u[1]
        const tb = (piece.b[0] - a[0]) * u[0] + (piece.b[1] - a[1]) * u[1]
        intervals = subtract(intervals, [Math.min(ta, tb), Math.max(ta, tb)])
      }
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const main = this.mainEntrance
      const far = main ? distance(mid, main.mid) : 0
      const depth = main
        ? (mid[0] - main.mid[0]) * main.n[0] + (mid[1] - main.mid[1]) * main.n[1]
        : 0
      return intervals.length
        ? [
            {
              a: start,
              axis: alongX ? 'x' : 'z',
              u,
              n,
              intervals,
              distance: far,
              depth,
            },
          ]
        : []
    })
    walls.sort((p, q) => q.distance - p.distance)
    const back = this.backWall(walls)
    this.walls = back ? [back, ...walls.filter((w) => w !== back)] : walls
  }

  /**
   * The wall farthest back along the main entrance's inward normal, among the walls that face
   * the entrance. Short recesses (less than half the longest facing wall, such as the arms
   * behind a block standing out of the back wall) are passed over; ties go to the longer wall.
   * Measuring along the normal, not the straight-line distance, keeps a far side wall of an L
   * shape or a long shop entered from its long side from being taken for the back wall.
   */
  backWall(walls: Wall[]): Wall | null {
    const main = this.mainEntrance
    if (!main) return null
    const usable = (w: Wall) => w.intervals.reduce((sum, [s, e]) => sum + e - s, 0)
    const facing = walls.filter((w) => w.n[0] * main.n[0] + w.n[1] * main.n[1] < -0.5)
    const pool = facing.length ? facing : walls
    const longest = Math.max(0, ...pool.map(usable))
    let best: Wall | null = null
    for (const wall of pool) {
      if (usable(wall) < longest / 2 - 1e-9) continue
      if (
        !best ||
        wall.depth > best.depth + 1e-6 ||
        (wall.depth > best.depth - 1e-6 && usable(wall) > usable(best) + 1e-9)
      )
        best = wall
    }
    return best
  }

  /**
   * Soft keep-out areas: inside every entrance, and the main aisle for island tables. Both are
   * strips along the entrance's own direction, so an entrance on a slanting wall or a cut corner
   * keeps a slanting strip clear rather than its whole bounding box.
   */
  zones(rules: PlannerRules, withAisle: boolean): Polygon[] {
    const zones: Polygon[] = []
    const depth = rules.entranceBuffer
    for (const { a, b, n } of this.entrances.flatMap((e) => e?.pieces ?? [])) {
      zones.push([
        a,
        b,
        [b[0] + n[0] * depth, b[1] + n[1] * depth],
        [a[0] + n[0] * depth, a[1] + n[1] * depth],
      ])
    }
    if (withAisle && this.mainEntrance) {
      const { mid, n } = this.mainEntrance
      const span = Math.max(this.bbox.maxX - this.bbox.minX, this.bbox.maxZ - this.bbox.minZ)
      const half = rules.aisle / 2
      const side: Vec = [-n[1], n[0]]
      zones.push([
        [mid[0] + side[0] * half, mid[1] + side[1] * half],
        [mid[0] + side[0] * half + n[0] * span, mid[1] + side[1] * half + n[1] * span],
        [mid[0] - side[0] * half + n[0] * span, mid[1] - side[1] * half + n[1] * span],
        [mid[0] - side[0] * half, mid[1] - side[1] * half],
      ])
    }
    return zones
  }

  /** Hard constraints plus the soft keep-outs and spacing of the current rules. */
  fits(
    rect: Rect,
    options: {
      zones: Polygon[]
      spacing: number
      wallClearance: number
      extra?: Rect[]
      islandSpacing?: number
    },
  ): boolean {
    if (!rectInsidePolygon(rect, this.boundary)) return false
    const padded = options.wallClearance > 0 ? expand(rect, options.wallClearance) : rect
    if (options.wallClearance > 0 && !rectInsidePolygon(padded, this.boundary)) return false
    if (this.space.obstacles.some((o) => polygonOverlapsRect(o.polygon, padded))) return false
    if (
      this.entrances.some((e) =>
        e?.pieces.some((p) => segmentIntersectsRectInterior(p.a, p.b, rect)),
      )
    )
      return false
    if (options.zones.some((zone) => polygonOverlapsRect(zone, rect))) return false
    const others = [
      ...this.placed.map((p) => ({ rect: p.rect, island: p.item.function === 'island_table' })),
      ...(options.extra ?? []).map((r) => ({ rect: r, island: true })),
    ]
    return others.every(({ rect: other, island }) => {
      const gap = options.spacing > 0 ? options.spacing : island ? (options.islandSpacing ?? 0) : 0
      return gap > 0 ? rectGap(rect, other) >= gap - 1e-9 : !rectsOverlap(rect, other)
    })
  }

  add(asset: PlannerAsset, rotation: Rotation, rect: Rect): void {
    const fn = asset.function
    const index = (this.counter.get(fn) ?? 0) + 1
    this.counter.set(fn, index)
    const size = rotatedFootprint(asset, rotation)
    this.placed.push({
      rect,
      item: {
        id: `${fn}-${index}`,
        assetId: asset.id,
        function: fn,
        name: asset.name.slice(0, 100),
        cx: roundM((rect.minX + rect.maxX) / 2),
        cz: roundM((rect.minZ + rect.maxZ) / 2),
        rotation,
        w: roundM(size.w),
        d: roundM(size.d),
        h: roundM(size.h),
        placeholder: false,
        locked: false,
      },
    })
  }

  /** Undoes, when called (as often as needed), everything placed after this call. */
  snapshot(): () => void {
    const count = this.placed.length
    const counter = [...this.counter]
    return () => {
      this.placed.length = count
      this.counter = new Map(counter)
    }
  }

  /** Rotation that turns the front into the room, or lays the long side along the wall. */
  wallRotation(asset: PlannerAsset, wall: Wall): Rotation {
    const facing = rotationFacing(asset.front, wall.n)
    if (facing !== null) return facing
    const longAlongX = asset.footprint.w >= asset.footprint.d
    return (wall.axis === 'x') === longAlongX ? 0 : 90
  }

  wallRect(wall: Wall, s: number, along: number, depth: number, gap: number): Rect {
    const at = (t: number, off: number): Point => [
      roundM(wall.a[0] + wall.u[0] * t + wall.n[0] * off),
      roundM(wall.a[1] + wall.u[1] * t + wall.n[1] * off),
    ]
    return aabb([at(s, gap), at(s + along, gap + depth)])
  }

  /** Strip along a whole wall, kept free of island tables so cabinets and their walkway fit. */
  wallBand(wall: Wall, depth: number): Rect[] {
    return wall.intervals.map(([t0, t1]) => this.wallRect(wall, t0, t1 - t0, depth, 0))
  }

  /** Places one prop against a wall, scanning from either end. */
  placeOnWall(asset: PlannerAsset, wall: Wall, fromEnd: boolean, rules: PlannerRules): boolean {
    const rotation = this.wallRotation(asset, wall)
    const size = rotatedFootprint(asset, rotation)
    const along = wall.axis === 'x' ? size.w : size.d
    const depth = wall.axis === 'x' ? size.d : size.w
    const zones = this.zones(rules, false)
    const intervals = fromEnd ? [...wall.intervals].reverse() : wall.intervals
    for (const [t0, t1] of intervals) {
      const steps = Math.floor((t1 - t0 - along) / ALONG_STEP + 1e-9)
      for (let k = 0; k <= steps; k++) {
        const s = fromEnd ? t1 - along - k * ALONG_STEP : t0 + k * ALONG_STEP
        const rect = this.wallRect(wall, s, along, depth, rules.wallGap)
        if (this.fits(rect, { zones, spacing: 0, wallClearance: 0 })) {
          this.add(asset, rotation, rect)
          return true
        }
      }
    }
    return false
  }

  /** Fills walls with cabinets, longest model first, never covering entrances. */
  fillWalls(cabinets: PlannerAsset[], walls: Wall[], limit: number, rules: PlannerRules): number {
    const zones = this.zones(rules, false)
    let count = 0
    for (const wall of walls) {
      for (const [t0, t1] of wall.intervals) {
        let s = t0
        while (count < limit && s < t1) {
          let advanced = false
          for (const asset of cabinets) {
            const rotation = this.wallRotation(asset, wall)
            const size = rotatedFootprint(asset, rotation)
            const along = wall.axis === 'x' ? size.w : size.d
            const depth = wall.axis === 'x' ? size.d : size.w
            if (s + along > t1 + 1e-9) continue
            const rect = this.wallRect(wall, s, along, depth, rules.wallGap)
            if (
              this.fits(rect, {
                zones,
                spacing: 0,
                wallClearance: 0,
                islandSpacing: rules.clearance,
              })
            ) {
              this.add(asset, rotation, rect)
              s += along
              count++
              advanced = true
              break
            }
          }
          if (!advanced) s += 0.1
        }
      }
    }
    return count
  }

  /**
   * At least `gap` (less the millimetre positions round to) from every boundary edge and obstacle,
   * measured as the true distance: a rounded or cut corner next to the prop counts by how near it
   * actually comes, not by a padded box.
   */
  clearOfEdge(rect: Rect, gap: number): boolean {
    const toRect = (p: Point) =>
      Math.hypot(
        Math.max(rect.minX - p[0], 0, p[0] - rect.maxX),
        Math.max(rect.minZ - p[1], 0, p[1] - rect.maxZ),
      )
    const corners = rectCorners(rect)
    const clear = (a: Point, b: Point) =>
      toRect(a) >= gap - EPSILON_M &&
      toRect(b) >= gap - EPSILON_M &&
      corners.every((c) => distanceToSegment(c, a, b) >= gap - EPSILON_M)
    return (
      edges(this.boundary).every(([a, b]) => clear(a, b)) &&
      this.space.obstacles.every((o) => edges(o.polygon).every(([a, b]) => clear(a, b)))
    )
  }

  /** The back wall when it faces the main entrance: the side an island shop's cabinets favour. */
  sideCabinetBack(): Wall | null {
    const main = this.mainEntrance
    const back = this.walls[0]
    return main && back && back.n[0] * main.n[0] + back.n[1] * main.n[1] < -0.5 ? back : null
  }

  /**
   * Island shop: stands up to `count` low cabinets along the edge the tables and the cashier left
   * free. The side facing the main entrance (the back wall) comes first, then the two sides beyond
   * `sideFromDepth` of the shop's depth. Judged per wall piece: an open side still takes one
   * against a piece of wall long enough for it. Never against an entrance or open edge, in the
   * main aisle or an entrance buffer; `wallGap` from the whole
   * boundary and `clearance` from island tables. Each cabinet takes the slot farthest from the
   * props already along the edge, so a few cabinets spread out; the first model in `assets` that
   * fits anywhere is used. Returns how many stand, and how many of them on the back wall.
   */
  placeSideCabinets(
    assets: PlannerAsset[],
    count: number,
    rules: PlannerRules,
    sideFromDepth: number,
  ): { placed: number; onBack: number } {
    const main = this.mainEntrance
    if (!main || !count) return { placed: 0, onBack: 0 }
    const depthOf = (p: Point) =>
      (p[0] - main.mid[0]) * main.n[0] + (p[1] - main.mid[1]) * main.n[1]
    const depths = this.boundary.map(depthOf)
    const from = Math.min(...depths) + (Math.max(...depths) - Math.min(...depths)) * sideFromDepth
    const back = this.sideCabinetBack()
    const tiers: { wall: Wall; tier: number }[] = back ? [{ wall: back, tier: 0 }] : []
    for (const wall of this.walls)
      if (Math.abs(wall.n[0] * main.n[0] + wall.n[1] * main.n[1]) < 0.5)
        tiers.push({ wall, tier: 1 })
    const zones = this.zones(rules, true)
    const centre = (r: Rect): Point => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]
    const edgeProps = () =>
      this.placed.filter((p) => p.item.function !== 'island_table').map((p) => centre(p.rect))
    let placed = 0
    let onBack = 0
    while (placed < count) {
      const others = edgeProps()
      let best = null as {
        asset: PlannerAsset
        rotation: Rotation
        rect: Rect
        tier: number
        spread: number
      } | null
      for (const asset of assets) {
        for (const { wall, tier } of tiers) {
          if (best && best.tier < tier) break
          const rotation = this.wallRotation(asset, wall)
          const size = rotatedFootprint(asset, rotation)
          const along = wall.axis === 'x' ? size.w : size.d
          const depth = wall.axis === 'x' ? size.d : size.w
          for (const [t0, t1] of wall.intervals) {
            const steps = Math.floor((t1 - t0 - along) / ALONG_STEP + 1e-9)
            for (let k = 0; k <= steps; k++) {
              const rect = this.wallRect(wall, t0 + k * ALONG_STEP, along, depth, rules.wallGap)
              if (tier > 0 && Math.min(...rectCorners(rect).map(depthOf)) < from - 1e-9) continue
              const spread = Math.min(Infinity, ...others.map((c) => distance(c, centre(rect))))
              if (best && (best.tier < tier || (best.tier === tier && best.spread >= spread)))
                continue
              if (
                !this.fits(rect, {
                  zones,
                  spacing: 0,
                  wallClearance: 0,
                  islandSpacing: rules.clearance,
                }) ||
                !this.clearOfEdge(rect, rules.wallGap)
              )
                continue
              best = { asset, rotation, rect, tier, spread }
            }
          }
        }
        // The preferred model wherever it fits; the next one only where it does not.
        if (best) break
      }
      if (!best) break
      this.add(best.asset, best.rotation, best.rect)
      placed++
      if (best.tier === 0) onBack++
    }
    return { placed, onBack }
  }

  /** All island-table slots of one orientation, packed row by row with the given spacing. */
  pack(asset: PlannerAsset, rotation: Rotation, rules: PlannerRules, reserved: Rect[]): Rect[] {
    const size = rotatedFootprint(asset, rotation)
    const area = (this.bbox.maxX - this.bbox.minX) * (this.bbox.maxZ - this.bbox.minZ)
    const grid = area > 200 ? 0.2 : 0.1
    const zones = [...this.zones(rules, true), ...reserved.map((r) => rectCorners(r))]
    const slots: Rect[] = []
    for (let z = this.bbox.minZ; z + size.d <= this.bbox.maxZ + 1e-9; z += grid) {
      for (let x = this.bbox.minX; x + size.w <= this.bbox.maxX + 1e-9; x += grid) {
        const rect: Rect = {
          minX: roundM(x),
          minZ: roundM(z),
          maxX: roundM(x + size.w),
          maxZ: roundM(z + size.d),
        }
        if (
          this.fits(rect, {
            zones,
            spacing: rules.clearance,
            wallClearance: rules.clearance,
            extra: slots,
          })
        )
          slots.push(rect)
      }
    }
    return slots
  }

  /** The better of the two orientations; ties keep the asset's own orientation. */
  bestPacking(
    asset: PlannerAsset,
    rules: PlannerRules,
    reserved: Rect[],
  ): { rotation: Rotation; slots: Rect[] } {
    const upright = { rotation: 0 as Rotation, slots: this.pack(asset, 0, rules, reserved) }
    const turned = { rotation: 90 as Rotation, slots: this.pack(asset, 90, rules, reserved) }
    return turned.slots.length > upright.slots.length ? turned : upright
  }
}

/** Picks `count` slots spread over the room: nearest the centre first, then farthest apart. */
function spread(slots: Rect[], count: number): Rect[] {
  if (slots.length <= count) return slots
  const centre = (r: Rect): Point => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]
  const centroid: Point = [
    slots.reduce((s, r) => s + centre(r)[0], 0) / slots.length,
    slots.reduce((s, r) => s + centre(r)[1], 0) / slots.length,
  ]
  const chosen: Rect[] = []
  const remaining = [...slots]
  remaining.sort((a, b) => distance(centre(a), centroid) - distance(centre(b), centroid))
  chosen.push(remaining.shift() as Rect)
  while (chosen.length < count && remaining.length) {
    let best = 0
    let bestScore = -Infinity
    remaining.forEach((slot, i) => {
      const score = Math.min(...chosen.map((c) => distance(centre(c), centre(slot))))
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    chosen.push(remaining.splice(best, 1)[0] as Rect)
  }
  return chosen
}

/**
 * Free floor (boundary minus obstacles) that no `width` × `width` square standing on free floor
 * can reach: arms and strips narrower than `width`, slivers in sharp corners, gaps between a
 * column and the wall. This is the part removed by a morphological opening with that square,
 * approximated on a grid of about 0.1 m (coarser for very large spaces, at most 40 000 cells).
 * A rectangle at least `width` across has none.
 */
function narrowArea(space: Space, width: number): number {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const [minX, minZ] = [Math.min(...xs), Math.min(...zs)]
  const [spanX, spanZ] = [Math.max(...xs) - minX, Math.max(...zs) - minZ]
  const cell = Math.max(0.1, Math.sqrt((spanX * spanZ) / 40000))
  const nx = Math.ceil(spanX / cell)
  const nz = Math.ceil(spanZ / cell)
  const k = Math.ceil(width / cell - 1e-9)
  const free = new Uint8Array(nx * nz)
  let freeCount = 0
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const p: Point = [minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell]
      if (locatePoint(p, space.boundary) !== 'inside') continue
      if (space.obstacles.some((o) => locatePoint(p, o.polygon) !== 'outside')) continue
      free[i * nz + j] = 1
      freeCount++
    }
  }
  if (!freeCount) return 0
  // Summed-area table over an (nx + 1) × (nz + 1) grid; rectSum counts cells [i0, i1) × [j0, j1).
  const prefix = (grid: Uint8Array, w: number, h: number): Int32Array => {
    const sums = new Int32Array((w + 1) * (h + 1))
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++)
        sums[(i + 1) * (h + 1) + j + 1] =
          (grid[i * h + j] ?? 0) +
          (sums[i * (h + 1) + j + 1] ?? 0) +
          (sums[(i + 1) * (h + 1) + j] ?? 0) -
          (sums[i * (h + 1) + j] ?? 0)
    return sums
  }
  const rectSum = (sums: Int32Array, h: number, i0: number, j0: number, i1: number, j1: number) =>
    (sums[i1 * (h + 1) + j1] ?? 0) -
    (sums[i0 * (h + 1) + j1] ?? 0) -
    (sums[i1 * (h + 1) + j0] ?? 0) +
    (sums[i0 * (h + 1) + j0] ?? 0)
  // Squares that fit: k × k windows of free cells, indexed by their first cell.
  const [wx, wz] = [nx - k + 1, nz - k + 1]
  if (wx <= 0 || wz <= 0) return freeCount * cell * cell
  const freeSums = prefix(free, nx, nz)
  const fits = new Uint8Array(wx * wz)
  for (let i = 0; i < wx; i++)
    for (let j = 0; j < wz; j++)
      if (rectSum(freeSums, nz, i, j, i + k, j + k) === k * k) fits[i * wz + j] = 1
  const fitSums = prefix(fits, wx, wz)
  let narrow = 0
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!free[i * nz + j]) continue
      // Covered when some fitting square starts within k − 1 cells before it on both axes.
      const [i0, j0] = [Math.max(0, i - k + 1), Math.max(0, j - k + 1)]
      const [i1, j1] = [Math.min(wx, i + 1), Math.min(wz, j + 1)]
      if (i0 >= i1 || j0 >= j1 || rectSum(fitSums, wz, i0, j0, i1, j1) === 0) narrow++
    }
  }
  return narrow * cell * cell
}

/**
 * Usable floor area, the basis of the 按面积推荐 table count: the boundary minus obstacles and,
 * with `minWidth`, minus the floor too narrow for a `minWidth` square (see narrowArea), so arms
 * and slivers no table can stand in do not raise the count.
 */
export function usableArea(space: Space, minWidth = 0): number {
  const free =
    polygonArea(space.boundary) -
    space.obstacles.reduce((sum, o) => sum + polygonArea(o.polygon), 0)
  return minWidth > 0 ? Math.max(0, free - narrowArea(space, minWidth)) : free
}

/** Initial heuristic carried over from the legacy planner, until cleaned store data gives a better rule. */
export function tablesForArea(area: number): number {
  return Math.max(1, Math.floor((area - 16) / 18) + 1)
}

/**
 * How many side cabinets an island shop asks for (see SideCabinetRules); or, when it stands none,
 * the note saying why.
 */
function islandSideTarget(
  planner: Planner,
  strategy: GeneratedStrategy,
  area: number,
  rule: SideCabinetRules,
): number | string {
  if (area < rule.minArea)
    return `中岛店面积 ${Math.floor(area)} ㎡，不足 ${rule.minArea} ㎡，不放配件边柜`
  if (!planner.mainEntrance) return '空间没有入口，分不出店的前后，未放配件边柜'
  return sideCabinetsForArea(area, strategy, rule)
}

/** The note on the side cabinets of an island shop: how many, and on what basis. */
function sideCabinetNote(
  strategy: GeneratedStrategy,
  area: number,
  target: number,
  placed: number,
  rule: SideCabinetRules,
): string {
  // Rounded down, as the count is: 49.6 ㎡ reads 49 ㎡ and asks for one cabinet.
  const shown = Math.floor(area)
  const basis = [
    `每 ${rule.areaPerCabinet} ㎡ 1 个，最多 ${rule.maxCount} 个`,
    ...(target < sideCabinetsForArea(area, 'max', rule)
      ? [`${PLAN_STRATEGY_LABELS[strategy]}最多 ${rule.strategyMax[strategy]} 个`]
      : []),
  ].join('；')
  return placed === target
    ? `中岛店按面积 ${shown} ㎡ 放 ${placed} 个配件边柜（${basis}）`
    : `中岛店按面积 ${shown} ㎡ 应放 ${target} 个配件边柜（${basis}），中岛桌优先，边缘空间只放下 ${placed} 个`
}

/**
 * Generates one layout for a polygon space. Cashier against the back wall, island tables in the
 * open floor away from entrances and the main aisle, cabinets along the remaining walls (an island
 * shop: a few low side cabinets, see SideCabinetRules). Guide values are relaxed one step at a
 * time when the requested tables do not fit, and every relaxation is recorded in
 * `planning.relaxations`.
 */
export function planLayout(input: PlannerInput): PlannerResult {
  const base: PlannerRules = { ...DEFAULT_RULES[input.shopType], ...input.rules }
  const planner = new Planner(input.space)
  const fitsHeight = (asset: PlannerAsset) => asset.footprint.h <= input.space.height + 1e-9
  const pick = (list: PlannerAsset[], role: string): PlannerAsset[] => {
    const usable = list.filter(fitsHeight)
    if (list.length && !usable.length) planner.notes.push(`${role}均高于层高，未摆放`)
    else if (!list.length) planner.notes.push(`模型目录中没有可摆放的${role}`)
    return usable
  }
  const islands = pick(input.catalog.island, '中岛桌')
  const cashiers = pick(input.catalog.cashier, '收银台')
  const allCabinets = pick(input.catalog.cabinet, '配件柜')
  // Too tall for the edge of this shop type (an island shop keeps to low cabinets).
  const cabinets = allCabinets
    .filter((asset) => asset.footprint.h <= base.cabinetMaxHeight + 1e-9)
    .sort((a, b) => Math.max(b.footprint.w, b.footprint.d) - Math.max(a.footprint.w, a.footprint.d))
  // An island shop stands only a few low cabinets along its edge, after the tables (step 3): the
  // catalogue's 配件边柜 first, then any cabinet low enough.
  const islandShop = input.shopType === 'island'
  const sideCabinets = islandShop
    ? [
        ...(input.catalog.sideCabinet?.length
          ? pick(input.catalog.sideCabinet, '配件边柜').filter(
              (asset) => asset.footprint.h <= base.cabinetMaxHeight + 1e-9,
            )
          : []),
        ...cabinets,
      ].filter((asset, i, list) => list.findIndex((a) => a.id === asset.id) === i)
    : []
  if (cabinets.length < allCabinets.length)
    planner.notes.push(
      `${SHOP_TYPE_LABELS[input.shopType]}不沿边界放高于 ${base.cabinetMaxHeight} m 的柜子${cabinets.length || sideCabinets.length ? '' : '，未摆放配件柜'}`,
    )

  // 1. Cashier at the end of the back wall (or the next wall that has room).
  const cashier = cashiers[0]
  if (cashier) {
    const placed = planner.walls.some(
      (wall) =>
        planner.placeOnWall(cashier, wall, false, base) ||
        planner.placeOnWall(cashier, wall, true, base),
    )
    if (!placed) planner.notes.push('没有足够的墙面放收银台，请人工安排')
  }

  // 2. Island tables come before cabinets: the strategies are about how many tables to show.
  //    The back wall keeps a band for cabinets plus the walkway in front of them.
  const back = planner.walls[0]
  const cabinetDepth = cabinets.length
    ? Math.min(...cabinets.map((c) => Math.min(c.footprint.w, c.footprint.d)))
    : 0
  // An island shop keeps no band: its side cabinets take only the edge the tables leave free.
  const reserved = (rules: PlannerRules): Rect[] =>
    back && cabinets.length && !islandShop
      ? planner.wallBand(back, rules.wallGap + cabinetDepth + rules.clearance)
      : []

  const island = islands[0]
  /** Where the tables go with the given keep-outs; nothing is placed yet. */
  const planTables = (keepOut: (rules: PlannerRules) => Rect[]) => {
    const notes: string[] = []
    let requested = 0
    let rules = base
    const relaxed = new Map<string, { target: number; actual: number }>()
    let chosen: { rotation: Rotation; slots: Rect[] } = { rotation: 0, slots: [] }
    if (island) {
      // 尽量多放 relaxes towards the same target as 按面积推荐, then keeps every slot, so it never
      // shows fewer tables; 尽量少放 asks for one.
      // Floor narrower than a table plus the tightest walkway on both sides cannot take one even
      // after every relaxation, so it does not count towards the table target.
      const tightest = Math.min(
        base.clearance,
        ...RELAXATION_STEPS.filter((s) => s.rule === 'clearance').map((s) => s.value),
      )
      const tableWidth = Math.min(island.footprint.w, island.footprint.d) + 2 * tightest
      if (input.strategy === 'min') requested = 1
      else {
        const area = usableArea(input.space, tableWidth)
        const whole = usableArea(input.space)
        requested = tablesForArea(area)
        if (requested < tablesForArea(whole))
          notes.push(`桌数按面积推荐时未计入约 ${Math.round(whole - area)} ㎡ 狭窄区域`)
      }
      let best = planner.bestPacking(island, rules, keepOut(rules))
      for (const step of RELAXATION_STEPS) {
        if (best.slots.length >= requested) break
        if (rules[step.rule] <= step.value) continue
        relaxed.set(step.rule, { target: base[step.rule], actual: step.value })
        rules = { ...rules, [step.rule]: step.value }
        best = planner.bestPacking(island, rules, keepOut(rules))
      }
      const slots = input.strategy === 'max' ? best.slots : spread(best.slots, requested)
      if (input.strategy === 'max') requested = Math.max(requested, best.slots.length)
      chosen = { rotation: best.rotation, slots }
      if (slots.length < requested && (input.strategy !== 'max' || !slots.length)) {
        notes.push(`空间有限，只放下 ${slots.length} / ${requested} 张中岛桌`)
      }
    }
    return { notes, requested, rules, relaxed, chosen }
  }
  const plain = planTables(reserved)
  let tables = plain
  const undoTables = planner.snapshot()
  const addTables = (t: typeof plain) => {
    if (island) for (const rect of t.chosen.slots) planner.add(island, t.chosen.rotation, rect)
  }
  addTables(plain)

  // 3. Cabinets along the walls, keeping the walkway to the tables. An island shop stands a few
  //    side cabinets in the edge the tables leave free.
  let sideNote: string | null = null
  if (islandShop) {
    const area = usableArea(input.space)
    const rule = input.sideCabinetRules ?? DEFAULT_SIDE_CABINET_RULES
    const target = sideCabinets.length
      ? islandSideTarget(planner, input.strategy, area, rule)
      : null
    if (typeof target === 'string') sideNote = target
    else if (target !== null) {
      const place = () => planner.placeSideCabinets(sideCabinets, target, base, rule.sideFromDepth)
      let result = place()
      // Short of the target, or some only found room on a side: try the tables clear of a band
      // along the back wall (the cabinets' first choice). That plan is kept only if it costs no
      // table and no further relaxation, and stands more cabinets, or as many with more on the
      // back wall.
      const back = planner.sideCabinetBack()
      if ((result.placed < target || result.onBack < result.placed) && island && back) {
        const depth = Math.min(...sideCabinets.map((c) => Math.min(c.footprint.w, c.footprint.d)))
        const band = planner.wallBand(back, base.wallGap + depth + base.clearance)
        // The tables are packed against what stands so far: the cashier, not the first try.
        undoTables()
        const banded = planTables(() => band)
        const relaxedKey = (t: typeof plain) => JSON.stringify([...t.relaxed])
        let other: typeof result | null = null
        if (
          banded.chosen.slots.length >= plain.chosen.slots.length &&
          relaxedKey(banded) === relaxedKey(plain)
        ) {
          addTables(banded)
          other = place()
        }
        if (
          other &&
          (other.placed > result.placed ||
            (other.placed === result.placed && other.onBack > result.onBack))
        )
          [tables, result] = [banded, other]
        else {
          undoTables()
          addTables(plain)
          place()
        }
      }
      const { placed } = result
      sideNote = sideCabinetNote(input.strategy, area, target, placed, rule)
    }
  } else if (cabinets.length) {
    const walls = input.strategy === 'max' ? planner.walls : planner.walls.slice(0, 1)
    planner.fillWalls(cabinets, walls, input.strategy === 'min' ? 1 : Infinity, plain.rules)
  }
  const { requested, rules, relaxed, chosen } = tables
  planner.notes.push(...tables.notes, ...(sideNote ? [sideNote] : []))

  const items = planner.placed.map((p) => p.item)
  const relaxations = [...relaxed.entries()].map(([rule, v]) => ({
    rule,
    target: v.target,
    actual: v.actual,
  }))
  const relaxNote = relaxations.length
    ? `；已让步：${relaxations.map((r) => `${RULE_NAMES[r.rule]} ${r.target}→${r.actual} m`).join('，')}`
    : ''
  const layout = LayoutSchema.parse({
    schemaVersion: 3,
    items,
    planning: {
      strategy: input.strategy,
      requested,
      placed: chosen.slots.length,
      relaxations,
      note: `${PLAN_STRATEGY_LABELS[input.strategy]}：主通道 ${rules.aisle} m、道具间距 ${rules.clearance} m 为设计指导值，非消防验收${relaxNote}`.slice(
        0,
        500,
      ),
    },
  })
  return { layout, issues: validateLayout(input.space, layout), notes: planner.notes }
}
