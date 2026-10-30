import { afterAll, beforeAll, expect, it } from 'vitest'
import { wallArtAsset, resizeWallArt, LayoutSchema } from '@store/shared'
import type { Asset, DesignNode, LayoutItem, ProjectExport } from '@store/shared'
import { createProject, createSpace, createNode, layoutOf } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp
beforeAll(async () => {
  t = await createTestApp()
})
afterAll(async () => {
  await t.close()
})

it('没有资源文件也提供标准画片；搜索、分类和可放置筛选一致', async () => {
  const asset = wallArtAsset()
  for (const suffix of [`/${asset.id}`, '?category=信息化物料', '?placeable=true', '?q=灯箱']) {
    const response = await t.app.inject({ url: `/api/v1/assets${suffix}` })
    expect(response.statusCode).toBe(200)
    const body = response.json<Asset | { items: Asset[] }>()
    const found = 'items' in body ? body.items.find((a) => a.id === asset.id) : body
    expect(found).toEqual(asset)
  }
  const no = await t.app.inject({ url: '/api/v1/assets?category=环境设施' })
  expect(no.json<{ items: Asset[] }>().items).toEqual([])
})

it('自定义宽高非占位画片可保存、重载、导出；JSON尺寸没有被标准尺寸覆盖', async () => {
  const art = wallArtAsset()
  const project = await createProject(t, { name: '灯箱精确尺寸', shopType: 'side_hall' })
  const space = await createSpace(t, project.id)
  const item: LayoutItem = resizeWallArt(
    {
      id: 'signage-1',
      assetId: art.id,
      function: 'signage',
      name: art.name,
      cx: 3,
      cz: 0.001,
      w: 1.5,
      d: 0.001,
      h: 0.85,
      rotation: 0,
      placeholder: false,
      locked: false,
      elevation: 1,
      mount: 'wall',
    },
    1.777,
    1.234,
  )
  const layout = LayoutSchema.parse(layoutOf(item))
  const plan = await createNode(t, project.id, {
    parentId: space.id,
    kind: 'plan',
    name: '自定义灯箱',
    layout,
  })
  const loaded = await t.app.inject({ url: `/api/v1/nodes/${plan.id}` })
  expect(loaded.json<DesignNode>().layout).toEqual(layout)
  const output = await t.app.inject({ url: `/api/v1/projects/${project.id}/export` })
  expect(output.json<ProjectExport>().nodes.find((n) => n.id === plan.id)?.layout).toEqual(layout)
})
