import { signedArea } from '@store/shared'
import type { Point } from '@store/shared'

/** Mitred display outline; acute corners are capped to prevent long spikes. */
export function offsetOutline(ring: readonly Point[], amount: number): Point[] {
  const sign = signedArea(ring) >= 0 ? 1 : -1
  const normal = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(sign * (b[1] - a[1])) / length, (-sign * (b[0] - a[0])) / length]
  }
  return ring.map((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!,
      next = ring[(i + 1) % ring.length]!
    const a = normal(prev, p),
      b = normal(p, next)
    const denom = 1 + a[0] * b[0] + a[1] * b[1]
    const factor = Math.abs(denom) > 1e-9 ? amount / denom : amount
    const dx = (a[0] + b[0]) * factor,
      dz = (a[1] + b[1]) * factor
    const length = Math.hypot(dx, dz),
      limit = Math.abs(amount) * 4
    const scale = length > limit && length > 0 ? limit / length : 1
    return [p[0] + dx * scale, p[1] + dz * scale]
  })
}
