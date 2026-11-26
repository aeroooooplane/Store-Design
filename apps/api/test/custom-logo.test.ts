import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CUSTOM_LOGO_ID,
  customLogoAsset,
  customLogoSize,
  rectangleSpace,
  AssetSchema,
  AssetListSchema,
  ProjectSchema,
  NodeSchema,
} from '@store/shared'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

describe('自定义 LOGO 接口', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(async () => {
    await t.close()
  })
  it('无需导入模型即可筛选获取，文字和尺寸随方案保存重开', async () => {
    const get = async (url: string): Promise<unknown> =>
      (await t.app.inject({ method: 'GET', url: '/api/v1' + url })).json<unknown>()
    const post = async (url: string, payload: unknown) => {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/v1' + url,
        payload: payload as object,
      })
      expect(r.statusCode, r.body).toBe(201)
      return r.json<{ id: string; node: { id: string } }>()
    }
    const list = AssetListSchema.parse(
      await get('/assets?function=signage&placeable=true&q=自定义'),
    )
    expect(list.items.map((a: { id: string }) => a.id)).toEqual([CUSTOM_LOGO_ID])
    const asset = AssetSchema.parse(await get('/assets/' + CUSTOM_LOGO_ID))
    expect(asset).toMatchObject(customLogoAsset())
    const p = ProjectSchema.parse(
      await post('/projects', {
        name: '自定义字形',
        shopType: 'side_hall',
        market: 'domestic',
        siStyle: 'SI1.0',
      }),
    )
    const root = (
      await post(`/projects/${p.id}/nodes`, {
        kind: 'space',
        parentId: null,
        name: '空间',
        space: rectangleSpace(8, 6, 3),
      })
    ).node
    const text = '影石 Insta360',
      item = {
        id: 'logo',
        assetId: CUSTOM_LOGO_ID,
        name: '自定义LOGO',
        function: 'signage',
        cx: 3,
        cz: 2,
        rotation: 90,
        ...customLogoSize(text, 2, 90),
        scale: 2,
        logoText: text,
        mount: 'wall',
        elevation: 1.2,
        locked: false,
      }
    const plan = (
      await post(`/projects/${p.id}/nodes`, {
        kind: 'plan',
        parentId: root.id,
        name: '文字方案',
        siStyle: 'SI1.0',
        layout: { schemaVersion: 3, planning: null, items: [item] },
      })
    ).node
    const reopened = NodeSchema.parse(await get('/nodes/' + plan.id))
    expect(reopened.layout?.items[0]).toMatchObject(item)
    const invalid = await t.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${p.id}/nodes`,
      payload: {
        kind: 'plan',
        parentId: root.id,
        name: '无效',
        siStyle: 'SI1.0',
        layout: { schemaVersion: 3, items: [{ ...item, logoText: '😀' }] },
      },
    })
    expect(invalid.statusCode).toBe(400)
  })
})
