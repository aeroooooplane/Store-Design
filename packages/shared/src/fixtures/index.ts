import { edges } from '../geometry/polygon.ts'
import { rectFromCenter, rectInsidePolygon, rectsOverlap } from '../geometry/rect.ts'
import type { Rect } from '../geometry/types.ts'
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
    const rect = fixtureRect(fixture)
    if (!rectInsidePolygon(rect, space.boundary)) {
      issues.push({
        code: 'fixture_outside_boundary',
        severity: 'warning',
        message: '空心隔板超出空间边界',
        itemIds: [fixture.id],
      })
    }
    for (const item of layout.items) {
      if (itemMount(item) !== 'floor' || isAccessoryCabinet(item)) continue
      if (rectsOverlap(rect, rectFromCenter(item.cx, item.cz, item.w, item.d))) {
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
  fixture: Pick<Fixture, 'cx' | 'cz' | 'w' | 'd' | 'h'>,
  items: readonly LayoutItem[],
): FixtureSolid[] {
  const outer = fixtureRect(fixture)
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

/** A fresh id for a new partition: partition-1, partition-2 … */
export function nextFixtureId(layout: Pick<Layout, 'fixtures'>): string {
  const used = new Set((layout.fixtures ?? []).map((f) => f.id))
  let n = (layout.fixtures?.length ?? 0) + 1
  while (used.has(`partition-${n}`)) n++
  return `partition-${n}`
}
