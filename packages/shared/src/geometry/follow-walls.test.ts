import { describe, expect, it } from 'vitest'
import { rectFromCenter } from './rect.ts'
import { wallShift } from './follow-walls.ts'
import type { Point } from './types.ts'

const rect = (w: number, d: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
]

describe('wallShift', () => {
  // A 2.4 m cabinet on the back wall (z = 0) and a 1.2 m one on the right wall (x = 6).
  const back = rectFromCenter(3, 0.275, 2.4, 0.55)
  const right = rectFromCenter(5.725, 2, 0.55, 1.2)
  const middle = rectFromCenter(3, 2, 1.8, 0.8)

  it('moves a prop with the wall it stands against', () => {
    // The back wall moves 0.5 m back (the shop gets deeper towards −z).
    const deeper: Point[] = [
      [0, -0.5],
      [6, -0.5],
      [6, 4],
      [0, 4],
    ]
    expect(wallShift(back, rect(6, 4), deeper)).toEqual([0, -0.5])
    expect(wallShift(right, rect(6, 4), rect(5.4, 4))).toEqual([-0.6, 0])
  })

  it('leaves free-standing props and props on walls that stayed put', () => {
    expect(wallShift(middle, rect(6, 4), rect(5, 3))).toEqual([0, 0])
    expect(wallShift(back, rect(6, 4), rect(7, 4))).toEqual([0, 0])
  })

  it('follows the part of a wall that still runs past the prop after a notch', () => {
    // Only the right half of the back wall moves 0.3 m into the shop.
    const notched: Point[] = [
      [0, 0],
      [2, 0],
      [2, 0.3],
      [6, 0.3],
      [6, 4],
      [0, 4],
    ]
    const onRight = rectFromCenter(4.5, 0.275, 1.2, 0.55)
    expect(wallShift(onRight, rect(6, 4), notched)).toEqual([0, 0.3])
  })

  it('follows both walls in a corner', () => {
    const corner = rectFromCenter(5.725, 0.6, 0.55, 1.2)
    const shifted = wallShift(corner, rect(6, 4), rect(6.5, 4))
    expect(shifted).toEqual([0.5, 0])
  })
})
