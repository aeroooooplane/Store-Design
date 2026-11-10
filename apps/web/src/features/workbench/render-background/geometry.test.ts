import { describe, expect, it } from 'vitest'
import { validMask } from './geometry.ts'

describe('photo-coordinate masks', () => {
  it('accepts simple concave polygons and rejects crossing, zero-area and overlapping edges', () => {
    expect(
      validMask([
        [0, 0],
        [1, 0],
        [0.4, 0.4],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(true)
    expect(
      validMask([
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
      ]),
    ).toBe(false)
    expect(
      validMask([
        [0, 0],
        [0.5, 0],
        [1, 0],
      ]),
    ).toBe(false)
    expect(
      validMask([
        [0, 0],
        [1, 0],
        [0.5, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(false)
    expect(
      validMask([
        [0, 0],
        [1, 0],
        [1, 0],
        [0, 1],
      ]),
    ).toBe(false)
  })
})
