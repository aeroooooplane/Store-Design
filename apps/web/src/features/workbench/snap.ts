import { edges, roundM } from '@store/shared'
import type { LayoutItem, Space } from '@store/shared'

/** Dragged props stick to walls and neighbours within this distance (metres). */
export const SNAP_DISTANCE_M = 0.1
/** Props further apart than this across the snapping axis are not neighbours. */
const NEIGHBOUR_M = 1.5
const EPS = 1e-6

interface Line {
  /** Coordinate of the line on the snapping axis. */
  at: number
  /** Extent along the other axis, used to decide whether the line is next to the prop. */
  from: number
  to: number
  /** Which prop edges may meet this line: low = left/top edge, high = right/bottom edge. */
  edges: ('low' | 'high')[]
}

function overlaps(a0: number, a1: number, b0: number, b1: number, margin: number) {
  return a0 < b1 + margin && b0 < a1 + margin
}

/** Best shift (≤ SNAP_DISTANCE_M) that brings one of the prop's edges onto a line. */
function bestShift(low: number, high: number, cross0: number, cross1: number, lines: Line[]) {
  let best: number | null = null
  for (const line of lines) {
    if (!overlaps(cross0, cross1, line.from, line.to, SNAP_DISTANCE_M)) continue
    for (const side of line.edges) {
      const shift = line.at - (side === 'low' ? low : high)
      if (
        Math.abs(shift) <= SNAP_DISTANCE_M + EPS &&
        (best === null || Math.abs(shift) < Math.abs(best))
      ) {
        best = shift
      }
    }
  }
  return best
}

/**
 * Magnetic snapping while dragging: the prop's edges stick to axis-aligned wall faces it runs
 * along and to neighbouring props' edges (touching side by side or aligned). Returns the
 * snapped centre and which axes snapped (those keep millimetre precision, not the 10 mm grid).
 */
export function magnetSnap(
  item: Pick<LayoutItem, 'id' | 'w' | 'd'>,
  cx: number,
  cz: number,
  others: readonly Pick<LayoutItem, 'id' | 'cx' | 'cz' | 'w' | 'd'>[],
  space: Space,
): { cx: number; cz: number; snappedX: boolean; snappedZ: boolean } {
  const hw = item.w / 2
  const hd = item.d / 2
  const xLines: Line[] = []
  const zLines: Line[] = []
  for (const [a, b] of edges(space.boundary)) {
    if (Math.abs(a[0] - b[0]) < EPS) {
      xLines.push({
        at: a[0],
        from: Math.min(a[1], b[1]),
        to: Math.max(a[1], b[1]),
        edges: ['low', 'high'],
      })
    } else if (Math.abs(a[1] - b[1]) < EPS) {
      zLines.push({
        at: a[1],
        from: Math.min(a[0], b[0]),
        to: Math.max(a[0], b[0]),
        edges: ['low', 'high'],
      })
    }
  }
  for (const o of others) {
    if (o.id === item.id) continue
    const [l, r, t, bt] = [o.cx - o.w / 2, o.cx + o.w / 2, o.cz - o.d / 2, o.cz + o.d / 2]
    if (overlaps(cz - hd, cz + hd, t, bt, NEIGHBOUR_M)) {
      xLines.push({ at: l, from: t - NEIGHBOUR_M, to: bt + NEIGHBOUR_M, edges: ['low', 'high'] })
      xLines.push({ at: r, from: t - NEIGHBOUR_M, to: bt + NEIGHBOUR_M, edges: ['low', 'high'] })
    }
    if (overlaps(cx - hw, cx + hw, l, r, NEIGHBOUR_M)) {
      zLines.push({ at: t, from: l - NEIGHBOUR_M, to: r + NEIGHBOUR_M, edges: ['low', 'high'] })
      zLines.push({ at: bt, from: l - NEIGHBOUR_M, to: r + NEIGHBOUR_M, edges: ['low', 'high'] })
    }
  }
  const dx = bestShift(cx - hw, cx + hw, cz - hd, cz + hd, xLines)
  const dz = bestShift(cz - hd, cz + hd, cx - hw, cx + hw, zLines)
  return {
    cx: dx === null ? cx : roundM(cx + dx),
    cz: dz === null ? cz : roundM(cz + dz),
    snappedX: dx !== null,
    snappedZ: dz !== null,
  }
}
