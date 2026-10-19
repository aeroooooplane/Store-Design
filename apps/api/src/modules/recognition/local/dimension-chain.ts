import type { Line } from './lines.ts'

/**
 * One span of a dimension chain: the stretch of a dimension line between two ticks. Its number
 * is drawn beside it, usually as outlines (text turned into curves), so it is read from the
 * page picture (see ../ocr.ts); this file only finds where to look.
 */
export interface DimensionSegment {
  horizontal: boolean
  /** The dimension line's y (horizontal) or x (vertical), in pixels. */
  at: number
  /** Where the span starts and ends along the line, in pixels. */
  a: number
  b: number
  /** The longest stroke of its ticks, in pixels: the drawing's text size goes with it. */
  tick: number
}

/** A span with the number read beside it (by ../ocr.ts). */
export interface ChainReading extends DimensionSegment {
  mm: number
  /** What was read, as read. */
  text: string
}

/** A tick: a short stroke at 20°–70° (drawings scaled unevenly slant them) to the line, 4–25 px long. */
const TICK_MIN_PX = 4
const TICK_MAX_PX = 25
/** Tick strokes this close (centres, px) are one tick: a tick is drawn as a filled sliver. */
const TICK_MERGE_PX = 3
/** Ticks this far off a common line (px) are still on it. */
const LINE_SLACK_PX = 1.5
/** A span counts when the dimension line covers this share of it. */
const MIN_COVERAGE = 0.8

/**
 * The spans of the dimension chains: ticks (architectural slashes) in a row on a horizontal or
 * vertical line, with the line drawn between each pair.
 */
export function findDimensionSegments(lines: readonly Line[]): DimensionSegment[] {
  const ticks: { x: number; y: number; n: number; len: number }[] = []
  for (const l of lines) {
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    const len = Math.hypot(dx, dy)
    if (len < TICK_MIN_PX || len > TICK_MAX_PX) continue
    const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 90
    if (angle < 20 || angle > 70) continue
    const x = (l.x1 + l.x2) / 2
    const y = (l.y1 + l.y2) / 2
    const near = ticks.find((t) => Math.hypot(t.x / t.n - x, t.y / t.n - y) < TICK_MERGE_PX)
    if (near) {
      near.x += x
      near.y += y
      near.n++
      near.len = Math.max(near.len, len)
    } else {
      ticks.push({ x, y, n: 1, len })
    }
  }
  const points = ticks.map((t) => ({ x: t.x / t.n, y: t.y / t.n, len: t.len }))
  const segments: DimensionSegment[] = []
  for (const horizontal of [true, false]) {
    const across = (p: { x: number; y: number }) => (horizontal ? p.y : p.x)
    const along = (p: { x: number; y: number }) => (horizontal ? p.x : p.y)
    const sorted = [...points].sort((p, q) => across(p) - across(q) || along(p) - along(q))
    const rows: (typeof points)[] = []
    for (const p of sorted) {
      const row = rows.at(-1)
      if (row?.[0] && Math.abs(across(row[0]) - across(p)) <= LINE_SLACK_PX) row.push(p)
      else rows.push([p])
    }
    for (const row of rows) {
      if (row.length < 2) continue
      row.sort((p, q) => along(p) - along(q))
      const at = row.reduce((sum, p) => sum + across(p), 0) / row.length
      const runs = lines.flatMap((l): [number, number][] => {
        const flat = horizontal ? Math.abs(l.y1 - l.y2) : Math.abs(l.x1 - l.x2)
        const pos = horizontal ? l.y1 : l.x1
        if (flat > 0.6 || Math.abs(pos - at) > LINE_SLACK_PX) return []
        const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
        return [[Math.min(s, e) - 0.5, Math.max(s, e) + 0.5]]
      })
      for (let i = 0; i + 1 < row.length; i++) {
        const p = row[i]!
        const q = row[i + 1]!
        const a = along(p)
        const b = along(q)
        if (b - a < TICK_MIN_PX) continue
        let covered = 0
        const samples = 20
        for (let k = 0; k < samples; k++) {
          const m = a + ((b - a) * (k + 0.5)) / samples
          if (runs.some(([s, e]) => s <= m && m <= e)) covered++
        }
        if (covered < samples * MIN_COVERAGE) continue
        segments.push({ horizontal, at, a, b, tick: Math.max(p.len, q.len) })
      }
    }
  }
  return segments
}

/**
 * Where a span's number is drawn, in page pixels: above a horizontal line, left of a vertical
 * one (read bottom to top), centred on the span. The ticks and the next span's number are left
 * out; a long span is only looked at round its middle.
 */
export function numberWindow(s: DimensionSegment): { x: number; y: number; w: number; h: number } {
  const textHeight = s.tick * 1.8
  const span = Math.min(Math.max(s.b - s.a - s.tick * 1.2, textHeight * 2.5), textHeight * 6)
  const mid = (s.a + s.b) / 2
  const offset = s.at - textHeight * 1.3
  const depth = textHeight * 1.1
  return s.horizontal
    ? { x: mid - span / 2, y: offset, w: span, h: depth }
    : { x: offset, y: mid - span / 2, w: depth, h: span }
}

/**
 * Tells the lines of the dimension chains whose numbers were read: lines along a read span's
 * row, over its stretch. They are no walls and no prop sides (two parallel chains look like a
 * long box). `shift` moves the readings into the coordinates of the lines (a crop).
 */
export function chainLineTest(
  readings: readonly ChainReading[],
  shift: { x: number; y: number } = { x: 0, y: 0 },
): (line: Line) => boolean {
  const rows: { horizontal: boolean; at: number; a: number; b: number }[] = []
  for (const r of readings) {
    const at = r.at - (r.horizontal ? shift.y : shift.x)
    const a = r.a - (r.horizontal ? shift.x : shift.y) - r.tick
    const b = r.b - (r.horizontal ? shift.x : shift.y) + r.tick
    const row = rows.find(
      (o) => o.horizontal === r.horizontal && Math.abs(o.at - at) <= LINE_SLACK_PX,
    )
    if (row) {
      row.a = Math.min(row.a, a)
      row.b = Math.max(row.b, b)
    } else {
      rows.push({ horizontal: r.horizontal, at, a, b })
    }
  }
  return (l) => {
    for (const row of rows) {
      const flat = row.horizontal ? Math.abs(l.y1 - l.y2) : Math.abs(l.x1 - l.x2)
      const pos = row.horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
      if (flat > 0.6 || Math.abs(pos - row.at) > LINE_SLACK_PX) continue
      const [s, e] = row.horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
      const lo = Math.min(s, e)
      const hi = Math.max(s, e)
      // Mostly within the chain's stretch: a wall the chain runs along goes on beyond it.
      if (Math.min(hi, row.b) - Math.max(lo, row.a) >= (hi - lo) * 0.5) return true
    }
    return false
  }
}

/** Readings within this share of each other are taken as one scale. */
export const CHAIN_TOLERANCE = 0.015

/**
 * The scale most spans agree on, in mm per pixel: the largest group of readings within
 * CHAIN_TOLERANCE of one another, as its total millimetres over its total pixels (long spans
 * weigh more, being less hurt by a pixel off).
 */
export function chainScale(
  readings: readonly ChainReading[],
): { mmPerPixel: number; used: ChainReading[] } | null {
  const px = (r: ChainReading) => r.b - r.a
  let best: ChainReading[] = []
  for (const r of readings) {
    const ratio = r.mm / px(r)
    const group = readings.filter((o) => Math.abs(o.mm / px(o) - ratio) / ratio <= CHAIN_TOLERANCE)
    if (group.length > best.length) best = group
  }
  if (!best.length) return null
  const mm = best.reduce((sum, r) => sum + r.mm, 0)
  const total = best.reduce((sum, r) => sum + px(r), 0)
  return { mmPerPixel: mm / total, used: best }
}
