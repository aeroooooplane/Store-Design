import type { ItemFunction, PlanStrategy, ShopType } from '../enums.ts'
import {
  distance,
  distanceToSegment,
  edges,
  polygonArea,
  polygonOverlapsRect,
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
import { roundM } from '../units.ts'
import { rotationFacing } from './orientation.ts'

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
}

export const DEFAULT_RULES: Record<ShopType, PlannerRules> = {
  side_hall: { aisle: 1.2, clearance: 0.9, entranceBuffer: 1.2, wallGap: 0.05 },
  island: { aisle: 1.2, clearance: 0.9, entranceBuffer: 1.0, wallGap: 0.3 },
  zone: { aisle: 1.2, clearance: 0.9, entranceBuffer: 1.0, wallGap: 0.05 },
}

/** Each step relaxes one guide value; applied in order until enough tables fit. */
const RELAXATION_STEPS: { rule: keyof Omit<PlannerRules, 'wallGap'>; value: number }[] = [
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
}

export interface PlannerResult {
  layout: Layout
  /** Hard-constraint check of the result; the planner aims for none. */
  issues: LayoutIssue[]
  notes: string[]
}

type Vec = readonly [number, number]

interface Wall {
  a: Point
  axis: 'x' | 'z'
  u: Vec
  n: Vec
  /** Usable stretches along the wall, in metres from `a` (entrances removed). */
  intervals: [number, number][]
  /** Distance from the main entrance; the farthest wall is the back wall. */
  distance: number
}

interface Placed {
  item: LayoutItem
  rect: Rect
}

const ALONG_STEP = 0.05

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
  readonly entranceNormal: Map<number, Vec> = new Map()
  readonly mainEntrance: { mid: Point; n: Vec } | null
  readonly space: Space
  private counter = new Map<string, number>()

  constructor(space: Space) {
    this.space = space
    this.boundary = toClockwise(space.boundary)
    this.bbox = aabb([...this.boundary])
    const ring = edges(this.boundary)
    // Each entrance takes the inward normal of the boundary edge it lies on.
    space.entrances.forEach((entrance, index) => {
      const mid: Point = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
      let best: { n: Vec; d: number } | null = null
      for (const [a, b] of ring) {
        const d = distanceToSegment(mid, a, b)
        const len = distance(a, b)
        if (len > 0 && (!best || d < best.d))
          best = { n: inward([(b[0] - a[0]) / len, (b[1] - a[1]) / len]), d }
      }
      if (best) this.entranceNormal.set(index, best.n)
    })
    const mainIndex = Math.max(
      0,
      space.entrances.findIndex((e) => e.kind === 'main'),
    )
    const main = space.entrances[mainIndex]
    const mainNormal = this.entranceNormal.get(mainIndex)
    this.mainEntrance =
      main && mainNormal
        ? { mid: [(main.a[0] + main.b[0]) / 2, (main.a[1] + main.b[1]) / 2], n: mainNormal }
        : null
    if (!this.mainEntrance) this.notes.push('空间没有入口，未预留入口缓冲与主通道')

    this.walls = ring.flatMap(([a, b]): Wall[] => {
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = Math.hypot(dx, dz)
      // Props rotate in quarter turns, so only axis-aligned edges can carry wall-standing props.
      if (length < 0.3 || (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6)) return []
      const u: Vec = [dx / length + 0, dz / length + 0]
      let intervals: [number, number][] = [[0, length]]
      for (const entrance of space.entrances) {
        if (
          distanceToSegment(entrance.a, a, b) > 0.02 ||
          distanceToSegment(entrance.b, a, b) > 0.02
        )
          continue
        const ta = (entrance.a[0] - a[0]) * u[0] + (entrance.a[1] - a[1]) * u[1]
        const tb = (entrance.b[0] - a[0]) * u[0] + (entrance.b[1] - a[1]) * u[1]
        intervals = subtract(intervals, [Math.min(ta, tb) - 0.1, Math.max(ta, tb) + 0.1])
      }
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const far = this.mainEntrance ? distance(mid, this.mainEntrance.mid) : 0
      return intervals.length
        ? [{ a, axis: Math.abs(dx) > 1e-6 ? 'x' : 'z', u, n: inward(u), intervals, distance: far }]
        : []
    })
    this.walls.sort((p, q) => q.distance - p.distance)
  }

  /** Soft keep-out areas: inside every entrance, and the main aisle for island tables. */
  zones(rules: PlannerRules, withAisle: boolean): Rect[] {
    const zones: Rect[] = []
    this.space.entrances.forEach((entrance, index) => {
      const n = this.entranceNormal.get(index)
      if (!n) return
      const depth = rules.entranceBuffer
      zones.push(
        aabb([
          entrance.a,
          entrance.b,
          [entrance.a[0] + n[0] * depth, entrance.a[1] + n[1] * depth],
          [entrance.b[0] + n[0] * depth, entrance.b[1] + n[1] * depth],
        ]),
      )
    })
    if (withAisle && this.mainEntrance) {
      const { mid, n } = this.mainEntrance
      const span = Math.max(this.bbox.maxX - this.bbox.minX, this.bbox.maxZ - this.bbox.minZ)
      const half = rules.aisle / 2
      const side: Vec = [-n[1], n[0]]
      zones.push(
        aabb([
          [mid[0] + side[0] * half, mid[1] + side[1] * half],
          [mid[0] - side[0] * half, mid[1] - side[1] * half],
          [mid[0] + side[0] * half + n[0] * span, mid[1] + side[1] * half + n[1] * span],
          [mid[0] - side[0] * half + n[0] * span, mid[1] - side[1] * half + n[1] * span],
        ]),
      )
    }
    return zones
  }

  /** Hard constraints plus the soft keep-outs and spacing of the current rules. */
  fits(
    rect: Rect,
    options: {
      zones: Rect[]
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
    if (this.space.entrances.some((e) => segmentIntersectsRectInterior(e.a, e.b, rect)))
      return false
    if (options.zones.some((zone) => rectsOverlap(zone, rect))) return false
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

  /** All island-table slots of one orientation, packed row by row with the given spacing. */
  pack(asset: PlannerAsset, rotation: Rotation, rules: PlannerRules, reserved: Rect[]): Rect[] {
    const size = rotatedFootprint(asset, rotation)
    const area = (this.bbox.maxX - this.bbox.minX) * (this.bbox.maxZ - this.bbox.minZ)
    const grid = area > 200 ? 0.2 : 0.1
    const zones = [...this.zones(rules, true), ...reserved]
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

/** Usable floor area, the basis of the 按面积推荐 table count. */
export function usableArea(space: Space): number {
  return (
    polygonArea(space.boundary) -
    space.obstacles.reduce((sum, o) => sum + polygonArea(o.polygon), 0)
  )
}

/** Initial heuristic carried over from the legacy planner, until cleaned store data gives a better rule. */
export function tablesForArea(area: number): number {
  return Math.max(1, Math.floor((area - 16) / 18) + 1)
}

const STRATEGY_NAMES: Record<GeneratedStrategy, string> = {
  max: '尽量多放',
  area: '按面积推荐',
  min: '尽量少放',
}

/**
 * Generates one layout for a polygon space. Cashier against the back wall, island tables in the
 * open floor away from entrances and the main aisle, cabinets along the remaining walls. Guide
 * values are relaxed one step at a time when the requested tables do not fit, and every
 * relaxation is recorded in `planning.relaxations`.
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
  const cabinets = pick(input.catalog.cabinet, '配件柜').sort(
    (a, b) => Math.max(b.footprint.w, b.footprint.d) - Math.max(a.footprint.w, a.footprint.d),
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
  const reserved = (rules: PlannerRules): Rect[] =>
    back && cabinets.length
      ? planner.wallBand(back, rules.wallGap + cabinetDepth + rules.clearance)
      : []

  let requested = 0
  let rules = base
  const relaxed = new Map<string, { target: number; actual: number }>()
  const island = islands[0]
  let chosen: { rotation: Rotation; slots: Rect[] } = { rotation: 0, slots: [] }
  if (island) {
    // 尽量多放 relaxes towards the same target as 按面积推荐, then keeps every slot, so it never
    // shows fewer tables; 尽量少放 asks for one.
    requested = input.strategy === 'min' ? 1 : tablesForArea(usableArea(input.space))
    let best = planner.bestPacking(island, rules, reserved(rules))
    for (const step of RELAXATION_STEPS) {
      if (best.slots.length >= requested) break
      if (rules[step.rule] <= step.value) continue
      relaxed.set(step.rule, { target: base[step.rule], actual: step.value })
      rules = { ...rules, [step.rule]: step.value }
      best = planner.bestPacking(island, rules, reserved(rules))
    }
    const slots = input.strategy === 'max' ? best.slots : spread(best.slots, requested)
    if (input.strategy === 'max') requested = Math.max(requested, best.slots.length)
    chosen = { rotation: best.rotation, slots }
    for (const rect of slots) planner.add(island, chosen.rotation, rect)
    if (slots.length < requested && (input.strategy !== 'max' || !slots.length)) {
      planner.notes.push(`空间有限，只放下 ${slots.length} / ${requested} 张中岛桌`)
    }
  }

  // 3. Cabinets along the walls, keeping the walkway to the tables.
  if (cabinets.length) {
    const walls = input.strategy === 'max' ? planner.walls : planner.walls.slice(0, 1)
    planner.fillWalls(cabinets, walls, input.strategy === 'min' ? 1 : Infinity, rules)
  }

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
      note: `${STRATEGY_NAMES[input.strategy]}：主通道 ${rules.aisle} m、道具间距 ${rules.clearance} m 为设计指导值，非消防验收${relaxNote}`.slice(
        0,
        500,
      ),
    },
  })
  return { layout, issues: validateLayout(input.space, layout), notes: planner.notes }
}
