import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import { schema } from '@store/database'
import { eq } from 'drizzle-orm'
import type {
  DesignNode,
  Draft,
  NodeCreated,
  NodeTree,
  ProjectExport,
  ProjectImported,
} from '@store/shared'
import {
  createProject,
  createSpace,
  islandItem as island,
  layoutOf as layout,
  postNode,
  seedAsset,
} from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
  await seedAsset(t)
})

afterAll(async () => {
  await t.close()
})

const newProject = (name = '节点测试') => createProject(t, { name, shopType: 'island' })
const post = (projectId: string, payload: object) => postNode(t, projectId, payload)
const spaceNode = (projectId: string) => createSpace(t, projectId)

describe('history nodes', () => {
  it('保留旧空间的原始 SI，切换后的兄弟空间使用独立 SI', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    expect(root.siStyle).toBe('SI1.0')
    await t.database.db
      .update(schema.designNodes)
      .set({ siStyle: null })
      .where(eq(schema.designNodes.id, root.id))
    const snapshot = { schemaVersion: 3, items: [], planning: null, fixtures: [] }
    const response = await post(project.id, {
      kind: 'space',
      parentId: null,
      sourceNodeId: root.id,
      name: '空间换版',
      space: root.space,
      layout: snapshot,
      siStyle: 'SI2.0',
    })
    expect(response.statusCode).toBe(201)
    expect(response.json<NodeCreated>().node).toMatchObject({
      parentId: null,
      sourceNodeId: root.id,
      siStyle: 'SI2.0',
      space: root.space,
      layout: snapshot,
    })
    await t.database.db
      .update(schema.projects)
      .set({ siStyle: 'SI2.0' })
      .where(eq(schema.projects.id, project.id))
    const original = await t.app.inject({ url: '/api/v1/nodes/' + root.id })
    expect(original.json<DesignNode>()).toMatchObject({
      siStyle: 'SI1.0',
      space: root.space,
      layout: null,
    })
  })

  it('边缘外扩一米内可开始渲染，超过一米的完整模型继续拦截', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const placed = layout(island('a', 8.5, 2))
    const plan = await post(project.id, {
      parentId: root.id,
      kind: 'plan',
      name: '场外一米方案',
      layout: placed,
    })
    expect(plan.statusCode).toBe(201)
    expect(plan.json<NodeCreated>().issues).toEqual([])
    const parentId = plan.json<NodeCreated>().node.id
    const render = await post(project.id, {
      parentId,
      kind: 'render',
      name: '允许出图',
      siStyle: 'SI1.0',
      layout: placed,
    })
    expect(render.statusCode).toBe(201)
    const refused = await post(project.id, {
      parentId,
      kind: 'render',
      name: '超限出图',
      siStyle: 'SI1.0',
      layout: layout(island('a', 8.51, 2)),
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.details).toContainEqual(
      expect.objectContaining({ code: 'item_outside_boundary' }),
    )
  })

  it('builds a tree of space and layout nodes and serves full nodes on demand', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const plan = await post(project.id, {
      parentId: root.id,
      kind: 'plan',
      name: '方案 A',
      strategy: 'max',
      layout: layout(island('a', 2, 2)),
    })
    expect(plan.statusCode).toBe(201)
    expect(plan.json<NodeCreated>()).toMatchObject({
      node: { kind: 'plan', origin: 'generator', strategy: 'max' },
      issues: [],
    })

    const tree = await t.app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/nodes` })
    expect(tree.json<NodeTree>().nodes.map((n) => n.kind)).toEqual(['space', 'plan'])
    expect(tree.json<NodeTree>().nodes[0]).not.toHaveProperty('space')

    const full = await t.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${plan.json<NodeCreated>().node.id}`,
    })
    expect(full.json<DesignNode>().layout?.items[0]).toMatchObject({ id: 'a', placeholder: false })
  })

  it('updates only the chosen space, plan or render and rebases its draft', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const planLayout = layout(island('a', 7.5, 2))
    const createPlan = async (name: string, sourceNodeId?: string) =>
      (
        await post(project.id, {
          parentId: root.id,
          kind: 'plan',
          name,
          layout: planLayout,
          ...(sourceNodeId ? { sourceNodeId } : {}),
        })
      ).json<NodeCreated>().node
    const plan = await createPlan('原方案')
    const sibling = await createPlan('另一方案')
    const render = (
      await post(project.id, {
        parentId: plan.id,
        kind: 'render',
        name: '原渲染',
        siStyle: 'SI1.0',
        layout: planLayout,
      })
    ).json<NodeCreated>().node
    const node = async (id: string) =>
      (await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${id}` })).json<DesignNode>()
    const save = (id: string, space: object, previousSpace: object) =>
      t.app.inject({
        method: 'PATCH',
        url: `/api/v1/nodes/${id}/space`,
        payload: { space, previousSpace },
      })
    const draft = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${project.id}/draft`,
      payload: { baseNodeId: plan.id, layout: layout(island('a', 7.5, 3)) },
    })
    expect(draft.statusCode).toBe(200)

    const initial = root.space!
    expect(
      (await save(root.id, { ...initial, height: 4, shopType: 'side_hall' }, initial)).statusCode,
    ).toBe(200)
    expect((await node(plan.id)).space).toEqual(initial)
    expect((await node(render.id)).space).toEqual(initial)
    expect((await createPlan('新方案')).space).toMatchObject({ height: 4, shopType: 'side_hall' })

    const wider = { ...rectangleSpace(9, 6, 3.2), shopType: 'zone' as const }
    const edited = await save(plan.id, wider, initial)
    expect(edited.statusCode).toBe(200)
    expect(edited.json<NodeCreated>().node).toMatchObject({
      id: plan.id,
      parentId: root.id,
      space: wider,
    })
    expect((await node(plan.id)).layout?.items[0]?.cx).toBe(8.5)
    expect((await node(sibling.id)).space).toEqual(initial)
    expect((await node(render.id)).space).toEqual(initial)
    expect((await createPlan('复制改墙方案', plan.id)).space).toEqual(wider)
    const drafts = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/drafts`,
    })
    expect(drafts.json<{ drafts: Draft[] }>().drafts).toMatchObject([
      { revision: 2, layout: { items: [{ cx: 8.5, cz: 3 }] } },
    ])
    expect((await save(plan.id, wider, initial)).statusCode).toBe(200)
    expect((await save(plan.id, { ...wider, height: 3.6 }, initial)).statusCode).toBe(409)

    const renderUpdate = await save(render.id, { ...initial, height: 3.6 }, initial)
    expect(renderUpdate.statusCode).toBe(200)
    expect(renderUpdate.json<NodeCreated>().node).toMatchObject({
      id: render.id,
      parentId: plan.id,
      kind: 'render',
      siStyle: 'SI1.0',
      space: { height: 3.6 },
    })
    expect((await node(plan.id)).space).toEqual(wider)
  })

  it('normalises spaces and rejects invalid ones', async () => {
    const project = await newProject()
    const ccw = rectangleSpace(6, 4, 3)
    const reversed = { ...ccw, boundary: [...ccw.boundary].reverse() }
    const ok = await post(project.id, {
      parentId: null,
      kind: 'space',
      name: '逆时针',
      space: reversed,
    })
    expect(ok.json<NodeCreated>().node.space?.boundary[1]).toEqual([6, 0])

    const bowtie = {
      ...ccw,
      boundary: [
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ],
    }
    const bad = await post(project.id, {
      parentId: null,
      kind: 'space',
      name: '自相交',
      space: bowtie,
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details[0].code).toBe('boundary_not_simple')
  })

  it('keeps design problems as issues but rejects broken model references', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const overlap = await post(project.id, {
      parentId: root.id,
      kind: 'plan',
      name: '重叠',
      layout: layout(island('a', 2, 2), island('b', 2.5, 2)),
    })
    expect(overlap.statusCode).toBe(201)
    expect(overlap.json<NodeCreated>().issues.map((i) => i.code)).toEqual(['item_overlap'])

    const stretched = await post(project.id, {
      parentId: root.id,
      kind: 'plan',
      name: '拉伸',
      layout: layout(island('a', 2, 2, { w: 1.5 })),
    })
    expect(stretched.statusCode).toBe(400)
    expect(stretched.json().error.details[0].code).toBe('item_asset_size_mismatch')

    const plan = await post(project.id, {
      parentId: root.id,
      kind: 'plan',
      name: '方案',
      layout: layout(island('a', 2, 2)),
    })
    const white = await post(project.id, {
      parentId: plan.json<NodeCreated>().node.id,
      kind: 'white',
      name: '白模',
      layout: layout(island('a', 2, 2), island('b', 2.5, 2)),
    })
    expect(white.statusCode).toBe(400)
    expect(white.json().error.message).toContain('进入三维效果前')
  })

  it('renders from plans directly and still accepts legacy 3D nodes', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const body = (parentId: string | null, kind: string) => ({
      parentId,
      kind,
      name: kind,
      layout: layout(island('a', 2, 2)),
      ...(kind === 'render' ? { siStyle: 'SI1.0' } : {}),
    })
    const plan = await post(project.id, body(root.id, 'plan'))
    const planId = plan.json<NodeCreated>().node.id
    const refused = [
      [planId, 'plan', '方案只能建在空间下'],
      [root.id, 'white', '旧版三维节点只能建在方案下'],
      [root.id, 'render', '渲染只能建在方案下'],
    ] as const
    for (const [parentId, kind, message] of refused) {
      const response = await post(project.id, body(parentId, kind))
      expect(response.statusCode).toBe(400)
      expect(response.json().error.message).toBe(message)
    }
    const direct = await post(project.id, body(planId, 'render'))
    expect(direct.statusCode).toBe(201)
    const white = await post(project.id, body(planId, 'white'))
    expect(white.statusCode).toBe(201)
    // A copy of the white model is its sibling, still under the plan.
    const copy = await post(project.id, {
      ...body(planId, 'white'),
      name: '白模 副本2',
      sourceNodeId: white.json<NodeCreated>().node.id,
    })
    const sourceId = white.json<NodeCreated>().node.id
    expect(copy.json<NodeCreated>().node).toMatchObject({
      parentId: planId,
      sourceNodeId: sourceId,
    })
    const baseUrl = `/api/v1/projects/${project.id}`
    const exported = (
      await t.app.inject({ method: 'GET', url: `${baseUrl}/export` })
    ).json<ProjectExport>()
    const imported = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/projects/import',
        payload: { data: exported },
      })
    ).json<ProjectImported>()
    const importedTree = (
      await t.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${imported.project.id}/nodes`,
      })
    ).json<NodeTree>()
    const restoredSource = importedTree.nodes.find((node) => node.importedFrom === sourceId)
    expect(restoredSource).toBeDefined()
    expect(importedTree.nodes.find((node) => node.name === '白模 副本2')?.sourceNodeId).toBe(
      restoredSource?.id,
    )
    const render = await post(project.id, body(copy.json<NodeCreated>().node.id, 'render'))
    expect(render.statusCode).toBe(201)
  })

  it('only accepts parents from the same project and refuses writes to binned projects', async () => {
    const first = await newProject('一')
    const second = await newProject('二')
    const root = await spaceNode(first.id)
    const foreign = await post(second.id, {
      parentId: root.id,
      kind: 'plan',
      name: '跨项目',
      layout: layout(),
    })
    expect(foreign.statusCode).toBe(404)

    await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${first.id}`,
      headers: { 'if-match': '"1"' },
    })
    const binned = await post(first.id, {
      parentId: root.id,
      kind: 'plan',
      name: '回收站',
      layout: layout(),
    })
    expect(binned.statusCode).toBe(409)
    expect(binned.json().error.code).toBe('INVALID_STATE')
  })

  it('renames, hides and restores without deleting anything', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${root.id}`,
      payload: { name: '主空间' },
    })
    expect(renamed.json<DesignNode>().name).toBe('主空间')

    await t.app.inject({ method: 'POST', url: `/api/v1/nodes/${root.id}/hide` })
    const visible = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/nodes`,
    })
    expect(visible.json<NodeTree>().nodes).toHaveLength(0)
    const all = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/nodes?includeHidden=true`,
    })
    expect(all.json<NodeTree>().nodes[0]).toMatchObject({ hidden: true })

    const restored = await t.app.inject({ method: 'POST', url: `/api/v1/nodes/${root.id}/restore` })
    expect(restored.json<DesignNode>().hidden).toBe(false)
  })
})

describe('drafts', () => {
  it('creates without a revision, then requires and enforces one', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const url = `/api/v1/projects/${project.id}/draft`
    const payload = { baseNodeId: root.id, layout: layout(island('a', 2, 2)) }

    const created = await t.app.inject({ method: 'PUT', url, payload })
    expect(created.statusCode).toBe(200)
    expect(created.headers.etag).toBe('"1"')

    const again = await t.app.inject({ method: 'PUT', url, payload })
    expect(again.statusCode).toBe(428)

    const updated = await t.app.inject({
      method: 'PUT',
      url,
      payload,
      headers: { 'if-match': '"1"' },
    })
    expect(updated.json().draft.revision).toBe(2)

    const stale = await t.app.inject({
      method: 'PUT',
      url,
      payload,
      headers: { 'if-match': '"1"' },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.details).toEqual({ currentRevision: 2 })

    expect((await t.app.inject({ method: 'GET', url })).json<Draft>().revision).toBe(2)
    const discarded = await t.app.inject({ method: 'DELETE', url, headers: { 'if-match': '"2"' } })
    expect(discarded.statusCode).toBe(204)
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(404)
  })

  it('isolates revisions, deletion and export round trips for two node drafts', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const plan = (
      await post(project.id, {
        parentId: root.id,
        kind: 'plan',
        name: '方案',
        layout: layout(),
      })
    ).json<NodeCreated>().node
    const url = `/api/v1/projects/${project.id}`
    const store = (baseNodeId: string, cx: number, revision?: string) =>
      t.app.inject({
        method: 'PUT',
        url: `${url}/draft`,
        headers: revision ? { 'if-match': revision } : {},
        payload: { baseNodeId, layout: layout(island('a', cx, 2)) },
      })
    const [first, second] = await Promise.all([store(root.id, 2), store(plan.id, 3)])
    expect([first.statusCode, second.statusCode]).toEqual([200, 200])
    expect((await store(plan.id, 4, '"1"')).statusCode).toBe(200)
    expect((await store(plan.id, 5, '"1"')).statusCode).toBe(409)

    const getDrafts = async (id: string) =>
      (await t.app.inject({ method: 'GET', url: `/api/v1/projects/${id}/drafts` })).json<{
        drafts: Draft[]
      }>().drafts
    const drafts = await getDrafts(project.id)
    expect(drafts.map((d) => [d.baseNodeId, d.revision, d.layout.items[0]?.cx])).toEqual([
      [plan.id, 2, 4],
      [root.id, 1, 2],
    ])
    const file = (await t.app.inject({ method: 'GET', url: `${url}/export` })).json<ProjectExport>()
    const imported = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: file },
    })
    expect(imported.statusCode).toBe(201)
    const restored = await getDrafts(imported.json<ProjectImported>().project.id)
    expect(restored.map((d) => d.layout.items[0]?.cx).sort()).toEqual([2, 4])

    const removed = await t.app.inject({
      method: 'DELETE',
      url: `${url}/draft?baseNodeId=${root.id}`,
      headers: { 'if-match': '"1"' },
    })
    expect(removed.statusCode).toBe(204)
    expect(await getDrafts(project.id)).toEqual([drafts[0]])
  })

  it('reports design issues and refuses render nodes as an editing base', async () => {
    const project = await newProject()
    const root = await spaceNode(project.id)
    const outside = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${project.id}/draft`,
      payload: { baseNodeId: root.id, layout: layout(island('a', 8.6, 2)) },
    })
    expect(outside.json().issues.map((i: { code: string }) => i.code)).toEqual([
      'item_outside_boundary',
    ])

    const stage = async (parentId: string, kind: 'plan' | 'white', name: string) =>
      (
        await post(project.id, { parentId, kind, name, layout: layout(island('a', 2, 2)) })
      ).json<NodeCreated>().node.id
    const white = await stage(await stage(root.id, 'plan', '方案'), 'white', '白模')
    const render = await post(project.id, {
      parentId: white,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout: layout(island('a', 2, 2)),
    })
    const onRender = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${project.id}/draft`,
      payload: { baseNodeId: render.json<NodeCreated>().node.id, layout: layout() },
      headers: { 'if-match': '"1"' },
    })
    expect(onRender.statusCode).toBe(409)
  })
})

/** Shaped like a backup from the legacy workbench (demo/src/sample.js in tag archive/pre-cleanup-20261013). */
const legacyBackup = {
  schemaVersion: 2,
  nodes: [
    {
      id: 'root-1',
      name: '上海星光摄影城',
      kind: 'root',
      parent: null,
      room: { w: 4.8, d: 5.15, h: 3.2, shopType: '中岛店' },
    },
    {
      id: 'plan-1',
      name: '方案 A',
      kind: 'plan',
      parent: 'root-1',
      layout: {
        room: { w: 4.8, d: 5.15, h: 3.2, shopType: '中岛店' },
        items: [
          {
            id: 'go',
            name: '1.8米go系列中岛桌',
            type: 'table',
            x: 1.77,
            z: 1.61,
            w: 1.8,
            d: 1,
            h: 0.9,
            // Any angle is kept now (it used to be imported as 0° with a warning).
            rotation: 30,
          },
          {
            id: 'real',
            name: '真实中岛桌',
            type: 'table',
            x: 0.5,
            z: 3,
            w: 1,
            d: 1.8,
            h: 1.327,
            assetId: 'asset-1',
          },
          {
            id: 'gone',
            name: '已下架模型',
            type: 'display',
            x: 3,
            z: 0.1,
            w: 1.2,
            d: 0.45,
            h: 1.5,
            // Within 3° of a quarter turn: that turn.
            rotation: 91,
            assetId: 'asset-999',
          },
          {
            id: 'block',
            name: '后侧结构占位',
            type: 'structure',
            x: 0,
            z: 0,
            w: 0.9,
            d: 0.39,
            h: 3.2,
          },
        ],
      },
    },
    // Legacy render nodes carry a full copy of the layout, structure placeholders included.
    {
      id: 'render-1',
      name: '渲染',
      kind: 'render',
      parent: 'plan-1',
      style: 'both',
      layout: {
        room: { w: 4.8, d: 5.15, h: 3.2 },
        items: [
          {
            id: 'block',
            name: '后侧结构占位',
            type: 'structure',
            x: 0,
            z: 0,
            w: 0.9,
            d: 0.39,
            h: 3.2,
          },
        ],
      },
    },
  ],
  editorDraft: { parent: 'plan-1', layout: { room: { w: 4.8, d: 5.15, h: 3.2 }, items: [] } },
}

describe('project import and export', () => {
  it('converts a legacy backup into a new project with explicit warnings', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: legacyBackup },
    })
    expect(response.statusCode).toBe(201)
    const imported = response.json<ProjectImported>()
    expect(imported).toMatchObject({
      format: 'legacy',
      draftImported: true,
      project: { name: '上海星光摄影城', shopType: 'island' },
    })
    // Structure placeholders put the plan in a different space, so a space step is inserted.
    expect(imported.nodesImported).toBe(4)
    expect(imported.warnings).toEqual([
      expect.stringContaining('已下架模型（asset-999）在当前模型目录中不存在'),
      expect.stringContaining('渲染风格“both”按 SI1.0 导入'),
    ])

    const tree = (
      await t.app.inject({ method: 'GET', url: `/api/v1/projects/${imported.project.id}/nodes` })
    ).json<NodeTree>()
    expect(tree.nodes.map((n) => n.kind)).toEqual(['space', 'space', 'plan', 'render'])
    const planned = tree.nodes.find((n) => n.kind === 'plan')
    const plan = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${planned?.id}` })
    ).json<DesignNode>()
    expect(plan.layout?.items.map((i) => i.id)).toEqual(['go', 'real', 'gone'])
    expect(plan.layout?.items[0]).toMatchObject({
      cx: 2.67,
      cz: 2.11,
      placeholder: true,
      function: 'island_table',
      rotation: 30,
    })
    expect(plan.layout?.items[1]).toMatchObject({ assetId: 'asset-1', placeholder: false })
    expect(plan.layout?.items[2]).toMatchObject({ assetId: null, placeholder: true, rotation: 90 })
    const planSpace = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${planned?.parentId}` })
    ).json<DesignNode>()
    expect(planSpace.space?.obstacles).toEqual([
      expect.objectContaining({
        label: '后侧结构占位',
        polygon: [
          [0, 0],
          [0.9, 0],
          [0.9, 0.39],
          [0, 0.39],
        ],
      }),
    ])
  })

  it('round-trips its own export, including hidden nodes and the draft', async () => {
    const source = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/projects/import',
        payload: { data: legacyBackup },
      })
    ).json<ProjectImported>()
    const tree = (
      await t.app.inject({ method: 'GET', url: `/api/v1/projects/${source.project.id}/nodes` })
    ).json<NodeTree>()
    await t.app.inject({ method: 'POST', url: `/api/v1/nodes/${tree.nodes[3]?.id}/hide` })

    const exported = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${source.project.id}/export`,
    })
    expect(exported.headers['content-disposition']).toContain('attachment')
    const file = exported.json<ProjectExport>()
    expect(file).toMatchObject({ format: 'store-design-project', schemaVersion: 1 })

    const again = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { name: '副本', data: file },
    })
    const copy = again.json<ProjectImported>()
    expect(copy).toMatchObject({
      format: 'store-design-project',
      nodesImported: 4,
      draftImported: true,
      warnings: [],
      project: { name: '副本' },
    })
    const copyTree = (
      await t.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${copy.project.id}/nodes?includeHidden=true`,
      })
    ).json<NodeTree>()
    expect(copyTree.nodes.filter((n) => n.hidden)).toHaveLength(1)
    expect(
      copyTree.nodes.every((n) =>
        tree.nodes.some((o) => o.id === n.importedFrom || o.importedFrom === n.importedFrom),
      ),
    ).toBe(true)
  })

  it('rejects unknown files and cycles without creating anything', async () => {
    const before = (
      await t.app.inject({ method: 'GET', url: '/api/v1/projects?pageSize=100' })
    ).json().total
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: { hello: 'world' } },
    })
    expect(unknown.statusCode).toBe(400)
    const cyclic = {
      nodes: [
        { id: 'a', name: 'A', kind: 'root', parent: 'b', room: { w: 4, d: 4, h: 3 } },
        {
          id: 'b',
          name: 'B',
          kind: 'plan',
          parent: 'a',
          layout: { room: { w: 4, d: 4, h: 3 }, items: [] },
        },
      ],
    }
    const cycle = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      payload: { data: cyclic },
    })
    expect(cycle.statusCode).toBe(400)
    expect(cycle.json().error.message).toContain('循环')
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/v1/projects?pageSize=100' })).json().total,
    ).toBe(before)
  })

  it('refuses to export an empty project', async () => {
    const project = await newProject()
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/export`,
    })
    expect(response.statusCode).toBe(409)
  })
})
