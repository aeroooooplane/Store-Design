import { centre, isRed } from './lines.ts'
import type { Box, Line } from './lines.ts'
import { findRegion, inRing, ringArea } from './region.ts'
import type { PxPoint, RegionHints } from './region.ts'

export interface Outline {
  points: PxPoint[]
  source: 'lease' | 'stroke' | 'drawing'
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
  // Mixing furniture ink with wall ink can create false notches when thin strips are peeled.
  // An independently closed stroke style may restore them, but only with an independent area
  // check and without losing a known prop. No hull or invented chord: the independent contour
  // can correct both inward notches and outward furniture strokes in the mixed-ink outline.
  const expected = hints.expectedArea
  if (
    drawing &&
    expected !== undefined &&
    expected !== null &&
    Number.isFinite(expected) &&
    expected > 0
  ) {
    const styles = new Map<string, Line[]>()
    for (const line of lines) {
      if (!line.w || isRed(line.color)) continue
      const key = `${line.color ?? ''}/${line.w}/${Boolean(line.dash)}`
      const group = styles.get(key) ?? []
      group.push(line)
      styles.set(key, group)
    }
    // Bound the work on pages with many stroke styles; thick structural strokes come first.
    const groups = [...styles.values()]
      .filter((group) => group.length >= 3 && group.length < lines.length)
      .sort((a, b) => (b[0]?.w ?? 0) - (a[0]?.w ?? 0) || b.length - a.length)
      .slice(0, 8)
    let best = drawing
    let error = Math.abs(ringArea(drawing) - expected)
    for (const group of groups) {
      const candidate = findRegion(width, height, group, anchors, hints)
      if (!candidate) continue
      const area = ringArea(candidate)
      const nextError = Math.abs(area - expected)
      if (area <= ringArea(drawing) || area < expected / 1.5 || area > expected * 1.5) continue
      if (nextError >= error) continue
      if (anchors.some((box) => inRing(centre(box), drawing) && !inRing(centre(box), candidate)))
        continue
      best = candidate
      error = nextError
    }
    if (best !== drawing) return { points: best, source: 'stroke' }
  }
  return drawing ? { points: drawing, source: 'drawing' } : null
}
