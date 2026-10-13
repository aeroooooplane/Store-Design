/**
 * Characterization tests for known behaviours that are due to change. Each test locks what
 * the API does today ("当前行为") so the later change is a deliberate, visible diff.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@store/database'
import { rectangleSpace } from '@store/shared'
import type {
  Asset,
  DesignNode,
  NodeCameraList,
  NodeCreated,
  NodeRenderList,
  NodeTree,
  Project,
  ProjectImported,
  RenderImage,
} from '@store/shared'
import { loadConfig } from '../src/config/env.ts'
import { systemContext } from '../src/context/actor.ts'
import { buildToolContext, findTool } from '../src/modules/agent/tools.ts'
import type { ToolOutcome } from '../src/modules/agent/tools.ts'
import { getProject } from '../src/modules/projects/service.ts'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp
let storage: string
const config = loadConfig({ NODE_ENV: 'test' })

/** Copied from agent.test.ts / layouts.test.ts (to be shared later): a table and a cabinet. */
const seeds: {
  id: string
  name: string
  fn: Asset['function']
  w: number
  d: number
  h: number
  front: string
}[] = [
  {
    id: 'asset-1',
    name: '1800mm普通中岛桌',
    fn: 'island_table',
    w: 1,
    d: 1.8,
    h: 1.327,
    front: 'any',
  },
  {
    id: 'asset-4',
    name: '1600mm配件柜',
    fn: 'accessory_cabinet',
    w: 1.6,
    d: 0.45,
    h: 2.4,
    front: '+Z',
  },
]

async function seedAssets() {
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
      variant: 'A',
      materialCategory: '软装物料',
      siFamily: 'SI1.0',
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
}

beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), 'store-quirks-'))
  t = await createTestApp({ STORAGE_ROOT: storage })
  await seedAssets()
})

afterAll(async () => {
  await t.close()
  await rm(storage, { recursive: true, force: true })
})

const island = (id: string, cx: number, cz: number) => ({
  id,
  assetId: 'asset-1',
  function: 'island_table',
  name: `中岛桌 ${id}`,
  cx,
  cz,
  rotation: 0,
  w: 1,
  d: 1.8,
  h: 1.327,
})
const layout = (...items: object[]) => ({ schemaVersion: 3, items })

async function newProject(name = '当前行为'): Promise<Project> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    payload: { name, shopType: 'island' },
  })
  expect(response.statusCode).toBe(201)
  return response.json<Project>()
}

function post(projectId: string, payload: object) {
  return t.app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/nodes`, payload })
}

async function create(projectId: string, payload: object): Promise<DesignNode> {
  const response = await post(projectId, payload)
  expect(response.statusCode).toBe(201)
  return response.json<NodeCreated>().node
}

/** An 8 × 6 × 3.2 m room whose whole front edge (z = 6) is the entrance. */
const spaceOf = (projectId: string) =>
  create(projectId, {
    parentId: null,
    kind: 'space',
    name: '空间',
    space: rectangleSpace(8, 6, 3.2),
  })

async function node(id: string | undefined): Promise<DesignNode> {
  const response = await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${id}` })
  expect(response.statusCode).toBe(200)
  return response.json<DesignNode>()
}

/** Runs one tool the way the agent service does: fresh context, input parsed by its schema. */
async function run(
  projectId: string,
  nodeId: string | null,
  name: string,
  input: object = {},
): Promise<ToolOutcome> {
  const tool = findTool(name)
  if (!tool) throw new Error(`no tool ${name}`)
  const ctx = systemContext('test')
  const project = await getProject(t.database.db, ctx, projectId)
  const tools = await buildToolContext(t.database.db, ctx, config, project, nodeId, [])
  return tool.run(tools, tool.schema.parse(input))
}

async function projectCount(): Promise<number> {
  const response = await t.app.inject({ method: 'GET', url: '/api/v1/projects?pageSize=100' })
  return response.json<{ total: number }>().total
}

describe('a. place_item 贴墙间隙', () => {
  it('当前行为：道具外沿离墙 0.02 m（WALL_GAP_M），四面墙都一样', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const place = async (modelId: string, along: string) => {
      const outcome = await run(project.id, space.id, 'place_item', { modelId, along })
      const saved = await node(outcome.nodeId)
      const item = saved.layout?.items[0]
      if (!item) throw new Error('nothing placed')
      return item
    }
    // [model, wall, expected centre and rotation, distance from the outer edge to that wall]
    const cases = [
      ['asset-1', 'back', { cx: 4, cz: 0.52, rotation: 90 }, (i: Box) => i.cz - i.d / 2],
      ['asset-1', 'front', { cx: 4, cz: 5.48, rotation: 90 }, (i: Box) => 6 - (i.cz + i.d / 2)],
      ['asset-1', 'left', { cx: 0.52, cz: 3, rotation: 0 }, (i: Box) => i.cx - i.w / 2],
      ['asset-1', 'right', { cx: 7.48, cz: 3, rotation: 0 }, (i: Box) => 8 - (i.cx + i.w / 2)],
      ['asset-4', 'back', { cx: 4, cz: 0.245, rotation: 0 }, (i: Box) => i.cz - i.d / 2],
      ['asset-4', 'front', { cx: 4, cz: 5.755, rotation: 180 }, (i: Box) => 6 - (i.cz + i.d / 2)],
      ['asset-4', 'left', { cx: 0.245, cz: 3, rotation: 270 }, (i: Box) => i.cx - i.w / 2],
      ['asset-4', 'right', { cx: 7.755, cz: 3, rotation: 90 }, (i: Box) => 8 - (i.cx + i.w / 2)],
    ] as const
    for (const [modelId, along, where, gap] of cases) {
      const item = await place(modelId, along)
      expect(item, `${modelId} ${along}`).toMatchObject(where)
      expect(gap(item), `${modelId} ${along}`).toBeCloseTo(0.02, 9)
    }
  })
})

type Box = { cx: number; cz: number; w: number; d: number }

/** Legacy backup with stages nested deeper than the new levels allow. */
const deepLegacy = {
  schemaVersion: 2,
  nodes: [
    {
      id: 'root-1',
      name: '旧店',
      kind: 'root',
      parent: null,
      room: { w: 8, d: 6, h: 3.2, shopType: '中岛店' },
    },
    ...(
      [
        ['plan-1', 'plan', 'root-1', '方案 A'],
        ['plan-2', 'plan', 'plan-1', '方案 A 再调'],
        ['edit-1', 'edit', 'plan-1', '调整'],
        ['white-1', 'white', 'plan-1', '白模'],
        ['white-2', 'white', 'white-1', '白模 再调'],
      ] as const
    ).map(([id, kind, parent, name]) => ({
      id,
      name,
      kind,
      parent,
      layout: {
        room: { w: 8, d: 6, h: 3.2 },
        items: [
          {
            id: 'real',
            name: '中岛桌',
            type: 'table',
            x: 1.5,
            z: 1.1,
            w: 1,
            d: 1.8,
            h: 1.327,
            assetId: 'asset-1',
          },
        ],
      },
    })),
  ],
}

describe('b. 旧项目深层级上的设计助理修改', () => {
  it('当前行为：导入保留“方案下挂方案/调整、白模下挂白模”，在这些节点上修改布局会因层级规则失败', async () => {
    const imported = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: deepLegacy },
    })
    expect(imported.statusCode).toBe(201)
    const { project, nodesImported, warnings } = imported.json<ProjectImported>()
    expect(nodesImported).toBe(6)
    expect(warnings).toEqual([])

    const nodes = (
      await t.app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/nodes` })
    ).json<NodeTree>().nodes
    const byName = (name: string) => {
      const found = nodes.find((n) => n.name === name)
      if (!found) throw new Error(`missing ${name}`)
      return found
    }
    const root = byName('旧店')
    const plan1 = byName('方案 A')
    const plan2 = byName('方案 A 再调')
    const edit1 = byName('调整')
    const white1 = byName('白模')
    const white2 = byName('白模 再调')
    // The import keeps the legacy nesting as it is (no extra space step: same room).
    expect(nodes.map((n) => [n.name, n.kind, n.parentId])).toEqual([
      ['旧店', 'space', null],
      ['方案 A', 'plan', root.id],
      ['方案 A 再调', 'plan', plan1.id],
      ['调整', 'edit', plan1.id],
      ['白模', 'white', plan1.id],
      ['白模 再调', 'white', white1.id],
    ])

    // On a node at its proper level the change works as usual.
    const fine = await run(project.id, white1.id, 'move_item', { itemId: 'real', dx_mm: 1000 })
    expect(await node(fine.nodeId)).toMatchObject({
      kind: 'white',
      parentId: plan1.id,
      name: '白模 · Agent',
    })

    // saveLayout files the copy under node.parentId, which here is a plan or a white model:
    // createNode's stage rule refuses it and nothing is created.
    const before = nodes.length + 1
    await expect(
      run(project.id, plan2.id, 'move_item', { itemId: 'real', dx_mm: 1000 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '方案只能建在空间下' })
    await expect(
      run(project.id, edit1.id, 'remove_item', { itemId: 'real' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '方案只能建在空间下' })
    await expect(
      run(project.id, white2.id, 'move_item', { itemId: 'real', along: 'back' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '白模只能建在方案下' })
    expect(
      (
        await t.app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/nodes` })
      ).json<NodeTree>().nodes,
    ).toHaveLength(before)

    // Tools that file under the space (found by walking up) are unaffected by the depth.
    const plans = await run(project.id, plan2.id, 'generate_plans')
    for (const id of plans.result.nodeIds as string[]) {
      expect((await node(id)).parentId).toBe(root.id)
    }
  })
})

describe("c. POST /projects/:id/nodes 接受 kind:'edit'", () => {
  it("当前行为：kind:'edit' 可以建在空间、方案、白模甚至渲染下面，来源记为 user", async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const edit = await create(project.id, {
      parentId: space.id,
      kind: 'edit',
      name: '调整',
      layout: layout(island('a', 2, 2)),
    })
    expect(edit).toMatchObject({ kind: 'edit', parentId: space.id, origin: 'user', strategy: null })
    expect(edit.layout?.items[0]).toMatchObject({ id: 'a', cx: 2, cz: 2 })

    // No stage rule for 'edit': it nests under every other stage.
    const plan = await create(project.id, {
      parentId: space.id,
      kind: 'plan',
      name: '方案',
      layout: layout(island('a', 2, 2)),
    })
    const white = await create(project.id, {
      parentId: plan.id,
      kind: 'white',
      name: '白模',
      layout: layout(island('a', 2, 2)),
    })
    const render = await create(project.id, {
      parentId: white.id,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout: layout(island('a', 2, 2)),
    })
    for (const parent of [plan, white, render, edit]) {
      const nested = await post(project.id, {
        parentId: parent.id,
        kind: 'edit',
        name: `调整 · ${parent.kind}`,
        layout: layout(island('a', 2, 2)),
      })
      expect(nested.statusCode, parent.kind).toBe(201)
      expect(nested.json<NodeCreated>().node).toMatchObject({ kind: 'edit', parentId: parent.id })
    }

    // Only a missing parent is refused (by the request schema, as for any non-space node).
    const orphan = await post(project.id, {
      parentId: null,
      kind: 'edit',
      name: '孤立',
      layout: layout(),
    })
    expect(orphan.statusCode).toBe(400)
    expect(orphan.json().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '请求体校验失败',
      details: [expect.objectContaining({ message: '该节点必须有父节点' })],
    })
  })
})

describe('d. 渲染上传仍接受 white 模式', () => {
  it('当前行为：PUT …/renders/:cameraId/white 返回 201 但不出现在列表中；POST 没有这个路由', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await create(project.id, {
      parentId: space.id,
      kind: 'plan',
      name: '方案',
      layout: layout(island('a', 2, 2)),
    })
    const white = await create(project.id, {
      parentId: plan.id,
      kind: 'white',
      name: '白模',
      layout: layout(island('a', 2, 2)),
    })
    const render = await create(project.id, {
      parentId: white.id,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout: layout(island('a', 2, 2)),
    })
    const cameras = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${render.id}/cameras` })
    ).json<NodeCameraList>().cameras
    const camera = cameras[0]
    if (!camera) throw new Error('views missing')
    const url = `/api/v1/nodes/${render.id}/renders/${camera.id}/white`

    const put = await t.app.inject({
      method: 'PUT',
      url,
      headers: { 'content-type': 'image/png' },
      payload: png(96, 64),
    })
    expect(put.statusCode).toBe(201)
    expect(put.json<RenderImage>()).toMatchObject({
      cameraId: camera.id,
      mode: 'white',
      width: 96,
      height: 64,
      stale: false,
    })
    const listed = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${render.id}/renders` })
    ).json<NodeRenderList>().images
    expect(listed).toEqual([])

    const posted = await t.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'image/png' },
      payload: png(96, 64),
    })
    expect(posted.statusCode).toBe(404)
    expect(posted.json().error.code).toBe('NOT_FOUND')
  })
})

describe('e. 导入不合规的旧版项目', () => {
  it('当前行为：道具尺寸超出 SizeSchema 上限（w > 50）时返回 500 INTERNAL，且不建项目', async () => {
    const before = await projectCount()
    const oversized = {
      nodes: [
        { id: 'root', name: '超大道具', kind: 'root', parent: null, room: { w: 8, d: 6, h: 3.2 } },
        {
          id: 'plan',
          name: '方案',
          kind: 'plan',
          parent: 'root',
          layout: {
            room: { w: 8, d: 6, h: 3.2 },
            items: [{ id: 'big', name: '超长桌', type: 'table', x: 0, z: 0, w: 60, d: 1, h: 1 }],
          },
        },
      ],
    }
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: oversized },
    })
    // LayoutSchema.parse throws a ZodError that the error handler does not map.
    expect(response.statusCode).toBe(500)
    expect(response.json().error).toMatchObject({ code: 'INTERNAL', message: '服务器内部错误' })
    expect(await projectCount()).toBe(before)

    // At the limit the same file imports.
    const atLimit = structuredClone(oversized)
    const item = atLimit.nodes[1]?.layout?.items[0]
    if (item) item.w = 50
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: atLimit },
    })
    expect(ok.statusCode).toBe(201)
  })
})
