import { isClockwise } from '../geometry/index.ts'
import type { Point, Polygon } from '../geometry/index.ts'
import { openingPieces } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { mainEntrance } from '../scene/frame.ts'
import { WALL_THICKNESS_M } from '../scene/walls.ts'

const SPAN_TOLERANCE = 0.003

function edgeMetrics(boundary: Polygon, edge: number, minLength = 0.1) {
  const a = boundary[edge]
  const b = boundary[(edge + 1) % boundary.length]
  if (!a || !b) return null
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  if (length < minLength) return null
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

type OpeningInterval = { start: number; end: number; openEdge: boolean; primary: boolean }
const facadeOpenings = new WeakMap<Space, Map<number, OpeningInterval[]>>()

function openingIntervals(space: Space) {
  const cached = facadeOpenings.get(space)
  if (cached) return cached
  const main = mainEntrance(space)
  const byEdge = new Map<number, OpeningInterval[]>()
  for (const [openings, openEdge] of [
    [space.openEdges, true],
    [space.entrances, false],
  ] as const) {
    for (const opening of openings) {
      for (const part of openingPieces(space, opening) ?? []) {
        const run = edgeMetrics(space.boundary, part.edge)
        if (!run) continue
        const a = run.along(part.a)
        const b = run.along(part.b)
        const list = byEdge.get(part.edge) ?? []
        list.push({
          start: Math.max(0, Math.min(a, b)),
          end: Math.min(run.length, Math.max(a, b)),
          openEdge,
          primary: opening === main,
        })
        byEdge.set(part.edge, list)
      }
    }
  }
  for (const [edge, intervals] of byEdge) {
    const merged: OpeningInterval[] = []
    for (const part of intervals.sort((a, b) => a.start - b.start)) {
      const previous = merged.at(-1)
      if (previous && part.start <= previous.end + SPAN_TOLERANCE) {
        previous.end = Math.max(previous.end, part.end)
        previous.openEdge ||= part.openEdge
        previous.primary ||= part.primary
      } else {
        merged.push(part)
      }
    }
    byEdge.set(
      edge,
      merged.filter((p) => p.end - p.start >= 0.099),
    )
  }
  facadeOpenings.set(space, byEdge)
  return byEdge
}

function facadeOpeningOrder(a: OpeningInterval, b: OpeningInterval) {
  return (
    Number(b.openEdge) - Number(a.openEdge) ||
    Number(b.primary) - Number(a.primary) ||
    b.end - b.start - (a.end - a.start)
  )
}

function preferredOpening(space: Space, edge: number, subspan?: { start: number; end: number }) {
  const candidates = openingIntervals(space).get(edge) ?? []
  const relevant = subspan
    ? candidates.filter((p) => p.start < subspan.end && p.end > subspan.start)
    : candidates
  return relevant.toSorted(facadeOpeningOrder)[0]
}

export function suggestedFacadeEdge(space: Space) {
  const candidates = space.boundary.flatMap((_, edge) => {
    const opening = preferredOpening(space, edge)
    return opening ? [{ ...opening, edge }] : []
  })
  candidates.sort(facadeOpeningOrder)
  return (
    candidates[0]?.edge ??
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

/** Outer face of facade cladding relative to the lease line. */
export function facadeOuterDepth() {
  return WALL_THICKNESS_M + 0.015
}

export function exteriorFacadeSpan(
  space: Space,
  span: { a: Point; b: Point },
): { a: Point; b: Point } {
  // The stored endpoints may be in either order. Use the boundary's winding and direction.
  const run = facadeRun(space.boundary, span)
  const chord = !run ? (openingPieces(space, span) ?? [])[0] : undefined
  const direction = run ?? (chord && edgeMetrics(space.boundary, chord.edge, 1e-6))
  if (!direction) return span
  const sign = isClockwise(space.boundary) ? 1 : -1
  const d = facadeOuterDepth() * sign
  const outside = ([x, z]: Point): Point => [x + direction.z * d, z - direction.x * d]
  return { a: outside(span.a), b: outside(span.b) }
}

export function facadeEdgeSize(space: Space, edge: number) {
  const length = edgeMetrics(space.boundary, edge)?.length ?? 0
  const opening = preferredOpening(space, edge)
  return {
    length,
    openingWidth: opening ? opening.end - opening.start : length,
    hasOpening: !!opening,
  }
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
  const centre = preferredOpening(space, run.edge, {
    start: run.offset,
    end: run.offset + run.width,
  })
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
