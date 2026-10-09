import { describe, expect, it } from 'vitest'
import { LayoutSchema, checkAssetFit, rotatedFootprint } from './layout.ts'
import type { AssetFit } from './layout.ts'
import { NodeCreateSchema } from './node.ts'
import { rectangleSpace } from './space.ts'

const island: AssetFit = { footprint: { w: 1, d: 1.8, h: 1.327 }, placeable: true }
const assets = new Map<string, AssetFit>([
  ['asset-1', island],
  ['asset-2', { ...island, placeable: false }],
])

function layoutWith(item: Record<string, unknown>) {
  return LayoutSchema.parse({
    schemaVersion: 3,
    items: [
      {
        id: 'a',
        assetId: 'asset-1',
        function: 'island_table',
        name: '中岛桌',
        cx: 2,
        cz: 2,
        rotation: 0,
        w: 1,
        d: 1.8,
        h: 1.327,
        ...item,
      },
    ],
  })
}

describe('checkAssetFit', () => {
  it('accepts the true size in either quarter-turn orientation', () => {
    expect(checkAssetFit(layoutWith({}), assets)).toEqual([])
    expect(checkAssetFit(layoutWith({ rotation: 90, w: 1.8, d: 1 }), assets)).toEqual([])
    expect(rotatedFootprint(island, 270)).toEqual({ w: 1.8, d: 1, h: 1.327 })
  })

  it('rejects stretched models and unknown or non-placeable ones', () => {
    expect(checkAssetFit(layoutWith({ w: 1.2 }), assets).map((i) => i.code)).toEqual([
      'item_asset_size_mismatch',
    ])
    expect(checkAssetFit(layoutWith({ rotation: 90 }), assets).map((i) => i.code)).toEqual([
      'item_asset_size_mismatch',
    ])
    expect(checkAssetFit(layoutWith({ assetId: 'asset-2' }), assets).map((i) => i.code)).toEqual([
      'item_asset_unknown',
    ])
    expect(checkAssetFit(layoutWith({ assetId: 'asset-9' }), assets).map((i) => i.code)).toEqual([
      'item_asset_unknown',
    ])
  })

  it('ignores parametric placeholders without a model', () => {
    expect(checkAssetFit(layoutWith({ assetId: null, w: 3 }), assets)).toEqual([])
  })
})

describe('NodeCreateSchema', () => {
  const layout = { schemaVersion: 3, items: [] }
  const parentId = '11111111-1111-4111-8111-111111111111'

  it('accepts a root space and a child layout node', () => {
    expect(
      NodeCreateSchema.safeParse({
        parentId: null,
        kind: 'space',
        name: '空间',
        space: rectangleSpace(6, 4, 3),
      }).success,
    ).toBe(true)
    expect(
      NodeCreateSchema.safeParse({
        parentId,
        kind: 'plan',
        name: '方案 A',
        layout,
        strategy: 'max',
      }).success,
    ).toBe(true)
  })

  it('enforces the payload that belongs to each kind', () => {
    const messages = (input: unknown) => {
      const result = NodeCreateSchema.safeParse(input)
      return result.success ? [] : result.error.issues.map((i) => i.message)
    }
    expect(messages({ parentId: null, kind: 'space', name: '空间' })).toContain(
      '空间节点必须包含空间',
    )
    expect(messages({ parentId: null, kind: 'edit', name: '编辑', layout })).toContain(
      '该节点必须有父节点',
    )
    expect(messages({ parentId, kind: 'edit', name: '编辑', layout, strategy: 'max' })).toContain(
      '只有生成方案节点可以记录排布策略',
    )
    expect(messages({ parentId, kind: 'render', name: '渲染', layout })).toContain(
      '渲染节点必须指定 SI 风格',
    )
    expect(
      messages({ parentId, kind: 'plan', name: '方案', layout, space: rectangleSpace(6, 4, 3) }),
    ).toContain('只有空间节点可以包含空间')
  })
})
