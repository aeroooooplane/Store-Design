import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { followSpaceWalls, rectangleSpace } from '@store/shared'
import type { Asset, DesignNode, Draft, Layout, LayoutItem, Project, Space } from '@store/shared'
import { makeAsset, makeCamera, makeNode, makeProject } from '../../test-utils/factories.ts'
import { json, stubFetch } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import { Workbench } from './Workbench.tsx'
import type { SpaceSketch } from './space-capture/space-sketch.ts'

const PID = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'

const project = makeProject({ id: PID })

const table: LayoutItem = {
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
  locked: false,
}
const layout = (items: LayoutItem[]): Layout => ({ schemaVersion: 3, items, planning: null })

function designNode(
  id: string,
  parentId: string | null,
  overrides: Partial<DesignNode> = {},
): DesignNode {
  return makeNode(id, parentId, {
    projectId: PID,
    space: parentId === null ? rectangleSpace(8, 6, 3.2) : null,
    layout: parentId === null ? null : layout([table]),
    ...overrides,
  })
}

/** A catalogue model with just what the workbench reads. */
function catalogAsset(
  id: string,
  siFamily: string,
  w: number,
  d: number,
  front: Asset['front'],
): Asset {
  return makeAsset({
    id,
    name: `${siFamily} 1.2米配件柜`,
    standardName: '1.2米配件柜',
    siFamily,
    function: 'accessory_cabinet',
    footprint: { w, d, h: 2.4 },
    front,
  })
}

/** In-memory stand-in for the node, draft, asset and layout APIs. */
function fakeApi(
  nodes: DesignNode[],
  draft: Draft | null,
  assets: Asset[] = [],
  options: { failCreate?: boolean } = {},
) {
  const state = {
    nodes: [...nodes],
    drafts: new Map(draft ? [[draft.baseNodeId, draft]] : []),
    project,
  }
  const fail = (status: number, code: string, message = code) =>
    json(status, { error: { code, message, requestId: 'r' } })

  function effectiveSpace(node: DesignNode): Space | null {
    const parent = state.nodes.find((candidate) => candidate.id === node.parentId)
    return node.space ?? (parent ? effectiveSpace(parent) : null)
  }
  const { calls, fetchMock } = stubFetch(({ request, url, route, body, ifMatch }) => {
    if (route === `GET /api/v1/projects/${PID}/nodes`) {
      const summaries = state.nodes.map(({ projectId: _p, space: _s, layout: _l, ...s }) => s)
      return json(200, { projectId: PID, nodes: summaries })
    }
    if (route === `GET /api/v1/projects/${PID}/drafts`) {
      return json(200, { drafts: [...state.drafts.values()] })
    }
    if (route === `PUT /api/v1/projects/${PID}/draft`) {
      const put = body as Pick<Draft, 'baseNodeId' | 'layout'>
      const current = state.drafts.get(put.baseNodeId)
      if (current && ifMatch === null) return fail(428, 'REVISION_REQUIRED')
      if (ifMatch !== (current ? `"${current.revision}"` : null))
        return fail(409, 'REVISION_CONFLICT')
      const saved = {
        projectId: PID,
        ...put,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: '2026-10-09T04:00:00.000Z',
      }
      state.drafts.set(put.baseNodeId, saved)
      return json(200, { draft: saved, issues: [] })
    }
    if (route === `DELETE /api/v1/projects/${PID}/draft`) {
      const baseNodeId = url.searchParams.get('baseNodeId') ?? ''
      const current = state.drafts.get(baseNodeId)
      if (!current || ifMatch !== `"${current.revision}"`) return fail(409, 'REVISION_CONFLICT')
      state.drafts.delete(baseNodeId)
      return new Response(null, { status: 204 })
    }
    if (route === `POST /api/v1/projects/${PID}/nodes`) {
      if (options.failCreate) {
        return fail(400, 'VALIDATION_FAILED', '进入三维效果前须先解决越界、重叠等问题')
      }
      const input = body as Partial<DesignNode> & Pick<DesignNode, 'kind' | 'name' | 'parentId'>
      const created = designNode(crypto.randomUUID(), input.parentId, {
        ...input,
        space: input.space ?? null,
        layout: input.layout ?? null,
        strategy: input.strategy ?? null,
        siStyle: input.siStyle ?? null,
      })
      state.nodes.push(created)
      return json(201, { node: { ...created, space: effectiveSpace(created) }, issues: [] })
    }
    if (route === 'GET /api/v1/assets') return json(200, { items: assets, total: assets.length })
    if (route === `PATCH /api/v1/projects/${PID}`) {
      state.project = {
        ...state.project,
        ...(body as Partial<Project>),
        revision: state.project.revision + 1,
      }
      return json(200, state.project)
    }
    if (request.method === 'GET' && url.pathname.endsWith('/cameras')) {
      const nodeId = url.pathname.split('/')[4] ?? P2
      return json(200, { nodeId, cameras: [makeCamera(0, nodeId, '正面鸟瞰')] })
    }

    const spaceEdit = /^PATCH \/api\/v1\/nodes\/([^/]+)\/space$/.exec(route)
    if (spaceEdit) {
      const row = state.nodes.find((node) => node.id === spaceEdit[1])
      const prior = row && effectiveSpace(row)
      if (!row || !prior) return fail(404, 'NOT_FOUND')
      const { space } = body as { space: Space }
      state.nodes = state.nodes.map((node) =>
        node.id === row.id
          ? { ...node, space, layout: node.layout && followSpaceWalls(node.layout, prior, space) }
          : node.parentId === row.id && !node.space
            ? { ...node, space: prior }
            : node,
      )
      return json(200, { node: state.nodes.find((node) => node.id === row.id), issues: [] })
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/v1/nodes/')) {
      const found = state.nodes.find((n) => url.pathname.endsWith(n.id))
      return found ? json(200, { ...found, space: effectiveSpace(found) }) : fail(404, 'NOT_FOUND')
    }
    if (route === 'POST /api/v1/layouts/generate') {
      const { space } = body as { space: unknown }
      const candidates = (['max', 'area', 'min'] as const).map((strategy, i) => ({
        strategy,
        layout: layout([table].slice(0, i === 2 ? 0 : 1)),
        issues: [],
        notes: [],
      }))
      return json(200, { space, candidates })
    }
    return fail(404, 'NOT_FOUND')
  })

  return { state, calls, fetchMock }
}

function renderWorkbench(search = '') {
  const router = createMemoryRouter(
    [{ path: '/projects/:projectId', element: <Workbench project={project} /> }],
    { initialEntries: [`/projects/${PID}${search}`] },
  )
  return renderWithClient(<RouterProvider router={router} />)
}

async function connectSpaceCanvas() {
  const frame = await screen.findByTitle<HTMLIFrameElement>('空间画布')
  const port = { close: vi.fn(), postMessage: vi.fn(), onmessage: (_event: MessageEvent) => {} }
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = port
      port2 = {}
    },
  )
  const connect = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  fireEvent.load(frame)
  const initial = connect.mock.calls[0]?.[0] as { state: SpaceSketch; submitLabel?: string }
  return {
    ...initial,
    result: port.postMessage,
    confirm: (draft: SpaceSketch) =>
      port.onmessage(new MessageEvent('message', { data: { type: 'submit', state: draft } })),
  }
}

let server: ReturnType<typeof fakeApi>
const confirm = vi.fn(() => true)

beforeAll(() => {
  // jsdom has no SVG layout; without a screen matrix the editor selects but does not drag.
  if (!('getScreenCTM' in SVGSVGElement.prototype)) {
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', { value: () => null })
  }
})

beforeEach(() => {
  confirm.mockClear()
  vi.stubGlobal('confirm', confirm)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Workbench', () => {
  it('copies a furniture snapshot, pastes or duplicates it, and keeps text shortcuts native', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1)], null)
    const { container } = renderWorkbench(`?node=${P1}`)
    await screen.findByRole('button', { name: '撤回' })
    fireEvent.click(screen.getByRole('button', { name: '平面' }))
    const count = () => container.querySelectorAll('.view-main .plan-item').length
    const canvas = screen.getByLabelText(/平面画布/)
    const tableShape = container.querySelector('.view-main [data-item-id="island_table-1"]')!
    expect(fireEvent.keyDown(canvas, { key: 'v', ctrlKey: true })).toBe(true)
    fireEvent.pointerDown(tableShape)
    const position = screen.getByRole('spinbutton', { name: '水平位置' })
    expect(fireEvent.keyDown(position, { key: 'c', ctrlKey: true })).toBe(true)
    expect(screen.queryByText(/已复制「中岛桌」/)).toBeNull()
    expect(fireEvent.keyDown(canvas, { key: 'c', ctrlKey: true })).toBe(false)
    expect(screen.getByText(/已复制「中岛桌」/)).toBeTruthy()
    expect(count()).toBe(1)
    expect(fireEvent.keyDown(position, { key: 'v', ctrlKey: true })).toBe(true)
    expect(count()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转 90°' }))
    expect(fireEvent.keyDown(canvas, { key: 'v', metaKey: true })).toBe(false)
    expect(count()).toBe(2)
    expect(fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true, repeat: true })).toBe(false)
    expect(count()).toBe(2)
    fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true })
    expect(count()).toBe(3)
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    expect(count()).toBe(2)
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(count()).toBe(3)
    await waitFor(() => {
      expect(server.state.drafts.get(P1)?.layout.items.map((item) => item.rotation)).toEqual([
        90, 0, 0,
      ])
    })
  })

  it('starts with a blank space canvas and opens placement on confirmation', async () => {
    server = fakeApi([], null)
    renderWorkbench()

    expect(await screen.findByText('第一步：录入空间')).toBeTruthy()
    const canvas = await connectSpaceCanvas()
    expect(canvas.state.points).toEqual([])
    canvas.confirm({
      ...canvas.state,
      closed: true,
      points: [
        [0, 0],
        [8000, 0],
        [8000, 6000],
        [0, 6000],
      ],
      mainEdge: 2,
      openings: [null, null, { mode: 'full' }, null],
    })

    expect(await screen.findByRole('region', { name: '平面编辑' })).toBeTruthy()
    const post = server.calls.find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({
      parentId: null,
      kind: 'space',
      name: '空间 A',
      space: {
        boundary: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        height: 3.2,
        entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }],
      },
    })
  })

  it.each([
    ['空间', S1],
    ['方案', P1],
    ['渲染', P2],
  ])('从%s阶段的空间信息保存到当前节点', async (_stage, nodeId) => {
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { layout: layout([{ ...table, cx: 7.1 }]) }),
        designNode(P2, P1, { kind: 'render', siStyle: 'SI1.0' }),
      ],
      null,
    )
    renderWorkbench(`?node=${nodeId}`)

    fireEvent.click(await screen.findByRole('tab', { name: '空间信息' }))
    fireEvent.click(await screen.findByRole('button', { name: '修改空间' }))
    const canvas = await connectSpaceCanvas()
    expect(canvas.submitLabel).toBe('保存到当前节点')
    expect(canvas.state.points[1]).toEqual([8000, 0])
    canvas.confirm({
      ...canvas.state,
      height: 3500,
      points: [
        [0, 0],
        [9000, 0],
        [9000, 6000],
        [0, 6000],
      ],
    })

    await waitFor(() => expect(screen.queryByTitle('空间画布')).toBeNull())
    expect(screen.getByRole('tabpanel', { name: '空间信息' }).textContent).toContain('3500 mm')
    expect(server.state.nodes).toHaveLength(3)
    expect(server.calls.filter((call) => call.method === 'PATCH').map((call) => call.path)).toEqual(
      [`/api/v1/nodes/${nodeId}/space`],
    )
    if (nodeId === P1) expect(server.state.nodes[1]?.layout?.items[0]?.cx).toBe(8.1)
  })

  it('keeps all three generated plans under the space and opens one', async () => {
    server = fakeApi([designNode(S1, null, { name: '一层空间' })], null)
    renderWorkbench()

    fireEvent.click(await screen.findByRole('button', { name: '生成三个方案' }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '打开此方案' })).toHaveLength(3),
    )
    const generate = server.calls.find((c) => c.path === '/api/v1/layouts/generate')
    expect(generate?.body).toMatchObject({ shopType: 'side_hall', siStyle: 'SI1.0' })
    const created = server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/nodes'))
    expect(created.map((c) => c.body)).toMatchObject([
      { parentId: S1, kind: 'plan', strategy: 'max', name: '方案 A · 尽量多放' },
      { parentId: S1, kind: 'plan', strategy: 'area', name: '方案 B · 按面积推荐' },
      { parentId: S1, kind: 'plan', strategy: 'min', name: '方案 C · 尽量少放' },
    ])

    fireEvent.click(screen.getAllByRole('button', { name: '打开此方案' })[1] as HTMLElement)
    expect(await screen.findByRole('heading', { name: '方案 B · 按面积推荐' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '方案阶段' })).toBeTruthy()
  })

  it('keeps another node editable and saves into its own draft', async () => {
    const draft: Draft = {
      projectId: PID,
      baseNodeId: P1,
      layout: layout([]),
      revision: 3,
      updatedAt: '2026-10-09T04:00:00.000Z',
    }
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { name: '方案 A' }),
        designNode(P2, S1, { name: '方案 B' }),
      ],
      draft,
    )
    const { container } = renderWorkbench(`?node=${P2}`)
    await screen.findByRole('button', { name: '撤回' })
    expect(screen.queryByRole('heading', { name: '当前节点只读' })).toBeNull()
    fireEvent.click(
      within(screen.getByRole('group', { name: '视图' })).getByRole('button', { name: '平面' }),
    )
    const item = container.querySelector('[data-item-id="island_table-1"]') as Element
    fireEvent.pointerDown(item)
    fireEvent.keyDown(screen.getByLabelText(/平面画布/), { key: 'ArrowRight', shiftKey: true })
    fireEvent.click(screen.getByRole('tab', { name: '历史' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '方案 A（有草稿）' }), { key: 'Enter' })
    await screen.findByRole('heading', { name: '方案 A' })
    expect(server.state.drafts.get(P1)).toEqual(draft)
    expect(server.state.drafts.get(P2)?.layout.items[0]?.cx).toBe(4.1)
    fireEvent.click(screen.getByRole('button', { name: '丢弃草稿' }))
    await waitFor(() => expect(server.state.drafts.has(P1)).toBe(false))
    expect(server.state.drafts.get(P2)?.layout.items[0]?.cx).toBe(4.1)
  })

  it.each(['', '&mode=placement'])(
    'copies a space with its layout and enters placement: %s',
    async (mode) => {
      const source = designNode(S1, null, {
        name: '空间 A',
        layout: layout([table]),
        siStyle: 'SI2.0',
      })
      server = fakeApi([source, designNode(P2, null, { name: '空间 A · v2', hidden: true })], null)
      renderWorkbench(`?node=${S1}${mode}`)
      fireEvent.click(await screen.findByRole('button', { name: '新建副本' }))
      await screen.findByRole('heading', { name: '空间 A · v3' })
      expect(server.state.nodes.at(-1)).toMatchObject({
        kind: 'space',
        parentId: null,
        sourceNodeId: S1,
        space: source.space,
        layout: source.layout,
        siStyle: 'SI2.0',
      })
      expect(server.state.nodes.find((node) => node.id === S1)).toEqual(source)
      const copy = screen.getByRole('button', { name: '新建副本' })
      const discard = screen.getByRole('button', { name: '丢弃草稿' })
      const advance = screen.getByRole('button', { name: '保存为方案' })
      expect(copy.parentElement).toBe(discard.parentElement)
      expect(advance.parentElement).not.toBe(copy.parentElement)
      expect(advance.parentElement?.className).toContain('single')
    },
  )

  it('keeps the space selected when copying fails', async () => {
    server = fakeApi([designNode(S1, null, { name: '空间 A' })], null, [], { failCreate: true })
    renderWorkbench(`?node=${S1}&mode=placement`)
    fireEvent.click(await screen.findByRole('button', { name: '新建副本' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('heading', { name: '空间 A' })).toBeTruthy()
    expect(server.state.nodes).toHaveLength(1)
  })

  it('gives a copy the next plan letter and displays its source', async () => {
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { name: '方案 A' }),
        designNode(P2, S1, { name: '方案 B', hidden: true }),
      ],
      null,
    )
    renderWorkbench(`?node=${P1}`)
    fireEvent.click(await screen.findByRole('button', { name: '新建副本' }))
    await screen.findByRole('heading', { name: '方案 C' })
    const copy = server.state.nodes.at(-1)
    expect(copy).toMatchObject({ name: '方案 C', sourceNodeId: P1 })
    fireEvent.click(screen.getByRole('tab', { name: '历史' }))
    expect(screen.getByText('来源：方案 A')).toBeTruthy()
  })

  describe('空间 SI 切换', () => {
    const space = rectangleSpace(8, 6, 3.2)
    const partitionLayout: Layout = {
      ...layout([]),
      fixtures: [
        { id: 'partition-a', kind: 'hollow_partition', cx: 3, cz: 2, w: 2, d: 0.2, h: 2.4 },
      ],
    }
    const original = designNode(S1, null, {
      name: '门店空间',
      siStyle: 'SI1.0',
      space,
      layout: partitionLayout,
    })

    it('换版新建兄弟空间并保留隔板，原样往返复用两个节点', async () => {
      const server = fakeApi([original], null)
      renderWorkbench('?node=' + S1)
      await screen.findByRole('heading', { name: '门店空间' })
      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      await screen.findByRole('heading', { name: '门店空间 · v2' }, { timeout: 5000 })
      expect(server.state.nodes[1]).toMatchObject({
        kind: 'space',
        parentId: null,
        sourceNodeId: S1,
        siStyle: 'SI2.0',
        space,
        layout: partitionLayout,
      })
      await screen.findByText(/已切换为 SI2.0，另存空间/)
      fireEvent.click(screen.getByRole('button', { name: 'SI1.0' }))
      await screen.findByRole('heading', { name: '门店空间' }, { timeout: 5000 })
      await screen.findByText(/已回到 SI1.0 的“门店空间”/)
      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      await screen.findByRole('heading', { name: '门店空间 · v2' }, { timeout: 5000 })
      expect(server.state.nodes).toHaveLength(2)
    })

    it.each(['轮廓', '隔板'])('修改%s后换回旧版会另存兄弟空间', async (edited) => {
      const changedSpace = edited === '轮廓' ? rectangleSpace(9, 6, 3.2) : space
      const changedLayout =
        edited === '隔板' ? { ...partitionLayout, fixtures: [] } : partitionLayout
      const sibling = designNode(P1, null, {
        name: '门店空间 · v2',
        kind: 'space',
        sourceNodeId: S1,
        siStyle: 'SI2.0',
        space: changedSpace,
        layout: partitionLayout,
      })
      const draft: Draft | null =
        edited === '隔板'
          ? {
              projectId: PID,
              baseNodeId: P1,
              layout: changedLayout,
              revision: 1,
              updatedAt: '2026-10-09T04:00:00.000Z',
            }
          : null
      const server = fakeApi([original, sibling], draft)
      renderWorkbench('?node=' + P1 + '&mode=placement')
      await screen.findByRole('heading', { name: '门店空间 · v2' })
      fireEvent.click(screen.getByRole('button', { name: 'SI1.0' }))
      await screen.findByRole('heading', { name: '门店空间 · v3' }, { timeout: 5000 })
      expect(server.state.nodes[2]).toMatchObject({
        kind: 'space',
        parentId: null,
        sourceNodeId: P1,
        siStyle: 'SI1.0',
        space: changedSpace,
        layout: changedLayout,
      })
      expect(server.state.nodes[0]).toEqual(original)
    })
  })

  it('switching SI saves a copy of the plan with its props swapped and keeps the original', async () => {
    const cabinet: LayoutItem = {
      ...table,
      id: 'c1',
      assetId: 'asset-2595882',
      function: 'accessory_cabinet',
      name: 'SI1.0 1.2米配件柜',
      cx: 2,
      cz: 0.225,
      w: 1.2,
      d: 0.45,
      h: 2.4,
      placeholder: false,
    }
    server = fakeApi(
      [designNode(S1, null), designNode(P1, S1, { name: '方案 A', layout: layout([cabinet]) })],
      null,
      [
        catalogAsset('asset-2595882', 'SI1.0', 1.2, 0.45, '+Z'),
        catalogAsset('asset-34327615', 'SI2.0', 1.2, 0.54, '+Z'),
      ],
    )
    renderWorkbench(`?node=${P1}`)

    await screen.findByRole('button', { name: '撤回' })
    fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))

    expect(
      await screen.findByRole('heading', { name: '方案 A · SI2.0' }, { timeout: 5000 }),
    ).toBeTruthy()
    expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ siStyle: 'SI2.0' })
    const copy = server.calls.find((c) => c.method === 'POST' && c.path.endsWith('/nodes'))
    expect(copy?.body).toMatchObject({
      parentId: S1,
      kind: 'plan',
      name: '方案 A · SI2.0',
      sourceNodeId: P1,
    })
    const swapped = (copy?.body as { layout: Layout }).layout.items[0]
    // The deeper SI2.0 cabinet keeps its back where the old one was.
    expect(swapped).toMatchObject({ assetId: 'asset-34327615', cx: 2, cz: 0.27, d: 0.54 })
    expect(screen.getByText(/换了 1 件道具，原节点保留/)).toBeTruthy()
    expect(server.state.nodes.find((n) => n.id === P1)?.layout?.items[0]?.assetId).toBe(
      'asset-2595882',
    )
  })

  describe('each step keeps its own SI style', () => {
    const cabinet: LayoutItem = {
      ...table,
      id: 'c1',
      assetId: 'asset-2595882',
      function: 'accessory_cabinet',
      name: 'SI1.0 1.2米配件柜',
      cx: 2,
      cz: 0.225,
      w: 1.2,
      d: 0.45,
      h: 2.4,
      placeholder: false,
    }
    const assets = [
      catalogAsset('asset-2595882', 'SI1.0', 1.2, 0.45, '+Z'),
      catalogAsset('asset-34327615', 'SI2.0', 1.2, 0.54, '+Z'),
    ]
    const pressed = () =>
      within(screen.getByRole('group', { name: 'SI 风格' }))
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
    const posts = () => server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/nodes'))

    it('shows the original in its own style after a switch, and goes back to it from an untouched copy', async () => {
      server = fakeApi(
        [designNode(S1, null), designNode(P1, S1, { name: '方案 A', layout: layout([cabinet]) })],
        null,
        assets,
      )
      renderWorkbench(`?node=${P1}`)
      await screen.findByRole('button', { name: '撤回' })
      expect(pressed()).toEqual(['SI1.0'])

      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      expect(
        await screen.findByRole('heading', { name: '方案 A · SI2.0' }, { timeout: 5000 }),
      ).toBeTruthy()
      expect(posts()[0]?.body).toMatchObject({ name: '方案 A · SI2.0', siStyle: 'SI2.0' })
      await waitFor(() => expect(pressed()).toEqual(['SI2.0']))

      // The bug: clicking back on A showed it in SI2.0.
      fireEvent.click(screen.getByRole('tab', { name: '历史' }))
      fireEvent.keyDown(screen.getByRole('button', { name: '方案 A' }), { key: 'Enter' })
      await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })
      await waitFor(() => expect(pressed()).toEqual(['SI1.0']))

      // On A again: its untouched SI2.0 copy is already there, so no second copy.
      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      expect(
        await screen.findByRole('heading', { name: '方案 A · SI2.0' }, { timeout: 5000 }),
      ).toBeTruthy()
      expect(posts()).toHaveLength(1)

      // On the untouched copy: back to A, the copy stays.
      await waitFor(() => expect(pressed()).toEqual(['SI2.0']))
      fireEvent.click(screen.getByRole('button', { name: 'SI1.0' }))
      expect(await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })).toBeTruthy()
      expect(await screen.findByText(/已回到 SI1.0 的“方案 A”/)).toBeTruthy()
      expect(posts()).toHaveLength(1)
      expect(screen.getByRole('button', { name: '方案 A · SI2.0' })).toBeTruthy()
    })

    it('switches a copy changed since its switch into a new sibling of the other style', async () => {
      const B = '55555555-5555-4555-8555-555555555555'
      const moved: LayoutItem = { ...cabinet, assetId: 'asset-34327615', cx: 4, cz: 0.27, d: 0.54 }
      server = fakeApi(
        [
          designNode(S1, null),
          designNode(P1, S1, { name: '方案 A', layout: layout([cabinet]) }),
          designNode(B, S1, {
            name: '方案 A · SI2.0',
            siStyle: 'SI2.0',
            layout: layout([moved]),
          }),
        ],
        null,
        assets,
      )
      renderWorkbench(`?node=${B}`)
      await screen.findByRole('button', { name: '撤回' })
      await waitFor(() => expect(pressed()).toEqual(['SI2.0']))

      fireEvent.click(screen.getByRole('button', { name: 'SI1.0' }))
      expect(
        await screen.findByRole('heading', { name: '方案 A · SI1.0' }, { timeout: 5000 }),
      ).toBeTruthy()
      const c = posts()[0]?.body as { siStyle: string; parentId: string; layout: Layout }
      expect(c).toMatchObject({ siStyle: 'SI1.0', parentId: S1 })
      // Made from B as changed: the cabinet stays where it was moved to.
      expect(c.layout.items[0]).toMatchObject({ assetId: 'asset-2595882', cx: 4 })
    })

    it('keeps the edits of the original step when switching from its draft', async () => {
      const edited: LayoutItem = { ...cabinet, cx: 3 }
      const draft: Draft = {
        projectId: PID,
        baseNodeId: P1,
        layout: layout([edited]),
        revision: 2,
        updatedAt: '2026-10-19T04:00:00.000Z',
      }
      server = fakeApi(
        [designNode(S1, null), designNode(P1, S1, { name: '方案 A', layout: layout([cabinet]) })],
        draft,
        assets,
      )
      renderWorkbench(`?node=${P1}`)
      await screen.findByRole('button', { name: '撤回' })

      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      expect(
        await screen.findByRole('heading', { name: '方案 A · SI2.0' }, { timeout: 5000 }),
      ).toBeTruthy()
      // The switched copy is made from the edited layout…
      const created = posts()[0]?.body as { layout: Layout }
      expect(created.layout.items[0]).toMatchObject({ cx: 3 })
      // …and the edits stay on the original step as its draft (not dropped, not lost).
      expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
      expect(server.state.drafts.get(P1)?.layout).toEqual(draft.layout)

      // The original step is marked as carrying the draft; clicking it opens the edits again.
      fireEvent.click(screen.getByRole('tab', { name: '历史' }))
      fireEvent.keyDown(screen.getByRole('button', { name: '方案 A（有草稿）' }), { key: 'Enter' })
      await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })
      expect(await screen.findByRole('button', { name: '撤回' })).toBeTruthy()
    })

    it('says the switch failed when the server refuses the new step', async () => {
      server = fakeApi(
        [designNode(S1, null), designNode(P1, S1, { name: '方案 A', layout: layout([cabinet]) })],
        null,
        assets,
        { failCreate: true },
      )
      renderWorkbench(`?node=${P1}`)
      await screen.findByRole('button', { name: '撤回' })

      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      expect(
        await screen.findByText(/切换失败：进入三维效果前须先解决越界、重叠等问题，没有新建节点/),
      ).toBeTruthy()
      // Nothing was created, and the project's default style did not change either.
      expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false)
      expect(screen.queryByRole('heading', { name: '方案 A · SI2.0' })).toBeNull()
    })

    it('copies a legacy 3D node into the plan stage when switching SI', async () => {
      const W = '66666666-6666-4666-8666-666666666666'
      server = fakeApi(
        [
          designNode(S1, null),
          designNode(P1, S1, { name: '方案 A' }),
          designNode(W, P1, {
            kind: 'white',
            name: '三维效果',
            siStyle: 'SI1.0',
            layout: layout([cabinet]),
          }),
        ],
        null,
        assets,
      )
      renderWorkbench(`?node=${W}`)
      await screen.findByRole('heading', { name: '三维效果' })

      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      await waitFor(() => expect(posts()).toHaveLength(1))
      const created = posts()[0]?.body as { kind: string; allowLayoutErrors?: boolean }
      expect(created).toMatchObject({ kind: 'plan', parentId: S1, sourceNodeId: W })
      expect(screen.queryByText(/切换失败/)).toBeNull()
    })
  })

  it('keeps plan or 3D when moving to another plan of the same space', async () => {
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { name: '方案 A' }),
        designNode(P2, S1, { name: '方案 B' }),
      ],
      null,
    )
    renderWorkbench(`?node=${P1}`)

    await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })
    const views = screen.getByRole('group', { name: '视图' })
    fireEvent.click(within(views).getByRole('button', { name: '三维' }))
    fireEvent.click(screen.getByRole('tab', { name: '历史' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '方案 B' }), { key: 'Enter' })

    await screen.findByRole('heading', { name: '方案 B' })
    const next = screen.getByRole('group', { name: '视图' })
    expect(within(next).getByRole('button', { name: '三维' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('offers space information and partition drawing without any model controls', async () => {
    server = fakeApi([designNode(S1, null, { name: '空间 A', layout: layout([table]) })], null)
    const { container } = renderWorkbench('?node=' + S1)
    const tabs = () =>
      within(screen.getByRole('tablist', { name: '左栏' }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    const editFixtures = await screen.findByRole('button', { name: '编辑空心隔板' })
    expect(tabs()).toEqual(['历史', '空间信息'])
    fireEvent.click(editFixtures)
    expect(tabs()).toEqual(['历史', '空间信息'])
    expect(screen.getByRole('button', { name: '画空心隔板' })).toBeTruthy()
    expect(container.querySelector('.model-picker')).toBeNull()
    const item = container.querySelector('[data-item-id="island_table-1"]') as Element
    expect(item).toBeTruthy()
    fireEvent.pointerDown(item)
    fireEvent.keyDown(screen.getByLabelText(/平面画布/), { key: 'Delete' })
    expect(container.querySelector('[data-item-id="island_table-1"]')).toBe(item)
    fireEvent.click(screen.getByRole('tab', { name: '空间信息' }))
    expect(screen.getByRole('button', { name: '画隔板' })).toBeTruthy()
  })

  it('puts history, models and space info in left tabs, opening the models in the plan stage', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1, { name: '方案 A' })], null)
    renderWorkbench(`?node=${P1}`)

    await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect(tab('添加模型').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '历史' })).toBeTruthy()
    // The history tab is hidden, not unmounted.
    expect(screen.queryByRole('button', { name: '方案 A' })).toBeNull()
    fireEvent.click(tab('历史'))
    expect(screen.getByRole('button', { name: '方案 A' })).toBeTruthy()
    fireEvent.click(tab('空间信息'))
    expect(screen.getByText('创建时间')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'SI 风格' })).toBeTruthy()
  })

  it('returns from the render models tab to the associated editable plan', async () => {
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { name: '方案 A' }),
        designNode(P2, P1, { kind: 'render', name: '渲染 A' }),
      ],
      null,
    )
    renderWorkbench('?node=' + P2)
    await screen.findByRole('region', { name: '渲染' })
    fireEvent.click(screen.getByRole('tab', { name: '添加模型' }))
    expect(screen.queryByRole('region', { name: '添加模型' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回方案添加模型' }))
    await screen.findByRole('heading', { name: '方案 A' })
    expect(screen.getByRole('region', { name: '添加模型' })).toBeTruthy()
  })

  it('keeps legacy 3D views available in the plan editor', async () => {
    server = fakeApi(
      [
        designNode(S1, null),
        designNode(P1, S1, { name: '方案 A' }),
        designNode(P2, P1, { kind: 'white', name: '三维效果' }),
      ],
      null,
    )
    const { container } = renderWorkbench(`?node=${P2}`)
    await screen.findByRole('heading', { name: '三维效果' })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '历史',
      '空间信息',
      '添加模型',
      '视角',
    ])
    expect(screen.getByRole('tab', { name: '添加模型' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('region', { name: '视角' })).toBeNull()
    expect(container.querySelectorAll('.camera-panel')).toHaveLength(1)
    expect(container.querySelector('.wb-right .camera-panel')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '视角' }))
    const panel = screen.getByRole('region', { name: '视角' })
    await within(panel).findByRole('button', { name: '查看视角 正面鸟瞰' })
    fireEvent.click(screen.getByRole('tab', { name: '空间信息' }))
    expect(screen.queryByRole('region', { name: '视角' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '视角' }))
    expect(screen.getByRole('region', { name: '视角' })).toBe(panel)

    fireEvent.click(screen.getByRole('tab', { name: '历史' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '方案 A' }), { key: 'Enter' })
    await screen.findByRole('heading', { name: '方案 A' }, { timeout: 5000 })
    expect(screen.getByRole('tab', { name: '视角' })).toBeTruthy()
  })

  it('renders directly from a plan, persisting a pending edit on the source first', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1, { name: '方案 A' })], null)
    const { container } = renderWorkbench(`?node=${P1}`)

    await screen.findByRole('button', { name: '撤回' })
    const views = screen.getByRole('group', { name: '视图' })
    expect(within(views).getByRole('button', { name: '三维' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.queryByRole('button', { name: '白模' })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: '平面' }))
    const item = container.querySelector('[data-item-id="island_table-1"]') as Element
    fireEvent.pointerDown(item)
    fireEvent.keyDown(screen.getByLabelText(/平面画布/), { key: 'ArrowRight', shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '开始渲染' }))

    await waitFor(() =>
      expect(server.state.nodes.some((node) => node.kind === 'render')).toBe(true),
    )
    const saves = server.calls.filter((c) => c.method === 'PUT' || c.method === 'POST')
    expect(saves[0]).toMatchObject({ method: 'PUT', body: { baseNodeId: P1 } })
    expect(saves[1]).toMatchObject({ method: 'POST', body: { parentId: P1, kind: 'render' } })
    expect(server.state.nodes.find((node) => node.kind === 'render')?.layout?.items[0]?.cx).toBe(
      4.1,
    )
    expect(server.state.drafts.get(P1)?.layout.items[0]?.cx).toBe(4.1)
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})
