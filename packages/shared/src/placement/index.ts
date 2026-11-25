import { obbCorners, obbInsidePolygon, placedBox, turnPoint } from '../geometry/obb.ts'
import { distanceToSegment, edges, locatePoint } from '../geometry/polygon.ts'
import type { Polygon } from '../geometry/types.ts'
import { EPSILON_M } from '../units.ts'

/** A model's whole footprint may extend this far beyond the actual store outline. */
export const MODEL_BOUNDARY_MARGIN_M = 1

/**
 * Tests the whole footprint, including the middle of concave recesses. A segment's round
 * one-metre neighbourhood is convex, so a box whose corners lie in it is covered in full.
 * Boxes covered by several wall segments are subdivided to the stored millimetre precision.
 */
export function modelWithinBoundary(
  item: { cx: number; cz: number; w: number; d: number; rotation?: number | undefined },
  boundary: Polygon,
): boolean {
  const ring = edges(boundary)
  const limit = MODEL_BOUNDARY_MARGIN_M + EPSILON_M / 2
  const pending = [placedBox(item)]
  while (pending.length) {
    const box = pending.pop()!
    if (obbInsidePolygon(box, boundary)) continue
    const corners = obbCorners(box)
    if (ring.some(([a, b]) => corners.every((p) => distanceToSegment(p, a, b) <= limit))) continue
    if (
      [...corners, [box.cx, box.cz] as const].some(
        (p) =>
          locatePoint(p, boundary, 0) === 'outside' &&
          ring.every(([a, b]) => distanceToSegment(p, a, b) > limit),
      )
    )
      return false
    if (Math.hypot(box.w, box.d) <= EPSILON_M) continue
    const alongX = box.w >= box.d
    const half = { ...box, w: alongX ? box.w / 2 : box.w, d: alongX ? box.d : box.d / 2 }
    const [dx, dz] = turnPoint(alongX ? box.w / 4 : 0, alongX ? 0 : box.d / 4, box.angle)
    pending.push(
      { ...half, cx: box.cx - dx, cz: box.cz - dz },
      { ...half, cx: box.cx + dx, cz: box.cz + dz },
    )
  }
  return true
}
