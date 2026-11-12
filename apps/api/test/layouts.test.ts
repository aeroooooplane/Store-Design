import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SIDE_CABINET_RULES, rectangleSpace } from '@store/shared'
import type { Asset, LayoutCandidates } from '@store/shared'
import { plannerCatalog } from '../src/modules/layouts/selection.ts'
import { seedAsset } from './fixtures.ts'
import type { AssetSeed } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

const seeds: AssetSeed[] = [
  {
    id: 'asset-1',
    name: '1800mm普通中岛桌',
    fn: 'island_table',
    si: 'SI1.0',
    w: 1,
    d: 1.8,
    h: 1.327,
    front: 'any',
  },
  {
    id: 'asset-2',
    name: '1.8米普通中岛桌',
    fn: 'island_table',
    si: 'SI2.0',
    w: 1.8,
    d: 0.804,
    h: 1.214,
    front: 'any',
  },
  {
    id: 'asset-3',
    name: '收银台',
    fn: 'cashier',
    si: 'SI1.0',
    w: 1.942,
    d: 0.648,
    h: 1.205,
    front: '+Z',
  },
  {
    id: 'asset-4',
    name: '1600mm配件柜',
    variant: '浅灰款',
    fn: 'accessory_cabinet',
    si: 'SI1.0',
    w: 1.6,
    d: 0.45,
    h: 2.4,
    front: '+Z',
  },
  {
    id: 'asset-5',
    name: '1600mm配件柜',
    variant: '另一款',
    fn: 'accessory_cabinet',
    si: 'SI1.0',
    w: 1.6,
    d: 0.45,
    h: 2.4,
    front: '+Z',
  },
]

beforeAll(async () => {
  t = await createTestApp()
  for (const s of seeds) await seedAsset(t, s)
})

afterAll(async () => {
  await t.close()
})

function generate(payload: object) {
  return t.app.inject({ method: 'POST', url: '/api/v1/layouts/generate', payload })
}

describe('POST /layouts/generate', () => {
  it('按清单数量生成并保留轮廓、墙柱、禁放区，缺项随方案保存', async () => {
    const space = {
      ...rectangleSpace(9, 7, 3.2),
      obstacles: [
        {
          kind: 'fixed',
          polygon: [
            [0, 0],
            [1, 0],
            [1, 2],
            [0, 2],
          ],
          height: 2.4,
          label: '已确认墙',
          addedLater: true,
        },
        {
          kind: 'other',
          polygon: [
            [6, 2],
            [7, 2],
            [7, 3],
            [6, 3],
          ],
          height: 0.001,
          label: '禁放区',
          addedLater: true,
        },
      ],
      demand: {
        schemaVersion: 1,
        sourceStoreId: 'test',
        entities: [
          { id: 'cash', label: '收银台', roles: ['cashier'], quantity: 2 },
          { id: 'combo', label: '收银开箱组合', roles: ['cashier', 'unboxing_table'], quantity: 1 },
          { id: 'unknown', label: '未知凳', roles: ['seating'], quantity: 1 },
        ],
      },
    }
    const before = JSON.stringify(space)
    const response = await generate({ space, shopType: 'side_hall' })
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(space)).toBe(before)
    const result = response.json<LayoutCandidates>()
    expect(result.space.boundary).toEqual(space.boundary)
    expect(result.space.obstacles).toEqual(space.obstacles)
    for (const c of result.candidates) {
      expect(c.layout.items).toHaveLength(2)
      expect(c.layout.items.every((i) => i.assetId === 'asset-3')).toBe(true)
      expect(c.layout.planning).toMatchObject({
        requested: 4,
        placed: 2,
        demand: [
          { id: 'cash', required: 2, placed: 2, placeholders: 0, reason: null },
          { id: 'combo', required: 1, placed: 0 },
          { id: 'unknown', required: 1, placed: 0 },
        ],
      })
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(c.notes).toHaveLength(2)
    }
  })
  it('显式空清单不自动增加道具，非法数量和重复编号返回400', async () => {
    const space = { ...rectangleSpace(5, 5, 3), demand: { schemaVersion: 1, entities: [] } }
    const empty = await generate({ space, shopType: 'island' })
    expect(empty.statusCode).toBe(200)
    expect(
      empty.json<LayoutCandidates>().candidates.every((c) => c.layout.items.length === 0),
    ).toBe(true)
    for (const quantities of [[201], [-1], [1.5], [101, 100], [1, 1]]) {
      const entities = quantities.map((quantity, i) => ({
        id: quantities[0] === 1 ? 'same' : String(i),
        label: '台',
        roles: ['cashier'],
        quantity,
      }))
      expect(
        (
          await generate({
            space: { ...space, demand: { schemaVersion: 1, entities } },
            shopType: 'island',
          })
        ).statusCode,
      ).toBe(400)
    }
  })
  it('returns one candidate per strategy, without hard-constraint errors', async () => {
    const response = await generate({ space: rectangleSpace(9, 7, 3.2), shopType: 'side_hall' })
    expect(response.statusCode).toBe(200)
    const { candidates } = response.json<LayoutCandidates>()
    expect(candidates.map((c) => c.strategy)).toEqual(['max', 'area', 'min'])
    for (const candidate of candidates) {
      expect(candidate.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(candidate.layout.planning?.strategy).toBe(candidate.strategy)
    }
    const max = candidates[0]?.layout.items ?? []
    expect(new Set(max.filter((i) => i.function === 'island_table').map((i) => i.assetId))).toEqual(
      new Set(['asset-1']),
    )
    // Same-length cabinets: only the preferred variant lines the walls.
    expect(
      new Set(max.filter((i) => i.function === 'accessory_cabinet').map((i) => i.assetId)),
    ).toEqual(new Set(['asset-4']))
  })

  it('follows the project SI style when choosing models', async () => {
    const response = await generate({
      space: rectangleSpace(9, 7, 3.2),
      shopType: 'side_hall',
      siStyle: 'SI2.0',
      strategies: ['min'],
    })
    const [only] = response.json<LayoutCandidates>().candidates
    expect(only?.layout.items.find((i) => i.function === 'island_table')?.assetId).toBe('asset-2')
  })

  it('normalises the space it planned in and rejects invalid spaces', async () => {
    const ccw = rectangleSpace(6, 5, 3)
    const ok = await generate({
      space: { ...ccw, boundary: [...ccw.boundary].reverse() },
      shopType: 'island',
      strategies: ['area'],
    })
    expect(ok.json<LayoutCandidates>().space.boundary[1]).toEqual([6, 0])
    const bad = await generate({
      space: {
        ...ccw,
        boundary: [
          [0, 0],
          [4, 4],
          [4, 0],
          [0, 4],
        ],
      },
      shopType: 'island',
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('POST /layouts/validate', () => {
  it('returns every problem, including model contract violations', async () => {
    const island = (id: string, cx: number, w = 1) => ({
      id,
      assetId: 'asset-1',
      function: 'island_table',
      name: id,
      cx,
      cz: 2,
      rotation: 0,
      w,
      d: 1.8,
      h: 1.327,
    })
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/layouts/validate',
      payload: {
        space: rectangleSpace(6, 5, 3),
        layout: {
          schemaVersion: 3,
          items: [island('a', 2), island('b', 2.5), island('c', 4.5, 1.2)],
        },
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ issues: { code: string }[] }>().issues.map((i) => i.code)).toEqual([
      'item_asset_size_mismatch',
      'item_overlap',
    ])
  })
})

describe('plannerCatalog', () => {
  const asset = (
    id: string,
    name: string,
    si: string,
    fn: Asset['function'],
    variant = 'A',
  ): Asset => ({
    id,
    name,
    standardName: name,
    variant,
    materialCategory: '软装物料',
    siFamily: si,
    function: fn,
    installation: 'floor',
    footprint: { w: 1, d: 1.8, h: 1 },
    footprintSource: 'glb',
    extent: null,
    front: 'any',
    staffSide: null,
    facingConfidence: 'high',
    placeable: true,
    retired: false,
    judgment: null,
    glb: null,
    whiteGlb: null,
    finishGlb: null,
    market: null,
    otherMarketGlb: null,
    category: '软装道具',
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
    preview: null,
  })

  it('prefers the SI family, then 通用, then standard names; rotated instances last', () => {
    const catalog = plannerCatalog(
      [
        asset('asset-10', '1.8米亮脚中岛桌', 'SI2.0', 'island_table'),
        asset('asset-11', '1.8米普通中岛桌', 'SI2.0', 'island_table', '产品陈列B_旋转实例'),
        asset('asset-12', '1.8米普通中岛桌', 'SI2.0', 'island_table'),
        asset('asset-13', '中岛陈列柜组合', '非标', 'island_table'),
        asset('asset-14', '1800mm普通中岛桌', 'SI1.0', 'island_table'),
      ],
      'SI2.0',
    )
    expect(catalog.island.map((a) => a.id)).toEqual([
      'asset-12',
      'asset-11',
      'asset-10',
      'asset-14',
      'asset-13',
    ])
  })

  it('never plans with models retired in 模型选用表', () => {
    const catalog = plannerCatalog(
      [
        { ...asset('asset-20', '1.8米普通中岛桌', 'SI2.0', 'island_table'), retired: true },
        asset('asset-21', '1.8米普通中岛桌', 'SI2.0', 'island_table'),
      ],
      'SI2.0',
    )
    expect(catalog.island.map((a) => a.id)).toEqual(['asset-21'])
  })

  it('hands island shops the 配件边柜 of the SI family: 1.2–1.4 m high first, then the shallowest', () => {
    const side = (id: string, si: string, w: number, d: number, h: number): Asset => ({
      ...asset(id, `配件边柜 ${id}`, si, 'side_cabinet'),
      footprint: { w, d, h },
    })
    const assets = [
      side('asset-28192911', 'SI2.0', 1.8, 0.721, 1.3),
      side('asset-33660153', 'SI2.0', 1.8, 0.531, 1.214),
      side('asset-34320268', 'SI1.0', 0.5, 1.8, 1.214),
      // Shallower but outside the 1.2–1.4 m band: after the band.
      side('asset-40', 'SI2.0', 1.2, 0.4, 0.9),
      side('asset-41', '通用', 1.8, 0.4, 1.3),
      { ...side('asset-42', 'SI2.0', 1.8, 0.3, 1.3), retired: true },
      asset('asset-50', '1200mm配件柜', 'SI2.0', 'accessory_cabinet'),
    ]
    const si2 = plannerCatalog(assets, 'SI2.0')
    expect(si2.sideCabinet?.map((a) => a.id)).toEqual([
      'asset-33660153',
      'asset-28192911',
      'asset-40',
    ])
    expect(si2.cabinet.map((a) => a.id)).toEqual(['asset-50'])
    expect(plannerCatalog(assets, 'SI1.0').sideCabinet?.map((a) => a.id)).toEqual([
      'asset-34320268',
    ])
    // No side cabinet of the family: the next family, 通用 first.
    const noSi2 = assets.filter((a) => a.siFamily !== 'SI2.0')
    expect(plannerCatalog(noSi2, 'SI2.0').sideCabinet?.map((a) => a.id)).toEqual(['asset-41'])
    // The preferred models and the height band come from the rules, which store data can replace.
    const rules = {
      ...DEFAULT_SIDE_CABINET_RULES,
      preferHeight: { min: 0.8, max: 1 },
      preferredAssets: { 'SI2.0': ['asset-28192911'] },
    }
    expect(plannerCatalog(assets, 'SI2.0', rules).sideCabinet?.map((a) => a.id)).toEqual([
      'asset-28192911',
      'asset-40',
      'asset-33660153',
    ])
  })
})
