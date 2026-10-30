import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { LayoutSchema } from '@store/shared'
import type { Asset, DesignNode, ProjectExport } from '@store/shared'
import { storageRoots } from '../src/app.ts'
import { loadConfig } from '../src/config/env.ts'
import { importCatalog } from '../src/modules/assets/importer.ts'
import { createNode, createProject, createSpace, layoutOf } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let root: string
let t: TestApp
const ids = ['asset-958185', 'asset-11525629', 'asset-2587726']
const model = Buffer.from('glTF-retained-model')
const hash = createHash('sha256').update(model).digest('hex')

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'catalog-availability-'))
  await mkdir(path.join(root, '04_模型库'), { recursive: true })
  await writeFile(
    path.join(root, '04_模型库/manifest.json'),
    JSON.stringify({
      assets: ids.map((id) => ({
        asset_id: id,
        standard_name: id === 'asset-11525629' ? 'LED门头屏' : '电子水牌',
        variant: '旧项目款',
        material_category: '信息化物料',
        category: '信息化物料',
        si_family: '通用',
        web_model: id,
        tight_face_bounds_xyz_mm: [500, 200, 1650],
      })),
    }),
  )
  await writeFile(
    path.join(root, '04_模型库/facing.json'),
    JSON.stringify({
      assets: Object.fromEntries(
        ids.map((id) => [id, { front: '+Z', installation: 'floor', confidence: 'high' }]),
      ),
    }),
  )
  for (const id of ids) {
    const folder = path.join(root, '04_模型库', id)
    await mkdir(folder)
    await writeFile(path.join(folder, 'model.glb'), model)
    await writeFile(
      path.join(folder, 'conversion.json'),
      JSON.stringify({
        id,
        bytes: model.length,
        glbSha256: hash,
        dimensions: { w: 0.5, d: 0.2, h: 1.65 },
      }),
    )
  }
  t = await createTestApp({ RESOURCE_ROOT: root })
  await importCatalog(t.database.db, storageRoots(loadConfig({ RESOURCE_ROOT: root })))
})

afterAll(async () => {
  await t.close()
  await rm(root, { recursive: true, force: true })
})

it('审核停用不丢模型；LED保持在库、未全局停用；当前水牌继续可用', async () => {
  for (const id of ids) {
    const response = await t.app.inject({ url: `/api/v1/assets/${id}` })
    expect(response.statusCode).toBe(200)
    expect(response.json<Asset>()).toMatchObject({
      id,
      retired: id === 'asset-958185',
      glb: { sha256: hash },
    })
    await expect(access(path.join(root, '04_模型库', id, 'model.glb'))).resolves.toBeUndefined()
  }
})

it('旧方案中的已停用模型与LED引用仍可保存、读取及导出', async () => {
  const project = await createProject(t, { name: '旧模型兼容', shopType: 'side_hall' })
  const space = await createSpace(t, project.id)
  const layout = layoutOf(
    ...ids.slice(0, 2).map((assetId, i) => ({
      id: `old-${i}`,
      assetId,
      name: '保留的旧模型',
      function: 'screen' as const,
      cx: 2 + i * 2,
      cz: 2,
      rotation: 0,
      w: 0.5,
      d: 0.2,
      h: 1.65,
      placeholder: false,
      locked: false,
    })),
  )
  const plan = await createNode(t, project.id, {
    parentId: space.id,
    kind: 'plan',
    name: '旧方案',
    layout,
  })
  const loaded = await t.app.inject({ url: `/api/v1/nodes/${plan.id}` })
  expect(loaded.json<DesignNode>().layout?.items.map((item) => item.assetId)).toEqual(
    ids.slice(0, 2),
  )
  const exported = await t.app.inject({ url: `/api/v1/projects/${project.id}/export` })
  expect(exported.statusCode).toBe(200)
  expect(exported.json<ProjectExport>().nodes.find((node) => node.id === plan.id)?.layout).toEqual(
    LayoutSchema.parse(layout),
  )
})
