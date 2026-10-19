import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Asset, DesignNode, Draft, Layout, LayoutItem, Project } from '@store/shared'
import { makeAsset, makeNode, makeProject } from '../../test-utils/factories.ts'
import { json, stubFetch } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import { Workbench } from './Workbench.tsx'

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
  const state = { nodes: [...nodes], draft, project }
  const fail = (status: number, code: string, message = code) =>
    json(status, { error: { code, message, requestId: 'r' } })

  const { calls, fetchMock } = stubFetch(({ request, url, route, body, ifMatch }) => {
    if (route === `GET /api/v1/projects/${PID}/nodes`) {
      const summaries = state.nodes.map(({ projectId: _p, space: _s, layout: _l, ...s }) => s)
      return json(200, { projectId: PID, nodes: summaries })
    }
    if (route === `GET /api/v1/projects/${PID}/draft`) {
      return state.draft ? json(200, state.draft) : fail(404, 'NOT_FOUND')
    }
    if (route === `PUT /api/v1/projects/${PID}/draft`) {
      const current = state.draft
      if (current && ifMatch === null) return fail(428, 'REVISION_REQUIRED')
      if (current && ifMatch !== `"${current.revision}"`) return fail(409, 'REVISION_CONFLICT')
      const put = body as Pick<Draft, 'baseNodeId' | 'layout'>
      state.draft = {
        projectId: PID,
        ...put,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: '2026-10-09T04:00:00.000Z',
      }
      return json(200, { draft: state.draft, issues: [] })
    }
    if (route === `DELETE /api/v1/projects/${PID}/draft`) {
      if (!state.draft || ifMatch !== `"${state.draft.revision}"`) {
        return fail(409, 'REVISION_CONFLICT')
      }
      state.draft = null
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
      return json(201, { node: created, issues: [] })
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
    if (request.method === 'GET' && url.pathname.startsWith('/api/v1/nodes/')) {
      const found = state.nodes.find((n) => url.pathname.endsWith(n.id))
      return found ? json(200, found) : fail(404, 'NOT_FOUND')
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
  return renderWithClient(<Workbench project={project} />, {
    router: { initialEntries: [`/projects/${PID}${search}`] },
  })
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
  it('starts an empty project with the space editor and opens the saved space', async () => {
    server = fakeApi([], null)
    renderWorkbench()

    expect(await screen.findByText('第一步：录入空间')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存空间' }))

    expect(await screen.findByRole('button', { name: '修改空间' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成三个方案' })).toBeTruthy()
    const post = server.calls.find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({
      parentId: null,
      kind: 'space',
      name: '空间',
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
      { parentId: S1, kind: 'plan', strategy: 'max', name: '方案 · 尽量多放' },
      { parentId: S1, kind: 'plan', strategy: 'area', name: '方案 · 按面积推荐' },
      { parentId: S1, kind: 'plan', strategy: 'min', name: '方案 · 尽量少放' },
    ])

    fireEvent.click(screen.getAllByRole('button', { name: '打开此方案' })[1] as HTMLElement)
    expect(await screen.findByRole('heading', { name: '方案 · 按面积推荐' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '方案阶段' })).toBeTruthy()
  })

  it('keeps other nodes read-only while the shared draft belongs to another step', async () => {
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
    renderWorkbench(`?node=${P2}`)

    expect(await screen.findByText(/基于「方案 A」的草稿/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '撤回' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '丢弃草稿' }))
    expect(await screen.findByRole('button', { name: '撤回' })).toBeTruthy()
    expect(confirm).toHaveBeenCalledOnce()
    expect(server.calls.find((c) => c.method === 'DELETE')?.ifMatch).toBe('"3"')
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

    expect(await screen.findByRole('heading', { name: '方案 A · SI2.0' })).toBeTruthy()
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
      expect(await screen.findByRole('heading', { name: '方案 A · SI2.0' })).toBeTruthy()
      expect(posts()[0]?.body).toMatchObject({ name: '方案 A · SI2.0', siStyle: 'SI2.0' })
      await waitFor(() => expect(pressed()).toEqual(['SI2.0']))

      // The bug: clicking back on A showed it in SI2.0.
      fireEvent.click(screen.getByRole('tab', { name: '历史' }))
      fireEvent.keyDown(screen.getByRole('button', { name: '方案 A' }), { key: 'Enter' })
      await screen.findByRole('heading', { name: '方案 A' })
      await waitFor(() => expect(pressed()).toEqual(['SI1.0']))

      // On A again: its untouched SI2.0 copy is already there, so no second copy.
      fireEvent.click(screen.getByRole('button', { name: 'SI2.0' }))
      expect(await screen.findByRole('heading', { name: '方案 A · SI2.0' })).toBeTruthy()
      expect(posts()).toHaveLength(1)

      // On the untouched copy: back to A, the copy stays.
      await waitFor(() => expect(pressed()).toEqual(['SI2.0']))
      fireEvent.click(screen.getByRole('button', { name: 'SI1.0' }))
      expect(await screen.findByRole('heading', { name: '方案 A' })).toBeTruthy()
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
      expect(await screen.findByRole('heading', { name: '方案 A · SI1.0' })).toBeTruthy()
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
      expect(await screen.findByRole('heading', { name: '方案 A · SI2.0' })).toBeTruthy()
      // The switched copy is made from the edited layout…
      const created = posts()[0]?.body as { layout: Layout }
      expect(created.layout.items[0]).toMatchObject({ cx: 3 })
      // …and the edits stay on the original step as its draft (not dropped, not lost).
      expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
      expect(server.state.draft?.baseNodeId).toBe(P1)

      // The original step is marked as carrying the draft; clicking it opens the edits again.
      fireEvent.keyDown(screen.getByRole('button', { name: '方案 A（有草稿）' }), { key: 'Enter' })
      await screen.findByRole('heading', { name: '方案 A' })
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

    it('lets a white model take the swapped layout even when the new sizes overlap', async () => {
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
      expect(created).toMatchObject({ kind: 'white', allowLayoutErrors: true })
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

    await screen.findByRole('heading', { name: '方案 A' })
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

  it('puts history, models and space info in left tabs, opening the models in the plan stage', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1, { name: '方案 A' })], null)
    renderWorkbench(`?node=${P1}`)

    await screen.findByRole('heading', { name: '方案 A' })
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect(tab('添加模型').getAttribute('aria-selected')).toBe('true')
    // The white stage starts on the history tab instead.
    expect(screen.getByRole('tab', { name: '历史' })).toBeTruthy()
    // The history tab is hidden, not unmounted.
    expect(screen.queryByRole('button', { name: '方案 A' })).toBeNull()
    fireEvent.click(tab('历史'))
    expect(screen.getByRole('button', { name: '方案 A' })).toBeTruthy()
    fireEvent.click(tab('空间信息'))
    expect(screen.getByText('创建时间')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'SI 风格' })).toBeTruthy()
  })

  it('autosaves edits to the draft, then saves a version and clears the draft', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1, { name: '方案 A' })], null)
    const { container } = renderWorkbench(`?node=${P1}`)

    await screen.findByRole('button', { name: '撤回' })
    const item = container.querySelector('[data-item-id="island_table-1"]') as Element
    fireEvent.pointerDown(item)
    fireEvent.keyDown(screen.getByLabelText(/平面画布/), { key: 'ArrowRight', shiftKey: true })

    expect(await screen.findByText('草稿已保存', {}, { timeout: 3000 })).toBeTruthy()
    const put = server.calls.find((c) => c.method === 'PUT')
    expect(put).toMatchObject({ ifMatch: null, body: { baseNodeId: P1 } })
    expect((put?.body as { layout: Layout }).layout.items[0]?.cx).toBe(4.1)

    // 新建副本: a sibling plan under the same space, carrying the edited layout.
    fireEvent.click(screen.getByRole('button', { name: '新建副本' }))
    expect(await screen.findByRole('heading', { name: '方案 A 副本2' })).toBeTruthy()
    const copy = server.calls.find((c) => c.method === 'POST' && c.path.endsWith('/nodes'))
    expect(copy?.body).toMatchObject({
      parentId: S1,
      kind: 'plan',
      name: '方案 A 副本2',
      sourceNodeId: P1,
    })
    expect((copy?.body as { layout: Layout }).layout.items[0]?.cx).toBe(4.1)
    expect(server.calls.find((c) => c.method === 'DELETE')?.ifMatch).toBe('"1"')
    expect(server.state.draft).toBeNull()
  })
})
