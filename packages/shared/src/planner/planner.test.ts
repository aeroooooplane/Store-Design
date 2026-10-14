import { describe, expect, it } from 'vitest'
import type { ShopType } from '../enums.ts'
import { polygonOverlapsRect, rectFromCenter, rectGap, rectsOverlap } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import { itemFootprint } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { SpaceSchema, rectangleSpace } from '../schemas/space.ts'
import type { Space, SpaceInput } from '../schemas/space.ts'
import { facingAfter, rotationFacing } from './orientation.ts'
import { planLayout, tablesForArea, usableArea } from './planner.ts'
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
