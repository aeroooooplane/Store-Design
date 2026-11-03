import type { Obstacle } from '@store/shared'
import {
  AXIS_TOLERANCE_PX,
  CLUSTER_PX,
  MAX_PROP_FRACTION,
  centre,
  closed,
  cluster,
  contains,
} from './lines.ts'
import type { Box, Line, LineIndex, Text } from './lines.ts'

export const OBSTACLE_WORDS: [RegExp, Obstacle['kind']][] = [
  [/柱/, 'column'],
  [/楼梯|台阶|扶梯/, 'stair'],
  [/配电|消防|管井|井道/, 'shaft'],
  [/服务台|层板|底柜|结构/, 'fixed'],
  // Added on site, not part of the shell: counts as area (see Obstacle.addedLater).
  [/橱窗|包板/, 'fixed'],
]

/** Fixtures added after the shell: props are kept off them, but they do not shrink the shop. */
export const ADDED_LATER_WORDS = /橱窗|包板/

/** Smallest drawn box holding the point, that is not the boundary and not tiny. */
export function boxAround(
  point: [number, number],
  boxes: Box[],
  boundary: Box | null,
  minArea: number,
): Box | null {
  let best: Box | null = null
  for (const b of boxes) {
    if (
      boundary &&
      b.x === boundary.x &&
      b.y === boundary.y &&
      b.w === boundary.w &&
      b.h === boundary.h
    )
      continue
    if (b.w * b.h < minArea) continue
    if (boundary && b.w * b.h > boundary.w * boundary.h * 0.6) continue
    if (!contains(b, point)) continue
    if (!best || b.w * b.h < best.w * best.h) best = b
  }
  return best
}

/** Lines on one side of a point whose span covers it, nearest first (at most four positions). */
function nearestSides(lines: Line[], cx: number, cy: number) {
  const lefts: number[] = []
  const rights: number[] = []
  const tops: number[] = []
  const bottoms: number[] = []
  for (const l of lines) {
    if (Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX) {
      if (cy < Math.min(l.y1, l.y2) - CLUSTER_PX || cy > Math.max(l.y1, l.y2) + CLUSTER_PX) continue
      const x = (l.x1 + l.x2) / 2
      if (x < cx - CLUSTER_PX) lefts.push(x)
      else if (x > cx + CLUSTER_PX) rights.push(x)
    } else if (Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX) {
      if (cx < Math.min(l.x1, l.x2) - CLUSTER_PX || cx > Math.max(l.x1, l.x2) + CLUSTER_PX) continue
      const y = (l.y1 + l.y2) / 2
      if (y < cy - CLUSTER_PX) tops.push(y)
      else if (y > cy + CLUSTER_PX) bottoms.push(y)
    }
  }
  const nearest = (values: number[], descending: boolean) =>
    cluster(values)
      .sort((a, b) => (descending ? b - a : a - b))
      .slice(0, 8)
  return {
    lefts: nearest(lefts, true),
    rights: nearest(rights, false),
    tops: nearest(tops, true),
    bottoms: nearest(bottoms, false),
  }
}

/**
 * The smallest closed rectangle of drawn lines around a text (CAD exports draw boxes as four
 * lines): rays from the text centre find the nearest lines on each side; when the nearest ones
 * do not close (details inside a prop) the next ones out are tried. A label just above or
 * below its box is probed from inside the box as well.
 */
export function boxFromLines(
  text: Text,
  lines: Line[],
  index: LineIndex,
  within: Box | null,
  pageArea: number,
): Box | null {
  const [cx, cy] = centre(text)
  const minLong = text.w * 0.8
  const minArea = text.w * text.h * 3
  const maxArea = Math.min(
    pageArea * MAX_PROP_FRACTION,
    within ? within.w * within.h * 0.6 : Infinity,
  )
  // A prop is a few times its label's size: longer boxes are the sheet frame or a room.
  const maxLong = Math.max(text.w, text.h) * 8
  const candidates = new Map<string, Box>()
  const probe = (px: number, py: number) => {
    const sides = nearestSides(lines, px, py)
    for (const x1 of sides.lefts) {
      for (const x2 of sides.rights) {
        for (const y1 of sides.tops) {
          for (const y2 of sides.bottoms) {
            const box: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
            const area = box.w * box.h
            if (
              Math.max(box.w, box.h) < minLong ||
              Math.max(box.w, box.h) > maxLong ||
              area < minArea ||
              area > maxArea
            )
              continue
            if (within && sameBox(box, within)) continue
            candidates.set(boxKey(box), box)
          }
        }
      }
    }
  }
  // Smallest first: the prop's own box closes before anything around it does.
  const smallestClosed = () =>
    [...candidates.values()]
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .find((box) => closed(index, box)) ?? null
  for (const step of [0, 2.5, -2.5, 5, -5]) probe(cx, cy + text.h * step)
  const near = smallestClosed()
  if (near) return near
  // A name written beside its box ("1.8米中岛桌" above the table): the box's edge along the label
  // is a long side spanning it; the other three sides lie beyond.
  const across = (horizontal: boolean) =>
    lines
      .filter((l) => {
        const flat = horizontal
          ? Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
          : Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
        if (!flat) return false
        const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
        const lo = Math.min(s, e)
        const hi = Math.max(s, e)
        const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
        const along = horizontal ? cx : cy
        return (
          hi - lo >= minLong &&
          hi - lo <= maxLong &&
          lo <= along + text.h &&
          hi >= along - text.h &&
          Math.abs(pos - (horizontal ? cy : cx)) <= text.h * 6
        )
      })
      .sort(
        (p, q) =>
          Math.abs((horizontal ? p.y1 : p.x1) - (horizontal ? cy : cx)) -
          Math.abs((horizontal ? q.y1 : q.x1) - (horizontal ? cy : cx)),
      )
  // The nearest vertical (or horizontal) stroke within SNAP px that covers the side's stretch.
  const SNAP = 14
  const snap = (at: number, vertical: boolean, a: number, b: number): [number] => {
    let best: number | null = null
    for (const l of lines) {
      const flat = vertical
        ? Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
        : Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
      if (!flat) continue
      const pos = vertical ? (l.x1 + l.x2) / 2 : (l.y1 + l.y2) / 2
      if (Math.abs(pos - at) > SNAP) continue
      const [s0, e0] = vertical ? [l.y1, l.y2] : [l.x1, l.x2]
      const lo = Math.max(a, Math.min(s0, e0))
      const hi = Math.min(b, Math.max(s0, e0))
      if (hi - lo < (b - a) * 0.8) continue
      if (best === null || Math.abs(pos - at) < Math.abs(best - at)) best = pos
    }
    return [best ?? at]
  }
  const boxesBeside: Box[] = []
  for (const horizontal of [true, false]) {
    for (const edge of across(horizontal)) {
      const [s, e] = horizontal ? [edge.x1, edge.x2] : [edge.y1, edge.y2]
      const lo = Math.min(s, e)
      const hi = Math.max(s, e)
      const pos = horizontal ? (edge.y1 + edge.y2) / 2 : (edge.x1 + edge.x2) / 2
      // The other side lies beyond, too far for the near search: flat lines with the same span.
      for (const far of lines) {
        const flat = horizontal
          ? Math.abs(far.y1 - far.y2) <= AXIS_TOLERANCE_PX
          : Math.abs(far.x1 - far.x2) <= AXIS_TOLERANCE_PX
        if (!flat) continue
        const farPos = horizontal ? (far.y1 + far.y2) / 2 : (far.x1 + far.x2) / 2
        const [fs, fe] = horizontal ? [far.x1, far.x2] : [far.y1, far.y2]
        if (Math.abs(Math.min(fs, fe) - lo) > CLUSTER_PX * 2) continue
        if (Math.abs(Math.max(fs, fe) - hi) > CLUSTER_PX * 2) continue
        const depth = Math.abs(farPos - pos)
        if (depth < text.h * 2 || depth > maxLong) continue
        const near1 = Math.min(pos, farPos)
        const box: Box = horizontal
          ? { x: lo, y: near1, w: hi - lo, h: depth }
          : { x: near1, y: lo, w: depth, h: hi - lo }
        // Sides drawn a few pixels apart (the symbol's corner joints): snapped out to the
        // nearest stroke that spans the whole side.
        const x1 = snap(box.x, true, box.y, box.y + box.h)
        const x2 = snap(box.x + box.w, true, box.y, box.y + box.h)
        const y1 = snap(box.y, false, box.x, box.x + box.w)
        const y2 = snap(box.y + box.h, false, box.x, box.x + box.w)
        const snapped: Box = { x: x1[0], y: y1[0], w: x2[0] - x1[0], h: y2[0] - y1[0] }
        if (snapped.w <= 0 || snapped.h <= 0) continue
        if (within && sameBox(snapped, within)) continue
        if (snapped.w * snapped.h > maxArea) continue
        boxesBeside.push(snapped)
      }
    }
  }
  const beside = boxesBeside.sort((a, b) => a.w * a.h - b.w * b.h).find((box) => closed(index, box))
  if (beside) return beside
  // Then look further out, a text height at a time, above and below first, then to the sides.
  for (const k of [1, 2, 3, 4]) {
    for (const [dx, dy] of [
      [0, -k],
      [0, k],
      [-k, 0],
      [k, 0],
    ] as const) {
      probe(cx + dx * text.h, cy + dy * text.h)
    }
    const found = smallestClosed()
    if (found) return found
  }
  return null
}

/** A drawn box is the model's when each side is within this share of the model's (or 4 px). */
const SIZE_SLACK = 0.12

/** The box is about `w` × `d` px, either way round. */
export function fitsSize(box: Box, w: number, d: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(b * SIZE_SLACK, 4)
  return (near(box.w, w) && near(box.h, d)) || (near(box.w, d) && near(box.h, w))
}

/**
 * The closed box of the model's size (`w` × `d` px, either way round) nearest the label, within
 * `reach` px of it: for a name written beside its prop rather than in it ("1.8米X系列中岛桌"
 * under the table), where the box around the text is the gap between props.
 */
export function boxOfSize(
  text: Text,
  lines: Line[],
  index: LineIndex,
  w: number,
  d: number,
  reach: number,
  taken: (box: Box) => boolean,
): Box | null {
  const [cx, cy] = centre(text)
  const near = (x: number, y: number) => Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach
  const xs: number[] = []
  const ys: number[] = []
  for (const l of lines) {
    if (!near(l.x1, l.y1) && !near(l.x2, l.y2)) continue
    if (Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX) {
      ys.push((l.y1 + l.y2) / 2)
      xs.push(l.x1, l.x2)
    } else if (Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX) {
      xs.push((l.x1 + l.x2) / 2)
      ys.push(l.y1, l.y2)
    }
  }
  const lefts = cluster(xs)
  const tops = cluster(ys)
  // Each side with the one position nearest the model's length past it: a dense drawing has
  // lines every few pixels, and every pair of them would be millions of boxes.
  const pairs = (values: number[], length: number) => {
    const out: [number, number][] = []
    const slack = Math.max(length * SIZE_SLACK, 4)
    for (const a of values) {
      let best: number | null = null
      for (const b of values) {
        const off = Math.abs(b - a - length)
        if (b > a && off <= slack && (best === null || off < Math.abs(best - a - length))) best = b
      }
      if (best !== null) out.push([a, best])
    }
    return out
  }
  const candidates: { box: Box; dist: number }[] = []
  for (const [bw, bh] of w === d
    ? [[w, d]]
    : [
        [w, d],
        [d, w],
      ]) {
    const across = pairs(lefts, bw ?? 0)
    const down = pairs(tops, bh ?? 0)
    for (const [x1, x2] of across) {
      for (const [y1, y2] of down) {
        const box: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
        const [bx, by] = centre(box)
        const dist = Math.hypot(bx - cx, by - cy)
        if (dist <= reach) candidates.push({ box, dist })
      }
    }
  }
  candidates.sort((p, q) => p.dist - q.dist)
  return candidates.find(({ box }) => !taken(box) && closed(index, box))?.box ?? null
}

export const boxKey = (b: Box) =>
  `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
export const sameBox = (a: Box, b: Box) => boxKey(a) === boxKey(b)
