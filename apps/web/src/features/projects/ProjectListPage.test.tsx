import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@store/shared'
import { ProjectListPage } from './ProjectListPage.tsx'

function project(overrides: Partial<Project>): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '南京德基',
    shopType: 'side_hall',
    market: 'domestic',
    siStyle: 'SI1.0',
    revision: 1,
    createdAt: '2026-10-09T02:00:00.000Z',
    updatedAt: '2026-10-09T02:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

interface Call {
  method: string
  path: string
  ifMatch: string | null
  body: unknown
}

/** In-memory stand-in for the API, recording every request the page makes. */
function fakeApi(initial: Project[]) {
  const projects = [...initial]
  const calls: Call[] = []
  let failCreate: { status: number; body: object } | null = null
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const text = request.method === 'GET' ? '' : await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    calls.push({
      method: request.method,
      path: url.pathname,
      ifMatch: request.headers.get('if-match'),
      body,
    })

    if (request.method === 'GET' && url.pathname === '/api/v1/projects') {
      const deleted = url.searchParams.get('status') === 'deleted'
      const items = projects.filter((p) => (p.deletedAt !== null) === deleted)
      return json(200, { items, total: items.length, page: 1, pageSize: 20 })
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/projects') {
      if (failCreate) return json(failCreate.status, failCreate.body)
      const created = project({ ...(body as Partial<Project>), id: crypto.randomUUID() })
      projects.unshift(created)
      return json(201, created)
    }
    if (request.method === 'DELETE') {
      const target = projects.find((p) => url.pathname.endsWith(p.id))
      if (!target)
        return json(404, { error: { code: 'NOT_FOUND', message: '项目不存在', requestId: 'r' } })
      target.deletedAt = '2026-10-09T03:00:00.000Z'
      target.revision += 1
      return json(200, target)
    }
    return json(404, { error: { code: 'NOT_FOUND', message: '接口不存在', requestId: 'r' } })
  })

  return {
    calls,
    fetchMock,
    failNextCreate(status: number, body: object) {
      failCreate = { status, body }
    },
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let server: ReturnType<typeof fakeApi>

beforeEach(() => {
  server = fakeApi([
    project({}),
    project({
      id: '22222222-2222-4222-8222-222222222222',
      name: '澳门威尼斯人',
      shopType: 'island',
      market: 'overseas',
      siStyle: 'SI2.0',
    }),
  ])
  vi.stubGlobal('fetch', server.fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProjectListPage', () => {
  it('lists projects with Chinese labels', async () => {
    renderPage()
    const row = (await screen.findByText('澳门威尼斯人')).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLElement)
    expect(cells.getByText('中岛店')).toBeTruthy()
    expect(cells.getByText('海外')).toBeTruthy()
    expect(cells.getByText('SI2.0')).toBeTruthy()
  })

  it('validates the name before calling the API', async () => {
    renderPage()
    await screen.findByText('南京德基')
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    expect(await screen.findByText('请填写项目名称（1–100 个字符）')).toBeTruthy()
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('creates a project with domestic/SI1.0 defaults and refreshes the list', async () => {
    renderPage()
    await screen.findByText('南京德基')
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '成都恒驰' } })
    fireEvent.change(screen.getByLabelText('铺位形态'), { target: { value: 'zone' } })
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))

    expect(await screen.findByText('成都恒驰')).toBeTruthy()
    const post = server.calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({
      name: '成都恒驰',
      shopType: 'zone',
      market: 'domestic',
      siStyle: 'SI1.0',
    })
  })

  it('shows the server message and request id when creation fails', async () => {
    server.failNextCreate(429, {
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', requestId: 'req-42' },
    })
    renderPage()
    await screen.findByText('南京德基')
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '任意' } })
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    const alert = await screen.findByText(/请求过于频繁/)
    expect(alert.textContent).toContain('req-42')
  })

  it('moves a project to the bin with its current revision as If-Match', async () => {
    renderPage()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const row = (await screen.findByText('南京德基')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '移入回收站' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('南京德基'))
    await waitFor(() => expect(screen.queryByText('南京德基')).toBeNull())
    const removal = server.calls.find((c) => c.method === 'DELETE')
    expect(removal).toMatchObject({
      path: '/api/v1/projects/11111111-1111-4111-8111-111111111111',
      ifMatch: '"1"',
    })
  })
})
