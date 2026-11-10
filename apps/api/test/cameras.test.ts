import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_NAMES, MAX_CAMERAS_PER_NODE } from '@store/shared'
import type { NodeCamera, NodeCameraList, NodeCreated } from '@store/shared'
import { api, placeholderLayout as layout, seedLegacyEdit, whiteChain } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.close()
})

const inject = api(() => t)

/** A project with space → plan → white; returns the ids. */
const whiteModel = () => whiteChain(t, { projectName: '视角测试' })

const list = async (nodeId: string, includeDeleted = false) =>
  (
    await inject('GET', `/nodes/${nodeId}/cameras${includeDeleted ? '?includeDeleted=true' : ''}`)
  ).json<NodeCameraList>().cameras

const view = { name: '收银台近景', position: [6, 1.6, 5], target: [7, 1, 1], fovDeg: 55 }

describe('cameras', () => {
  it('initializes and edits saved views on an imported legacy edit node', async () => {
    const { project, plan } = await whiteModel()
    const legacy = await seedLegacyEdit(t, project.id, plan.id, '旧版调整', layout)
    const initialized = await inject('POST', `/nodes/${legacy.id}/cameras/initialize`)
    expect(initialized.statusCode).toBe(200)
    expect(initialized.json<NodeCameraList>().cameras).toHaveLength(8)
    expect((await inject('POST', `/nodes/${legacy.id}/cameras`, view)).statusCode).toBe(201)
    const [first] = await list(legacy.id)
    expect(
      (await inject('PATCH', `/cameras/${first?.id}`, { name: '旧图视角', fovDeg: 42 })).statusCode,
    ).toBe(200)
    expect((await inject('DELETE', `/cameras/${first?.id}`)).statusCode).toBe(200)
    expect((await inject('POST', `/cameras/${first?.id}/restore`)).statusCode).toBe(200)
  })
  it('gives a confirmed white model eight defaults and allows a plan to add views', async () => {
    const { plan, white } = await whiteModel()
    const cameras = await list(white.id)
    expect(cameras.map((c) => c.camera.name)).toEqual([...DEFAULT_VIEW_NAMES])
    expect(cameras.map((c) => c.sort)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(cameras.every((c) => c.camera.source === 'auto' && c.deletedAt === null)).toBe(true)
    // The front of the shop faces +z, so the front bird's-eye view stands beyond z = 6.
    expect(cameras[0]?.camera.position[2]).toBeGreaterThan(6)

    expect(await list(plan.id)).toEqual([])
    const refused = await inject('POST', `/nodes/${plan.id}/cameras`, view)
    expect(refused.statusCode).toBe(201)
    expect((await list(plan.id)).map((c) => c.camera.name)).toEqual([view.name])
  })

  it('adds the user’s own views after the defaults; re-aiming a default makes it theirs', async () => {
    const { white } = await whiteModel()
    const added = await inject('POST', `/nodes/${white.id}/cameras`, view)
    expect(added.statusCode).toBe(201)
    expect(added.json<NodeCamera>()).toMatchObject({
      sort: 8,
      camera: { ...view, source: 'user' },
    })

    const [first] = await list(white.id)
    const renamed = await inject('PATCH', `/cameras/${first?.id}`, { name: '正面' })
    expect(renamed.json<NodeCamera>().camera).toMatchObject({ name: '正面', source: 'auto' })
    const reaimed = await inject('PATCH', `/cameras/${first?.id}`, { fovDeg: 40 })
    expect(reaimed.json<NodeCamera>().camera).toMatchObject({
      name: '正面',
      fovDeg: 40,
      source: 'user',
    })
  })

  it('deletes softly, restores, and keeps to the per-node limit', async () => {
    const { white } = await whiteModel()
    const [first] = await list(white.id)
    const removed = await inject('DELETE', `/cameras/${first?.id}`)
    expect(removed.statusCode).toBe(200)
    expect(removed.json<NodeCamera>().deletedAt).not.toBeNull()
    expect(await list(white.id)).toHaveLength(7)
    expect(await list(white.id, true)).toHaveLength(8)
    expect((await inject('PATCH', `/cameras/${first?.id}`, { name: 'x' })).statusCode).toBe(409)

    for (let i = 7; i < MAX_CAMERAS_PER_NODE; i++) {
      expect((await inject('POST', `/nodes/${white.id}/cameras`, view)).statusCode).toBe(201)
    }
    expect((await inject('POST', `/nodes/${white.id}/cameras`, view)).statusCode).toBe(409)
    expect((await inject('POST', `/cameras/${first?.id}/restore`)).statusCode).toBe(409)

    const [second] = await list(white.id)
    await inject('DELETE', `/cameras/${second?.id}`)
    const restored = await inject('POST', `/cameras/${first?.id}/restore`)
    expect(restored.json<NodeCamera>()).toMatchObject({ deletedAt: null, sort: 0 })
  })

  it('carries the active views over to a copy of the white model and to its renders', async () => {
    const { project, plan, white } = await whiteModel()
    const [first] = await list(white.id)
    await inject('DELETE', `/cameras/${first?.id}`)
    await inject('POST', `/nodes/${white.id}/cameras`, view)

    const copy = await inject('POST', `/projects/${project.id}/nodes`, {
      parentId: plan.id,
      kind: 'white',
      name: '白模 副本2',
      sourceNodeId: white.id,
      layout,
    })
    const expected = [...DEFAULT_VIEW_NAMES.slice(1), view.name]
    const names = (await list(copy.json<NodeCreated>().node.id)).map((c) => c.camera.name)
    expect(names).toEqual(expected)

    const render = await inject('POST', `/projects/${project.id}/nodes`, {
      parentId: white.id,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout,
    })
    expect((await list(render.json<NodeCreated>().node.id)).map((c) => c.camera.name)).toEqual(
      expected,
    )
  })

  it('validates input and refuses changes to binned projects', async () => {
    const { project, white } = await whiteModel()
    const extra = await inject('POST', `/nodes/${white.id}/cameras`, { ...view, source: 'auto' })
    expect(extra.statusCode).toBe(400)
    const [first] = await list(white.id)
    expect((await inject('PATCH', `/cameras/${first?.id}`, {})).statusCode).toBe(400)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await inject('DELETE', `/cameras/${missing}`)).statusCode).toBe(404)

    await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { 'if-match': `"${project.revision}"` },
    })
    expect((await inject('DELETE', `/cameras/${first?.id}`)).statusCode).toBe(409)
    expect(await list(white.id)).toHaveLength(8)
  })
})

describe('四阶段视角初始化', () => {
  it('旧空间和方案首次展开后可初始化、重命名、调整、删除和恢复，阶段隔离', async () => {
    const { space, plan, white } = await whiteModel()
    expect(await list(space.id)).toEqual([])
    const initialized = await inject('POST', `/nodes/${space.id}/cameras/initialize`)
    expect(initialized.statusCode).toBe(200)
    const original = initialized.json<NodeCameraList>().cameras
    expect(original).toHaveLength(8)
    const first = original[0]!
    expect(
      (await inject('PATCH', `/cameras/${first.id}`, { name: '空间入口', fovDeg: 60 })).statusCode,
    ).toBe(200)
    const own = (await list(space.id))[0]!
    expect(own.camera).toMatchObject({ name: '空间入口', fovDeg: 60 })
    const initializedPlan = await inject('POST', `/nodes/${plan.id}/cameras/initialize`)
    expect(initializedPlan.statusCode).toBe(200)
    const planViews = initializedPlan.json<NodeCameraList>().cameras
    expect(planViews[0]!.camera.name).toBe('空间入口')
    expect(planViews[0]!.id).not.toBe(first.id)
    await inject('PATCH', `/cameras/${planViews[0]!.id}`, { name: '方案入口' })
    expect((await list(space.id))[0]!.camera.name).toBe('空间入口')
    expect((await list(white.id))[0]!.camera.name).toBe(DEFAULT_VIEW_NAMES[0])
    await inject('DELETE', `/cameras/${first.id}`)
    expect(await list(space.id)).toHaveLength(7)
    expect((await inject('POST', `/cameras/${first.id}/restore`)).statusCode).toBe(200)
    expect(await list(space.id)).toHaveLength(8)
  })

  it('并发首次打开只建立一组默认视角，删除全部后初始化不复活', async () => {
    const { plan } = await whiteModel()
    const results = await Promise.all(
      Array.from({ length: 3 }, () => inject('POST', `/nodes/${plan.id}/cameras/initialize`)),
    )
    expect(results.map((res) => res.statusCode)).toEqual([200, 200, 200])
    const original = await list(plan.id)
    expect(original).toHaveLength(8)
    expect(new Set(results.map((res) => res.json<NodeCameraList>().cameras[0]!.id)).size).toBe(1)
    for (const camera of original) await inject('DELETE', `/cameras/${camera.id}`)
    expect(
      (await inject('POST', `/nodes/${plan.id}/cameras/initialize`)).json<NodeCameraList>().cameras,
    ).toHaveLength(8)
    expect(await list(plan.id)).toEqual([])
    expect((await list(plan.id, true)).every((camera) => camera.deletedAt !== null)).toBe(true)
  })

  it('新三维节点继承方案已修改的视角，初始化回收站项目被拒绝', async () => {
    const { project, space, plan } = await whiteModel()
    await inject('POST', `/nodes/${plan.id}/cameras`, view)
    const created = await inject('POST', `/projects/${project.id}/nodes`, {
      parentId: plan.id,
      kind: 'white',
      name: '继承方案视角',
      layout,
    })
    expect(created.statusCode).toBe(201)
    expect(
      (await list(created.json<NodeCreated>().node.id)).map((camera) => camera.camera.name),
    ).toEqual([view.name])
    await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { 'if-match': `"${project.revision}"` },
    })
    expect((await inject('POST', `/nodes/${space.id}/cameras/initialize`)).statusCode).toBe(409)
  })
})
