import { describe, expect, it } from 'vitest'
import { isClockwise } from '../geometry/index.ts'
import { ARC, arcFront } from '../planner/shapes.fixture.ts'
import {
  SpaceSchema,
  normalizeSpace,
  openingPieces,
  rectangleSpace,
  validateSpace,
} from './space.ts'
import type { SpaceInput } from './space.ts'

const lShape: SpaceInput = {
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [6, 0],
    [6, 2],
    [3, 2],
    [3, 5],
    [0, 5],
  ],
  height: 3.2,
  entrances: [{ a: [0.5, 5], b: [2.5, 5], kind: 'main' }],
  obstacles: [
    {
      kind: 'column',
      polygon: [
        [1, 1],
        [1.4, 1],
        [1.4, 1.4],
        [1, 1.4],
      ],
      label: '柱 A',
    },
  ],
}

describe('SpaceSchema', () => {
  it('fills defaults for optional collections', () => {
    const space = SpaceSchema.parse({ schemaVersion: 1, boundary: lShape.boundary, height: 3 })
    expect(space.entrances).toEqual([])
    expect(space.obstacles).toEqual([])
    expect(space.calibration).toBeNull()
  })

  it('rejects malformed coordinates', () => {
    expect(
      SpaceSchema.safeParse({
        ...lShape,
        boundary: [
          [0, 0],
          [1, 1],
        ],
      }).success,
    ).toBe(false)
    expect(
      SpaceSchema.safeParse({
        ...lShape,
        boundary: [
          [0, 0],
          [Number.NaN, 0],
          [1, 1],
        ],
      }).success,
    ).toBe(false)
    expect(
      SpaceSchema.safeParse({
        ...lShape,
        boundary: [
          [0, 0],
          [5000, 0],
          [1, 1],
        ],
      }).success,
    ).toBe(false)
  })
})

describe('validateSpace', () => {
  it('accepts a valid L-shaped shop with a column and an entrance on the boundary', () => {
    expect(validateSpace(SpaceSchema.parse(lShape))).toEqual([])
  })

  it('reports an obstacle in the cut-away corner and an entrance off the boundary', () => {
    const space = SpaceSchema.parse({
      ...lShape,
      entrances: [{ a: [4, 4], b: [5, 4], kind: 'main' }],
      obstacles: [
        {
          kind: 'column',
          polygon: [
            [4, 3],
            [4.4, 3],
            [4.4, 3.4],
            [4, 3.4],
          ],
        },
      ],
    })
    expect(validateSpace(space).map((issue) => issue.code)).toEqual([
      'obstacle_outside_boundary',
      'entrance_not_on_boundary',
    ])
  })

  it('reports a self-intersecting boundary and skips checks that depend on it', () => {
    const space = SpaceSchema.parse({
      ...lShape,
      boundary: [
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ],
    })
    expect(validateSpace(space).map((issue) => issue.code)).toEqual(['boundary_not_simple'])
  })

  it('accepts an entrance or open edge that runs along several edges', () => {
    const [p0, , p2, , , , p6, , p8] = ARC
    // The whole arc storefront as one entrance: its chord midpoint (5, 7) is inside the shop.
    const wholeArc = { ...arcFront, entrances: [{ a: p0, b: p8, kind: 'main' as const }] }
    expect(validateSpace(SpaceSchema.parse({ ...wholeArc, openEdges: [] }))).toEqual([])
    // Part entrance, part open edges (the fixture).
    expect(validateSpace(arcFront)).toEqual([])
    expect(openingPieces(arcFront, { a: p2, b: p6 })?.map((p) => p.edge)).toEqual([4, 5, 6, 7])
    // From the middle of one arc piece to the middle of another, and round an L-shape corner.
    const mid = (i: number): [number, number] => {
      const [a, b] = [ARC[i], ARC[i + 1]] as [[number, number], [number, number]]
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    }
    const partial = SpaceSchema.parse({
      ...arcFront,
      entrances: [{ a: mid(1), b: mid(4), kind: 'main' }],
      openEdges: [{ a: p6, b: p8 }],
    })
    expect(validateSpace(partial)).toEqual([])
    expect(openingPieces(partial, partial.entrances[0] ?? { a: p0, b: p0 })).toHaveLength(4)
    const corner = SpaceSchema.parse({
      ...lShape,
      entrances: [{ a: [3, 3], b: [5, 2], kind: 'main' }],
    })
    expect(validateSpace(corner)).toEqual([])
  })

  it('still rejects an entrance or open edge with an end off the boundary', () => {
    const [p0, , , , p4] = ARC // p4 = (5, 8), the front of the arc
    const space = SpaceSchema.parse({
      ...arcFront,
      entrances: [{ a: p0, b: [5, 7.5], kind: 'main' }],
      openEdges: [{ a: p4, b: [5, 7] }],
    })
    expect(validateSpace(space).map((issue) => [issue.code, issue.path])).toEqual([
      ['entrance_not_on_boundary', ['entrances', 0]],
      ['open_edge_not_on_boundary', ['openEdges', 0]],
    ])
  })

  it('warns about unusual ceiling heights without blocking', () => {
    const issues = validateSpace(SpaceSchema.parse({ ...lShape, height: 8 }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'height_unusual', severity: 'warning' })
  })
})

describe('normalizeSpace', () => {
  it('stores clockwise rings at millimetre precision', () => {
    const space = SpaceSchema.parse({
      ...lShape,
      boundary: [...lShape.boundary].reverse().map(([x, z]) => [x + 0.00041, z]),
    })
    const normalized = normalizeSpace(space)
    expect(isClockwise(normalized.boundary)).toBe(true)
    expect(normalized.boundary[0]).toEqual([0, 0])
  })

  it('keeps an entrance along several edges as one entrance', () => {
    const normalized = normalizeSpace({
      ...arcFront,
      boundary: [...arcFront.boundary].reverse(),
    })
    expect(normalized.entrances).toEqual(arcFront.entrances)
    expect(normalized.openEdges).toEqual(arcFront.openEdges)
    expect(validateSpace(normalized)).toEqual([])
  })
})

describe('rectangleSpace', () => {
  it('creates a valid rectangle whose front edge is the main entrance', () => {
    const space = rectangleSpace(8, 6, 3.2)
    expect(validateSpace(space)).toEqual([])
    expect(space.entrances).toEqual([{ a: [0, 6], b: [8, 6], kind: 'main' }])
  })
})
