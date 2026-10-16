import { describe, expect, it } from 'vitest'
import {
  arcPoints,
  scaleFromPoints,
  snapPoint,
  straighten,
  toPicturePoints,
  toTracedSpace,
} from './trace.ts'
import type { Px } from './trace.ts'

const line = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 })
// Two walls meeting at (100, 100), and a lone wall further off.
const vector = {
  lines: [line(100, 100, 400, 100), line(100, 100, 100, 300), line(600, 50, 600, 400)],
}

describe('snapPoint', () => {
  it('pulls a click onto a nearby corner, else onto a nearby line, else leaves it', () => {
    expect(snapPoint([106, 95], vector, 12)).toEqual({ point: [100, 100], kind: 'corner' })
    expect(snapPoint([250, 108], vector, 12)).toEqual({ point: [250, 100], kind: 'line' })
    expect(snapPoint([300, 250], vector, 12)).toEqual({ point: [300, 250], kind: 'none' })
    // A picture without vector content: no snapping.
    expect(snapPoint([106, 95], null, 12).kind).toBe('none')
  })

  it('finds where two lines cross, not only their ends', () => {
    const crossing = { lines: [line(0, 50, 200, 50), line(80, 0, 80, 200)] }
    expect(snapPoint([84, 46], crossing, 10)).toEqual({ point: [80, 50], kind: 'corner' })
  })
})

describe('straighten', () => {
  it('keeps the longer of the two moves', () => {
    expect(straighten([0, 0], [100, 12])).toEqual([100, 0])
    expect(straighten([0, 0], [-8, 90])).toEqual([0, 90])
  })
})

describe('arcPoints', () => {
  const round = (ps: Px[]) =>
    ps.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])

  it('cuts a half circle through its middle into 15° pieces, ending at the end point', () => {
    // From (−100, 0) over the top (0, −100) to (100, 0): 180°, 12 pieces.
    const points = arcPoints([-100, 0], [0, -100], [100, 0])
    expect(points).toHaveLength(12)
    expect(points.at(-1)).toEqual([100, 0])
    for (const [x, y] of points) expect(Math.hypot(x, y)).toBeCloseTo(100, 6)
    expect(round(points).some(([, y]) => y === -100)).toBe(true)
    // Through the bottom instead: the other half.
    expect(arcPoints([-100, 0], [0, 100], [100, 0]).every(([, y]) => y >= -1e-9)).toBe(true)
  })

  it('is a straight piece when the three points are in line', () => {
    expect(arcPoints([0, 0], [50, 0], [100, 0])).toEqual([[100, 0]])
  })
})

describe('toTracedSpace', () => {
  // A 400 × 300 px rectangle at 10 mm per pixel: 4 × 3 m.
  const square: Px[] = [
    [100, 100],
    [500, 100],
    [500, 400],
    [100, 400],
  ]

  it('turns pixels into metres from the origin', () => {
    const space = toTracedSpace(square, ['wall', 'wall', 'wall', 'wall'], 10, [100, 100])
    expect(space.boundary).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    expect(space.entrances).toEqual([])
    expect(space.openEdges).toEqual([])
  })

  it('makes entrances (the first the main one) and open edges from the edge kinds', () => {
    const space = toTracedSpace(square, ['wall', 'open', 'entrance', 'wall'], 10, [100, 100])
    expect(space.entrances).toEqual([{ a: [4, 3], b: [0, 3], kind: 'main' }])
    expect(space.openEdges).toEqual([{ a: [4, 0], b: [4, 3] }])
  })

  it('joins adjacent edges of the same kind into one entrance, across the start too', () => {
    // An arc storefront traced as three pieces, the last one wrapping to the first point.
    const front: Px[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [60, 120],
      [40, 120],
      [0, 100],
    ]
    const space = toTracedSpace(
      front,
      ['wall', 'wall', 'entrance', 'entrance', 'entrance', 'wall'],
      10,
      [0, 0],
    )
    expect(space.entrances).toEqual([{ a: [1, 1], b: [0, 1], kind: 'main' }])
  })

  it('goes back to picture pixels for editing a recognised boundary', () => {
    expect(toPicturePoints([[4, 3]], 10, [100, 100])).toEqual([[500, 400]])
  })
})

describe('scaleFromPoints', () => {
  it('divides the known length by the picked distance', () => {
    expect(scaleFromPoints({ a: [0, 0], b: [300, 400] }, 5000)).toBe(10)
    expect(scaleFromPoints({ a: [0, 0], b: [0, 0] }, 5000)).toBeNull()
    expect(scaleFromPoints(null, 5000)).toBeNull()
  })
})
