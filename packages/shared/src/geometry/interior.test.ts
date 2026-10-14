import { describe, expect, it } from 'vitest'
import { distanceToBoundary, interiorPoint, locatePoint } from './index.ts'
import type { Point } from './index.ts'

const rectangle = (w: number, d: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
]

// Opening at the bottom: the bounding-box centre (4.5, 3) lies in the slot, outside the shop.
const uShape: Point[] = [
  [0, 0],
  [9, 0],
  [9, 6],
  [6, 6],
  [6, 2],
  [3, 2],
  [3, 6],
  [0, 6],
]

describe('interiorPoint', () => {
  it('is the centre of a rectangle', () => {
    expect(interiorPoint(rectangle(8, 6))).toEqual([4, 3])
    expect(interiorPoint(rectangle(20, 4))).toEqual([10, 2])
  })

  it('lies inside a U shape, as far from its walls as the arms allow', () => {
    const p = interiorPoint(uShape)
    expect(locatePoint(p, uShape)).toBe('inside')
    // The arms are 3 m wide, so no point is more than 1.5 m from a wall.
    expect(distanceToBoundary(p, uShape)).toBeGreaterThan(1.45)
  })

  it('finds the deep corner of an L shape', () => {
    const l: Point[] = [
      [0, 0],
      [4, 0],
      [4, 6],
      [10, 6],
      [10, 10],
      [0, 10],
    ]
    const p = interiorPoint(l)
    expect(locatePoint(p, l)).toBe('inside')
    expect(distanceToBoundary(p, l)).toBeGreaterThan(2)
  })

  it('handles slanted edges', () => {
    const trapezoid: Point[] = [
      [0, 0],
      [6, 0],
      [10, 6],
      [0, 6],
    ]
    const p = interiorPoint(trapezoid)
    expect(locatePoint(p, trapezoid)).toBe('inside')
    expect(distanceToBoundary(p, trapezoid)).toBeGreaterThan(2.5)
  })

  it('keeps a preferred point that is as deep as the best one', () => {
    expect(interiorPoint(rectangle(20, 4), { prefer: [6, 2] })).toEqual([6, 2])
    // Too close to the wall: the deepest point wins.
    expect(interiorPoint(rectangle(20, 4), { prefer: [6, 0.5] })[1]).toBeCloseTo(2, 2)
  })
})
