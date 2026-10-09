import { describe, expect, it } from 'vitest'
import {
  isClockwise,
  isSimplePolygon,
  locatePoint,
  polygonArea,
  polygonInsidePolygon,
  polygonOverlapsRect,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
  signedArea,
  toClockwise,
} from './index.ts'
import type { Point } from './index.ts'

const square: Point[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
// U-shaped shop: a slot (x 2–4, z 1–4) is cut out of the bottom edge.
const uShape: Point[] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [4, 4],
  [4, 1],
  [2, 1],
  [2, 4],
  [0, 4],
]

describe('polygon orientation and area', () => {
  it('treats right-then-down rings as clockwise on the plan (z points down)', () => {
    expect(signedArea(square)).toBe(12)
    expect(isClockwise(square)).toBe(true)
    expect(isClockwise([...square].reverse())).toBe(false)
  })

  it('reorients counter-clockwise rings without changing the area', () => {
    const fixed = toClockwise([...square].reverse())
    expect(isClockwise(fixed)).toBe(true)
    expect(polygonArea(fixed)).toBe(12)
  })
})

describe('locatePoint', () => {
  it('distinguishes inside, boundary and the concave slot', () => {
    expect(locatePoint([1, 1], uShape)).toBe('inside')
    expect(locatePoint([3, 0], uShape)).toBe('boundary')
    expect(locatePoint([3, 3], uShape)).toBe('outside')
  })
})

describe('isSimplePolygon', () => {
  it('accepts concave rings', () => {
    expect(isSimplePolygon(uShape)).toBe(true)
  })

  it('rejects self-intersecting, degenerate and folded rings', () => {
    const bowtie: Point[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]
    const repeated: Point[] = [
      [0, 0],
      [4, 0],
      [4, 0],
      [4, 3],
    ]
    const spike: Point[] = [
      [0, 0],
      [4, 0],
      [2, 0],
      [2, 3],
    ]
    expect(isSimplePolygon(bowtie)).toBe(false)
    expect(isSimplePolygon(repeated)).toBe(false)
    expect(isSimplePolygon(spike)).toBe(false)
    expect(
      isSimplePolygon([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBe(false)
  })
})

describe('rectInsidePolygon', () => {
  it('allows props flush against the walls', () => {
    expect(rectInsidePolygon(rectFromCenter(0.5, 0.25, 1, 0.5), square)).toBe(true)
  })

  it('rejects a rectangle bridging the concave slot even though all corners are inside', () => {
    const rect = { minX: 1, minZ: 2, maxX: 5, maxZ: 3 }
    expect(rectInsidePolygon(rect, uShape)).toBe(false)
  })

  it('rejects a rectangle poking out of the boundary', () => {
    expect(rectInsidePolygon(rectFromCenter(3.9, 1, 0.5, 0.5), square)).toBe(false)
  })
})

describe('polygonInsidePolygon', () => {
  it('detects obstacles that leave the concave boundary between vertices', () => {
    const across: Point[] = [
      [1, 2],
      [5, 2],
      [5, 3],
      [1, 3],
    ]
    const column: Point[] = [
      [0.5, 0.5],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
    ]
    expect(polygonInsidePolygon(across, uShape)).toBe(false)
    expect(polygonInsidePolygon(column, uShape)).toBe(true)
  })
})

describe('rectangle relations', () => {
  it('does not count touching edges as overlap', () => {
    const a = rectFromCenter(1, 1, 2, 2)
    const b = rectFromCenter(3, 1, 2, 2)
    expect(rectsOverlap(a, b)).toBe(false)
    expect(rectsOverlap(a, rectFromCenter(2.5, 1, 2, 2))).toBe(true)
    expect(rectGap(a, b)).toBe(0)
    expect(rectGap(a, rectFromCenter(5, 1, 2, 2))).toBe(2)
  })

  it('finds segments through the interior but ignores segments along an edge', () => {
    const rect = rectFromCenter(1, 1, 2, 2)
    expect(segmentIntersectsRectInterior([-1, 1], [3, 1], rect)).toBe(true)
    expect(segmentIntersectsRectInterior([0, 2], [2, 2], rect)).toBe(false)
    expect(segmentIntersectsRectInterior([3, 0], [3, 2], rect)).toBe(false)
  })

  it('detects obstacle overlap when either shape contains the other', () => {
    const column: Point[] = [
      [0.9, 0.9],
      [1.1, 0.9],
      [1.1, 1.1],
      [0.9, 1.1],
    ]
    expect(polygonOverlapsRect(column, rectFromCenter(1, 1, 2, 2))).toBe(true)
    expect(polygonOverlapsRect(square, rectFromCenter(1, 1, 0.5, 0.5))).toBe(true)
    expect(polygonOverlapsRect(column, rectFromCenter(1.6, 1, 1, 1))).toBe(false)
  })
})
