import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@store/shared'
import { makeProject as project } from '../../test-utils/factories.ts'
import { json, notFound, stubFetch } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import { ProjectListPage } from './ProjectListPage.tsx'

/** In-memory stand-in for the API, recording every request the page makes. */
function fakeApi(initial: Project[]) {
  const projects = [...initial]
  let failCreate: { status: number; body: object } | null = null

  const { calls, fetchMock } = stubFetch(({ request, url, body }) => {
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
    if (request.method === 'POST' && url.pathname === '/api/v1/projects/import') {
      const created = project({
        id: '33333333-3333-4333-8333-333333333333',
        name: '旧版备份项目',
      })
      projects.unshift(created)
      return json(201, {
        project: created,
        nodesImported: 3,
        draftImported: true,
        format: 'legacy',
        warnings: ['道具「旧款柜」与当前模型不符，已改为占位'],
      })
    }
    if (request.method === 'DELETE') {
      const target = projects.find((p) => url.pathname.endsWith(p.id))
      if (!target) return notFound('项目不存在')
      target.deletedAt = '2026-10-09T03:00:00.000Z'
      target.revision += 1
      return json(200, target)
    }
    return notFound()
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
  return renderWithClient(<ProjectListPage />, { router: true })
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

  it('imports a project file and lists what was converted', async () => {
    renderPage()
    await screen.findByText('南京德基')
    const file = new File([JSON.stringify({ schemaVersion: 2, projects: [] })], 'backup.json', {
      type: 'application/json',
    })
    fireEvent.change(screen.getByLabelText('选择项目文件'), { target: { files: [file] } })

    expect(await screen.findByText(/已导入为新项目「旧版备份项目」/)).toBeTruthy()
    expect(screen.getByText('道具「旧款柜」与当前模型不符，已改为占位')).toBeTruthy()
    const post = server.calls.find((c) => c.path === '/api/v1/projects/import')
    expect(post?.body).toEqual({ data: { schemaVersion: 2, projects: [] } })
    const notice = screen.getByRole('status')
    expect(within(notice).getByRole('link', { name: '打开' }).getAttribute('href')).toBe(
      '/projects/33333333-3333-4333-8333-333333333333',
    )
  })

  it('refuses a file that is not JSON without calling the API', async () => {
    renderPage()
    await screen.findByText('南京德基')
    const file = new File(['不是 JSON'], 'x.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('选择项目文件'), { target: { files: [file] } })

    expect(await screen.findByText('这不是有效的项目文件（不是 JSON）')).toBeTruthy()
    expect(server.calls.some((c) => c.path.endsWith('/import'))).toBe(false)
  })

  it('links every active project to its export', async () => {
    renderPage()
    const row = (await screen.findByText('南京德基')).closest('tr') as HTMLElement
    const link = within(row).getByRole('link', { name: '导出' })
    expect(link.getAttribute('href')).toBe(
      '/api/v1/projects/11111111-1111-4111-8111-111111111111/export',
    )
  })
})
