import { describe, expect, it } from 'vitest'
import { isClockwise } from '../geometry/index.ts'
import { SpaceSchema, normalizeSpace, rectangleSpace, validateSpace } from './space.ts'
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
})

describe('rectangleSpace', () => {
  it('creates a valid rectangle whose front edge is the main entrance', () => {
    const space = rectangleSpace(8, 6, 3.2)
    expect(validateSpace(space)).toEqual([])
    expect(space.entrances).toEqual([{ a: [0, 6], b: [8, 6], kind: 'main' }])
  })
})
