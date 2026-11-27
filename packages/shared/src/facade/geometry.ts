import { isClockwise } from '../geometry/index.ts'
import type { Point, Polygon } from '../geometry/index.ts'
import { openingPieces } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { mainEntrance } from '../scene/frame.ts'

const SPAN_TOLERANCE = 0.003

function edgeMetrics(boundary: Polygon, edge: number) {
  const a = boundary[edge]
  const b = boundary[(edge + 1) % boundary.length]
  if (!a || !b) return null
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.1) return null
  const x = dx / length
  const z = dz / length
  return {
    a,
    length,
    x,
    z,
    at: (distance: number): Point => [a[0] + x * distance, a[1] + z * distance],
    along: (point: Point) => (point[0] - a[0]) * x + (point[1] - a[1]) * z,
    across: (point: Point) => (point[0] - a[0]) * z - (point[1] - a[1]) * x,
  }
}

export function facadeRun(boundary: Polygon, span: { a: Point; b: Point }) {
  for (const edge of boundary.keys()) {
    const run = edgeMetrics(boundary, edge)
    if (
      !run ||
      Math.abs(run.across(span.a)) > SPAN_TOLERANCE ||
      Math.abs(run.across(span.b)) > SPAN_TOLERANCE
    )
      continue
    const positions = [run.along(span.a), run.along(span.b)]
    const start = Math.min(...positions)
    const end = Math.max(...positions)
    if (start < -SPAN_TOLERANCE || end > run.length + SPAN_TOLERANCE || end - start < 0.099)
      continue
    const offset = Math.max(0, start)
    const width = Math.min(run.length, end) - offset
    return { ...run, edge, offset, width }
  }
  return null
}

export function facadeSpan(boundary: Polygon, edge: number, offset: number, width: number) {
  const run = edgeMetrics(boundary, edge)
  if (
    !run ||
    !Number.isFinite(offset) ||
    !Number.isFinite(width) ||
    offset < 0 ||
    width < 0.1 ||
    offset + width > run.length + 0.001
  )
    return null
  return { a: run.at(offset), b: run.at(Math.min(run.length, offset + width)) }
}

function entranceInterval(space: Space, edge: number) {
  const entrance = mainEntrance(space)
  const piece = entrance && openingPieces(space, entrance)?.find((part) => part.edge === edge)
  const run = edgeMetrics(space.boundary, edge)
  if (!piece || !run) return null
  const values = [run.along(piece.a), run.along(piece.b)]
  return { start: Math.min(...values), end: Math.max(...values) }
}

export function suggestedFacadeEdge(space: Space) {
  const entrance = mainEntrance(space)
  const pieces = entrance ? openingPieces(space, entrance) : null
  const candidate = pieces
    ?.slice()
    .sort(
      (a, b) =>
        Math.hypot(b.a[0] - b.b[0], b.a[1] - b.b[1]) - Math.hypot(a.a[0] - a.b[0], a.a[1] - a.b[1]),
    )[0]
  return (
    candidate?.edge ??
    space.boundary.reduce(
      (best, _, edge) =>
        (edgeMetrics(space.boundary, edge)?.length ?? 0) >
        (edgeMetrics(space.boundary, best)?.length ?? 0)
          ? edge
          : best,
      0,
    )
  )
}

export function facadeEdgeSize(space: Space, edge: number) {
  const length = edgeMetrics(space.boundary, edge)?.length ?? 0
  const opening = entranceInterval(space, edge)
  return { length, openingWidth: opening ? opening.end - opening.start : length }
}

/** Local X goes to a shopfront observer's right. Local +Z is outside the lease line. */
export function facadeGeometry(
  space: Space,
  facade: { a: Point; b: Point; openingWidth: number; openingOffset?: number | undefined },
) {
  const run = facadeRun(space.boundary, facade)
  if (!run) return null
  const reversed = isClockwise(space.boundary)
  const origin = run.at(reversed ? run.offset + run.width : run.offset)
  const direction: Point = [reversed ? -run.x : run.x, reversed ? -run.z : run.z]
  const centre = entranceInterval(space, run.edge)
  const start = centre ? Math.max(0, centre.start - run.offset) : 0
  const end = centre ? Math.min(run.width, centre.end - run.offset) : 0
  const entryWidth = Math.max(0, end - start)
  const entryCentre = entryWidth > 0 ? (start + end) / 2 : run.width / 2
  const width = Math.min(facade.openingWidth, run.width)
  const half = width / 2
  const localCentre = Math.min(
    run.width - half,
    Math.max(half, reversed ? run.width - entryCentre : entryCentre),
  )
  return {
    origin,
    direction,
    outward: [-direction[1], direction[0]] as Point,
    width: run.width,
    entryWidth,
    openingStart: facade.openingOffset ?? localCentre - half,
    openingEnd:
      facade.openingOffset === undefined ? localCentre + half : facade.openingOffset + width,
  }
}
