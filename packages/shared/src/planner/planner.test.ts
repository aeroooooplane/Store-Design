import { describe, expect, it } from 'vitest'
import { rectFromCenter, rectGap, rectsOverlap } from '../geometry/index.ts'
import { itemFootprint } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { SpaceSchema, rectangleSpace } from '../schemas/space.ts'
import type { SpaceInput } from '../schemas/space.ts'
import { facingAfter, rotationFacing } from './orientation.ts'
import { planLayout, tablesForArea } from './planner.ts'
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
