import { describe, expect, it } from 'vitest'
import {
  nearestQuarter,
  obbBounds,
  obbCorners,
  obbGap,
  obbInsidePolygon,
  obbsOverlap,
  placedBox,
  polygonOverlapsObb,
  quarterTilt,
  segmentIntersectsObbInterior,
  turnPoint,
} from './obb.ts'
import type { Obb } from './obb.ts'
import {
  polygonOverlapsRect,
  rectCorners,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
} from './rect.ts'
import type { Point, Polygon } from './types.ts'

const room: Polygon = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
const box = (cx: number, cz: number, w: number, d: number, angle = 0): Obb => ({
  cx,
  cz,
  w,
  d,
  angle,
})
const close = (points: Point[]) => points.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)])

describe('turned boxes', () => {
  it('turns with the layout convention: a quarter turn takes +X to +Z and +Z to −X', () => {
    expect(turnPoint(1, 0, 90)).toEqual([0, 1])
    expect(turnPoint(0, 1, 90)).toEqual([-1, 0])
    expect(close([turnPoint(1, 0, 45)])).toEqual([[0.707107, 0.707107]])
    expect(turnPoint(2, 3, 0)).toEqual([2, 3])
  })

  it('splits an angle into its nearest quarter turn and the tilt beyond it', () => {
    expect([0, 30, 44.9, 45, 100, 179, 271, 315, 359.9].map(nearestQuarter)).toEqual([
      0, 0, 0, 90, 90, 180, 270, 0, 0,
    ])
    expect(
      [0, 30, 44.9, 45, 100, 179, 271, 315, 359.9].map((a) => +quarterTilt(a).toFixed(6)),
    ).toEqual([0, 30, 44.9, -45, 10, -1, 1, -45, -0.1])
    // An item's box: its stored w × d (already swapped at the quarter turn), tilted by the rest.
    expect(placedBox({ cx: 1, cz: 2, w: 0.5, d: 1.8, rotation: 100 })).toEqual(
      box(1, 2, 0.5, 1.8, 10),
    )
    expect(placedBox({ cx: 1, cz: 2, w: 0.5, d: 1.8 }).angle).toBe(0)
  })

  it('gives exactly the axis-aligned answers when not turned', () => {
    const a = box(1, 1, 2, 1)
    const b = box(2.5, 1.2, 1, 1)
    const rect = (o: Obb) => rectFromCenter(o.cx, o.cz, o.w, o.d)
    expect(obbCorners(a)).toEqual(rectCorners(rect(a)))
    expect(obbBounds(a)).toEqual(rect(a))
    expect(obbsOverlap(a, b)).toBe(rectsOverlap(rect(a), rect(b)))
    expect(obbGap(a, box(4, 1, 1, 1))).toBe(rectGap(rect(a), rect(box(4, 1, 1, 1))))
    expect(obbInsidePolygon(a, room)).toBe(rectInsidePolygon(rect(a), room))
    expect(polygonOverlapsObb(room, a)).toBe(polygonOverlapsRect(room, rect(a)))
    expect(segmentIntersectsObbInterior([0, 1], [3, 1], a)).toBe(
      segmentIntersectsRectInterior([0, 1], [3, 1], rect(a)),
    )
  })

  it('places the corners of a tilted box and bounds them', () => {
    const tilted = box(0, 0, 2, 0, 90)
    expect(close(obbCorners(tilted))).toEqual([
      [0, -1],
      [0, 1],
      [0, 1],
      [0, -1],
    ])
    const diamond = box(3, 2, Math.SQRT2, Math.SQRT2, 45)
    const bounds = obbBounds(diamond)
    expect([bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].map((v) => +v.toFixed(6))).toEqual([
      2, 1, 4, 3,
    ])
  })

  it('tells overlapping tilted boxes from ones whose bounds only overlap', () => {
    // Two 2 × 0.4 boards at 45°, side by side 0.6 m apart across their length: their bounding
    // squares overlap, the boards do not.
    const a = box(2, 2, 2, 0.4, 45)
    const [nx, nz] = turnPoint(0, 0.6, 45)
    const b = box(2 + nx, 2 + nz, 2, 0.4, 45)
    expect(rectsOverlap(obbBounds(a), obbBounds(b))).toBe(true)
    expect(obbsOverlap(a, b)).toBe(false)
    expect(obbGap(a, b)).toBeCloseTo(0.2, 6)
    // Closer together they do.
    const [mx, mz] = turnPoint(0, 0.3, 45)
    expect(obbsOverlap(a, box(2 + mx, 2 + mz, 2, 0.4, 45))).toBe(true)
    // A tilted box against an upright one, touching at a corner only, does not overlap.
    expect(obbsOverlap(box(0, 0, Math.SQRT2, Math.SQRT2, 45), box(1.5, 0, 1, 1))).toBe(false)
    expect(obbsOverlap(box(0, 0, Math.SQRT2, Math.SQRT2, 45), box(1.4, 0, 1, 1))).toBe(true)
  })

  it('checks a tilted box against walls, columns and entrances by its true outline', () => {
    // A 3 × 0.5 board at 30° in the middle of the room fits; pushed to the wall a corner leaves.
    expect(obbInsidePolygon(box(3, 2, 3, 0.5, 30), room)).toBe(true)
    expect(obbInsidePolygon(box(4.6, 2, 3, 0.5, 30), room)).toBe(false)
    // A small column inside the bounds of a thin tilted board, but beside the board itself.
    const board = box(3, 2, 3, 0.2, 30)
    const beside: Polygon = [
      [4.15, 1.25],
      [4.25, 1.25],
      [4.25, 1.35],
      [4.15, 1.35],
    ]
    expect(polygonOverlapsRect(beside, obbBounds(board))).toBe(true)
    expect(polygonOverlapsObb(beside, board)).toBe(false)
    const column: Polygon = [
      [2.9, 1.9],
      [3.1, 1.9],
      [3.1, 2.1],
      [2.9, 2.1],
    ]
    expect(polygonOverlapsObb(column, box(3, 2, 3, 0.5, 30))).toBe(true)
    expect(polygonOverlapsObb(column, box(3, 3, 3, 0.2, 30))).toBe(false)
    expect(segmentIntersectsObbInterior([0, 2], [6, 2], box(3, 2, 3, 0.5, 30))).toBe(true)
    expect(segmentIntersectsObbInterior([0, 3.9], [6, 3.9], box(3, 2, 3, 0.5, 30))).toBe(false)
  })
})
