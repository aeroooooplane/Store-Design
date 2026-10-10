import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_NAMES, MAX_CAMERAS_PER_NODE, rectangleSpace } from '@store/shared'
import type { NodeCamera, NodeCameraList, NodeCreated, Project } from '@store/shared'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.close()
})

/** A placeholder table needs no catalogue model. */
const layout = {
  schemaVersion: 3,
  items: [
    {
      id: 'island_table-1',
      assetId: null,
      function: 'island_table',
      name: '中岛桌',
      cx: 4,
      cz: 3,
      rotation: 0,
      w: 1.8,
      d: 0.9,
      h: 0.9,
      placeholder: true,
    },
  ],
}

async function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return t.app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) })
}

/** A project with space → plan → white; returns the ids. */
async function whiteModel() {
  const project = (
    await inject('POST', '/projects', { name: '视角测试', shopType: 'side_hall' })
  ).json<Project>()
  const create = async (payload: object) => {
    const response = await inject('POST', `/projects/${project.id}/nodes`, payload)
    expect(response.statusCode).toBe(201)
    return response.json<NodeCreated>().node
  }
  const space = await create({
    parentId: null,
    kind: 'space',
    name: '空间',
    space: { ...rectangleSpace(8, 6, 3.2), entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }] },
  })
  const plan = await create({ parentId: space.id, kind: 'plan', name: '方案', layout })
  const white = await create({ parentId: plan.id, kind: 'white', name: '白模确认', layout })
  return { project, plan, white }
}

const list = async (nodeId: string, includeDeleted = false) =>
  (
    await inject('GET', `/nodes/${nodeId}/cameras${includeDeleted ? '?includeDeleted=true' : ''}`)
  ).json<NodeCameraList>().cameras

const view = { name: '收银台近景', position: [6, 1.6, 5], target: [7, 1, 1], fovDeg: 55 }

describe('cameras', () => {
  it('gives a confirmed white model the eight default views, and plans none', async () => {
    const { plan, white } = await whiteModel()
    const cameras = await list(white.id)
    expect(cameras.map((c) => c.camera.name)).toEqual([...DEFAULT_VIEW_NAMES])
    expect(cameras.map((c) => c.sort)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(cameras.every((c) => c.camera.source === 'auto' && c.deletedAt === null)).toBe(true)
    // The front of the shop faces +z, so the front bird's-eye view stands beyond z = 6.
    expect(cameras[0]?.camera.position[2]).toBeGreaterThan(6)

    expect(await list(plan.id)).toEqual([])
    const refused = await inject('POST', `/nodes/${plan.id}/cameras`, view)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: { code: 'INVALID_STATE' } })
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

  it('carries the active views over when a white model is re-confirmed', async () => {
    const { project, white } = await whiteModel()
    const [first] = await list(white.id)
    await inject('DELETE', `/cameras/${first?.id}`)
    await inject('POST', `/nodes/${white.id}/cameras`, view)

    const next = await inject('POST', `/projects/${project.id}/nodes`, {
      parentId: white.id,
      kind: 'white',
      name: '白模确认（修改后）',
      layout,
    })
    const names = (await list(next.json<NodeCreated>().node.id)).map((c) => c.camera.name)
    expect(names).toEqual([...DEFAULT_VIEW_NAMES.slice(1), view.name])
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
