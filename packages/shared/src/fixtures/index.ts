import { cross, edges, polygonArea } from '../geometry/polygon.ts'
import { obbCorners, obbInsidePolygon, obbsOverlap, placedBox, turnPoint } from '../geometry/obb.ts'
import { rectFromCenter, rectsOverlap } from '../geometry/rect.ts'
import type { Point, Rect } from '../geometry/types.ts'
import type { ShopType } from '../enums.ts'
import { wallSegments } from '../scene/walls.ts'
import { openingPieces } from '../schemas/space.ts'
import { itemMount } from '../mounting/index.ts'
import type { Fixture, Layout, LayoutIssue, LayoutItem } from '../schemas/layout.ts'
import type { Space } from '../schemas/space.ts'
import { EPSILON_M, roundM } from '../units.ts'

/**
 * 空心隔板 (hollow partitions): a stop-gap for accessory cabinets built into a wall. The user
 * drags a rectangle on the plan; its edges stick to walls and to accessory cabinets, so the box
 * closes neatly around them. Real built-in cabinets (inside walls) may replace this later.
 */

/** A drawn edge jumps onto a wall or cabinet edge within this distance (metres). */
export const FIXTURE_SNAP_M = 0.1
/** Smallest partition side worth keeping (a click without a drag draws nothing). */
export const MIN_FIXTURE_M = 0.05

/** Accessory cabinets (including 1.3 m 配件边柜): the props a partition may close around. */
export function isAccessoryCabinet(item: Pick<LayoutItem, 'function' | 'mount'>): boolean {
  return (
    itemMount(item) === 'floor' &&
    (item.function === 'accessory_cabinet' || item.function === 'side_cabinet')
  )
}

export const fixtureRect = (f: Pick<Fixture, 'cx' | 'cz' | 'w' | 'd'>): Rect =>
  rectFromCenter(f.cx, f.cz, f.w, f.d)

type FixtureFootprint = Pick<Fixture, 'cx' | 'cz' | 'w' | 'd' | 'rotation'>
const fixtureBox = (f: FixtureFootprint) => ({
  cx: f.cx,
  cz: f.cz,
  w: f.w,
  d: f.d,
  angle: f.rotation ?? 0,
})

export const fixtureCorners = (f: FixtureFootprint) => obbCorners(fixtureBox(f))

/** The real axis-aligned footprint when the partition has horizontal and vertical faces. */
export function fixtureStraightRect(f: FixtureFootprint): Rect | undefined {
  const angle = f.rotation ?? 0
  if (angle % 180 === 0) return fixtureRect(f)
  if (angle % 90 === 0) return rectFromCenter(f.cx, f.cz, f.d, f.w)
  return undefined
}

interface Line {
  at: number
  from: number
  to: number
}

/** Moves `value` onto the nearest line within FIXTURE_SNAP_M that runs past [from, to]. */
function snapTo(value: number, from: number, to: number, lines: readonly Line[]): number {
  let best = value
  let gap = FIXTURE_SNAP_M + EPSILON_M
  for (const line of lines) {
    if (line.to < from - FIXTURE_SNAP_M || line.from > to + FIXTURE_SNAP_M) continue
    const d = Math.abs(line.at - value)
    if (d < gap) {
      gap = d
      best = line.at
    }
  }
  return best
}

/**
 * A drawn or moved rectangle with each edge stuck to the nearest straight wall or accessory
 * cabinet edge within FIXTURE_SNAP_M (Alt held: pass no space to skip this).
 */
export function snapFixtureRect(
  rect: Rect,
  space: Pick<Space, 'boundary'>,
  items: readonly LayoutItem[],
): Rect {
  const xLines: Line[] = []
  const zLines: Line[] = []
  for (const [a, b] of edges(space.boundary)) {
    if (Math.abs(a[0] - b[0]) < EPSILON_M)
      xLines.push({ at: a[0], from: Math.min(a[1], b[1]), to: Math.max(a[1], b[1]) })
    else if (Math.abs(a[1] - b[1]) < EPSILON_M)
      zLines.push({ at: a[1], from: Math.min(a[0], b[0]), to: Math.max(a[0], b[0]) })
  }
  for (const item of items) {
    if (!isAccessoryCabinet(item)) continue
    const r = rectFromCenter(item.cx, item.cz, item.w, item.d)
    xLines.push({ at: r.minX, from: r.minZ, to: r.maxZ }, { at: r.maxX, from: r.minZ, to: r.maxZ })
    zLines.push({ at: r.minZ, from: r.minX, to: r.maxX }, { at: r.maxZ, from: r.minX, to: r.maxX })
  }
  return {
    minX: roundM(snapTo(rect.minX, rect.minZ, rect.maxZ, xLines)),
    maxX: roundM(snapTo(rect.maxX, rect.minZ, rect.maxZ, xLines)),
    minZ: roundM(snapTo(rect.minZ, rect.minX, rect.maxX, zLines)),
    maxZ: roundM(snapTo(rect.maxZ, rect.minX, rect.maxX, zLines)),
  }
}

export type FixtureEdge = keyof Rect

interface FixtureSnapTarget {
  a: Point
  b: Point
}

function outlineTargets(corners: readonly Point[]): FixtureSnapTarget[] {
  return edges(corners).map(([a, b]) => ({ a, b }))
}

/** Draw to real walls, cabinets and partitions. Resizing also uses the open boundary lines. */
export function fixtureSnapTargets(
  space: Space,
  shopType: ShopType,
  items: readonly LayoutItem[],
  fixtures: readonly Fixture[],
  resizing = false,
): FixtureSnapTarget[] {
  const boundary =
    resizing && shopType === 'island'
      ? edges(space.boundary).map(([a, b]) => ({ a, b }))
      : wallSegments(space, shopType).map(({ a, b }) => ({ a, b }))
  const openings = resizing
    ? [...space.entrances, ...space.openEdges].flatMap(
        (opening) => openingPieces(space, opening) ?? [],
      )
    : []
  return [
    ...boundary,
    ...openings,
    ...items
      .filter(isAccessoryCabinet)
      .flatMap((item) => outlineTargets(obbCorners(placedBox(item)))),
    ...fixtures.flatMap((fixture) => outlineTargets(fixtureCorners(fixture))),
  ]
}

export interface FixtureDragPreview {
  // Place the rectangle at its world centre, with these dimensions and this local angle.
  rect: Rect
  rotation?: number
  guides: FixtureSnapTarget[]
  valid: boolean
}

function rectBetween(a: Point, b: Point): Rect {
  return {
    minX: Math.min(a[0], b[0]),
    maxX: Math.max(a[0], b[0]),
    minZ: Math.min(a[1], b[1]),
    maxZ: Math.max(a[1], b[1]),
  }
}

function hasFixtureSize(rect: Rect): boolean {
  return (
    roundM(rect.maxX - rect.minX) >= MIN_FIXTURE_M && roundM(rect.maxZ - rect.minZ) >= MIN_FIXTURE_M
  )
}

function nearestFixtureLine(
  axis: 0 | 1,
  value: number,
  from: number,
  to: number,
  targets: readonly FixtureSnapTarget[],
): FixtureSnapTarget | undefined {
  const along = axis === 0 ? 1 : 0
  let best: FixtureSnapTarget | undefined
  let distance = FIXTURE_SNAP_M + EPSILON_M
  for (const target of targets) {
    const { a, b } = target
    if (Math.abs(a[axis] - b[axis]) > EPSILON_M) continue
    if (
      Math.max(a[along], b[along]) < from - FIXTURE_SNAP_M ||
      Math.min(a[along], b[along]) > to + FIXTURE_SNAP_M
    )
      continue
    const gap = Math.abs(value - a[axis])
    if (gap >= distance) continue
    best = target
    distance = gap
  }
  return best
}

function snapDrawPoint(point: Point, rect: Rect, targets: readonly FixtureSnapTarget[]) {
  let corner: Point | undefined
  let best = FIXTURE_SNAP_M + EPSILON_M
  for (const { a, b } of targets) {
    for (const end of [a, b]) {
      const distance = Math.hypot(point[0] - end[0], point[1] - end[1])
      if (distance >= best) continue
      best = distance
      corner = end
    }
  }
  if (corner) {
    return {
      point: corner,
      guides: targets.filter(
        ({ a, b }) =>
          a === corner ||
          b === corner ||
          (a[0] === corner[0] && a[1] === corner[1]) ||
          (b[0] === corner[0] && b[1] === corner[1]),
      ),
    }
  }
  const x = nearestFixtureLine(0, point[0], rect.minZ, rect.maxZ, targets)
  const z = nearestFixtureLine(1, point[1], rect.minX, rect.maxX, targets)
  return {
    point: [x?.a[0] ?? point[0], z?.a[1] ?? point[1]] as Point,
    guides: [x, z].filter((target) => target !== undefined),
  }
}

export function previewDrawnFixture(
  start: Point,
  end: Point,
  targets: readonly FixtureSnapTarget[],
): FixtureDragPreview {
  const raw = rectBetween(start, end)
  const a = snapDrawPoint(start, raw, targets)
  const b = snapDrawPoint(end, raw, targets)
  const rect = rectBetween(a.point, b.point)
  return {
    rect,
    guides: [...new Set([...a.guides, ...b.guides])],
    valid: hasFixtureSize(raw) && hasFixtureSize(rect),
  }
}

/** Keep the opposite edge fixed. A free resize rounds the edited dimension to 10 mm. */
export function previewResizedFixture(
  start: Rect,
  edge: FixtureEdge,
  delta: number,
  targets: readonly FixtureSnapTarget[],
): FixtureDragPreview {
  const alongX = edge.endsWith('X')
  const axis = alongX ? 0 : 1
  const min = edge.startsWith('min')
  const fixed = alongX ? start[min ? 'maxX' : 'minX'] : start[min ? 'maxZ' : 'minZ']
  const direction = min ? -1 : 1
  const resized = (at: number) => ({ ...start, [edge]: roundM(at) })
  if (delta === 0) return { rect: start, guides: [], valid: true }
  const size = Math.max(
    MIN_FIXTURE_M,
    Math.round((start[edge] + delta - fixed) * direction * 100) / 100,
  )
  const free = fixed + direction * size
  const available = targets.filter(
    ({ a }) =>
      (a[axis] - fixed) * direction >= MIN_FIXTURE_M - EPSILON_M &&
      (Math.abs(a[axis] - start[edge]) > EPSILON_M || Math.abs(free - start[edge]) < EPSILON_M),
  )
  const guide = nearestFixtureLine(
    axis,
    free,
    alongX ? start.minZ : start.minX,
    alongX ? start.maxZ : start.maxX,
    available,
  )
  const rect = resized(guide?.a[axis] ?? free)
  return { rect, guides: guide ? [guide] : [], valid: hasFixtureSize(rect) }
}

function fixtureTargetsLocal(fixture: FixtureFootprint, targets: readonly FixtureSnapTarget[]) {
  const angle = fixture.rotation ?? 0
  const local = ([x, z]: Point) => turnPoint(x - fixture.cx, z - fixture.cz, -angle)
  return targets.map(({ a, b }) => ({ a: local(a), b: local(b) }))
}

/** Resize along the selected side's normal, with the opposite side anchored in the plan. */
export function previewFixtureEdgeResize(
  fixture: FixtureFootprint,
  edge: FixtureEdge,
  start: Point,
  end: Point,
  targets: readonly FixtureSnapTarget[],
): FixtureDragPreview {
  const rotation = fixture.rotation ?? 0
  const axis = edge.endsWith('X') ? 0 : 1
  const delta = turnPoint(end[0] - start[0], end[1] - start[1], -rotation)[axis]
  if (!rotation) return previewResizedFixture(fixtureRect(fixture), edge, delta, targets)
  const local = previewResizedFixture(
    rectFromCenter(0, 0, fixture.w, fixture.d),
    edge,
    delta,
    fixtureTargetsLocal(fixture, targets),
  )
  const { minX, maxX, minZ, maxZ } = local.rect
  const world = ([x, z]: Point): Point => {
    const [dx, dz] = turnPoint(x, z, rotation)
    return [fixture.cx + dx, fixture.cz + dz]
  }
  const [cx, cz] = world([(minX + maxX) / 2, (minZ + maxZ) / 2])
  return {
    rect: rectFromCenter(cx, cz, maxX - minX, maxZ - minZ),
    rotation,
    guides: local.guides.map(({ a, b }) => ({ a: world(a), b: world(b) })),
    valid: local.valid,
  }
}

/** Snap the actual faces to nearby parallel targets while moving, keeping both dimensions. */
export function snapFixturePosition(
  fixture: FixtureFootprint,
  targets: readonly FixtureSnapTarget[],
): Point {
  const { w, d, cx, cz } = fixture
  const nearby = fixtureTargetsLocal(fixture, targets)
  const shift = (axis: 0 | 1, half: number, across: number) => {
    const offsets = [-half, half].flatMap((face) => {
      const at = nearestFixtureLine(axis, face, -across, across, nearby)?.a[axis]
      return at === undefined ? [] : [at - face]
    })
    return (
      offsets.reduce<number | undefined>(
        (best, offset) => (best === undefined || Math.abs(offset) < Math.abs(best) ? offset : best),
        undefined,
      ) ?? 0
    )
  }
  const [dx, dz] = turnPoint(shift(0, w / 2, d / 2), shift(1, d / 2, w / 2), fixture.rotation ?? 0)
  return [roundM(cx + dx), roundM(cz + dz)]
}

/**
 * Default height: as tall as the tallest accessory cabinet it touches or encloses, so the box
 * finishes flush with the cabinets; up to the ceiling when there is none.
 */
export function defaultFixtureHeight(
  rect: Rect,
  items: readonly LayoutItem[],
  space: Pick<Space, 'height'>,
): number {
  const near = items.filter(
    (item) =>
      isAccessoryCabinet(item) &&
      rectsOverlap(rect, rectFromCenter(item.cx, item.cz, item.w, item.d), -EPSILON_M * 10),
  )
  return roundM(near.length ? Math.max(...near.map((i) => i.h)) : space.height)
}

/**
 * Soft checks for partitions (warnings, since this is a drawing aid): they stay inside the
 * boundary, and only accessory cabinets may sit inside them (built in).
 */
export function fixtureIssues(space: Space, layout: Layout): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  for (const fixture of layout.fixtures ?? []) {
    const box = fixtureBox(fixture)
    if (!obbInsidePolygon(box, space.boundary)) {
      issues.push({
        code: 'fixture_outside_boundary',
        severity: 'warning',
        message: '空心隔板超出空间边界',
        itemIds: [fixture.id],
      })
    }
    for (const item of layout.items) {
      if (itemMount(item) !== 'floor' || isAccessoryCabinet(item)) continue
      if (obbsOverlap(box, placedBox(item))) {
        issues.push({
          code: 'fixture_overlaps_item',
          severity: 'warning',
          message: `空心隔板与${item.name}重叠`,
          itemIds: [fixture.id, item.id],
        })
      }
    }
  }
  return issues
}

/** One solid block of a partition: a footprint from `bottom` to `top` (metres). */
export interface FixtureSolid {
  rect: Rect
  polygon?: Point[]
  bottom: number
  top: number
}

/**
 * What of a partition is solid in 3D: the box with niches where accessory cabinets stand, so
 * the cabinets show through; above a cabinet lower than the partition the box closes again.
 * The partition is cut into cells along every cabinet edge; cells in one row with the same
 * bottom are joined, so a partition around one cabinet is a handful of blocks.
 */
export function fixtureSolids(
  fixture: FixtureFootprint & Pick<Fixture, 'h'>,
  items: readonly LayoutItem[],
): FixtureSolid[] {
  const outer = fixtureStraightRect(fixture)
  if (!outer) return turnedFixtureSolids(fixture, items)
  const cabinets = items
    .filter(isAccessoryCabinet)
    .map((item) => ({ rect: rectFromCenter(item.cx, item.cz, item.w, item.d), h: item.h }))
    .filter((c) => rectsOverlap(outer, c.rect))
  const cuts = (lo: number, hi: number, values: number[]) =>
    [...new Set([lo, hi, ...values.filter((v) => v > lo + EPSILON_M && v < hi - EPSILON_M)])].sort(
      (a, b) => a - b,
    )
  const xs = cuts(
    outer.minX,
    outer.maxX,
    cabinets.flatMap((c) => [c.rect.minX, c.rect.maxX]),
  )
  const zs = cuts(
    outer.minZ,
    outer.maxZ,
    cabinets.flatMap((c) => [c.rect.minZ, c.rect.maxZ]),
  )
  const solids: FixtureSolid[] = []
  for (let j = 0; j + 1 < zs.length; j++) {
    let run: FixtureSolid | null = null
    for (let i = 0; i + 1 < xs.length; i++) {
      const cell: Rect = {
        minX: xs[i] ?? 0,
        maxX: xs[i + 1] ?? 0,
        minZ: zs[j] ?? 0,
        maxZ: zs[j + 1] ?? 0,
      }
      const mx = (cell.minX + cell.maxX) / 2
      const mz = (cell.minZ + cell.maxZ) / 2
      const under = cabinets.filter(
        (c) => mx > c.rect.minX && mx < c.rect.maxX && mz > c.rect.minZ && mz < c.rect.maxZ,
      )
      const bottom = under.length ? Math.max(...under.map((c) => c.h)) : 0
      if (bottom >= fixture.h - EPSILON_M) {
        run = null
        continue
      }
      if (run && Math.abs(run.bottom - bottom) < EPSILON_M) {
        run.rect = { ...run.rect, maxX: cell.maxX }
      } else {
        run = { rect: cell, bottom, top: fixture.h }
        solids.push(run)
      }
    }
  }
  return solids
}

/** Split a convex cell by a cabinet edge (cabinet interior is on the positive side). */
function splitFixtureCell(cell: Point[], a: Point, b: Point): [Point[], Point[]] {
  const inside: Point[] = []
  const outside: Point[] = []
  const side = (p: Point) => {
    const value = cross(a, b, p)
    return Math.abs(value) < 1e-10 ? 0 : value
  }
  for (const [p, q] of edges(cell)) {
    const from = side(p)
    const to = side(q)
    if (from >= 0) inside.push(p)
    if (from <= 0) outside.push(p)
    if ((from < 0 && to > 0) || (from > 0 && to < 0)) {
      const t = from / (from - to)
      const intersection: Point = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
      inside.push(intersection)
      outside.push(intersection)
    }
  }
  return [inside, outside]
}

function turnedFixtureSolids(
  fixture: FixtureFootprint & Pick<Fixture, 'h'>,
  items: readonly LayoutItem[],
): FixtureSolid[] {
  const box = fixtureBox(fixture)
  let cells: { polygon: Point[]; bottom: number }[] = [{ polygon: obbCorners(box), bottom: 0 }]
  for (const cabinet of items.filter(isAccessoryCabinet)) {
    const cut = placedBox(cabinet)
    if (!obbsOverlap(box, cut)) continue
    const sides = edges(obbCorners(cut))
    cells = cells.flatMap((cell) => {
      if (cell.bottom >= cabinet.h) return [cell]
      let inside = cell.polygon
      const remaining: typeof cells = []
      for (const [a, b] of sides) {
        const [clipped, outside] = splitFixtureCell(inside, a, b)
        if (polygonArea(clipped) <= 1e-8) return [cell]
        if (polygonArea(outside) > 1e-8) remaining.push({ polygon: outside, bottom: cell.bottom })
        inside = clipped
      }
      if (cabinet.h < fixture.h - EPSILON_M) remaining.push({ polygon: inside, bottom: cabinet.h })
      return remaining
    })
  }
  return cells.map(({ polygon, bottom }) => {
    const x = polygon.map((point) => point[0])
    const z = polygon.map((point) => point[1])
    return {
      polygon,
      bottom,
      top: fixture.h,
      rect: {
        minX: Math.min(...x),
        maxX: Math.max(...x),
        minZ: Math.min(...z),
        maxZ: Math.max(...z),
      },
    }
  })
}

/** A fresh id for a new partition: partition-1, partition-2 … */
export function nextFixtureId(layout: Pick<Layout, 'fixtures'>): string {
  const used = new Set((layout.fixtures ?? []).map((f) => f.id))
  let n = (layout.fixtures?.length ?? 0) + 1
  while (used.has(`partition-${n}`)) n++
  return `partition-${n}`
}
