import {
  distance,
  distanceToSegment,
  edges,
  locatePoint,
  polygonArea,
} from '../geometry/polygon.ts'
import type { Point } from '../geometry/types.ts'

const EPS = 1e-7
type Edge = { a: Point; b: Point; cuts: number[] }
const key = (p: Point) => p.map((v) => Math.round(v / EPS)).join(',')
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const at = (e: Edge, t: number): Point => [
  e.a[0] + (e.b[0] - e.a[0]) * t,
  e.a[1] + (e.b[1] - e.a[1]) * t,
]

/** Boundary of the union of small wall-band polygons. Internal faces are removed before extrusion.
 * Split the planar arrangement at intersections, retain only inside/outside transitions, then
 * walk the directed boundary. This also handles narrow re-entrant corners and collinear walls.
 */
export function wallUnion(
  polygons: readonly (readonly Point[])[],
  exclude?: readonly Point[],
): Point[][] {
  return regionBoundary(polygons, exclude ? [exclude] : [])
}

/** Cut boundary setbacks out of a simple room outline, including for re-entrant corners. */
export function subtractPlanRegions(
  outline: readonly Point[],
  cuts: readonly (readonly Point[])[],
) {
  return regionBoundary([outline], cuts)
}

function regionBoundary(
  polygons: readonly (readonly Point[])[],
  exclusions: readonly (readonly Point[])[],
): Point[][] {
  const rings = polygons
    .filter((p) => p.length >= 3 && polygonArea(p) > EPS * EPS)
    .map((ring) => ({
      ring,
      minX: Math.min(...ring.map((p) => p[0])),
      maxX: Math.max(...ring.map((p) => p[0])),
      minZ: Math.min(...ring.map((p) => p[1])),
      maxZ: Math.max(...ring.map((p) => p[1])),
    }))
  const masked = exclusions.map((ring) => ({
    ring,
    minX: Math.min(...ring.map((p) => p[0])),
    maxX: Math.max(...ring.map((p) => p[0])),
    minZ: Math.min(...ring.map((p) => p[1])),
    maxZ: Math.max(...ring.map((p) => p[1])),
  }))
  const segments: Edge[] = [...rings.map((r) => r.ring), ...exclusions].flatMap((ring) =>
    edges(ring)
      .filter(([a, b]) => distance(a, b) > EPS)
      .map(([a, b]) => ({ a, b, cuts: [0, 1] })),
  )
  const parameter = (p: Point, e: Edge) => {
    const r = sub(e.b, e.a),
      v = sub(p, e.a)
    return (r[0] * v[0] + r[1] * v[1]) / (r[0] * r[0] + r[1] * r[1])
  }
  const cut = (e: Edge, t: number) => {
    if (t >= -EPS && t <= 1 + EPS) e.cuts.push(Math.max(0, Math.min(1, t)))
  }
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const e = segments[i]!,
        f = segments[j]!
      if (
        Math.max(e.a[0], e.b[0]) + EPS < Math.min(f.a[0], f.b[0]) ||
        Math.max(f.a[0], f.b[0]) + EPS < Math.min(e.a[0], e.b[0]) ||
        Math.max(e.a[1], e.b[1]) + EPS < Math.min(f.a[1], f.b[1]) ||
        Math.max(f.a[1], f.b[1]) + EPS < Math.min(e.a[1], e.b[1])
      )
        continue
      const r = sub(e.b, e.a),
        s = sub(f.b, f.a),
        v = sub(f.a, e.a),
        d = cross(r, s)
      if (Math.abs(d) > EPS * EPS) {
        const t = cross(v, s) / d,
          u = cross(v, r) / d
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
          cut(e, t)
          cut(f, u)
        }
      } else if (Math.abs(cross(v, r)) < EPS * Math.hypot(...r)) {
        cut(e, parameter(f.a, e))
        cut(e, parameter(f.b, e))
        cut(f, parameter(e.a, f))
        cut(f, parameter(e.b, f))
      }
    }
  const contains = (r: (typeof rings)[number], p: Point) =>
    p[0] >= r.minX - EPS &&
    p[0] <= r.maxX + EPS &&
    p[1] >= r.minZ - EPS &&
    p[1] <= r.maxZ + EPS &&
    locatePoint(p, r.ring, EPS / 10) !== 'outside'
  const inside = (p: Point) =>
    rings.some((r) => contains(r, p)) && !masked.some((r) => contains(r, p))
  const boundary = new Map<string, { a: Point; b: Point }>()
  // Intersections computed from two different edges can straddle a quantisation cell.
  // Snap nearby vertices to one representative before assigning boundary edge ids.
  const buckets = new Map<string, Point[]>()
  const canonical = (p: Point): Point => {
    const x = Math.floor(p[0] / EPS),
      z = Math.floor(p[1] / EPS)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const found = buckets.get(`${x + dx},${z + dz}`)?.find((q) => distance(p, q) < EPS)
        if (found) return found
      }
    const id = `${x},${z}`
    buckets.set(id, [...(buckets.get(id) ?? []), p])
    return p
  }
  for (const e of segments) {
    const cuts = [...new Set(e.cuts.map((t) => Math.round(t * 1e10) / 1e10))].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      let a = at(e, cuts[i - 1]!),
        b = at(e, cuts[i]!)
      const length = distance(a, b)
      if (length < EPS) continue
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        probe = Math.min(1e-6, length / 10)
      const n: Point = [(-(b[1] - a[1]) / length) * probe, ((b[0] - a[0]) / length) * probe]
      const left = inside([mid[0] + n[0], mid[1] + n[1]]),
        right = inside([mid[0] - n[0], mid[1] - n[1]])
      if (left === right) continue
      if (right) [a, b] = [b, a]
      a = canonical(a)
      b = canonical(b)
      if (key(a) === key(b)) continue
      boundary.set(key(a) + '|' + key(b), { a, b })
    }
  }
  const remaining = new Set(boundary.keys()),
    starts = new Map<string, string[]>()
  for (const [id, e] of boundary) {
    const k = key(e.a)
    starts.set(k, [...(starts.get(k) ?? []), id])
  }
  const result: Point[][] = []
  while (remaining.size) {
    const first = remaining.values().next().value!,
      initial = boundary.get(first)!,
      ring: Point[] = [initial.a]
    let id = first,
      closed = false
    while (remaining.has(id)) {
      remaining.delete(id)
      const e = boundary.get(id)!
      if (key(e.b) === key(initial.a)) {
        closed = true
        break
      }
      ring.push(e.b)
      const choices = (starts.get(key(e.b)) ?? []).filter((k) => remaining.has(k))
      if (!choices.length) break
      const incoming = sub(e.b, e.a)
      choices.sort((x, y) => {
        const vx = sub(boundary.get(x)!.b, e.b),
          vy = sub(boundary.get(y)!.b, e.b)
        return (
          Math.atan2(cross(incoming, vy), incoming[0] * vy[0] + incoming[1] * vy[1]) -
          Math.atan2(cross(incoming, vx), incoming[0] * vx[0] + incoming[1] * vx[1])
        )
      })
      id = choices[0]!
    }
    if (!closed) throw new Error('连续墙轮廓未闭合')
    const simple = ring.filter(
      (p, i) =>
        distanceToSegment(
          p,
          ring[(i + ring.length - 1) % ring.length]!,
          ring[(i + 1) % ring.length]!,
        ) > EPS,
    )
    if (simple.length >= 3 && polygonArea(simple) > EPS * EPS) result.push(simple)
  }
  return result
}
