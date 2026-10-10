import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { DesignNode, Draft, Layout, LayoutItem, Project } from '@store/shared'
import { Workbench } from './Workbench.tsx'

const PID = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'

const project: Project = {
  id: PID,
  name: '南京德基',
  shopType: 'side_hall',
  market: 'domestic',
  siStyle: 'SI1.0',
  revision: 1,
  createdAt: '2026-10-09T02:00:00.000Z',
  updatedAt: '2026-10-09T02:00:00.000Z',
  deletedAt: null,
}

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
  return {
    id,
    projectId: PID,
    parentId,
    kind: parentId === null ? 'space' : 'plan',
    name: id,
    strategy: null,
    siStyle: null,
    origin: 'user',
    importedFrom: null,
    hidden: false,
    createdAt: '2026-10-09T03:00:00.000Z',
    space: parentId === null ? rectangleSpace(8, 6, 3.2) : null,
    layout: parentId === null ? null : layout([table]),
    ...overrides,
  }
}

interface Call {
  method: string
  path: string
  ifMatch: string | null
  body: unknown
}

/** In-memory stand-in for the node, draft, asset and layout APIs. */
function fakeApi(nodes: DesignNode[], draft: Draft | null) {
  const state = { nodes: [...nodes], draft }
  const calls: Call[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fail = (status: number, code: string) =>
    json(status, { error: { code, message: code, requestId: 'r' } })

  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const text = request.method === 'GET' ? '' : await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    const ifMatch = request.headers.get('if-match')
    calls.push({ method: request.method, path: url.pathname, ifMatch, body })
    const route = `${request.method} ${url.pathname}`

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
    if (route === 'GET /api/v1/assets') return json(200, { items: [], total: 0 })
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/${PID}${search}`]}>
        <Workbench project={project} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
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
    vi.stubGlobal('fetch', server.fetchMock)
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
    vi.stubGlobal('fetch', server.fetchMock)
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
    vi.stubGlobal('fetch', server.fetchMock)
    renderWorkbench(`?node=${P2}`)

    expect(await screen.findByText(/基于「方案 A」的草稿/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '旋转 90°' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '丢弃草稿' }))
    expect(await screen.findByRole('button', { name: '旋转 90°' })).toBeTruthy()
    expect(confirm).toHaveBeenCalledOnce()
    expect(server.calls.find((c) => c.method === 'DELETE')?.ifMatch).toBe('"3"')
  })

  it('autosaves edits to the draft, then saves a version and clears the draft', async () => {
    server = fakeApi([designNode(S1, null), designNode(P1, S1, { name: '方案 A' })], null)
    vi.stubGlobal('fetch', server.fetchMock)
    const { container } = renderWorkbench(`?node=${P1}`)

    await screen.findByRole('button', { name: '旋转 90°' })
    const item = container.querySelector('[data-item-id="island_table-1"]') as Element
    fireEvent.pointerDown(item)
    fireEvent.keyDown(screen.getByLabelText(/平面画布/), { key: 'ArrowRight', shiftKey: true })

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('草稿已保存'), {
      timeout: 3000,
    })
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
