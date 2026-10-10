import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@store/database'
import { rectangleSpace } from '@store/shared'
import type { Asset, LayoutCandidates } from '@store/shared'
import { plannerCatalog } from '../src/modules/layouts/selection.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

type Seed = {
  id: string
  name: string
  variant?: string
  fn: Asset['function']
  si: string
  w: number
  d: number
  h: number
  front: string
}
const seeds: Seed[] = [
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
  for (const s of seeds) {
    const [file] = await t.database.db
      .insert(schema.storedFiles)
      .values({
        root: 'resource',
        storageKey: `models/${s.id}.glb`,
        kind: 'glb',
        contentType: 'model/gltf-binary',
        bytes: 1,
        sha256: 'a'.repeat(64),
      })
      .returning()
    await t.database.db.insert(schema.assets).values({
      id: s.id,
      standardName: s.name,
      variant: s.variant ?? 'A',
      materialCategory: '软装物料',
      siFamily: s.si,
      function: s.fn,
      installation: 'floor',
      width: s.w,
      depth: s.d,
      height: s.h,
      footprintSource: 'glb',
      front: s.front,
      placeable: true,
      glbFileId: file?.id,
    })
  }
})

afterAll(async () => {
  await t.close()
})

function generate(payload: object) {
  return t.app.inject({ method: 'POST', url: '/api/v1/layouts/generate', payload })
}

describe('POST /layouts/generate', () => {
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
    front: 'any',
    staffSide: null,
    facingConfidence: 'high',
    placeable: true,
    retired: false,
    judgment: null,
    glb: null,
    whiteGlb: null,
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
})
