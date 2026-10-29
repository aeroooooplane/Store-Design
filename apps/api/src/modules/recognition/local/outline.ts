import { centre, isRed } from './lines.ts'
import type { Box, Line } from './lines.ts'
import { findRegion, inRing, ringArea } from './region.ts'
import type { PxPoint, RegionHints } from './region.ts'

export interface Outline {
  points: PxPoint[]
  source: 'lease' | 'drawing'
}

/**
 * Red strokes are only a lease candidate: red fixture symbols and incomplete lease lines also
 * occur. Compare with the whole drawing, and never discard a prop held by that outline merely
 * because a smaller red loop happened to close. The number of strokes is not evidence: the
 * same rectangle can be four segments or hundreds of dashes.
 */
export function findOutline(
  width: number,
  height: number,
  lines: readonly Line[],
  anchors: readonly Box[],
  hints: RegionHints = {},
): Outline | null {
  const drawing = findRegion(width, height, lines, anchors, hints)
  const red = lines.filter((line) => isRed(line.color))
  const lease = red.length >= 3 ? findRegion(width, height, red, anchors, hints) : null
  if (lease) {
    const held = (ring: PxPoint[], box: Box) => inRing(centre(box), ring)
    const misses = drawing && anchors.some((box) => held(drawing, box) && !held(lease, box))
    const expected = hints.expectedArea
    const area = ringArea(lease)
    const fitsArea =
      expected === null ||
      expected === undefined ||
      (area >= expected / 1.5 && area <= expected * 1.5)
    if (!misses && fitsArea) return { points: lease, source: 'lease' }
  }
  return drawing ? { points: drawing, source: 'drawing' } : null
}
