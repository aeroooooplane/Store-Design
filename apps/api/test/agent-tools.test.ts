/**
 * Characterization tests for the design assistant's tools that agent.test.ts does not cover.
 * They call the tools directly (findTool + buildToolContext, as the agent service does) and
 * lock the current results, the nodes they create and the props' coordinates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NodeCameraList, NodeTree } from '@store/shared'
import {
  createNode,
  createProject,
  createSpace,
  getNode,
  islandItem as island,
  layoutOf as layout,
  runTool,
  seedAsset,
} from './fixtures.ts'
import type { AssetSeed, ToolCall } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

/** A table, a cashier, a cabinet. */
const seeds: AssetSeed[] = [
  {
    id: 'asset-1',
    name: '1800mm普通中岛桌',
    fn: 'island_table',
    w: 1,
    d: 1.8,
    h: 1.327,
    front: 'any',
  },
  { id: 'asset-3', name: '收银台', fn: 'cashier', w: 1.942, d: 0.648, h: 1.205, front: '+Z' },
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

beforeAll(async () => {
  t = await createTestApp()
  for (const s of seeds) await seedAsset(t, s)
})

afterAll(async () => {
  await t.close()
})

const newProject = (name = 'Agent 工具') => createProject(t, { name, shopType: 'island' })
const create = (projectId: string, payload: object) => createNode(t, projectId, payload)
/** An 8 × 6 × 3.2 m room whose whole front edge (z = 6) is the entrance. */
const spaceOf = (projectId: string) => createSpace(t, projectId)

const planOf = (projectId: string, parentId: string, items: object[], name = '方案 A') =>
  create(projectId, { parentId, kind: 'plan', name, layout: layout(...items) })

const whiteOf = (projectId: string, parentId: string, items: object[], name = '三维效果') =>
  create(projectId, { parentId, kind: 'white', name, layout: layout(...items) })

const node = (id: string | undefined) => getNode(t, id)

async function tree(projectId: string): Promise<NodeTree['nodes']> {
  return (
    await t.app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/nodes` })
  ).json<NodeTree>().nodes
}

async function cameras(nodeId: string) {
  return (
    await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${nodeId}/cameras` })
  ).json<NodeCameraList>().cameras
}

const run = (...call: ToolCall) => runTool(t, ...call)

describe('get_state（当前行为）', () => {
  it('describes the project, the current node, the space in millimetres and the props', async () => {
    const project = await newProject('状态')
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    const outcome = await run(project.id, plan.id, 'get_state', {}, ['a'])
    expect(outcome.nodeId).toBeUndefined()
    expect(outcome.result).toEqual({
      project: { name: '状态', shopType: '中岛店', market: 'domestic', siStyle: 'SI1.0' },
      currentNode: { id: plan.id, kind: 'plan', stage: '方案', name: '方案 A' },
      space: {
        boundary_mm: [
          [0, 0],
          [8000, 0],
          [8000, 6000],
          [0, 6000],
        ],
        size_mm: [8000, 6000],
        area_m2: 48,
        height_mm: 3200,
        entrances: [{ kind: 'main', a_mm: [0, 6000], b_mm: [8000, 6000] }],
        obstacles: [],
      },
      items: [
        {
          id: 'a',
          name: '中岛桌 a',
          function: '中岛桌',
          modelId: 'asset-1',
          cx_mm: 2000,
          cz_mm: 2000,
          width_mm: 1000,
          depth_mm: 1800,
          height_mm: 1327,
          rotation: 0,
          placeholder: false,
        },
      ],
      selectedItemIds: ['a'],
      issues: [],
    })
    // Nothing was written.
    expect((await tree(project.id)).map((n) => n.kind)).toEqual(['space', 'plan'])
  })

  it('reports stage labels and layout issues; without a node there is no space or props', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const overlap = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 2.5, 2)])
    const state = (await run(project.id, overlap.id, 'get_state')).result
    expect(state.issues).toEqual([
      { severity: 'error', message: '中岛桌 a与中岛桌 b重叠', itemIds: ['a', 'b'] },
    ])

    const onSpace = (await run(project.id, space.id, 'get_state')).result
    expect(onSpace.currentNode).toEqual({
      id: space.id,
      kind: 'space',
      stage: '空间',
      name: '空间',
    })
    expect(onSpace.items).toEqual([])
    expect(onSpace.issues).toEqual([])

    const plan = await planOf(project.id, space.id, [island('a', 2, 2)], '方案 B')
    const white = await whiteOf(project.id, plan.id, [island('a', 2, 2)])
    const onWhite = (await run(project.id, white.id, 'get_state')).result
    expect(onWhite.currentNode).toMatchObject({ kind: 'white', stage: '三维效果' })
    const edit = await create(project.id, {
      parentId: space.id,
      kind: 'edit',
      name: '调整',
      layout: layout(),
    })
    const onEdit = (await run(project.id, edit.id, 'get_state')).result
    expect(onEdit.currentNode).toMatchObject({ kind: 'edit', stage: '方案' })

    const none = (await run(project.id, null, 'get_state')).result
    expect(none).toMatchObject({ currentNode: null, space: null, items: [], issues: [] })
  })
})

describe('generate_plans（当前行为）', () => {
  it('saves three plans under the space, named by strategy, and continues from the last', async () => {
    const project = await newProject('生成')
    const space = await spaceOf(project.id)
    const outcome = await run(project.id, space.id, 'generate_plans')
    const plans = outcome.result.plans as {
      nodeId: string
      name: string
      items: number
      issues: number
      notes: unknown
    }[]
    expect(plans.map((p) => p.name)).toEqual([
      '方案 · 尽量多放',
      '方案 · 按面积推荐',
      '方案 · 尽量少放',
    ])
    expect(outcome.result.nodeIds).toEqual(plans.map((p) => p.nodeId))
    expect(outcome.nodeId).toBe(plans[2]?.nodeId)
    expect(plans.map((p) => p.issues)).toEqual([0, 0, 0])
    expect(plans.every((p) => Array.isArray(p.notes))).toBe(true)

    const strategies = ['max', 'area', 'min']
    for (const [index, plan] of plans.entries()) {
      const saved = await node(plan.nodeId)
      expect(saved).toMatchObject({
        kind: 'plan',
        parentId: space.id,
        origin: 'agent',
        name: plan.name,
        strategy: strategies[index],
        siStyle: 'SI1.0',
      })
      expect(saved.layout?.items).toHaveLength(plan.items)
      expect(saved.layout?.items.length).toBeGreaterThan(0)
      // Every prop comes from the seeded SI1.0 catalogue.
      expect(
        saved.layout?.items.every((i) =>
          ['asset-1', 'asset-3', 'asset-4'].includes(i.assetId ?? ''),
        ),
      ).toBe(true)
    }
    // The planner is deterministic: lock what it places today ([model, cx, cz, rotation, w, d]).
    const placed = async (id: string) =>
      (await node(id)).layout?.items.map((i) => [i.assetId, i.cx, i.cz, i.rotation, i.w, i.d])
    const cashier = ['asset-3', 0.971, 0.624, 0, 1.942, 0.648]
    const cabinet = (cx: number) => ['asset-4', cx, 0.525, 0, 1.6, 0.45]
    const table = (cx: number, cz: number) => ['asset-1', cx, cz, 90, 1.8, 1]
    expect(plans.map((p) => p.items)).toEqual([8, 6, 3])
    expect(await placed(plans[0]?.nodeId ?? '')).toEqual([
      cashier,
      table(5.5, 2.2),
      table(1.8, 2.4),
      table(5.5, 4.1),
      table(1.8, 4.3),
      cabinet(2.8),
      cabinet(4.4),
      cabinet(6),
    ])
    expect(await placed(plans[1]?.nodeId ?? '')).toEqual([
      cashier,
      table(5.5, 4.1),
      table(1.8, 2.4),
      cabinet(2.8),
      cabinet(4.4),
      cabinet(6),
    ])
    expect(await placed(plans[2]?.nodeId ?? '')).toEqual([cashier, table(5.5, 4.1), cabinet(2.8)])
  })

  it('numbers repeated names and always files the plans under the space above the current node', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    await run(project.id, space.id, 'generate_plans')
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    const again = await run(project.id, plan.id, 'generate_plans')
    const plans = again.result.plans as { nodeId: string; name: string }[]
    expect(plans.map((p) => p.name)).toEqual([
      '方案 · 尽量多放（2）',
      '方案 · 按面积推荐（2）',
      '方案 · 尽量少放（2）',
    ])
    for (const p of plans) expect((await node(p.nodeId)).parentId).toBe(space.id)

    await expect(run(project.id, null, 'generate_plans')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: '项目还没有空间，请先录入或识别空间',
    })
  })
})

describe('move_item', () => {
  it('moves a prop against a wall: long side along it, the island wallGap (0.3 m) inside, saved as a sibling plan', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 6, 3)])
    const outcome = await run(project.id, plan.id, 'move_item', { itemId: 'a', along: 'back' })
    expect(outcome.result).toMatchObject({
      done: '已移动「中岛桌 a」',
      nodeId: outcome.nodeId,
      nodeName: '方案 A · Agent',
      items: 2,
      issues: [],
      item: { id: 'a', cx_mm: 4000, cz_mm: 800, width_mm: 1800, depth_mm: 1000, rotation: 90 },
    })
    expect(outcome.result).not.toHaveProperty('warning')
    const moved = await node(outcome.nodeId)
    expect(moved).toMatchObject({ kind: 'plan', parentId: space.id, origin: 'agent' })
    expect(moved.layout?.items).toHaveLength(2)
    expect(moved.layout?.items[0]).toMatchObject({
      id: 'a',
      cx: 4,
      cz: 0.8,
      rotation: 90,
      w: 1.8,
      d: 1,
    })
    // The other prop and the original plan are untouched.
    expect(moved.layout?.items[1]).toMatchObject({
      id: 'b',
      cx: 6,
      cz: 3,
      rotation: 0,
      w: 1,
      d: 1.8,
    })
    expect((await node(plan.id)).layout?.items[0]).toMatchObject({ cx: 2, cz: 2 })
  })

  it('places along each wall and clamps the position to the wall ends', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const cabinet = {
      id: 'c',
      assetId: 'asset-4',
      function: 'accessory_cabinet',
      name: '配件柜',
      cx: 4,
      cz: 3,
      rotation: 0,
      w: 1.6,
      d: 0.45,
      h: 2.4,
    }
    const plan = await planOf(project.id, space.id, [island('a', 2, 2), cabinet])
    const at = async (itemId: string, along: string, position?: number) =>
      (
        await run(project.id, plan.id, 'move_item', {
          itemId,
          along,
          ...(position === undefined ? {} : { position }),
        })
      ).result.item
    // The table has no front: its long side lies along the wall.
    expect(await at('a', 'left', 0)).toMatchObject({
      cx_mm: 800,
      cz_mm: 900,
      width_mm: 1000,
      depth_mm: 1800,
      rotation: 0,
    })
    expect(await at('a', 'right', 1)).toMatchObject({ cx_mm: 7200, cz_mm: 5100, rotation: 0 })
    expect(await at('a', 'front', 0.5)).toMatchObject({ cx_mm: 4000, cz_mm: 5200, rotation: 90 })
    expect(await at('a', 'center')).toMatchObject({ cx_mm: 4000, cz_mm: 3000, rotation: 90 })
    // The cabinet's front (+Z) faces into the shop from every wall.
    expect(await at('c', 'back', 0)).toMatchObject({
      cx_mm: 800,
      cz_mm: 525,
      width_mm: 1600,
      depth_mm: 450,
      rotation: 0,
    })
    expect(await at('c', 'front')).toMatchObject({ cx_mm: 4000, cz_mm: 5475, rotation: 180 })
    expect(await at('c', 'left')).toMatchObject({
      cx_mm: 525,
      cz_mm: 3000,
      width_mm: 450,
      depth_mm: 1600,
      rotation: 270,
    })
    expect(await at('c', 'right')).toMatchObject({ cx_mm: 7475, cz_mm: 3000, rotation: 90 })
    // Every move started from the same plan, so the names keep counting up.
    const names = (await tree(project.id)).filter((n) => n.origin === 'agent').map((n) => n.name)
    expect(names).toEqual([
      '方案 A · Agent',
      '方案 A · Agent（2）',
      '方案 A · Agent（3）',
      '方案 A · Agent（4）',
      '方案 A · Agent（5）',
      '方案 A · Agent（6）',
      '方案 A · Agent（7）',
      '方案 A · Agent（8）',
    ])
  })

  it('moves by a relative offset in millimetres and keeps the rotation', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(
      project.id,
      space.id,
      [island('a', 2, 2, { rotation: 90, w: 1.8, d: 1 })],
      '方案 A（3）',
    )
    const outcome = await run(project.id, plan.id, 'move_item', {
      itemId: 'a',
      dx_mm: 500,
      dz_mm: -250,
    })
    // The "（3）" suffix of the source name is dropped before " · Agent".
    expect(outcome.result).toMatchObject({
      nodeName: '方案 A · Agent',
      item: { cx_mm: 2500, cz_mm: 1750, width_mm: 1800, depth_mm: 1000, rotation: 90 },
    })
    const moved = await node(outcome.nodeId)
    expect(moved.layout?.items[0]).toMatchObject({ cx: 2.5, cz: 1.75, rotation: 90, w: 1.8, d: 1 })
  })

  it('keeps a moved white model at the white stage, beside the original under its plan', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    const white = await whiteOf(project.id, plan.id, [island('a', 2, 2)])
    const outcome = await run(project.id, white.id, 'move_item', { itemId: 'a', dx_mm: 1000 })
    const moved = await node(outcome.nodeId)
    expect(moved).toMatchObject({
      kind: 'white',
      parentId: plan.id,
      origin: 'agent',
      name: '三维效果 · Agent',
    })
    expect(moved.layout?.items[0]).toMatchObject({ cx: 3, cz: 2 })
    // A white step gets its views (copied from the source white model).
    expect(await cameras(moved.id)).toHaveLength(8)
  })

  it('reports layout errors of the saved step as a warning', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 5, 2)])
    const outcome = await run(project.id, plan.id, 'move_item', { itemId: 'b', dx_mm: -2500 })
    expect(outcome.result).toMatchObject({
      items: 2,
      issues: ['中岛桌 a与中岛桌 b重叠'],
      warning: '有 1 个问题需要处理，进入三维效果前须解决',
    })
    expect((await node(outcome.nodeId)).layout?.items[1]).toMatchObject({ cx: 2.5, cz: 2 })
  })

  it('refuses unknown props and render nodes', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    await expect(
      run(project.id, plan.id, 'move_item', { itemId: 'nope', dx_mm: 100 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '布局中没有道具 nope' })
    const white = await whiteOf(project.id, plan.id, [island('a', 2, 2)])
    const render = await create(project.id, {
      parentId: white.id,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout: layout(island('a', 2, 2)),
    })
    await expect(
      run(project.id, render.id, 'move_item', { itemId: 'a', dx_mm: 100 }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: '渲染节点不能修改，请先回到它的白模',
    })
  })
})

describe('remove_item（当前行为）', () => {
  it('saves the layout without the prop as a new sibling plan', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 5, 3)])
    const outcome = await run(project.id, plan.id, 'remove_item', { itemId: 'a' })
    expect(outcome.result).toEqual({
      done: '已删除「中岛桌 a」',
      nodeId: outcome.nodeId,
      nodeName: '方案 A · Agent',
      items: 1,
      issues: [],
    })
    const saved = await node(outcome.nodeId)
    expect(saved).toMatchObject({ kind: 'plan', parentId: space.id, origin: 'agent' })
    expect(saved.layout?.items.map((i) => [i.id, i.cx, i.cz, i.rotation])).toEqual([['b', 5, 3, 0]])
    expect((await node(plan.id)).layout?.items).toHaveLength(2)

    // Removing the last prop leaves an empty plan.
    const empty = await run(project.id, outcome.nodeId ?? null, 'remove_item', { itemId: 'b' })
    expect(empty.result).toMatchObject({ nodeName: '方案 A · Agent · Agent', items: 0 })
    expect((await node(empty.nodeId)).layout?.items).toEqual([])
  })

  it('refuses a prop that is not in the layout (a space has no layout)', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    await expect(run(project.id, space.id, 'remove_item', { itemId: 'a' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '布局中没有道具 a',
    })
  })
})

describe('validate（当前行为）', () => {
  it('lists layout problems without creating a node', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [
      island('a', 2, 2),
      island('b', 2.5, 2),
      island('c', 7.9, 3),
    ])
    const outcome = await run(project.id, plan.id, 'validate')
    expect(outcome.nodeId).toBeUndefined()
    const issues = outcome.result.issues as {
      severity: string
      message: string
      itemIds: string[]
    }[]
    expect(issues).toEqual([
      { severity: 'error', message: '中岛桌 c超出空间边界', itemIds: ['c'] },
      { severity: 'error', message: '中岛桌 a与中岛桌 b重叠', itemIds: ['a', 'b'] },
    ])
    expect(await tree(project.id)).toHaveLength(2)
  })

  it('finds nothing on a space or a clean plan, and needs a space', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    expect((await run(project.id, space.id, 'validate')).result).toEqual({ issues: [] })
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    expect((await run(project.id, plan.id, 'validate')).result).toEqual({ issues: [] })
    await expect(run(project.id, null, 'validate')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })
})

describe('confirm_white（当前行为）', () => {
  it('adds a white step under the plan with the same layout and the default views', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 5, 3)])
    const outcome = await run(project.id, plan.id, 'confirm_white')
    expect(outcome.result).toEqual({
      done: '已进入三维效果',
      nodeId: outcome.nodeId,
      nodeName: '三维效果',
    })
    const white = await node(outcome.nodeId)
    expect(white).toMatchObject({
      kind: 'white',
      parentId: plan.id,
      origin: 'agent',
      name: '三维效果',
    })
    expect(white.layout?.items.map((i) => [i.id, i.cx, i.cz, i.rotation])).toEqual([
      ['a', 2, 2, 0],
      ['b', 5, 3, 0],
    ])
    expect(await cameras(white.id)).toHaveLength(8)

    const again = await run(project.id, plan.id, 'confirm_white')
    expect(again.result.nodeName).toBe('三维效果（2）')
  })

  it('accepts legacy edit nodes, refuses other stages and layouts with errors', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const edit = await create(project.id, {
      parentId: space.id,
      kind: 'edit',
      name: '调整',
      layout: layout(island('a', 2, 2)),
    })
    const fromEdit = await run(project.id, edit.id, 'confirm_white')
    expect(await node(fromEdit.nodeId)).toMatchObject({ kind: 'white', parentId: edit.id })

    await expect(run(project.id, space.id, 'confirm_white')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: '只能从方案节点进入三维效果',
    })
    const overlap = await planOf(project.id, space.id, [island('a', 2, 2), island('b', 2.5, 2)])
    await expect(run(project.id, overlap.id, 'confirm_white')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '进入三维效果前须先解决越界、重叠等问题',
    })
  })
})

describe('start_render（当前行为）', () => {
  it('adds a render step under the white model in the project SI style', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    const white = await whiteOf(project.id, plan.id, [island('a', 2, 2)])
    const outcome = await run(project.id, white.id, 'start_render')
    expect(outcome.result).toEqual({
      done: '已创建渲染节点，打开它即可渲染',
      nodeId: outcome.nodeId,
      nodeName: '渲染',
    })
    const render = await node(outcome.nodeId)
    expect(render).toMatchObject({
      kind: 'render',
      parentId: white.id,
      origin: 'agent',
      name: '渲染',
      siStyle: 'SI1.0',
    })
    expect(render.layout?.items.map((i) => [i.id, i.cx, i.cz, i.rotation])).toEqual([
      ['a', 2, 2, 0],
    ])
    // The render inherits the white model's views.
    const whiteViews = (await cameras(white.id)).map((c) => c.camera.name)
    expect((await cameras(render.id)).map((c) => c.camera.name)).toEqual(whiteViews)

    expect((await run(project.id, white.id, 'start_render')).result.nodeName).toBe('渲染（2）')
    await expect(run(project.id, plan.id, 'start_render')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: '只能从白模节点开始渲染',
    })
  })
})

describe('remove_view（当前行为）', () => {
  it('soft-deletes a view of the current white or render node and returns it for restoring', async () => {
    const project = await newProject()
    const space = await spaceOf(project.id)
    const plan = await planOf(project.id, space.id, [island('a', 2, 2)])
    const white = await whiteOf(project.id, plan.id, [island('a', 2, 2)])
    const views = await cameras(white.id)
    expect(views).toHaveLength(8)
    const first = views[0]
    if (!first) throw new Error('views missing')
    const outcome = await run(project.id, white.id, 'remove_view', { cameraId: first.id })
    expect(outcome.nodeId).toBeUndefined()
    expect(outcome.result).toEqual({
      done: `已删除视角「${first.camera.name}」`,
      restoreCameraId: first.id,
    })
    expect((await cameras(white.id)).map((c) => c.id)).toEqual(views.slice(1).map((c) => c.id))

    // A deleted view is no longer the node's.
    await expect(
      run(project.id, white.id, 'remove_view', { cameraId: first.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '当前节点没有这个视角' })

    const render = await create(project.id, {
      parentId: white.id,
      kind: 'render',
      name: '渲染',
      siStyle: 'SI1.0',
      layout: layout(island('a', 2, 2)),
    })
    const renderViews = await cameras(render.id)
    const removed = await run(project.id, render.id, 'remove_view', {
      cameraId: renderViews[0]?.id,
    })
    expect(removed.result.restoreCameraId).toBe(renderViews[0]?.id)
    // Another node's view cannot be removed from here.
    await expect(
      run(project.id, render.id, 'remove_view', { cameraId: views[1]?.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      run(project.id, plan.id, 'remove_view', { cameraId: views[1]?.id }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: '只有三维效果或渲染节点有视角，请先进入三维效果',
    })
  })
})

describe('export_project（当前行为）', () => {
  it('only returns the export URL, with or without a node', async () => {
    const project = await newProject()
    const outcome = await run(project.id, null, 'export_project')
    expect(outcome).toEqual({ result: { url: `/api/v1/projects/${project.id}/export` } })

    const space = await spaceOf(project.id)
    const onSpace = await run(project.id, space.id, 'export_project')
    expect(onSpace.result.url).toBe(`/api/v1/projects/${project.id}/export`)
    const exported = await t.app.inject({ method: 'GET', url: String(onSpace.result.url) })
    expect(exported.statusCode).toBe(200)
  })
})
