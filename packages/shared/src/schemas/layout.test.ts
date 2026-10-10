import { describe, expect, it } from 'vitest'
import { LayoutSchema, assetFitProblem, checkAssetFit, validateLayout } from './layout.ts'
import type { LayoutInput } from './layout.ts'
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
