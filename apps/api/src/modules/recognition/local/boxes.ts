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
]

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
  const candidates = new Map<string, Box>()
  for (const step of [0, 2.5, -2.5, 5, -5]) {
    const sides = nearestSides(lines, cx, cy + text.h * step)
    for (const x1 of sides.lefts) {
      for (const x2 of sides.rights) {
        for (const y1 of sides.tops) {
          for (const y2 of sides.bottoms) {
            const box: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
            const area = box.w * box.h
            if (Math.max(box.w, box.h) < minLong || area < minArea || area > maxArea) continue
            if (within && sameBox(box, within)) continue
            candidates.set(boxKey(box), box)
          }
        }
      }
    }
  }
  // Smallest first: the prop's own box closes before anything around it does.
  return (
    [...candidates.values()]
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .find((box) => closed(index, box)) ?? null
  )
}

export const boxKey = (b: Box) =>
  `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
export const sameBox = (a: Box, b: Box) => boxKey(a) === boxKey(b)
