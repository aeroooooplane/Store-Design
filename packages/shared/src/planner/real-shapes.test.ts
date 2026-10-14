// 回归样例：5 家真实门店的草稿边界（见 real-shapes.fixture.ts，未经用户核实，入口为补设）。
import { describe, expect, it } from 'vitest'
import { distanceToSegment, edges, interiorPoint, locatePoint } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import { itemFootprint } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { validateSpace } from '../schemas/space.ts'
import { defaultCameras } from '../scene/views.ts'
import { facingAfter } from './orientation.ts'
import { planLayout } from './planner.ts'
import type { GeneratedStrategy, PlannerCatalog } from './planner.ts'
import {
  REAL_SHAPES,
  baodingBeiguo,
  nanchangWushang,
  shanghaiTpy,
  shenyangBainaohui,
  venetianMacau,
} from './real-shapes.fixture.ts'
import type { RealShape } from './real-shapes.fixture.ts'

// Real catalogue sizes (资源库/04_模型库), as in planner.test.ts.
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
const CASES = REAL_SHAPES.map((shape) => [`${shape.source} ${shape.name}`, shape] as const)

const run = (shape: RealShape, strategy: GeneratedStrategy) =>
  planLayout({ space: shape.space, shopType: shape.shopType, strategy, catalog })
const byFunction = (items: LayoutItem[], fn: string) => items.filter((i) => i.function === fn)

/** The boundary edge a wall-standing prop (front +Z) has its back against. */
function backEdge(shape: RealShape, item: LayoutItem): [Point, Point] {
  const rect = itemFootprint(item)
  const [fx, fz] = facingAfter('+Z', item.rotation)
  const back: Point = [
    item.cx - (fx * (rect.maxX - rect.minX)) / 2,
    item.cz - (fz * (rect.maxZ - rect.minZ)) / 2,
  ]
  let best: [Point, Point] | null = null
  let gap = Infinity
  for (const [a, b] of edges(shape.space.boundary)) {
    const d = distanceToSegment(back, a, b)
    if (d < gap) [best, gap] = [[a, b], d]
  }
  // Within the wall gap of the shop type (0.05 m side hall, 0.3 m island).
  expect(gap).toBeLessThan(0.31)
  return best as [Point, Point]
}
const cashierEdge = (shape: RealShape) => {
  const [cashier] = byFunction(run(shape, 'area').layout.items, 'cashier')
  expect(cashier).toBeDefined()
  return backEdge(shape, cashier as LayoutItem)
}

describe('real shop drafts', () => {
  it.each(CASES)('%s：能建立空间', (_, shape) => {
    expect(validateSpace(shape.space).filter((i) => i.severity === 'error')).toEqual([])
    expect(shape.space.entrances).toHaveLength(1)
  })

  it.each(CASES)('%s：三种策略都没有越界、重叠等硬约束错误', (_, shape) => {
    for (const strategy of STRATEGIES) {
      const { issues } = run(shape, strategy)
      expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    }
  })

  it.each(CASES)('%s：内部点和默认视角的目标点都在店内', (_, shape) => {
    const ring = shape.space.boundary
    expect(locatePoint(interiorPoint(ring), ring)).toBe('inside')
    const cameras = defaultCameras(shape.space, shape.shopType)
    expect(cameras).toHaveLength(8)
    for (const camera of cameras)
      expect(locatePoint([camera.target[0], camera.target[2]], ring)).toBe('inside')
  })

  it('stands no 2.4 m cabinet along the edge of the island shops', () => {
    // store-0043、0239：只放中岛桌和收银台（目录里的配件柜都是 2.4 m 高柜），收银台仍靠入口对面的直边。
    for (const shape of [baodingBeiguo, shenyangBainaohui]) {
      for (const strategy of STRATEGIES) {
        const { layout, notes } = run(shape, strategy)
        expect(byFunction(layout.items, 'accessory_cabinet')).toEqual([])
        expect(byFunction(layout.items, 'cashier')).toHaveLength(1)
        expect(byFunction(layout.items, 'island_table').length).toBeGreaterThanOrEqual(1)
        expect(notes).toContain('中岛店不沿边界放高于 1.5 m 的柜子，未摆放配件柜')
      }
    }
  })

  it('places tables in every draft but the 11.7 ㎡ arc platform', () => {
    for (const shape of [baodingBeiguo, shenyangBainaohui, nanchangWushang, shanghaiTpy]) {
      for (const strategy of STRATEGIES) {
        const tables = byFunction(run(shape, strategy).layout.items, 'island_table')
        expect(tables.length).toBeGreaterThanOrEqual(1)
      }
    }
    // 已知问题（只记录，未修）：store-0293 唯一的直边是整条入口，弧上全是斜边，没有可贴墙的边；
    // 主通道和入口缓冲区占掉平台中部，两侧放不下 1 m 宽的桌子加通道（去掉入口时能放 1 张），三种策略都是空的。
    for (const strategy of STRATEGIES) {
      const { layout, notes } = run(venetianMacau, strategy)
      expect(layout.items).toEqual([])
      expect(notes).toContain('没有足够的墙面放收银台，请人工安排')
    }
  })

  it('takes the wall opposite the entrance as the back wall', () => {
    // store-0043：圆角矩形，入口在下边，收银台靠上边的直段。
    expect(cashierEdge(baodingBeiguo)).toEqual([
      [1.49, 0],
      [6.656, 0],
    ])
    // store-0239：入口在下边（两角倒圆的一侧），收银台靠 6.008 m 的上边。
    expect(cashierEdge(shenyangBainaohui)).toEqual([
      [0, 0],
      [6.008, 0],
    ])
    // store-0088：入口是约 4° 的斜底边，收银台靠 8.265 m 的上边。
    expect(cashierEdge(nanchangWushang)).toEqual([
      [0.01, 0],
      [8.275, 0],
    ])
  })

  it('store-0001: the 0.55° top edge counts as the back wall and takes the cashier', () => {
    // 上方 3720 mm 一段在草稿里斜了 0.55°（右端低 36 mm）：偏差 3° 以内按直墙处理，它是后墙，
    // 收银台和“尽量少放”唯一的配件柜都靠它。约 6° 的 6551 mm 一段仍不放靠墙道具。
    const top: [Point, Point] = [
      [1.886, 0],
      [5.606, 0.036],
    ]
    expect(cashierEdge(shanghaiTpy)).toEqual(top)
    const [cabinet] = byFunction(run(shanghaiTpy, 'min').layout.items, 'accessory_cabinet')
    expect(cabinet).toBeDefined()
    expect(backEdge(shanghaiTpy, cabinet as LayoutItem)).toEqual(top)
    // Props stand square to the x axis with the wall gap taken from the lower right end of the
    // edge, so none reaches over the slanted wall (to within the millimetre centres round to).
    for (const strategy of STRATEGIES) {
      for (const item of run(shanghaiTpy, strategy).layout.items) {
        const rect = itemFootprint(item)
        if (rect.minZ > 1) continue
        expect(Math.abs(rect.minZ - (0.036 + 0.05))).toBeLessThanOrEqual(0.001)
        const corners: Point[] = [
          [rect.minX, rect.minZ],
          [rect.maxX, rect.minZ],
        ]
        for (const corner of corners)
          expect(distanceToSegment(corner, ...top)).toBeGreaterThanOrEqual(0.05 - 0.001)
      }
    }
  })
})
