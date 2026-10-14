import { describe, expect, it } from 'vitest'
import { WALL_THICKNESS_M, rectangleSpace } from '@store/shared'
import type { Point, Space } from '@store/shared'
import {
  boundarySides,
  dimensionChains,
  overallDimensions,
  readableAngle,
  symbolBaseRotation,
  symbolSizeFromSvg,
  tickHalf,
  wallBands,
} from './plan-drawing.ts'

const t = WALL_THICKNESS_M
/** 8 × 6 m, entrance on the bottom edge from x = 3 to 5. */
const shop = (): Space => ({
  ...rectangleSpace(8, 6, 3.2),
  entrances: [{ a: [3, 6], b: [5, 6], kind: 'main' }],
})

const round = (p: readonly number[]) => p.map((v) => Math.round(v * 1000) / 1000)

describe('wallBands', () => {
  it('mitres corners and caps the wall ends at the entrance', () => {
    const bands = wallBands(shop(), 'side_hall')
    expect(bands).toHaveLength(5)
    // Back wall (top): corners meet the side walls' outer faces.
    expect(bands[0]?.polygon.map(round)).toEqual([
      [0, 0],
      [8, 0],
      [8 + t, -t],
      [-t, -t],
    ])
    expect(bands[0]?.outline).toHaveLength(2)
    // The bottom-right run stops at the entrance: it gets an end cap there.
    const beforeEntrance = bands[2]
    expect(beforeEntrance?.polygon.map(round)).toEqual([
      [8, 6],
      [5, 6],
      [5, 6 + t],
      [8 + t, 6 + t],
    ])
    expect(beforeEntrance?.outline.map((line) => line.map(round))).toContainEqual([
      [5, 6],
      [5, 6 + t],
    ])
  })

  it('draws no walls for island shops', () => {
    expect(wallBands(shop(), 'island')).toEqual([])
  })
})

describe('dimensionChains', () => {
  it('measures every edge outside the plan, split at the entrance', () => {
    const chains = dimensionChains(shop(), 0.6)
    expect(chains.map((d) => d.label)).toEqual(['8000', '6000', '3000', '2000', '3000', '6000'])
    const top = chains[0]
    expect(top?.a.map((v) => Math.round(v * 100) / 100)).toEqual([0, -0.6])
    expect(top?.outward).toEqual([0, -1])
    expect(chains.every((d) => d.angle > -90 && d.angle <= 90)).toBe(true)
  })
})

/** 10 m wide, 6 m deep at the sides; the front bulges 1.5 m out in an 8-piece arc. */
function arcShop(entrances: Space['entrances'] = []): Space {
  const arc: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    arc.push([10 - 10 * t, 6 + 1.5 * Math.sin(Math.PI * t)])
  }
  return {
    ...rectangleSpace(10, 7.5, 3),
    boundary: [
      [0, 0],
      [10, 0],
      ...arc.map((p): [number, number] => [round(p)[0] ?? 0, round(p)[1] ?? 0]),
    ],
    entrances,
  }
}

const L: Space = {
  ...rectangleSpace(10, 10, 3),
  boundary: [
    [0, 0],
    [4, 0],
    [4, 6],
    [10, 6],
    [10, 10],
    [0, 10],
  ],
  entrances: [{ a: [8, 10], b: [4, 10], kind: 'main' }],
}

describe('dimension chains of irregular shops', () => {
  it('measures an arc front as one chord instead of eight pieces', () => {
    const space = arcShop()
    expect(space.boundary).toHaveLength(11)
    const chains = dimensionChains(space, 0.6)
    // Back, right side, the arc, left side (was 3 + 8 = 11 chains).
    expect(chains.map((d) => d.label)).toEqual(['10000', '6000', '10000', '6000'])
    const front = chains[2]
    // Along the chord, outside the arc's lowest point (z = 7.5).
    expect(front?.outward).toEqual([0, 1])
    expect(front?.a[1]).toBeCloseTo(7.5 + 0.6, 6)
    expect(front?.b[1]).toBeCloseTo(7.5 + 0.6, 6)
    // The extension lines start on the boundary: the chord ends are the arc ends.
    expect(front?.from).toEqual([10, 6])
    expect(front?.to).toEqual([0, 6])
  })

  it('splits the arc chord where an entrance across several pieces starts and ends', () => {
    const space = arcShop()
    const [a, b] = [space.boundary[4], space.boundary[8]] as [[number, number], [number, number]]
    const chains = dimensionChains({ ...space, entrances: [{ a, b, kind: 'main' }] }, 0.6)
    const front = chains.filter((d) => d.outward[1] === 1)
    expect(front.map((d) => d.label)).toEqual(['2500', '5000', '2500'])
    // The entrance ends sit on the boundary, not on the chord.
    expect(front[1]?.from).toEqual(a)
    expect(front[1]?.to).toEqual(b)
  })

  it('keeps long straight-ish edges and corners apart', () => {
    // A 30° cut corner is not an arc: three sides plus the cut, each with its own chain.
    const cut: Point[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [7, 8],
      [0, 8],
    ]
    expect(boundarySides(cut)).toHaveLength(5)
    // Collinear edges (an extra vertex on a straight wall) are one side.
    expect(
      boundarySides([
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 6],
        [0, 6],
      ]),
    ).toHaveLength(4)
  })

  it('leaves out the faces of a narrow notch, but not of a wide one', () => {
    const notch = (w: number): Space => ({
      ...rectangleSpace(9, 6, 3),
      boundary: [
        [0, 0],
        [9, 0],
        [9, 6],
        [4.5 + w / 2, 6],
        [4.5 + w / 2, 2],
        [4.5 - w / 2, 2],
        [4.5 - w / 2, 6],
        [0, 6],
      ],
      entrances: [],
    })
    const faces = (space: Space) =>
      dimensionChains(space, 0.6).filter(
        (d) => (d.from[1] === 6 && d.to[1] === 2) || (d.from[1] === 2 && d.to[1] === 6),
      )
    expect(faces(notch(3))).toHaveLength(2)
    expect(faces(notch(0.8))).toHaveLength(0)
    // The bottom of the narrow notch still shows its width.
    expect(dimensionChains(notch(0.8), 0.6).map((d) => d.label)).toContain('800')
  })
})

describe('overallDimensions', () => {
  it('adds the overall width above and depth left, outside every chain', () => {
    const chains = dimensionChains(L, 0.6)
    const [width, depth] = overallDimensions(L, chains, 0.6, 0.5)
    expect(width?.label).toBe('10000')
    expect(depth?.label).toBe('10000')
    const top = Math.min(...chains.flatMap((d) => [d.a[1], d.b[1]]))
    const left = Math.min(...chains.flatMap((d) => [d.a[0], d.b[0]]))
    expect(width?.a).toEqual([0, top - 0.5])
    expect(width?.b).toEqual([10, top - 0.5])
    expect(depth?.a).toEqual([left - 0.5, 0])
    expect(depth?.b).toEqual([left - 0.5, 10])
    // Measured from the extreme vertices, nearest the dimension line.
    expect([width?.from, width?.to]).toEqual([
      [0, 0],
      [10, 6],
    ])
    expect([depth?.from, depth?.to]).toEqual([
      [0, 0],
      [0, 10],
    ])
    expect(depth?.angle).toBe(90)
  })

  it('adds nothing to a rectangle: its edge chains are already the overall sizes', () => {
    expect(overallDimensions(shop(), dimensionChains(shop(), 0.6), 0.6, 0.5)).toEqual([])
  })

  it('measures an arc shop to the bottom of its arc', () => {
    const space = arcShop()
    const [width, depth] = overallDimensions(space, dimensionChains(space, 0.6), 0.6, 0.5)
    expect(width?.label).toBe('10000')
    expect(depth?.label).toBe('7500')
  })
})

describe('tickHalf', () => {
  const angleBetween = (u: Point, v: Point) =>
    (Math.acos(
      Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])),
    ) *
      180) /
    Math.PI

  it('keeps the legacy (1, −1) tick on lines along x or z', () => {
    expect(tickHalf([0, 0], [5, 0], 0.2)).toEqual([0.1, -0.1])
    expect(tickHalf([5, 0], [0, 0], 0.2)).toEqual([0.1, -0.1])
    expect(tickHalf([0, 0], [0, 5], 0.2)).toEqual([0.1, -0.1])
    expect(tickHalf([0, 5], [0, 0], 0.2)).toEqual([0.1, -0.1])
  })

  it('turns with a slanted line and crosses it at 45°, also on a 45° edge', () => {
    for (const b of [
      [3, -3],
      [3, 3],
      [-3, 4],
      [4, 1],
    ] as Point[]) {
      const half = tickHalf([0, 0], b, 0.2)
      expect(Math.hypot(half[0], half[1])).toBeCloseTo(0.2 / Math.SQRT2, 9)
      expect(angleBetween(half, b)).toBeCloseTo(45, 6)
    }
    // The legacy fixed tick would lie on a (1, −1) line.
    expect(angleBetween([1, -1], [3, -3])).toBeCloseTo(0, 3)
  })
})

describe('readableAngle', () => {
  it('never turns text upside down', () => {
    expect(readableAngle([1, 0])).toBe(0)
    expect(readableAngle([-1, 0])).toBe(0)
    expect(readableAngle([0, 1])).toBe(90)
    expect(readableAngle([0, -1])).toBe(90)
  })
})

describe('symbols', () => {
  it('reads the drawn size without the 18 mm margin', () => {
    const svg = '<svg width="1836mm" viewBox="-18 -18 1836 1036"><rect/></svg>'
    expect(symbolSizeFromSvg(svg)).toEqual({ w: 1.8, d: 1 })
    expect(symbolSizeFromSvg('<svg></svg>')).toBeNull()
  })

  it('turns the symbol to the model front, or to match the footprint', () => {
    const size = { w: 1.8, d: 0.5 }
    expect(symbolBaseRotation('+Z', { w: 1.8, d: 0.5 }, size)).toBe(0)
    expect(symbolBaseRotation('-Z', { w: 1.8, d: 0.5 }, size)).toBe(180)
    expect(symbolBaseRotation('+X', { w: 0.5, d: 1.8 }, size)).toBe(-90)
    expect(symbolBaseRotation('-X', { w: 0.5, d: 1.8 }, size)).toBe(90)
    expect(symbolBaseRotation('any', { w: 1, d: 1.8 }, { w: 1.8, d: 1 })).toBe(90)
    expect(symbolBaseRotation(null, { w: 1.8, d: 1 }, { w: 1.8, d: 1 })).toBe(0)
  })
})
