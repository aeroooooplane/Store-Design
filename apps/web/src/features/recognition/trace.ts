import type { VectorContent } from '@store/shared'

/**
 * Tracing a shop's boundary on the uploaded picture (原图描点): the points are in picture pixels;
 * with a scale they become the space's boundary in metres. Works on any plan, a picture or a
 * scan included, with no model (confirmed by the user, 2026-10-16).
 */

export type Px = [number, number]

/** What a traced edge is: a wall, an entrance, or an open side (no wall). */
export type EdgeKind = 'wall' | 'entrance' | 'open'

export const EDGE_KINDS: readonly EdgeKind[] = ['wall', 'entrance', 'open']
export const EDGE_KIND_LABELS: Record<EdgeKind, string> = {
  wall: '墙',
  entrance: '入口',
  open: '开放边',
}

/** An arc is drawn as straight pieces of at most this many degrees each. */
export const ARC_STEP_DEG = 15

const dist = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Where segments ab and cd cross (inside both), or null. */
function crossing(a: Px, b: Px, c: Px, d: Px): Px | null {
  const r: Px = [b[0] - a[0], b[1] - a[1]]
  const s: Px = [d[0] - c[0], d[1] - c[1]]
  const denom = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denom) < 1e-9) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/** The point of segment ab nearest to p. */
function nearestOn(p: Px, a: Px, b: Px): Px {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return [a[0] + dx * t, a[1] + dy * t]
}

/**
 * A clicked point pulled onto the drawing of a vector PDF: the nearest line end or crossing of
 * two lines within `radius` pixels, else the nearest point on a line within it; unchanged when
 * nothing is that near (or for a picture without vector content).
 */
export function snapPoint(
  p: Px,
  vector: Pick<VectorContent, 'lines'> | null,
  radius: number,
): { point: Px; kind: 'corner' | 'line' | 'none' } {
  if (!vector) return { point: p, kind: 'none' }
  const near = vector.lines
    .map((l) => ({ a: [l.x1, l.y1] as Px, b: [l.x2, l.y2] as Px }))
    .filter((l) => dist(p, nearestOn(p, l.a, l.b)) <= radius)
  let best: { point: Px; d: number } | null = null
  const consider = (q: Px) => {
    const d = dist(p, q)
    if (d <= radius && (!best || d < best.d)) best = { point: q, d }
  }
  for (const l of near) {
    consider(l.a)
    consider(l.b)
  }
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i]
      const b = near[j]
      if (!a || !b) continue
      const q = crossing(a.a, a.b, b.a, b.b)
      if (q) consider(q)
    }
  }
  if (best) return { point: (best as { point: Px }).point, kind: 'corner' }
  let onLine: { point: Px; d: number } | null = null
  for (const l of near) {
    const q = nearestOn(p, l.a, l.b)
    const d = dist(p, q)
    if (!onLine || d < onLine.d) onLine = { point: q, d }
  }
  return onLine ? { point: onLine.point, kind: 'line' } : { point: p, kind: 'none' }
}

/** With Shift held, the next point lies straight across or down from the last one. */
export function straighten(from: Px, p: Px): Px {
  return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]]
}

/**
 * The arc through `start`, `mid` and `end` as the points after `start` (end included), at most
 * ARC_STEP_DEG apart; a straight line when the three points are in line.
 */
export function arcPoints(start: Px, mid: Px, end: Px, stepDeg = ARC_STEP_DEG): Px[] {
  const ax = start[0]
  const ay = start[1]
  const bx = mid[0]
  const by = mid[1]
  const cx = end[0]
  const cy = end[1]
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return [end]
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d
  const r = Math.hypot(ax - ux, ay - uy)
  const angle = (x: number, y: number) => Math.atan2(y - uy, x - ux)
  const a0 = angle(ax, ay)
  const am = angle(bx, by)
  const a1 = angle(cx, cy)
  // Go the way round that passes the middle point.
  const tau = 2 * Math.PI
  const ccw = (from: number, to: number) => (((to - from) % tau) + tau) % tau
  const sweep = ccw(a0, am) <= ccw(a0, a1) ? ccw(a0, a1) : -ccw(a1, a0)
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((stepDeg * Math.PI) / 180)))
  const points: Px[] = []
  for (let k = 1; k < steps; k++) {
    const t = a0 + (sweep * k) / steps
    points.push([ux + r * Math.cos(t), uy + r * Math.sin(t)])
  }
  points.push(end)
  return points
}

/** Millimetres per picture pixel from two picked points of a known length. */
export function scaleFromPoints(points: { a: Px; b: Px } | null, mm: number): number | null {
  if (!points || !(mm > 0)) return null
  const d = dist(points.a, points.b)
  return d > 1 ? mm / d : null
}

export interface TracedSpace {
  boundary: [number, number][]
  entrances: { a: [number, number]; b: [number, number]; kind: 'main' | 'side' }[]
  openEdges: { a: [number, number]; b: [number, number] }[]
}

/**
 * The traced outline in metres (to the millimetre): pixels from `originPx` times `mmPerPixel`.
 * Each edge's kind makes an entrance (the first one the main entrance) or an open edge; a run
 * of adjacent edges of the same kind (an arc storefront) becomes one entrance or open edge.
 */
export function toTracedSpace(
  polygon: Px[],
  kinds: readonly EdgeKind[],
  mmPerPixel: number,
  originPx: Px,
): TracedSpace {
  const m = (p: Px): [number, number] => [
    Math.round((p[0] - originPx[0]) * mmPerPixel) / 1000 + 0,
    Math.round((p[1] - originPx[1]) * mmPerPixel) / 1000 + 0,
  ]
  const boundary = polygon.map(m)
  const n = boundary.length
  const entrances: TracedSpace['entrances'] = []
  const openEdges: TracedSpace['openEdges'] = []
  // Start at an edge whose previous edge is of another kind, so a run is never split in two.
  const start = Math.max(
    0,
    Array.from({ length: n }, (_, i) => i).findIndex((i) => kinds[i] !== kinds[(i + n - 1) % n]),
  )
  let i = 0
  while (i < n) {
    const first = (start + i) % n
    const kind = kinds[first] ?? 'wall'
    let last = first
    while (i + 1 < n && kinds[(start + i + 1) % n] === kind) {
      i++
      last = (start + i) % n
    }
    i++
    if (kind === 'wall') continue
    const a = boundary[first] as [number, number]
    const b = boundary[(last + 1) % n] as [number, number]
    if (kind === 'entrance') entrances.push({ a, b, kind: entrances.length ? 'side' : 'main' })
    else openEdges.push({ a, b })
  }
  return { boundary, entrances, openEdges }
}

/** The outline back in picture pixels (to start tracing from a recognised boundary). */
export function toPicturePoints(
  boundary: readonly (readonly [number, number])[],
  mmPerPixel: number,
  originPx: Px,
): Px[] {
  return boundary.map((p) => [
    originPx[0] + (p[0] * 1000) / mmPerPixel,
    originPx[1] + (p[1] * 1000) / mmPerPixel,
  ])
}
