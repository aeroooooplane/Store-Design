import { describe, expect, it } from 'vitest'
import { WALL_THICKNESS_M, rectangleSpace } from '@store/shared'
import type { Point, Space } from '@store/shared'
import {
  boundarySides,
  dimensionChains,
  openingLines,
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
  it('adds no overall dimension that one chain already shows', () => {
    // The L's left edge is one 10000 chain: no overall depth. Its bottom edge is split by the
    // entrance into several chains, so the overall width is still added.
    const overall = overallDimensions(L, dimensionChains(L, 0.6), 0.6, 0.5)
    expect(overall.map((d) => [d.label, d.angle])).toEqual([['10000', 0]])
  })

  it('adds the overall width above and depth left, outside every chain', () => {
    // Every corner cut: no edge spans the full width or depth.
    const cut: Space = {
      ...rectangleSpace(10, 10, 3),
      boundary: [
        [1, 0],
        [9, 0],
        [10, 1],
        [10, 9],
        [9, 10],
        [1, 10],
        [0, 9],
        [0, 1],
      ],
      entrances: [],
    }
    const chains = dimensionChains(cut, 0.6)
    const [width, depth] = overallDimensions(cut, chains, 0.6, 0.5)
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
      [0, 1],
      [10, 1],
    ])
    expect([depth?.from, depth?.to]).toEqual([
      [1, 0],
      [1, 10],
    ])
    expect(depth?.angle).toBe(90)
  })

  it('adds nothing to a rectangle: its edge chains are already the overall sizes', () => {
    expect(overallDimensions(shop(), dimensionChains(shop(), 0.6), 0.6, 0.5)).toEqual([])
  })

  it('measures an arc shop to the bottom of its arc', () => {
    const space = arcShop()
    // The straight back edge already shows the 10000 width; only the depth to the arc is added.
    const overall = overallDimensions(space, dimensionChains(space, 0.6), 0.6, 0.5)
    expect(overall.map((d) => d.label)).toEqual(['7500'])
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

describe('openings across several edges', () => {
  /** 7 m wide, 6 m deep at the sides, a 4-piece arc front bulging 0.8 m; all of it entrance. */
  const arcFront = (): Space => {
    const arc = [0, 1, 2, 3, 4].map((i): [number, number] => [
      round([7 - 1.75 * i])[0] ?? 0,
      round([6 + 0.8 * Math.sin((Math.PI * i) / 4)])[0] ?? 0,
    ])
    return {
      ...rectangleSpace(7, 6.8, 3),
      boundary: [[0, 0], [7, 0], ...arc],
      entrances: [{ a: [7, 6], b: [0, 6], kind: 'main' }],
    }
  }
  /** 8 × 6 m with the entrance round the bottom-right corner. */
  const roundCorner = (): Space => ({
    ...rectangleSpace(8, 6, 3),
    entrances: [{ a: [6, 6], b: [8, 4], kind: 'main' }],
  })
  const touches = (bands: ReturnType<typeof wallBands>, p: Point) =>
    bands.some((band) => band.polygon.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6))

  it('draws an opening along the boundary, one line per edge it covers', () => {
    const space = arcFront()
    const entrance = space.entrances[0] as Space['entrances'][number]
    expect(openingLines(space, entrance)).toEqual([
      [space.boundary[2], space.boundary[3]],
      [space.boundary[3], space.boundary[4]],
      [space.boundary[4], space.boundary[5]],
      [space.boundary[5], space.boundary[6]],
    ])
    expect(openingLines(roundCorner(), { a: [6, 6], b: [8, 4] })).toEqual([
      [
        [6, 6],
        [8, 6],
      ],
      [
        [8, 6],
        [8, 4],
      ],
    ])
    // Within one edge, and off the boundary, it stays the segment a → b.
    expect(openingLines(shop(), { a: [5, 6], b: [3, 6] })).toEqual([
      [
        [5, 6],
        [3, 6],
      ],
    ])
    expect(openingLines(shop(), { a: [3, 5], b: [5, 5] })).toEqual([
      [
        [3, 5],
        [5, 5],
      ],
    ])
  })

  it('leaves no wall at the vertices inside an opening, and caps the walls at its ends', () => {
    const arc = arcFront()
    const bands = wallBands(arc, 'side_hall')
    // Back and both sides only: the arc is all entrance.
    expect(bands).toHaveLength(3)
    for (const vertex of arc.boundary.slice(3, 6)) expect(touches(bands, vertex)).toBe(false)
    const outlines = bands.flatMap((band) => band.outline.map((line) => line.map(round)))
    expect(outlines).toContainEqual([
      [7, 6],
      [7 + t, 6],
    ])
    expect(outlines).toContainEqual([
      [0, 6],
      [-t, 6],
    ])

    const corner = wallBands(roundCorner(), 'side_hall')
    expect(touches(corner, [8, 6])).toBe(false)
    expect(touches(corner, [8, 4])).toBe(true)
    expect(touches(corner, [6, 6])).toBe(true)

    // An open edge round the top-right corner leaves that corner without wall too.
    const open: Space = { ...shop(), openEdges: [{ a: [8, 2], b: [6, 0] }] }
    expect(touches(wallBands(open, 'side_hall'), [8, 0])).toBe(false)
  })

  it('splits dimension chains only at the ends of an opening, not at the vertices inside it', () => {
    // The whole arc is one chain, as without an entrance.
    expect(dimensionChains(arcFront(), 0.6).map((d) => d.label)).toEqual([
      '7000',
      '6000',
      '7000',
      '6000',
    ])
    // Round a corner: each side splits where the entrance reaches it.
    expect(dimensionChains(roundCorner(), 0.6).map((d) => d.label)).toEqual([
      '8000',
      '4000',
      '2000',
      '2000',
      '6000',
      '6000',
    ])
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

/**
 * 草稿样例（门店图纸窗口清洗试点，AI 看图得到、未经用户核实；与
 * packages/shared/src/planner/real-shapes.fixture.ts 相同的坐标，按 x, z 依次排列，单位米）。
 */
const draft = (flat: number[]): Space => {
  const boundary: [number, number][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) boundary.push([flat[i] ?? 0, flat[i + 1] ?? 0])
  return { ...rectangleSpace(1, 1, 3.2), boundary, entrances: [] }
}
/** store-0293 澳门威尼斯人：4.52 m 平直底边，其余 65 段是约 210° 的弧形平台。 */
const STORE_0293 = draft([
  4.613, 3.006, 0.093, 3.006, 0.063, 2.893, 0.024, 2.688, 0.011, 2.585, 0, 2.378, 0.001, 2.261,
  0.02, 2.047, 0.051, 1.863, 0.083, 1.731, 0.114, 1.627, 0.149, 1.525, 0.19, 1.426, 0.246, 1.304,
  0.336, 1.139, 0.456, 0.959, 0.526, 0.869, 0.591, 0.792, 0.664, 0.713, 0.76, 0.62, 0.895, 0.505,
  1.002, 0.426, 1.151, 0.329, 1.268, 0.264, 1.362, 0.217, 1.562, 0.136, 1.651, 0.105, 1.767, 0.073,
  1.852, 0.053, 1.977, 0.029, 2.057, 0.018, 2.191, 0.005, 2.299, 0, 2.407, 0, 2.514, 0.005, 2.622,
  0.014, 2.728, 0.029, 2.853, 0.053, 2.953, 0.077, 3.042, 0.102, 3.144, 0.136, 3.248, 0.176, 3.343,
  0.217, 3.463, 0.277, 3.641, 0.383, 3.726, 0.442, 3.809, 0.505, 3.867, 0.551, 3.967, 0.64, 4.042,
  0.713, 4.112, 0.788, 4.25, 0.959, 4.343, 1.097, 4.411, 1.212, 4.446, 1.277, 4.516, 1.426, 4.556,
  1.525, 4.591, 1.627, 4.648, 1.836, 4.669, 1.941, 4.688, 2.067, 4.704, 2.274, 4.706, 2.369, 4.694,
  2.585, 4.664, 2.79, 4.643, 2.891,
])
/** store-0043 保定北国先天下：8.146 × 7.004 m，四角为约 1.49 m 半径、15 段折线的圆角。 */
const STORE_0043 = draft([
  0.436, 6.567, 0.317, 6.432, 0.214, 6.283, 0.13, 6.122, 0.065, 5.949, 0.022, 5.767, 0.001, 5.577,
  0, 5.514, 0, 1.49, 0.001, 1.427, 0.022, 1.237, 0.065, 1.054, 0.13, 0.882, 0.214, 0.72, 0.317,
  0.571, 0.436, 0.436, 0.571, 0.317, 0.72, 0.214, 0.882, 0.13, 1.054, 0.065, 1.237, 0.022, 1.427,
  0.001, 1.49, 0, 6.656, 0, 6.719, 0.001, 6.91, 0.022, 7.092, 0.065, 7.264, 0.13, 7.426, 0.214,
  7.575, 0.317, 7.71, 0.436, 7.829, 0.571, 7.932, 0.72, 8.017, 0.882, 8.081, 1.054, 8.124, 1.237,
  8.145, 1.427, 8.146, 1.49, 8.146, 5.514, 8.145, 5.577, 8.124, 5.767, 8.081, 5.949, 8.017, 6.122,
  7.932, 6.283, 7.829, 6.432, 7.71, 6.567, 7.575, 6.687, 7.426, 6.79, 7.264, 6.874, 7.092, 6.939,
  6.91, 6.982, 6.719, 7.002, 6.656, 7.004, 1.49, 7.004, 1.427, 7.002, 1.237, 6.982, 1.054, 6.939,
  0.882, 6.874, 0.72, 6.79, 0.571, 6.687,
])
/** store-0088 南昌武商mall：租赁线，直角凹凸、74 mm 的小错台和约 4° 的斜底边。 */
const STORE_0088 = draft([
  0.489, 5.427, 0.489, 4.879, 0, 4.879, 0, 2.894, 0.099, 2.894, 0.099, 1.907, 0.798, 1.907, 0.798,
  0.862, 0.01, 0.862, 0.01, 0, 8.275, 0, 8.275, 0.175, 9.111, 0.175, 9.111, 5.99, 9.037, 5.99,
  9.032, 6.061,
])
/** store-0001 上海TPY中心：租赁线，斜墙之间转角 75°–96°，左墙与左上斜边只差 14.6°。 */
const STORE_0001 = draft([
  0, 3.69, 0.586, 1.438, 1.886, 1.438, 1.886, 0, 5.606, 0.036, 5.949, 3.288, 12.464, 2.604, 13.037,
  8.071, 0, 8.071,
])

describe('dimension chains of real shop drafts', () => {
  const turned = (side: Point[]) => {
    const dir = (i: number) => {
      const [a, b] = [side[i] as Point, side[i + 1] as Point]
      return Math.atan2(b[1] - a[1], b[0] - a[0])
    }
    let sum = 0
    for (let i = 1; i + 1 < side.length; i++) {
      let d = dir(i) - dir(i - 1)
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      sum += d
    }
    return Math.abs((sum * 180) / Math.PI)
  }

  it('cuts store-0293’s 210° arc into three equal chains, not 90° + 90° + 30°', () => {
    // The 90° cap alone gave 3377, 3378 and a short 1171 at the end of the arc.
    const sides = boundarySides(STORE_0293.boundary)
    expect(sides.map((side) => side.length - 1)).toEqual([1, 20, 24, 21])
    for (const side of sides.slice(1)) {
      expect(turned(side)).toBeGreaterThan(65)
      expect(turned(side)).toBeLessThan(75)
    }
    expect(dimensionChains(STORE_0293, 0.6).map((d) => d.label)).toEqual([
      '4520',
      '2735',
      '2724',
      '2713',
    ])
  })

  it('keeps store-0043’s straight sides apart from its round corners', () => {
    // The first and last piece of each corner turn under 1° from the long side next to them.
    // They used to join it as "straight", pulling whole corners into the sides' chains (5772,
    // 7050, 5872, 1920); now each straight side and each corner has its own chain.
    expect(dimensionChains(STORE_0043, 0.6).map((d) => d.label)).toEqual([
      '4024',
      '2107',
      '5166',
      '2107',
      '4024',
      '2107',
      '5166',
      '2107',
    ])
  })

  it('leaves the corners of lease-line polylines alone: one side per edge', () => {
    expect(boundarySides(STORE_0088.boundary)).toHaveLength(16)
    expect(boundarySides(STORE_0001.boundary)).toHaveLength(9)
    expect(dimensionChains(STORE_0001, 0.6).map((d) => d.label)).toEqual([
      '2327',
      '1300',
      '1438',
      '3720',
      '3270',
      '6551',
      '5497',
      '13037',
      '4381',
    ])
  })
})
