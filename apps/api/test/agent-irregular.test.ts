/**
 * The design assistant on irregular shops (L, U, trapezoid): props go against the real edges,
 * 'center' is a point inside the floor, a prop that does not fit is refused without a node, the
 * space description lists the edges, and edit_space moves and inserts vertices.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { itemCorners, obbInsidePolygon, placedBox, rectangleSpace } from '@store/shared'
import type { LayoutItem, NodeTree, Point, Space } from '@store/shared'
import { createProject, createSpace, getNode, runTool, seedAsset } from './fixtures.ts'
import type { AssetSeed, ToolCall } from './fixtures.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

/** A table without a front and a cabinet facing +Z. */
const seeds: AssetSeed[] = [
  { id: 'asset-1', name: '1800mm普通中岛桌', fn: 'island_table', w: 1, d: 1.8, h: 1.327 },
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

const run = (...call: ToolCall) => runTool(t, ...call)

/** An L-shaped shop, its front right quarter cut away; the entrance is 3 m of the front edge. */
const L_SHAPE: Point[] = [
  [0, 0],
  [8, 0],
  [8, 3],
  [5, 3],
  [5, 6],
  [0, 6],
]
/** A U-shaped shop: a 2 × 4 m notch cut into the middle of the back wall. */
const U_SHAPE: Point[] = [
  [0, 0],
  [3, 0],
  [3, 4],
  [5, 4],
  [5, 0],
  [8, 0],
  [8, 6],
  [0, 6],
]
/** A trapezoid: the right wall runs slanted from (10, 0) at the back to (8, 6) at the front. */
const TRAPEZOID: Point[] = [
  [0, 0],
  [10, 0],
  [8, 6],
  [0, 6],
]

const spaces = {
  L: {
    ...rectangleSpace(8, 6, 3.2),
    boundary: L_SHAPE,
    entrances: [{ kind: 'main', a: [4, 6], b: [1, 6] }],
  },
  U: { ...rectangleSpace(8, 6, 3.2), boundary: U_SHAPE },
  trapezoid: {
    ...rectangleSpace(8, 6, 3.2),
    boundary: TRAPEZOID,
    entrances: [{ kind: 'main', a: [0, 6], b: [8, 6] }],
    openEdges: [{ a: [0, 2], b: [0, 0] }],
  },
  /** The back edge drops 0.28 m over 7.58 m (2.1°), the left edge leans 0.42 m over 6 m (4.0°). */
  askew: {
    ...rectangleSpace(8, 6, 3.2),
    boundary: [
      [0.42, 0],
      [8, 0.28],
      [8, 6],
      [0, 6],
    ],
  },
}

/** An island shop (0.3 m off the walls) on one of the shapes. */
async function shop(shape: keyof typeof spaces | object, name = '异形店') {
  const project = await createProject(t, { name, shopType: 'island' })
  const space = await createSpace(t, project.id, typeof shape === 'string' ? spaces[shape] : shape)
  return { project, space }
}

async function nodeCount(projectId: string) {
  return (
    await t.app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/nodes` })
  ).json<NodeTree>().nodes.length
}

/** Places a model on the space node and returns the saved item. */
async function place(
  projectId: string,
  spaceId: string,
  modelId: string,
  along: string,
  position?: number,
): Promise<LayoutItem> {
  const outcome = await run(projectId, spaceId, 'place_item', {
    modelId,
    along,
    ...(position === undefined ? {} : { position }),
  })
  const item = (await getNode(t, outcome.nodeId)).layout?.items[0]
  if (!item) throw new Error('nothing placed')
  return item
}

/** Inside the shop by its true outline (turned when standing on a slanted wall). */
const inside = (item: LayoutItem, boundary: Point[]) => obbInsidePolygon(placedBox(item), boundary)

describe('place_item 贴真实的边', () => {
  it('L 形：前边分两段，position 按总长分布，不会放进缺口', async () => {
    const { project, space } = await shop('L')
    // The front edges: x 0–5 at z 6, then x 5–8 at z 3 (8 m in all). 0.8 → 6.4 m → the second
    // edge, 1.4 m along it; the bounding box used to put it at z 5.475, outside the shop.
    const cut = await place(project.id, space.id, 'asset-4', 'front', 0.8)
    expect(cut).toMatchObject({ cx: 6.4, cz: 2.475, rotation: 180, w: 1.6, d: 0.45 })
    expect(inside(cut, L_SHAPE)).toBe(true)
    const near = await place(project.id, space.id, 'asset-4', 'front', 0.2)
    expect(near).toMatchObject({ cx: 1.6, cz: 5.475, rotation: 180 })
    // The right wall: the outer one (z 0–3) and the inner step (x 5, z 3–6), back to front.
    expect(await place(project.id, space.id, 'asset-4', 'right', 0.75)).toMatchObject({
      cx: 4.475,
      cz: 4.5,
      rotation: 90,
    })
    for (const along of ['back', 'front', 'left', 'right', 'center']) {
      for (const position of [0, 0.3, 0.5, 0.7, 1]) {
        const item = await place(project.id, space.id, 'asset-1', along, position)
        expect(inside(item, L_SHAPE), `${along} ${position}`).toBe(true)
      }
    }
  })

  it('U 形：后墙中段是缺口底边；中央取店内的点而不是缺口', async () => {
    const { project, space } = await shop('U')
    // Back edges 3 + 2 + 3 m: the middle of the wall is the bottom of the notch.
    expect(await place(project.id, space.id, 'asset-4', 'back', 0.5)).toMatchObject({
      cx: 4,
      cz: 4.525,
      rotation: 0,
    })
    expect(await place(project.id, space.id, 'asset-4', 'back', 0)).toMatchObject({
      cx: 0.8,
      cz: 0.525,
    })
    // The left wall: the outer wall (x 0, 6 m) first, then the side of the notch (x 5, 4 m).
    expect(await place(project.id, space.id, 'asset-4', 'left', 0)).toMatchObject({
      cx: 0.525,
      cz: 0.8,
      rotation: 270,
    })
    expect(await place(project.id, space.id, 'asset-4', 'left', 0.8)).toMatchObject({
      cx: 5.525,
      cz: 2,
      rotation: 270,
    })
    // The bounding-box centre (4, 3) lies in the notch; the table goes to the most open point,
    // where the left arm meets the front part (about 1.53 m from the walls and the notch corner).
    const center = await place(project.id, space.id, 'asset-1', 'center')
    expect(center).toMatchObject({ cx: 1.535, cz: 4.465, rotation: 90 })
    expect(inside(center, U_SHAPE)).toBe(true)
    for (const along of ['back', 'front', 'left', 'right', 'center']) {
      for (const position of [0, 0.3, 0.5, 0.7, 1]) {
        const item = await place(project.id, space.id, 'asset-4', along, position)
        expect(inside(item, U_SHAPE), `${along} ${position}`).toBe(true)
      }
    }
  })

  it('梯形：斜墙上与墙平行、正面朝店内，背面离斜墙 0.3 m；锐角处沿墙滑开', async () => {
    const { project, space } = await shop('trapezoid')
    // The slanted wall 6x + 2z = 60 faces into the shop along (−6, −2): the cabinet's front (+Z)
    // turns that way, 108.4°; stored as at its nearest quarter turn (90°: 0.45 × 1.6).
    const slanted = await place(project.id, space.id, 'asset-4', 'right', 0.5)
    expect(slanted.rotation).toBeCloseTo(108.4, 1)
    expect(slanted).toMatchObject({ w: 0.45, d: 1.6 })
    // Flush with the wall: both back corners keep the gap, the front ones are 0.45 m further in.
    const gaps = itemCorners(slanted)
      .map(([x, z]) => (60 - 6 * x - 2 * z) / Math.sqrt(40))
      .sort((a, b) => a - b)
    expect(gaps[0]).toBeCloseTo(0.3, 2)
    expect(gaps[1]).toBeCloseTo(0.3, 2)
    expect(gaps[2]).toBeCloseTo(0.75, 2)
    expect(inside(slanted, TRAPEZOID)).toBe(true)
    // The back right corner is acute: the cabinet slides left until it clears the slanted wall.
    const end = await place(project.id, space.id, 'asset-4', 'back', 1)
    expect(end).toMatchObject({ cz: 0.525, rotation: 0 })
    expect(end.cx).toBeLessThanOrEqual(8.95)
    expect(end.cx).toBeGreaterThan(8.85)
    expect(inside(end, TRAPEZOID)).toBe(true)
    // The middle of the floor is the middle of its box here.
    expect(await place(project.id, space.id, 'asset-1', 'center')).toMatchObject({
      cx: 5,
      cz: 3,
      rotation: 90,
    })
    for (const along of ['back', 'front', 'left', 'right', 'center']) {
      for (const position of [0, 0.5, 1]) {
        const item = await place(project.id, space.id, 'asset-1', along, position)
        expect(inside(item, TRAPEZOID), `${along} ${position}`).toBe(true)
      }
    }
  })
})

describe('放不下时报错，不建节点', () => {
  it('a shallow trapezoid has no room for the table anywhere along its back wall', async () => {
    const { project, space } = await shop({
      ...rectangleSpace(10, 1, 3.2),
      boundary: [
        [0, 0],
        [10, 0],
        [9.5, 0.9],
        [0.5, 0.9],
      ],
      entrances: [{ kind: 'main', a: [9.5, 0.9], b: [0.5, 0.9] }],
    })
    const before = await nodeCount(project.id)
    await expect(
      run(project.id, space.id, 'place_item', { modelId: 'asset-1', along: 'back' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message:
        '「1800mm普通中岛桌 · A」放在后墙（position 0.5）会超出店铺边界，请换一个位置或换一面墙',
    })
    await expect(
      run(project.id, space.id, 'place_item', { modelId: 'asset-1', along: 'center' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('中央') })
    // The slanted side walls are about 1 m: too short for the table along them.
    await expect(
      run(project.id, space.id, 'place_item', { modelId: 'asset-1', along: 'left' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('左墙没有放得下「1800mm普通中岛桌 · A」的墙段'),
    })
    expect(await nodeCount(project.id)).toBe(before)
  })

  it('a column at the bottom of the U notch blocks the cabinet; move_item is refused too', async () => {
    const { project, space } = await shop({
      ...spaces.U,
      obstacles: [
        {
          kind: 'column',
          label: '柱子',
          polygon: [
            [3.8, 4.3],
            [4.2, 4.3],
            [4.2, 4.7],
            [3.8, 4.7],
          ],
        },
      ],
    })
    const before = await nodeCount(project.id)
    await expect(
      run(project.id, space.id, 'place_item', { modelId: 'asset-4', along: 'back' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '「1600mm配件柜 · A」放在后墙（position 0.5）会压住柱子，请换一个位置或换一面墙',
    })
    expect(await nodeCount(project.id)).toBe(before)
    const placed = await run(project.id, space.id, 'place_item', {
      modelId: 'asset-4',
      along: 'back',
      position: 0,
    })
    const count = await nodeCount(project.id)
    const itemId = (await getNode(t, placed.nodeId)).layout?.items[0]?.id
    await expect(
      run(project.id, placed.nodeId ?? null, 'move_item', { itemId, along: 'back' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await nodeCount(project.id)).toBe(count)
  })
})

describe('空间描述的边表', () => {
  const edgesOf = async (shape: keyof typeof spaces) => {
    const { project, space } = await shop(shape)
    const state = (await run(project.id, space.id, 'get_state')).result
    return (state.space as { edges: string[] }).edges
  }

  it('lists length, heading, wall, entrance and open edges per edge', async () => {
    expect(await edgesOf('L')).toEqual([
      'e0 8000mm 0° back',
      'e1 3000mm 90° right',
      'e2 3000mm 180° front',
      'e3 3000mm 90° right',
      'e4 5000mm 180° front 入口3000mm',
      'e5 6000mm 270° left',
    ])
    expect(await edgesOf('U')).toEqual([
      'e0 3000mm 0° back',
      'e1 4000mm 90° right',
      'e2 2000mm 0° back',
      'e3 4000mm 270° left',
      'e4 3000mm 0° back',
      'e5 6000mm 90° right',
      'e6 8000mm 180° front 入口',
      'e7 6000mm 270° left',
    ])
    expect(await edgesOf('trapezoid')).toEqual([
      'e0 10000mm 0° back',
      'e1 6325mm 108° 斜向(近right)',
      'e2 8000mm 180° front 入口',
      'e3 6000mm 270° left 开放边2000mm',
    ])
  })

  it('calls an edge square to its wall within 3°, as the automatic planner does', async () => {
    expect(await edgesOf('askew')).toEqual([
      'e0 7585mm 2° back',
      'e1 5720mm 90° right',
      'e2 8000mm 180° front 入口',
      'e3 6015mm 274° 斜向(近left)',
    ])
  })
})

describe('edit_space 移动和插入顶点', () => {
  const spaceOf = async (nodeId: string | undefined) => {
    const space = (await getNode(t, nodeId)).space
    if (!space) throw new Error('no space')
    return space
  }

  it('moves a vertex of the L shape and describes the new slanted edge', async () => {
    const { project, space } = await shop('L')
    const outcome = await run(project.id, space.id, 'edit_space', {
      move_vertex: { index: 3, x_mm: 5000, z_mm: 2000 },
    })
    expect((await spaceOf(outcome.nodeId)).boundary).toEqual([
      [0, 0],
      [8, 0],
      [8, 3],
      [5, 2],
      [5, 6],
      [0, 6],
    ])
    expect(outcome.result).toMatchObject({
      notes: ['顶点 3 已移到 (5000, 2000)'],
      space: {
        edges: expect.arrayContaining(['e2 3162mm 198° 斜向(近front)', 'e3 4000mm 90° right']),
      },
    })
    // The original space is untouched.
    expect((await spaceOf(space.id)).boundary).toEqual(L_SHAPE)
  })

  it('inserts a vertex at the middle of an edge or at a given point', async () => {
    const { project, space } = await shop('trapezoid')
    const middle = await run(project.id, space.id, 'edit_space', { insert_vertex: { edge: 0 } })
    expect((await spaceOf(middle.nodeId)).boundary).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [8, 6],
      [0, 6],
    ])
    // A dent in the back wall, then the vertex after it is still number 2.
    const dent = await run(project.id, space.id, 'edit_space', {
      insert_vertex: { edge: 0, x_mm: 4000, z_mm: 500 },
    })
    const dented = await spaceOf(dent.nodeId)
    expect(dented.boundary[1]).toEqual([4, 0.5])
    expect(dented.boundary[2]).toEqual([10, 0])
    expect(dented.openEdges).toEqual([{ a: [0, 2], b: [0, 0] }])
  })

  it('carries entrance ends on a moved corner along', async () => {
    const { project, space } = await shop(rectangleSpace(8, 6, 3.2))
    const outcome = await run(project.id, space.id, 'edit_space', {
      move_vertex: { index: 2, x_mm: 9000, z_mm: 6000 },
    })
    expect((await spaceOf(outcome.nodeId)).entrances).toEqual([
      { kind: 'main', a: [0, 6], b: [9, 6] },
    ])
  })

  it('refuses an invalid result and bad numbers without a node', async () => {
    const { project, space } = await shop('U')
    const before = await nodeCount(project.id)
    // Vertex 3 (5, 4) to (2, 4): the edge back to (5, 0) crosses the notch wall.
    await expect(
      run(project.id, space.id, 'edit_space', {
        move_vertex: { index: 3, x_mm: 2000, z_mm: 4000 },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('空间边界不闭合或存在自相交'),
    })
    await expect(
      run(project.id, space.id, 'edit_space', { move_vertex: { index: 8, x_mm: 0, z_mm: 0 } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '没有顶点 8（共 8 个，编号 0–7）',
    })
    await expect(
      run(project.id, space.id, 'edit_space', { insert_vertex: { edge: 8 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '没有边 8（共 8 条，编号 0–7）' })
    await expect(
      run(project.id, space.id, 'edit_space', { insert_vertex: { edge: 1, x_mm: 3000 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await nodeCount(project.id)).toBe(before)

    // The L's entrance (x 1–4 at z 6) is off the boundary once corner (5, 6) moves to (5, 7).
    const l = await shop('L')
    await expect(
      run(l.project.id, l.space.id, 'edit_space', {
        move_vertex: { index: 4, x_mm: 5000, z_mm: 7000 },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('入口 1 不在空间边界上'),
    })
  })
})

describe('边表与跨边入口', () => {
  it('marks every edge of an arc storefront entered along the boundary, not by its chord', async () => {
    const { describeEdges } = await import('../src/modules/agent/tools/describe.ts')
    // The front is a four-segment arc; one main entrance runs along it from (8, 6) to (0, 6).
    const arc: Space = {
      ...rectangleSpace(8, 6, 3.2),
      boundary: [
        [0, 0],
        [8, 0],
        [8, 6],
        [6, 6.6],
        [4, 6.8],
        [2, 6.6],
        [0, 6],
      ],
      entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }],
    }
    const lines = describeEdges(arc)
    expect(lines.filter((line) => line.endsWith(' 入口'))).toHaveLength(4)
    // No edge is marked as partly an entrance, and the side walls are not marked at all.
    expect(lines.some((line) => /入口\d+mm/.test(line))).toBe(false)
    expect(lines.filter((line) => line.includes('入口'))).toHaveLength(4)
  })
})
