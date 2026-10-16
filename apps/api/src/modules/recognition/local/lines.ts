import type { RecognizeRequest, VectorContent } from '@store/shared'

export type Text = VectorContent['texts'][number]
export type Line = VectorContent['lines'][number]

export interface Box {
  x: number
  y: number
  w: number
  h: number
  color?: string | undefined
}

export const AXIS_TOLERANCE_PX = 1.5
export const CLUSTER_PX = 2.5
/** A side counts as drawn when this much of it is covered by lines. */
export const SIDE_COVERAGE = 0.85
/** The front of a shop may be entirely entrance and open edge (a dashed lease line). */
export const OPEN_SIDE_COVERAGE = 0
/** Boundary candidates need sides at least this fraction of the page's short side. */
export const MIN_SIDE_FRACTION = 0.12
/** Dimension ratios within this of each other agree. */
export const RATIO_TOLERANCE = 0.05
/** The sheet frame is nearly the whole page; the shop never is. */
export const MAX_BOUNDARY_FRACTION = 0.8
/** A prop box is a small part of the page; anything bigger is a room or the sheet. */
export const MAX_PROP_FRACTION = 0.2
export const DEFAULT_ENTRANCE_M = 1.5

export const isRed = (color?: string) => {
  if (!color) return false
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return r > 150 && g < 110 && b < 110
}

export const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2]
export const contains = (b: Box, p: [number, number], slack = 0) =>
  p[0] >= b.x - slack &&
  p[0] <= b.x + b.w + slack &&
  p[1] >= b.y - slack &&
  p[1] <= b.y + b.h + slack

export function cropContent(content: VectorContent, crop: RecognizeRequest['crop']): VectorContent {
  if (!crop) return content
  const inside = (x: number, y: number) =>
    x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h
  return {
    width: crop.w,
    height: crop.h,
    texts: content.texts
      .filter((t) => inside(t.x + t.w / 2, t.y + t.h / 2))
      .map((t) => ({ ...t, x: t.x - crop.x, y: t.y - crop.y })),
    lines: content.lines
      .filter((l) => inside(l.x1, l.y1) || inside(l.x2, l.y2))
      .map((l) => ({
        ...l,
        x1: l.x1 - crop.x,
        y1: l.y1 - crop.y,
        x2: l.x2 - crop.x,
        y2: l.y2 - crop.y,
      })),
    rects: content.rects
      .filter((r) => inside(r.x + r.w / 2, r.y + r.h / 2))
      .map((r) => ({ ...r, x: r.x - crop.x, y: r.y - crop.y })),
  }
}

/** Axis-aligned lines, rectangles unfolded into their four sides. */
export function axisLines(content: VectorContent): Line[] {
  const lines: Line[] = []
  for (const l of content.lines) {
    if (Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX || Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX) {
      lines.push(l)
    }
  }
  for (const r of content.rects) {
    const { x, y, w, h, color } = r
    lines.push(
      { x1: x, y1: y, x2: x + w, y2: y, color },
      { x1: x, y1: y + h, x2: x + w, y2: y + h, color },
      { x1: x, y1: y, x2: x, y2: y + h, color },
      { x1: x + w, y1: y, x2: x + w, y2: y + h, color },
    )
  }
  return lines
}

/** Axis-aligned lines bucketed by their position, so a side check only looks at its neighbours. */
export interface LineIndex {
  h: Map<number, Line[]>
  v: Map<number, Line[]>
  /** Coverages already worked out: the boundary search asks for the same sides many times. */
  covered: Map<string, number>
}

export const bucket = (pos: number) => Math.round(pos / CLUSTER_PX)

export function buildIndex(lines: Line[]): LineIndex {
  const index: LineIndex = { h: new Map(), v: new Map(), covered: new Map() }
  for (const l of lines) {
    const horizontal = Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
    const vertical = Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
    if (!horizontal && !vertical) continue
    const map = horizontal ? index.h : index.v
    const at = bucket(horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2)
    for (const k of [at - 1, at, at + 1]) {
      const list = map.get(k) ?? []
      list.push(l)
      map.set(k, list)
    }
  }
  return index
}

/** How much of the segment [a, b] at position `at` (on the other axis) the lines cover. */
function coverage(index: LineIndex, horizontal: boolean, at: number, a: number, b: number): number {
  const key = `${horizontal ? 'h' : 'v'}${at},${a},${b}`
  const known = index.covered.get(key)
  if (known !== undefined) return known
  const value = measureCoverage(index, horizontal, at, a, b)
  index.covered.set(key, value)
  return value
}

function measureCoverage(
  index: LineIndex,
  horizontal: boolean,
  at: number,
  a: number,
  b: number,
): number {
  const spans: [number, number][] = []
  for (const l of (horizontal ? index.h : index.v).get(bucket(at)) ?? []) {
    const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
    if (Math.abs(pos - at) > CLUSTER_PX) continue
    const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
    const lo = Math.max(a, Math.min(s, e))
    const hi = Math.min(b, Math.max(s, e))
    if (hi > lo) spans.push([lo, hi])
  }
  spans.sort((p, q) => p[0] - q[0])
  let covered = 0
  let cursor = a
  for (const [lo, hi] of spans) {
    if (hi <= cursor) continue
    covered += hi - Math.max(lo, cursor)
    cursor = hi
  }
  return covered / (b - a)
}

export const sideCoverages = (index: LineIndex, box: Box) => [
  coverage(index, true, box.y, box.x, box.x + box.w),
  coverage(index, true, box.y + box.h, box.x, box.x + box.w),
  coverage(index, false, box.x, box.y, box.y + box.h),
  coverage(index, false, box.x + box.w, box.y, box.y + box.h),
]

/** All four sides drawn. */
export const closed = (index: LineIndex, box: Box) =>
  sideCoverages(index, box).every((c) => c >= SIDE_COVERAGE)

export function cluster(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last === undefined || v - last > CLUSTER_PX) out.push(v)
  }
  return out
}
