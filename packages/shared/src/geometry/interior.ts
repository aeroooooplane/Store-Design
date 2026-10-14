import { distanceToBoundary, locatePoint, polygonArea, signedArea } from './polygon.ts'
import type { Point, Polygon } from './types.ts'

export interface InteriorPointOptions {
  /** Stop refining once no cell can beat the best clearance by more than this (metres). */
  precision?: number
  /**
   * Returned instead when its clearance is within `precision` of the best found, so shapes
   * with many equally deep points (a rectangle, a long corridor) keep a predictable centre.
   * Defaults to the centre of the bounding box.
   */
  prefer?: Point
}

/** Distance to the boundary, negative outside. */
function clearance(p: Point, polygon: Polygon): number {
  const d = distanceToBoundary(p, polygon)
  return locatePoint(p, polygon, 0) === 'outside' ? -d : d
}

interface Cell {
  x: number
  z: number
  /** Half the cell size. */
  h: number
  d: number
  /** Upper bound of the clearance anywhere in the cell. */
  max: number
}

function cell(x: number, z: number, h: number, polygon: Polygon): Cell {
  const d = clearance([x, z], polygon)
  return { x, z, h, d, max: d + h * Math.SQRT2 }
}

/** Area centroid, or the vertex average for a degenerate ring. */
function centroid(polygon: Polygon): Point {
  const area = signedArea(polygon)
  if (Math.abs(area) < 1e-12) {
    const n = polygon.length || 1
    return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n]
  }
  let x = 0
  let z = 0
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a
    const f = a[0] * b[1] - b[0] * a[1]
    x += (a[0] + b[0]) * f
    z += (a[1] + b[1]) * f
  })
  return [x / (6 * area), z / (6 * area)]
}

/**
 * A point inside the polygon as far from its boundary as possible: an approximation of the
 * pole of inaccessibility (the polylabel grid search). Unlike the bounding-box centre it lies
 * inside L, U and other concave shapes; for a rectangle it is the centre.
 */
export function interiorPoint(polygon: Polygon, options: InteriorPointOptions = {}): Point {
  const xs = polygon.map((p) => p[0])
  const zs = polygon.map((p) => p[1])
  const [minX, maxX, minZ, maxZ] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ]
  const centre: Point = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  const prefer = options.prefer ?? centre
  const size = Math.min(maxX - minX, maxZ - minZ)
  if (!(size > 0) || polygonArea(polygon) <= 0) return prefer
  const precision = options.precision ?? Math.max(size / 1000, 0.001)

  // Max-heap on the cell's upper bound.
  const heap: Cell[] = []
  const push = (c: Cell) => {
    heap.push(c)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((heap[parent] as Cell).max >= c.max) break
      heap[i] = heap[parent] as Cell
      i = parent
    }
    heap[i] = c
  }
  const pop = (): Cell | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (!top || !last || heap.length === 0) return top
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let next = i
      let best = last.max
      if (l < heap.length && (heap[l] as Cell).max > best) [next, best] = [l, (heap[l] as Cell).max]
      if (r < heap.length && (heap[r] as Cell).max > best) next = r
      if (next === i) break
      heap[i] = heap[next] as Cell
      i = next
    }
    heap[i] = last
    return top
  }

  const h = size / 2
  for (let x = minX; x < maxX; x += size) {
    for (let z = minZ; z < maxZ; z += size) push(cell(x + h, z + h, h, polygon))
  }
  const [cx, cz] = centroid(polygon)
  let best = cell(cx, cz, 0, polygon)
  const middle = cell(centre[0], centre[1], 0, polygon)
  if (middle.d > best.d) best = middle

  for (let c = pop(); c; c = pop()) {
    if (c.d > best.d) best = c
    if (c.max - best.d <= precision) continue
    const q = c.h / 2
    push(cell(c.x - q, c.z - q, q, polygon))
    push(cell(c.x + q, c.z - q, q, polygon))
    push(cell(c.x - q, c.z + q, q, polygon))
    push(cell(c.x + q, c.z + q, q, polygon))
  }

  const preferred = clearance(prefer, polygon)
  return preferred > 0 && preferred >= best.d - precision ? prefer : [best.x, best.z]
}
