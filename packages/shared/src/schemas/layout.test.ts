import { describe, expect, it } from 'vitest'
import {
  LayoutSchema,
  assetFitProblem,
  checkAssetFit,
  fitBodyFootprints,
  modelBox,
  turnOffset,
  validateLayout,
} from './layout.ts'
import type { LayoutInput } from './layout.ts'
import { ARC, arcFront } from '../planner/shapes.fixture.ts'
import { SpaceSchema, rectangleSpace } from './space.ts'

const space = SpaceSchema.parse({
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [6, 0],
    [6, 4],
    [4, 4],
    [4, 1],
    [2, 1],
    [2, 4],
    [0, 4],
  ],
  height: 3,
  entrances: [{ a: [0, 4], b: [2, 4], kind: 'main' }],
  obstacles: [
    {
      kind: 'column',
      polygon: [
        [5, 2],
        [5.4, 2],
        [5.4, 2.4],
        [5, 2.4],
      ],
      label: '柱 A',
    },
  ],
})

function item(id: string, cx: number, cz: number, w = 1.8, d = 0.5, h = 0.9) {
  return {
    id,
    assetId: null,
    function: 'side_cabinet' as const,
    name: id,
    cx,
    cz,
    rotation: 0 as const,
    w,
    d,
    h,
  }
}

function layout(items: ReturnType<typeof item>[]): LayoutInput {
  return { schemaVersion: 3, items }
}

const codes = (input: LayoutInput) =>
  validateLayout(space, LayoutSchema.parse(input)).map((issue) => issue.code)

describe('LayoutSchema', () => {
  it('applies defaults and rejects duplicate item ids', () => {
    const parsed = LayoutSchema.parse(layout([item('a', 1, 0.25)]))
    expect(parsed.items[0]).toMatchObject({ placeholder: false, locked: false })
    expect(parsed.planning).toBeNull()
    expect(LayoutSchema.safeParse(layout([item('a', 1, 0.25), item('a', 4, 0.25)])).success).toBe(
      false,
    )
  })

  it('only accepts quarter-turn rotations', () => {
    const tilted = { ...item('a', 1, 0.25), rotation: 45 }
    expect(LayoutSchema.safeParse({ schemaVersion: 3, items: [tilted] }).success).toBe(false)
  })
})

describe('validateLayout', () => {
  it('accepts props flush with walls and with each other', () => {
    expect(codes(layout([item('a', 0.9, 0.25), item('b', 2.7, 0.25)]))).toEqual([])
  })

  it('reports overlapping props', () => {
    expect(codes(layout([item('a', 0.9, 0.25), item('b', 2, 0.25)]))).toEqual(['item_overlap'])
  })

  it('reports a prop bridging the concave slot as outside the boundary', () => {
    expect(codes(layout([item('a', 3, 2.5, 3, 0.5)]))).toEqual(['item_outside_boundary'])
  })

  it('reports props on columns, on entrances and taller than the ceiling', () => {
    expect(codes(layout([item('a', 5.2, 2.2, 0.6, 0.6)]))).toEqual(['item_overlaps_obstacle'])
    expect(codes(layout([item('a', 1, 3.9, 1, 0.5)]))).toEqual([
      'item_outside_boundary',
      'item_blocks_entrance',
    ])
    expect(codes(layout([item('a', 1, 0.25, 1.8, 0.5, 3.2)]))).toEqual(['item_too_tall'])
  })

  it('checks an entrance along an arc piece by piece, not along its chord', () => {
    const wholeArc = SpaceSchema.parse({
      ...arcFront,
      entrances: [{ a: [...ARC[0]], b: [...ARC[8]], kind: 'main' }],
      openEdges: [],
    })
    const check = (input: LayoutInput) =>
      validateLayout(wholeArc, LayoutSchema.parse(input)).map((issue) => issue.code)
    // Across the chord z = 7 but inside the arc: fine.
    expect(check(layout([item('a', 5, 7.2, 1.8, 0.5)]))).toEqual([])
    // Across the arc itself: outside the shop and over the entrance.
    expect(check(layout([item('a', 5, 7.9, 1, 0.5)]))).toEqual([
      'item_outside_boundary',
      'item_blocks_entrance',
    ])
  })

  it('allows a prop standing against the entrance edge from inside', () => {
    const rect = rectangleSpace(6, 4, 3)
    const parsed = LayoutSchema.parse(layout([item('a', 3, 3.75)]))
    expect(validateLayout(rect, parsed)).toEqual([])
  })
})

describe('assetFitProblem / checkAssetFit', () => {
  const screen = { footprint: { w: 1.69, d: 0.05, h: 0.958 }, placeable: false }
  const table = { footprint: { w: 1, d: 1.8, h: 1.327 }, placeable: true }
  const item = (overrides: object) => ({
    placeholder: false,
    rotation: 0 as const,
    w: 1,
    d: 1.8,
    h: 1.327,
    ...overrides,
  })

  it('lets a model without a web model stand in only as a placeholder, at true size', () => {
    expect(
      assetFitProblem(item({ placeholder: true, w: 1.69, d: 0.05, h: 0.958 }), screen),
    ).toBeNull()
    expect(assetFitProblem(item({ w: 1.69, d: 0.05, h: 0.958 }), screen)).toBe('not_placeable')
    expect(assetFitProblem(item({ placeholder: true, w: 2, d: 0.05, h: 0.958 }), screen)).toBe(
      'size',
    )
    expect(
      assetFitProblem(
        item({ rotation: 90, w: 0.05, d: 1.69, h: 0.958, placeholder: true }),
        screen,
      ),
    ).toBeNull()
  })

  it('still requires placeable models at their true size and known ids', () => {
    expect(assetFitProblem(item({}), table)).toBeNull()
    expect(assetFitProblem(item({ w: 1.2 }), table)).toBe('size')
    expect(assetFitProblem(item({}), undefined)).toBe('unknown')
  })

  it('explains each problem in the issue list', () => {
    const layout = LayoutSchema.parse({
      schemaVersion: 3,
      items: [
        {
          id: 'a',
          assetId: 'asset-1',
          function: 'screen',
          name: '广告机',
          cx: 1,
          cz: 1,
          rotation: 0,
          w: 1.69,
          d: 0.05,
          h: 0.958,
        },
        {
          id: 'b',
          assetId: 'asset-9',
          function: 'other',
          name: '未知',
          cx: 3,
          cz: 3,
          rotation: 0,
          w: 1,
          d: 1,
          h: 1,
        },
      ],
    })
    const issues = checkAssetFit(layout, new Map([['asset-1', screen]]))
    expect(issues.map((i) => i.message)).toEqual([
      '广告机引用的模型 asset-1 还没有网页模型，只能作为占位摆放',
      '未知引用的模型 asset-9 不存在',
    ])
  })
})

describe('a model placed by its body (开箱桌 without its stools)', () => {
  // 开箱储物柜: 1.069 × 1.8 m whole, a 0.5 × 1.8 m body on the −X side, stools on +X.
  const unboxing = {
    footprint: { w: 0.5, d: 1.8, h: 0.902 },
    placeable: true,
    extent: { w: 1.069, d: 1.8, cx: 0.284, cz: 0 },
  }
  const assets = new Map([['asset-666964', unboxing]])
  const unboxingItem = (overrides: object) => ({
    id: 'u',
    assetId: 'asset-666964',
    function: 'unboxing_table' as const,
    name: '开箱储物柜',
    placeholder: false,
    cx: 3,
    cz: 2,
    rotation: 0 as const,
    w: 0.5,
    d: 1.8,
    h: 0.902,
    ...overrides,
  })
  const open = rectangleSpace(6, 4, 3)

  it('turns an offset in the model frame with the item, as the viewer does', () => {
    expect(turnOffset(1, 0, 0)).toEqual([1, 0])
    expect(turnOffset(1, 0, 90)).toEqual([0, 1])
    expect(turnOffset(1, 0, 180)).toEqual([-1, 0])
    expect(turnOffset(0, 1, 90)).toEqual([-1, 0])
    expect(modelBox(unboxingItem({}), unboxing)).toEqual({ cx: 3.284, cz: 2, w: 1.069, d: 1.8 })
    expect(modelBox(unboxingItem({ rotation: 90, w: 1.8, d: 0.5 }), unboxing)).toEqual({
      cx: 3,
      cz: 2.284,
      w: 1.8,
      d: 1.069,
    })
    // A model without a separate body is the item itself.
    expect(modelBox(unboxingItem({}), undefined)).toEqual({ cx: 3, cz: 2, w: 0.5, d: 1.8 })
  })

  it('accepts the body, and the whole model size placed before the correction', () => {
    expect(assetFitProblem(unboxingItem({}), unboxing)).toBeNull()
    expect(assetFitProblem(unboxingItem({ w: 1.069 }), unboxing)).toBeNull()
    expect(assetFitProblem(unboxingItem({ rotation: 90, w: 1.8, d: 1.069 }), unboxing)).toBeNull()
    expect(assetFitProblem(unboxingItem({ w: 0.8 }), unboxing)).toBe('size')
  })

  it('moves items placed at the whole size onto the body, once', () => {
    const before = LayoutSchema.parse({
      schemaVersion: 3,
      items: [
        // Placed before the correction: centred on the whole model.
        unboxingItem({ id: 'old', cx: 3.284, w: 1.069 }),
        unboxingItem({ id: 'turned', cx: 1, cz: 2.284, rotation: 90, w: 1.8, d: 1.069 }),
        unboxingItem({ id: 'new' }),
        item('other', 1, 1),
      ],
    })
    const after = fitBodyFootprints(before, assets)
    expect(after.items.map(({ id, cx, cz, w, d }) => ({ id, cx, cz, w, d }))).toEqual([
      { id: 'old', cx: 3, cz: 2, w: 0.5, d: 1.8 },
      { id: 'turned', cx: 1, cz: 2, w: 1.8, d: 0.5 },
      { id: 'new', cx: 3, cz: 2, w: 0.5, d: 1.8 },
      { id: 'other', cx: 1, cz: 1, w: 1.8, d: 0.5 },
    ])
    // The whole model stays where it stood.
    expect(modelBox(after.items[0] as never, unboxing)).toMatchObject({ cx: 3.284, cz: 2 })
    expect(fitBodyFootprints(after, assets)).toBe(after)
  })

  it('warns, without an error, when the stools reach a wall, a column or another prop', () => {
    const check = (items: object[], s = open) =>
      validateLayout(s, LayoutSchema.parse({ schemaVersion: 3, items }), assets)
    // Stools clear of everything: nothing to say.
    expect(check([unboxingItem({})])).toEqual([])
    // Body 0.1 m from the right wall, stools beyond it: a warning only.
    const atWall = check([unboxingItem({ cx: 5.65 })])
    expect(atWall.map((i) => [i.code, i.severity])).toEqual([['item_extent_blocked', 'warning']])
    expect(atWall[0]?.message).toBe('开箱储物柜的凳子压到墙、障碍物或其他道具')
    // Another prop where the stools are.
    expect(
      check([unboxingItem({}), { ...item('cabinet', 3.75, 2, 0.4, 0.4) }]).map((i) => i.code),
    ).toEqual(['item_extent_blocked'])
    // Without the catalogue (older callers) the stools are not checked.
    expect(
      validateLayout(
        open,
        LayoutSchema.parse({ schemaVersion: 3, items: [unboxingItem({ cx: 5.65 })] }),
      ),
    ).toEqual([])
  })
})
