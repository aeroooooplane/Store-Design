import { distance, distanceToSegment, edges } from './polygon.ts'
import type { Point, Polygon } from './types.ts'

/** One straight stretch of a path along a boundary; edge `i` runs from vertex `i` to `i + 1`. */
export interface BoundaryPiece {
  edge: number
  a: Point
  b: Point
}

interface RingPosition {
  edge: number
  /** Metres from the start of the edge. */
  t: number
}

/** The nearest edge to `p` and how far along it p lies, or null when p is off the boundary. */
function locate(p: Point, ring: [Point, Point][], tolerance: number): RingPosition | null {
  let best: (RingPosition & { d: number }) | null = null
  ring.forEach(([a, b], edge) => {
    const d = distanceToSegment(p, a, b)
    if (d > tolerance || (best && d >= best.d)) return
    const length = distance(a, b)
    const t =
      length === 0 ? 0 : ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length
    best = { edge, t: Math.min(length, Math.max(0, t)), d }
  })
  return best
}

/**
 * The stretch of a closed boundary between two points on it, one piece per edge, running from
 * `a` to `b` the shorter way round. An entrance or open edge is stored by its two ends only, so
 * this is what lets one opening follow several edges: a storefront drawn as a polyline arc, or
 * an opening round a corner. Ends on the same edge give exactly the segment a → b. Pieces start
 * at `a`, end at `b` and otherwise meet at boundary vertices. Null when an end is farther than
 * `tolerance` from the boundary.
 */
export function boundaryPath(
  boundary: Polygon,
  a: Point,
  b: Point,
  tolerance: number,
): BoundaryPiece[] | null {
  const ring = edges(boundary)
  const from = locate(a, ring, tolerance)
  const to = locate(b, ring, tolerance)
  if (!from || !to) return null
  if (from.edge === to.edge) return [{ edge: from.edge, a, b }]

  const lengths = ring.map(([p, q]) => distance(p, q))
  const starts: number[] = []
  let perimeter = 0
  for (const length of lengths) {
    starts.push(perimeter)
    perimeter += length
  }
  const s = (pos: RingPosition) => (starts[pos.edge] ?? 0) + pos.t
  const ahead = (((s(to) - s(from)) % perimeter) + perimeter) % perimeter
  const forward = ahead <= perimeter - ahead

  // Walk the ring forwards from the first end to the second, then orient the result a → b.
  const [start, end, startPoint, endPoint] = forward ? [from, to, a, b] : [to, from, b, a]
  const pieces: BoundaryPiece[] = []
  for (let k = 0; k <= ring.length; k++) {
    const edge = (start.edge + k) % ring.length
    const [p, q] = ring[edge] as [Point, Point]
    const length = lengths[edge] ?? 0
    const first = k === 0
    const last = edge === end.edge
    const t0 = first ? start.t : 0
    const t1 = last ? end.t : length
    if (t1 - t0 > 1e-9) {
      pieces.push({
        edge,
        a: first ? startPoint : p,
        b: last ? endPoint : q,
      })
    }
    if (last) break
  }
  // A dropped empty first or last piece leaves a vertex as the end; put the given point back.
  const head = pieces[0]
  const tail = pieces[pieces.length - 1]
  if (head) head.a = startPoint
  if (tail) tail.b = endPoint
  return forward ? pieces : pieces.reverse().map((piece) => ({ ...piece, a: piece.b, b: piece.a }))
}

/** The point halfway along a path of pieces. */
export function pathMidpoint(pieces: readonly BoundaryPiece[]): Point | null {
  const total = pieces.reduce((sum, piece) => sum + distance(piece.a, piece.b), 0)
  let remaining = total / 2
  for (const piece of pieces) {
    const length = distance(piece.a, piece.b)
    if (remaining <= length && length > 0) {
      const f = remaining / length
      return [
        piece.a[0] + (piece.b[0] - piece.a[0]) * f,
        piece.a[1] + (piece.b[1] - piece.a[1]) * f,
      ]
    }
    remaining -= length
  }
  const first = pieces[0]
  return first ? first.a : null
}
