import { EPSILON_M } from '../units.ts'
import type { Point, Polygon } from './types.ts'

function vertex(polygon: Polygon, index: number): Point {
  const point = polygon[((index % polygon.length) + polygon.length) % polygon.length]
  if (!point) throw new Error('Polygon has no vertices')
  return point
}

/** Edges as [start, end] pairs, closing the ring. */
export function edges(polygon: Polygon): [Point, Point][] {
  return polygon.map((point, i) => [point, vertex(polygon, i + 1)])
}

export function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/**
 * Shoelace area with sign. With x right and z down, a positive value means the ring runs
 * clockwise as seen on the plan.
 */
export function signedArea(polygon: Polygon): number {
  let sum = 0
  for (const [a, b] of edges(polygon)) sum += a[0] * b[1] - b[0] * a[1]
  return sum / 2
}

export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedArea(polygon))
}

/** Area common to two simple rings, including concave rings. */
export function polygonIntersectionArea(first: Polygon, second: Polygon): number {
  const left = Math.max(Math.min(...first.map(([x]) => x)), Math.min(...second.map(([x]) => x)))
  const right = Math.min(Math.max(...first.map(([x]) => x)), Math.max(...second.map(([x]) => x)))
  if (left >= right) return 0

  const cuts = new Set([left, right])
  const addCut = (x: number) => {
    if (x > left && x < right) cuts.add(x)
  }
  first.forEach(([x]) => addCut(x))
  second.forEach(([x]) => addCut(x))
  const firstEdges = edges(first),
    secondEdges = edges(second)
  for (const [a, b] of firstEdges) {
    for (const [c, d] of secondEdges) {
      if (!segmentsProperlyCross(a, b, c, d)) continue
      const atA = cross(c, d, a),
        atB = cross(c, d, b)
      addCut(a[0] + ((b[0] - a[0]) * atA) / (atA - atB))
    }
  }

  // Between cuts, all vertical intersection endpoints vary linearly without crossing.
  // The overlap length at the midpoint therefore gives the exact area for that strip.
  function intervals(ring: [Point, Point][], x: number): [number, number][] {
    const zs = ring
      .flatMap(([a, b]) => {
        if (x <= Math.min(a[0], b[0]) || x >= Math.max(a[0], b[0])) return []
        return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
      })
      .sort((a, b) => a - b)
    const spans: [number, number][] = []
    for (let i = 0; i < zs.length; i += 2) {
      const start = zs[i],
        end = zs[i + 1]
      if (start !== undefined && end !== undefined) spans.push([start, end])
    }
    return spans
  }

  let area = 0,
    start = left
  for (const end of [...cuts].sort((a, b) => a - b).slice(1)) {
    const x = (start + end) / 2
    const secondSpans = intervals(secondEdges, x)
    for (const [a, b] of intervals(firstEdges, x)) {
      for (const [c, d] of secondSpans) {
        area += (end - start) * Math.max(0, Math.min(b, d) - Math.max(a, c))
      }
    }
    start = end
  }
  return area
}

export function isClockwise(polygon: Polygon): boolean {
  return signedArea(polygon) > 0
}

export function toClockwise(polygon: Polygon): Point[] {
  return isClockwise(polygon) ? [...polygon] : [...polygon].reverse()
}

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return a
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
  return [a[0] + t * dx, a[1] + t * dz]
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b))
}

export function distanceToBoundary(p: Point, polygon: Polygon): number {
  let best = Infinity
  for (const [a, b] of edges(polygon)) best = Math.min(best, distanceToSegment(p, a, b))
  return best
}

function sign(value: number, eps: number): -1 | 0 | 1 {
  if (value > eps) return 1
  if (value < -eps) return -1
  return 0
}

/** True when the interiors of two segments cross at a single point (touching does not count). */
export function segmentsProperlyCross(a: Point, b: Point, c: Point, d: Point, eps = 1e-9): boolean {
  const d1 = sign(cross(c, d, a), eps)
  const d2 = sign(cross(c, d, b), eps)
  const d3 = sign(cross(a, b, c), eps)
  const d4 = sign(cross(a, b, d), eps)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** True when two segments share any point, including touching ends and collinear overlap. */
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  eps = EPSILON_M,
): boolean {
  if (segmentsProperlyCross(a, b, c, d)) return true
  return (
    distanceToSegment(a, c, d) <= eps ||
    distanceToSegment(b, c, d) <= eps ||
    distanceToSegment(c, a, b) <= eps ||
    distanceToSegment(d, a, b) <= eps
  )
}

export type PointLocation = 'inside' | 'boundary' | 'outside'

export function locatePoint(p: Point, polygon: Polygon, eps = EPSILON_M): PointLocation {
  if (distanceToBoundary(p, polygon) <= eps) return 'boundary'
  let inside = false
  for (const [a, b] of edges(polygon)) {
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
      if (p[0] < x) inside = !inside
    }
  }
  return inside ? 'inside' : 'outside'
}

/**
 * A ring is simple when it has a real area, no repeated consecutive vertices and no edges
 * that touch except neighbours meeting at their shared vertex.
 */
export function isSimplePolygon(polygon: Polygon, eps = EPSILON_M): boolean {
  const n = polygon.length
  if (n < 3 || polygonArea(polygon) <= eps * eps) return false
  const ring = edges(polygon)
  for (const [a, b] of ring) if (distance(a, b) <= eps) return false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const first = ring[i]
      const second = ring[j]
      if (!first || !second) continue
      const neighbours = j === i + 1 || (i === 0 && j === n - 1)
      if (neighbours) {
        // Neighbours share one vertex; they must not fold back onto each other.
        const shared = j === i + 1 ? first[1] : first[0]
        const p = j === i + 1 ? first[0] : first[1]
        const q = j === i + 1 ? second[1] : second[0]
        const folded =
          Math.abs(cross(shared, p, q)) <=
            eps * Math.max(distance(shared, p), distance(shared, q)) &&
          (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]) > 0
        if (folded) return false
      } else if (segmentsIntersect(first[0], first[1], second[0], second[1], eps)) {
        return false
      }
    }
  }
  return true
}

/** Inner ring lies inside or on the outer ring and never leaves it between vertices. */
export function polygonInsidePolygon(inner: Polygon, outer: Polygon, eps = EPSILON_M): boolean {
  for (const [a, b] of edges(inner)) {
    if (locatePoint(a, outer, eps) === 'outside') return false
    const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (locatePoint(middle, outer, eps) === 'outside') return false
    for (const [c, d] of edges(outer)) if (segmentsProperlyCross(a, b, c, d)) return false
  }
  return true
}
