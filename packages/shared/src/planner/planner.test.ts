import { describe, expect, it } from 'vitest'
import type { ShopType } from '../enums.ts'
import {
  boundaryPath,
  distanceToSegment,
  edges,
  locatePoint,
  pathMidpoint,
  polygonOverlapsRect,
  rectCorners,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  toClockwise,
} from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import { itemFootprint } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { SpaceSchema, rectangleSpace } from '../schemas/space.ts'
import type { Space, SpaceInput } from '../schemas/space.ts'
import { facingAfter, rotationFacing } from './orientation.ts'
import {
  DEFAULT_RULES,
  ISLAND_CABINET_MAX_H,
  ISLAND_SIDE_CABINETS,
  planLayout,
  sideCabinetsForArea,
  tablesForArea,
  usableArea,
} from './planner.ts'
import {
  ARC,
  IRREGULAR_SHAPES,
  arcFront,
  chamfer,
  concave,
  lShape as lShop,
  trapezoid,
} from './shapes.fixture.ts'
import type { GeneratedStrategy, PlannerCatalog } from './planner.ts'

// Real catalogue sizes (资源库/04_模型库).
const catalog: PlannerCatalog = {
  island: [
    {
      id: 'asset-408124',
      name: '1800mm普通中岛桌',
      function: 'island_table',
      footprint: { w: 1, d: 1.8, h: 1.327 },
      front: 'any',
    },
  ],
  cashier: [
    {
      id: 'asset-24432224',
      name: '1.8米收银桌(左)',
      function: 'cashier',
      footprint: { w: 1.8, d: 0.603, h: 1.205 },
      front: '+Z',
    },
  ],
  cabinet: [
    {
      id: 'asset-2595882',
      name: '1200mm配件柜',
      function: 'accessory_cabinet',
      footprint: { w: 1.2, d: 0.45, h: 2.4 },
      front: '+Z',
    },
    {
      id: 'asset-323015',
      name: '1600mm配件柜',
      function: 'accessory_cabinet',
      footprint: { w: 1.6, d: 0.45, h: 2.4 },
      front: '+Z',
    },
  ],
}
const STRATEGIES: GeneratedStrategy[] = ['max', 'area', 'min']

const space = (input: SpaceInput) => SpaceSchema.parse(input)
const lShape = space({
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [10, 0],
    [10, 4],
    [5, 4],
    [5, 9],
    [0, 9],
  ],
  height: 3.2,
  entrances: [{ a: [1, 9], b: [4, 9], kind: 'main' }],
})
const uShape = space({
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [12, 0],
    [12, 8],
    [8, 8],
    [8, 3],
    [4, 3],
    [4, 8],
    [0, 8],
  ],
  height: 3.5,
  entrances: [{ a: [9, 8], b: [11, 8], kind: 'main' }],
})
const withColumn = space({
  ...rectangleSpace(9, 7, 3.2),
  obstacles: [
    {
      kind: 'column',
      polygon: [
        [4.3, 3.3],
        [4.8, 3.3],
        [4.8, 3.8],
        [4.3, 3.8],
      ],
      label: '柱',
    },
  ],
})

const byFunction = (items: LayoutItem[], fn: string) => items.filter((i) => i.function === fn)

describe('orientation', () => {
  it('follows the legacy quarter-turn convention (+Z turns to −X)', () => {
    expect(facingAfter('+Z', 0)).toEqual([0, 1])
    expect(facingAfter('+Z', 90)).toEqual([-1, 0])
    expect(facingAfter('+Z', 180)).toEqual([0, -1])
    expect(facingAfter('+X', 90)).toEqual([0, 1])
    expect(rotationFacing('+Z', [1, 0])).toBe(270)
    expect(rotationFacing('any', [1, 0])).toBeNull()
  })
})

describe('planLayout', () => {
  it.each([
    ['8×6 矩形', rectangleSpace(8, 6, 3.2)],
    ['L 形', lShape],
    ['U 形', uShape],
    ['带柱子', withColumn],
  ])('%s：三种策略都没有硬约束错误', (_, s) => {
    for (const strategy of STRATEGIES) {
      const { layout, issues } = planLayout({ space: s, shopType: 'side_hall', strategy, catalog })
      expect(issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(byFunction(layout.items, 'island_table').length).toBeGreaterThanOrEqual(1)
    }
  })

  it('orders the strategies by table count and records the request', () => {
    const tables = (strategy: GeneratedStrategy) =>
      planLayout({ space: uShape, shopType: 'side_hall', strategy, catalog }).layout
    const max = tables('max')
    const area = tables('area')
    const min = tables('min')
    expect(byFunction(max.items, 'island_table').length).toBeGreaterThanOrEqual(
      byFunction(area.items, 'island_table').length,
    )
    expect(byFunction(min.items, 'island_table')).toHaveLength(1)
    expect(area.planning).toMatchObject({
      strategy: 'area',
      requested: tablesForArea(12 * 8 - 4 * 5),
    })
    expect(byFunction(min.items, 'accessory_cabinet').length).toBeLessThanOrEqual(1)
  })

  it('puts the cashier against the back wall, facing into the room', () => {
    const { layout } = planLayout({
      space: rectangleSpace(8, 6, 3.2),
      shopType: 'side_hall',
      strategy: 'area',
      catalog,
    })
    const [cashier] = byFunction(layout.items, 'cashier')
    // The entrance is the front edge (z = 6), so the back wall is z = 0 and "into the room" is +Z.
    expect(cashier).toMatchObject({ rotation: 0, w: 1.8, d: 0.603 })
    expect(cashier?.cz).toBeCloseTo(0.05 + 0.603 / 2, 2)
  })

  it('keeps island tables out of the entrance buffer and the main aisle, with walkways around them', () => {
    const s = rectangleSpace(10, 8, 3.2)
    const { layout } = planLayout({ space: s, shopType: 'side_hall', strategy: 'max', catalog })
    const islands = byFunction(layout.items, 'island_table')
    const buffer = { minX: 0, minZ: 8 - 1.2, maxX: 10, maxZ: 8 }
    const aisle = { minX: 5 - 0.6, minZ: 0, maxX: 5 + 0.6, maxZ: 8 }
    for (const island of islands) {
      const rect = itemFootprint(island)
      expect(rectsOverlap(rect, buffer)).toBe(false)
      expect(rectsOverlap(rect, aisle)).toBe(false)
      for (const other of layout.items.filter((i) => i.id !== island.id)) {
        expect(rectGap(rect, itemFootprint(other))).toBeGreaterThanOrEqual(0.9 - 1e-6)
      }
    }
    expect(layout.planning?.relaxations).toEqual([])
  })

  it('relaxes guide values one step at a time in a tight space and says so', () => {
    const tight = rectangleSpace(4.5, 4.2, 3)
    const { layout, issues } = planLayout({
      space: tight,
      shopType: 'side_hall',
      strategy: 'min',
      catalog,
    })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(layout.planning?.relaxations.length).toBeGreaterThan(0)
    expect(layout.planning?.note).toContain('已让步')
  })

  it('reports when even relaxed rules cannot fit a table', () => {
    const closet = rectangleSpace(3, 2.5, 3)
    const { layout, notes } = planLayout({
      space: closet,
      shopType: 'side_hall',
      strategy: 'area',
      catalog,
    })
    expect(byFunction(layout.items, 'island_table')).toHaveLength(0)
    expect(notes.join()).toContain('只放下 0 / 1 张中岛桌')
  })

  it('skips models taller than the ceiling', () => {
    const low = rectangleSpace(8, 6, 2.3)
    const { layout, notes } = planLayout({
      space: low,
      shopType: 'side_hall',
      strategy: 'max',
      catalog,
    })
    expect(byFunction(layout.items, 'accessory_cabinet')).toHaveLength(0)
    expect(notes).toContain('配件柜均高于层高，未摆放')
  })

  it('never puts props over obstacles or entrances, and is deterministic', () => {
    const first = planLayout({ space: withColumn, shopType: 'side_hall', strategy: 'max', catalog })
    const second = planLayout({
      space: withColumn,
      shopType: 'side_hall',
      strategy: 'max',
      catalog,
    })
    expect(second.layout).toEqual(first.layout)
    const column = rectFromCenter(4.55, 3.55, 0.5, 0.5)
    for (const item of first.layout.items)
      expect(rectsOverlap(itemFootprint(item), column)).toBe(false)
  })

  it('treats an entrance along an arc storefront as one entrance, keeping every piece clear', () => {
    const wholeArc = space({
      ...arcFront,
      entrances: [{ a: [...ARC[0]], b: [...ARC[8]], kind: 'main' }],
      openEdges: [],
    })
    for (const s of [arcFront, wholeArc]) {
      for (const strategy of STRATEGIES) {
        const { layout, issues } = planLayout({
          space: s,
          shopType: 'side_hall',
          strategy,
          catalog,
        })
        expect(issues.filter((i) => i.severity === 'error')).toEqual([])
        // One main aisle, centred on the middle of the arc (x = 5) and running straight back.
        const aisle = { minX: 5 - 0.6, minZ: 0, maxX: 5 + 0.6, maxZ: 8 }
        for (const island of byFunction(layout.items, 'island_table'))
          expect(rectsOverlap(itemFootprint(island), aisle)).toBe(false)
      }
    }
    // The chord (z = 7) no longer blocks the floor behind the arc: more tables than the 4 before.
    const max = planLayout({ space: wholeArc, shopType: 'side_hall', strategy: 'max', catalog })
    expect(byFunction(max.layout.items, 'island_table').length).toBeGreaterThan(4)
  })

  it('works for an island shop without any entrance and notes it', () => {
    const noEntrance = space({
      schemaVersion: 1,
      boundary: rectangleSpace(7, 5, 3).boundary.map(([x, z]): [number, number] => [x, z]),
      height: 3,
    })
    const { layout, notes, issues } = planLayout({
      space: noEntrance,
      shopType: 'island',
      strategy: 'area',
      catalog,
    })
    expect(notes).toContain('空间没有入口，未预留入口缓冲与主通道')
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(byFunction(layout.items, 'island_table').length).toBeGreaterThanOrEqual(1)
  })

  describe('cabinets along the edge of an island shop', () => {
    // The 1.8 m 配件边柜 (H 1.3 m) of the real catalogue next to the 2.4 m 配件柜.
    const low = {
      id: 'asset-28192911',
      name: '1.8米配件边柜(H1.3米)',
      function: 'side_cabinet',
      footprint: { w: 1.8, d: 0.721, h: 1.3 },
      front: '+Z',
    } as const
    const mixed: PlannerCatalog = { ...catalog, cabinet: [...catalog.cabinet, low] }
    const shapes: [string, Space][] = [
      ['10×8 矩形', rectangleSpace(10, 8, 3.2)],
      ['U 形', uShape],
      ['带柱子', withColumn],
      ...Object.entries(IRREGULAR_SHAPES),
    ]
    const cabinetsOf = (items: LayoutItem[]) =>
      items.filter((i) => i.function === 'accessory_cabinet' || i.function === 'side_cabinet')

    it.each(shapes)(
      '%s：三种策略都不沿边界放高于 1.5 m 的柜子，矮柜不超过按面积的个数',
      (name, s) => {
        expect(DEFAULT_RULES.island.cabinetMaxHeight).toBe(ISLAND_CABINET_MAX_H)
        for (const strategy of STRATEGIES) {
          const { layout, issues, notes } = planLayout({
            space: s,
            shopType: 'island',
            strategy,
            catalog: mixed,
          })
          expect(issues.filter((i) => i.severity === 'error')).toEqual([])
          const cabinets = cabinetsOf(layout.items)
          for (const item of cabinets) expect(item.h).toBeLessThanOrEqual(ISLAND_CABINET_MAX_H)
          // A low cabinet in the cabinet list counts as a side cabinet: a few at most, by area.
          expect(cabinets.length).toBeLessThanOrEqual(sideCabinetsForArea(usableArea(s), strategy))
          if (name === '10×8 矩形') expect(cabinets.length).toBeGreaterThan(0)
          expect(notes).toContain('中岛店不沿边界放高于 1.5 m 的柜子')
          // The cashier still stands against the back of the shop.
          expect(byFunction(layout.items, 'cashier')).toHaveLength(1)
        }
      },
    )

    it('leaves the cabinets out and says so when the catalogue has only tall ones', () => {
      for (const strategy of STRATEGIES) {
        const { layout, notes } = planLayout({
          space: rectangleSpace(10, 8, 3.2),
          shopType: 'island',
          strategy,
          catalog,
        })
        expect(cabinetsOf(layout.items)).toEqual([])
        expect(notes).toContain('中岛店不沿边界放高于 1.5 m 的柜子，未摆放配件柜')
      }
    })

    it('still lines the walls of a side-hall shop or a zone with tall cabinets', () => {
      for (const shopType of ['side_hall', 'zone'] as const) {
        const { layout, notes } = planLayout({
          space: rectangleSpace(10, 8, 3.2),
          shopType,
          strategy: 'max',
          catalog: mixed,
        })
        expect(cabinetsOf(layout.items).some((i) => i.h > ISLAND_CABINET_MAX_H)).toBe(true)
        expect(notes.join()).not.toContain('不沿边界放')
      }
    })
  })
})

describe('planLayout on irregular shops', () => {
  const run = (s: Space, strategy: GeneratedStrategy, shopType: ShopType = 'side_hall') =>
    planLayout({ space: s, shopType, strategy, catalog })
  const cashierOf = (s: Space) => byFunction(run(s, 'area').layout.items, 'cashier')[0]
  /** A strip from `a`–`b` reaching `depth` along `n`. */
  const strip = (a: Point, b: Point, n: Point, depth: number): Point[] => [
    a,
    b,
    [b[0] + n[0] * depth, b[1] + n[1] * depth],
    [a[0] + n[0] * depth, a[1] + n[1] * depth],
  ]

  it.each(Object.entries(IRREGULAR_SHAPES))(
    '%s：三种店型、三种策略都没有越界、重叠等硬约束错误',
    (_, s) => {
      for (const shopType of ['side_hall', 'island', 'zone'] as const) {
        for (const strategy of STRATEGIES) {
          const { layout, issues } = run(s, strategy, shopType)
          expect(issues.filter((i) => i.severity === 'error')).toEqual([])
          expect(byFunction(layout.items, 'island_table').length).toBeGreaterThanOrEqual(1)
        }
      }
    },
  )

  it('takes the back wall farthest along the main entrance’s inward normal', () => {
    // L shape: the 10 m wall at the back (z = 0), not the far right-hand wall of the other leg.
    expect(cashierOf(lShop)).toMatchObject({ rotation: 0 })
    expect(cashierOf(lShop)?.cz).toBeCloseTo(0.05 + 0.603 / 2, 2)
    // Concave back: the face of the block (z = 3), not one of the 2 m arms behind it.
    expect(cashierOf(concave)).toMatchObject({ rotation: 0 })
    expect(cashierOf(concave)?.cz).toBeCloseTo(3 + 0.05 + 0.603 / 2, 2)
    // Trapezoid and arc front: the straight back wall.
    for (const s of [trapezoid, arcFront]) expect(cashierOf(s)?.cz).toBeCloseTo(0.352, 2)
    // Entrance on the cut corner: the left wall lies deeper along the diagonal than the top one.
    expect(cashierOf(chamfer)).toMatchObject({ rotation: 270 })
    expect(cashierOf(chamfer)?.cx).toBeCloseTo(0.05 + 0.603 / 2, 2)
    // A long rectangle entered from its long side: the opposite long wall, not an end wall.
    const long = space({
      ...rectangleSpace(6, 15, 3.2),
      entrances: [{ a: [0, 3], b: [0, 10.5], kind: 'main' }],
    })
    expect(cashierOf(long)).toMatchObject({ rotation: 90 })
    expect(cashierOf(long)?.cx).toBeCloseTo(6 - 0.05 - 0.603 / 2, 2)
  })

  it('treats an edge within 3° of an axis as a wall along it, clear of the edge at its inner end', () => {
    // The back wall drops 0.35 m over 9.7 m (2.1°), the left wall leans 0.3 m over 8 m (2.1°).
    const askew = space({
      ...rectangleSpace(10, 8, 3.2),
      boundary: [
        [0.3, 0],
        [10, 0.35],
        [10, 8],
        [0, 8],
      ],
    })
    expect(cashierOf(askew)).toMatchObject({ rotation: 0 })
    // Square to the axis, the wall gap taken from the end of the edge farther into the room (to
    // within the millimetre the centres round to).
    const near = (value: number, target: number) =>
      expect(Math.abs(value - target)).toBeLessThanOrEqual(0.001)
    for (const strategy of STRATEGIES) {
      const { layout, issues } = run(askew, strategy)
      expect(issues).toEqual([])
      const back = layout.items.filter((i) => itemFootprint(i).minZ < 0.8)
      const left = layout.items.filter((i) => itemFootprint(i).minX < 0.8 && !back.includes(i))
      expect(back.length).toBeGreaterThan(0)
      for (const item of back) near(itemFootprint(item).minZ, 0.35 + 0.05)
      for (const item of left) near(itemFootprint(item).minX, 0.3 + 0.05)
      if (strategy === 'max') expect(left.length).toBeGreaterThan(0)
    }
    // At 4° the back wall is a slanted wall: nothing stands against it.
    const steeper = space({
      ...rectangleSpace(10, 8, 3.2),
      boundary: [
        [0, 0],
        [10, 0.7],
        [10, 8],
        [0, 8],
      ],
    })
    expect(cashierOf(steeper)?.rotation).not.toBe(0)
  })

  it('puts nothing against an open edge', () => {
    const open = space({
      ...rectangleSpace(10, 8, 3.2),
      openEdges: [
        { a: [0, 8], b: [0, 0] },
        { a: [10, 1.6], b: [10, 4.8] },
      ],
    })
    for (const strategy of STRATEGIES) {
      const { layout, issues } = run(open, strategy)
      expect(issues).toEqual([])
      for (const item of layout.items) {
        const rect = itemFootprint(item)
        // Only props standing against the back or front wall may reach into the left corners.
        if (rect.minX < 0.1) expect(rect.minZ < 0.1 || rect.maxZ > 7.9).toBe(true)
        if (rect.maxX > 9.9) expect(rect.maxZ <= 1.6 || rect.minZ >= 4.8).toBe(true)
      }
    }
    // The rest of the right-hand wall still takes cabinets.
    const max = run(open, 'max').layout.items
    expect(max.some((i) => i.function === 'accessory_cabinet' && itemFootprint(i).maxX > 9.9)).toBe(
      true,
    )
  })

  it('keeps a slanting strip clear inside a slanting entrance, not its bounding box', () => {
    // Entrance on the cut corner: the old bounding boxes of the diagonal aisle and buffer covered
    // the whole floor, so not one table fitted even with every guide value relaxed.
    const { layout } = run(chamfer, 'area')
    expect(layout.planning).toMatchObject({ requested: 4, placed: 4, relaxations: [] })
    const n: Point = [-Math.SQRT1_2, -Math.SQRT1_2]
    const side: Point = [Math.SQRT1_2, -Math.SQRT1_2]
    const aisle = strip(
      [9 + side[0] * 0.6, 7 + side[1] * 0.6],
      [9 - side[0] * 0.6, 7 - side[1] * 0.6],
      n,
      12,
    )
    const buffer = strip([8, 8], [10, 6], n, 1.2)
    for (const table of byFunction(layout.items, 'island_table')) {
      expect(polygonOverlapsRect(aisle, itemFootprint(table))).toBe(false)
      expect(polygonOverlapsRect(buffer, itemFootprint(table))).toBe(false)
    }
    // A side door in the trapezoid's slanting wall keeps its own slanting buffer clear.
    const len = Math.hypot(2, 8)
    const inward: Point = [-8 / len, 2 / len]
    const door = strip([8.5, 2], [9.5, 6], inward, 1.2)
    for (const strategy of STRATEGIES) {
      for (const item of run(trapezoid, strategy).layout.items)
        expect(polygonOverlapsRect(door, itemFootprint(item))).toBe(false)
    }
  })

  it('does not count narrow arms or slivers towards the 按面积推荐 table count', () => {
    // Narrower than a 1 m table with 0.6 m (the tightest walkway) on both sides.
    expect(usableArea(concave, 2.2)).toBeCloseTo(50, 6)
    expect(usableArea(trapezoid, 2.2)).toBeGreaterThan(71)
    expect(usableArea(trapezoid, 2.2)).toBeLessThan(72)
    expect(usableArea(rectangleSpace(10, 8, 3.2), 2.2)).toBe(80)
    expect(usableArea(rectangleSpace(2, 20, 3.2), 2.2)).toBe(0)
    expect(usableArea(withColumn, 2.2)).toBe(usableArea(withColumn))

    // The concave shop asks for as many tables as the 10 × 5 m floor in front of the block, and
    // they fit without relaxing anything; it used to ask for 3 counting the two 2 × 3 m arms.
    const concaveArea = run(concave, 'area')
    const front = run(rectangleSpace(10, 5, 3.2), 'area')
    expect(concaveArea.layout.planning).toMatchObject({
      requested: front.layout.planning?.requested,
      placed: front.layout.planning?.requested,
      relaxations: [],
    })
    expect(concaveArea.notes).toContain('桌数按面积推荐时未计入约 12 ㎡ 狭窄区域')
    // The trapezoid's target fits as well, and 尽量多放 shows at least as many.
    const trapezoidArea = run(trapezoid, 'area').layout.planning
    expect(trapezoidArea).toMatchObject({ requested: 4, placed: 4, relaxations: [] })
    for (const s of [concave, trapezoid]) {
      const max = run(s, 'max').layout.planning
      expect(max?.relaxations).toEqual([])
      expect(max?.placed).toBeGreaterThanOrEqual(run(s, 'area').layout.planning?.requested ?? 0)
    }
  })
})

describe('side cabinets along the edge of an island shop', () => {
  // 配件边柜 of the real catalogue: SI1.0 1.8米边桌配件柜 (front +X) and SI2.0 1.8米配件边柜(带托盘).
  const si1Side = {
    id: 'asset-34320268',
    name: '1.8米边桌配件柜',
    function: 'side_cabinet',
    footprint: { w: 0.5, d: 1.8, h: 1.214 },
    front: '+X',
  } as const
  const si2Side = {
    id: 'asset-33660153',
    name: '1.8米配件边柜(带托盘)',
    function: 'side_cabinet',
    footprint: { w: 1.8, d: 0.531, h: 1.214 },
    front: '+Z',
  } as const
  const withSide: PlannerCatalog = { ...catalog, sideCabinet: [si1Side] }
  const withSi2Side: PlannerCatalog = { ...catalog, sideCabinet: [si2Side] }
  const plan = (
    s: Space,
    strategy: GeneratedStrategy,
    cat: PlannerCatalog = withSide,
    shopType: ShopType = 'island',
  ) => planLayout({ space: s, shopType, strategy, catalog: cat })
  const sidesOf = (items: LayoutItem[]) => byFunction(items, 'side_cabinet')
  const fronts: Record<string, '+X' | '+Z'> = { [si1Side.id]: '+X', [si2Side.id]: '+Z' }

  const strip = (a: Point, b: Point, n: Point, depth: number): Point[] => [
    a,
    b,
    [b[0] + n[0] * depth, b[1] + n[1] * depth],
    [a[0] + n[0] * depth, a[1] + n[1] * depth],
  ]
  /** Inward normal of a boundary piece: the side its midpoint moves into the shop. */
  const pieceNormal = (s: Space, a: Point, b: Point): Point => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: Point = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
    const probe: Point = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01]
    return locatePoint(probe, s.boundary) === 'inside' ? n : [-n[0], -n[1]]
  }
  const piecesOf = (s: Space, a: Point, b: Point) =>
    boundaryPath(toClockwise(s.boundary), a, b, 0.02) ?? []
  /** The main entrance's midpoint and inward direction, as the planner takes them. */
  const mainOf = (s: Space) => {
    const entrance = s.entrances.find((e) => e.kind === 'main') ?? s.entrances[0]
    if (!entrance) throw new Error('no entrance')
    const pieces = piecesOf(s, entrance.a, entrance.b)
    const sum = pieces.reduce<Point>(
      (acc, p) => {
        const n = pieceNormal(s, p.a, p.b)
        const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1])
        return [acc[0] + n[0] * len, acc[1] + n[1] * len]
      },
      [0, 0],
    )
    const len = Math.hypot(sum[0], sum[1])
    return { mid: pathMidpoint(pieces) as Point, n: [sum[0] / len, sum[1] / len] as Point }
  }
  /** Entrance buffers (1 m) and the 1.2 m main aisle of an island shop. */
  const keepOuts = (s: Space): Point[][] => {
    const buffers = s.entrances.flatMap((e) =>
      piecesOf(s, e.a, e.b).map((p) => strip(p.a, p.b, pieceNormal(s, p.a, p.b), 1)),
    )
    const { mid, n } = mainOf(s)
    const side: Point = [-n[1], n[0]]
    const at = (k: number): Point => [mid[0] + side[0] * k, mid[1] + side[1] * k]
    return [...buffers, strip(at(0.6), at(-0.6), n, 100)]
  }

  it('asks for one per 25 ㎡ from 20 ㎡, three at most, and at most 3 / 2 / 1 by strategy', () => {
    expect(ISLAND_SIDE_CABINETS).toMatchObject({
      minArea: 20,
      areaPerCabinet: 25,
      maxCount: 3,
      strategyMax: { max: 3, area: 2, min: 1 },
    })
    const counts = (area: number) => STRATEGIES.map((s) => sideCabinetsForArea(area, s))
    expect(counts(15)).toEqual([0, 0, 0])
    expect(counts(19.9)).toEqual([0, 0, 0])
    expect(counts(20)).toEqual([1, 1, 1])
    expect(counts(30)).toEqual([1, 1, 1])
    expect(counts(49.9)).toEqual([1, 1, 1])
    expect(counts(60)).toEqual([2, 2, 1])
    expect(counts(120)).toEqual([3, 2, 1])
    expect(counts(500)).toEqual([3, 2, 1])
  })

  it.each([
    [15, rectangleSpace(5, 3, 3.2), [0, 0, 0], '中岛店面积 15 ㎡，不足 20 ㎡，不放配件边柜'],
    [
      30,
      rectangleSpace(6, 5, 3.2),
      [1, 1, 1],
      '中岛店按面积 30 ㎡ 放 1 个配件边柜（每 25 ㎡ 1 个，最多 3 个）',
    ],
    [
      60,
      rectangleSpace(10, 6, 3.2),
      [2, 2, 1],
      '中岛店按面积 60 ㎡ 放 2 个配件边柜（每 25 ㎡ 1 个，最多 3 个）',
    ],
    [
      120,
      rectangleSpace(12, 10, 3.2),
      [3, 2, 1],
      '中岛店按面积 120 ㎡ 放 3 个配件边柜（每 25 ㎡ 1 个，最多 3 个）',
    ],
  ])(
    '%s ㎡ 的中岛店：尽量多放、按面积推荐、尽量少放的个数符合规则，说明写明依据',
    (_, s, expected, note) => {
      const counts = STRATEGIES.map((strategy) => sidesOf(plan(s, strategy).layout.items).length)
      expect(counts).toEqual(expected)
      expect(plan(s, 'max').notes).toContain(note)
    },
    30_000,
  )

  it('names the strategy cap and the shortfall in the note', () => {
    expect(plan(rectangleSpace(12, 10, 3.2), 'area').notes).toContain(
      '中岛店按面积 120 ㎡ 放 2 个配件边柜（每 25 ㎡ 1 个，最多 3 个；按面积推荐最多 2 个）',
    )
    expect(plan(rectangleSpace(12, 10, 3.2), 'min').notes).toContain(
      '中岛店按面积 120 ㎡ 放 1 个配件边柜（每 25 ㎡ 1 个，最多 3 个；尽量少放最多 1 个）',
    )
    // With the SI2.0 table 尽量多放 fills the floor of 120 ㎡: tables first, no edge left.
    const si2: PlannerCatalog = {
      ...withSi2Side,
      island: [
        {
          id: 'asset-2',
          name: '1.8米普通中岛桌',
          function: 'island_table',
          footprint: { w: 1.8, d: 0.804, h: 1.214 },
          front: '+Z',
        },
      ],
    }
    const { layout, notes } = plan(rectangleSpace(12, 10, 3.2), 'max', si2)
    expect(sidesOf(layout.items)).toEqual([])
    expect(notes).toContain(
      '中岛店按面积 120 ㎡ 应放 3 个配件边柜（每 25 ㎡ 1 个，最多 3 个），中岛桌优先，边缘空间只放下 0 个',
    )
  }, 30_000)

  const cases: [string, Space][] = [
    ['10×8 整面入口', rectangleSpace(10, 8, 3.2)],
    [
      '12×10 正面中段入口',
      space({
        ...rectangleSpace(12, 10, 3.2),
        entrances: [{ a: [4.5, 10], b: [7.5, 10], kind: 'main' }],
      }),
    ],
    [
      '12×10 右侧加侧门',
      space({
        ...rectangleSpace(12, 10, 3.2),
        entrances: [
          { a: [1, 10], b: [11, 10], kind: 'main' },
          { a: [12, 2], b: [12, 4], kind: 'side' },
        ],
      }),
    ],
    [
      '10×8 左侧入口',
      space({
        ...rectangleSpace(10, 8, 3.2),
        entrances: [{ a: [0, 1], b: [0, 7], kind: 'main' }],
      }),
    ],
    [
      '10×8 左侧开放',
      space({ ...rectangleSpace(10, 8, 3.2), openEdges: [{ a: [0, 8], b: [0, 0] }] }),
    ],
    ['6×5', rectangleSpace(6, 5, 3.2)],
    ['带柱子', withColumn],
    ['U 形', uShape],
    ...Object.entries(IRREGULAR_SHAPES),
  ]

  // Planning is slow on a busy machine: these run a dozen plans each.
  it.each(cases)(
    '%s：中岛桌数与不放边柜时相同；边柜不在入口边、开放边、主通道和入口缓冲区里，朝向店内，留足间距',
    (_, s) => {
      const { mid, n } = mainOf(s)
      const depthOf = (p: Point) => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1]
      const depths = s.boundary.map(depthOf)
      const half = (Math.min(...depths) + Math.max(...depths)) / 2
      const zones = keepOuts(s)
      const open = [
        ...s.entrances.flatMap((e) => piecesOf(s, e.a, e.b)),
        ...s.openEdges.flatMap((e) => piecesOf(s, e.a, e.b)),
      ]
      let seen = 0
      for (const strategy of STRATEGIES) {
        const tables = byFunction(plan(s, strategy, catalog).layout.items, 'island_table').length
        for (const cat of [withSide, withSi2Side]) {
          const { layout, issues } = plan(s, strategy, cat)
          expect(issues.filter((i) => i.severity === 'error')).toEqual([])
          expect(byFunction(layout.items, 'island_table')).toHaveLength(tables)
          const sides = sidesOf(layout.items)
          seen += sides.length
          expect(sides.length).toBeLessThanOrEqual(sideCabinetsForArea(usableArea(s), strategy))
          for (const item of sides) {
            const rect = itemFootprint(item)
            // 0.3 m (wallGap) clear of the whole boundary, to the millimetre centres round to.
            expect(rectInsidePolygon(rect, s.boundary)).toBe(true)
            const toRect = (p: Point) =>
              Math.hypot(
                Math.max(rect.minX - p[0], 0, p[0] - rect.maxX),
                Math.max(rect.minZ - p[1], 0, p[1] - rect.maxZ),
              )
            for (const [a, b] of edges(s.boundary)) {
              const gap = Math.min(
                toRect(a),
                toRect(b),
                ...rectCorners(rect).map((c) => distanceToSegment(c, a, b)),
              )
              expect(gap).toBeGreaterThanOrEqual(0.3 - 0.002)
            }
            for (const zone of zones) expect(polygonOverlapsRect(zone, rect)).toBe(false)
            for (const other of layout.items.filter((i) => i.id !== item.id)) {
              const otherRect = itemFootprint(other)
              if (other.function === 'island_table')
                expect(rectGap(rect, otherRect)).toBeGreaterThanOrEqual(0.9 - 1e-6)
              else expect(rectsOverlap(rect, otherRect)).toBe(false)
            }
            // Its back stands 0.3 m off a wall, not an entrance or open edge; its front faces in.
            const facing = facingAfter(fronts[item.assetId ?? ''] ?? '+Z', item.rotation)
            const depth = facing[0] ? rect.maxX - rect.minX : rect.maxZ - rect.minZ
            const back: Point = [
              item.cx - (facing[0] * depth) / 2,
              item.cz - (facing[1] * depth) / 2,
            ]
            const nearest = Math.min(
              ...edges(s.boundary).map(([a, b]) => distanceToSegment(back, a, b)),
            )
            expect(nearest).toBeGreaterThan(0.29)
            expect(nearest).toBeLessThan(0.31)
            for (const piece of open)
              expect(distanceToSegment(back, piece.a, piece.b)).toBeGreaterThan(0.35)
            // On the side facing the main entrance, or in the back half of a side.
            const along = facing[0] * n[0] + facing[1] * n[1]
            if (along > -0.5) {
              expect(Math.abs(along)).toBeLessThan(0.5)
              for (const corner of rectCorners(rect))
                expect(depthOf(corner)).toBeGreaterThanOrEqual(half - 1e-6)
            }
          }
        }
      }
      expect(seen).toBeGreaterThan(0)
    },
    30_000,
  )

  it('stands them only on the side facing the main entrance when three or more sides are open', () => {
    // 8 × 14 m, the whole front an entrance; open edges along the front part of both sides.
    const shop = (openTo: number) =>
      space({
        ...rectangleSpace(8, 14, 3.2),
        openEdges: [
          { a: [0, 14], b: [0, openTo] },
          { a: [8, openTo], b: [8, 14] },
        ],
      })
    // 8 of 14 m open on each side (57 %): the front and both sides are open.
    const open = plan(shop(6), 'area')
    const sides = sidesOf(open.layout.items)
    expect(sides.length).toBeGreaterThan(0)
    for (const item of sides) {
      expect(facingAfter('+X', item.rotation)).toEqual([0, 1])
      expect(itemFootprint(item).minZ).toBeCloseTo(0.3, 2)
    }
    expect(open.notes.join()).toContain('3 面以上开敞，只放在正对主入口的一侧')
    // 4 of 14 m (29 %): only the front is open, and the back half of a side takes one as well.
    const partly = sidesOf(plan(shop(10), 'area').layout.items)
    expect(partly.length).toBeGreaterThan(sides.length)
    expect(partly.some((item) => facingAfter('+X', item.rotation)[1] === 0)).toBe(true)
  })

  it('leaves side-hall shops and zones exactly as before', () => {
    for (const shopType of ['side_hall', 'zone'] as const) {
      // The whole run over 9 180 plans is compared outside the tests; here two shapes.
      for (const s of [rectangleSpace(10, 8, 3.2), IRREGULAR_SHAPES.arcFront]) {
        for (const strategy of STRATEGIES) {
          expect(plan(s, strategy, withSide, shopType)).toEqual(
            plan(s, strategy, catalog, shopType),
          )
        }
      }
    }
  }, 30_000)
})
