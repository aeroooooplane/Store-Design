import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW_NAMES } from '@store/shared'
import type { Camera, NodeCamera } from '@store/shared'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { CameraPanel } from './CameraPanel.tsx'

const NODE = '55555555-5555-4555-8555-555555555555'
const pose = { position: [1, 2, 3], target: [4, 0.8, 3], fovDeg: 50 } as const

function camera(i: number, overrides: Partial<NodeCamera> = {}): NodeCamera {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    nodeId: NODE,
    sort: i,
    camera: {
      name: DEFAULT_VIEW_NAMES[i] ?? `视角 ${i}`,
      position: [i, 5, 9],
      target: [4, 0.8, 3],
      fovDeg: 48,
      source: 'auto',
    },
    deletedAt: null,
    ...overrides,
  }
}

interface Call {
  method: string
  path: string
  body: unknown
}

function fakeApi(cameras: NodeCamera[]) {
  const calls: Call[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const text = request.method === 'GET' ? '' : await request.text()
    calls.push({
      method: request.method,
      path: url.pathname,
      body: text ? JSON.parse(text) : undefined,
    })
    if (request.method === 'GET') return json(200, { nodeId: NODE, cameras })
    const target = cameras.find((c) => url.pathname.includes(c.id)) ?? cameras[0]
    return json(request.method === 'POST' && url.pathname.endsWith('/cameras') ? 201 : 200, target)
  })
  return { calls, fetchMock }
}

function viewer(): Viewer3DHandle & { shown: Camera[] } {
  const shown: Camera[] = []
  return {
    shown,
    currentView: () => ({ ...pose, position: [...pose.position], target: [...pose.target] }),
    showView: (view) => shown.push(view as Camera),
    renderViews: async (views) => views.map((_, i) => `data:image/png;base64,${i}`),
  }
}

let server: ReturnType<typeof fakeApi>

function renderPanel(handle: Viewer3DHandle, onShow = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CameraPanel
        nodeId={NODE}
        viewer={{ current: handle }}
        viewerReady
        layout={{ schemaVersion: 3, items: [], planning: null }}
        onShow={onShow}
      />
    </QueryClientProvider>,
  )
  return onShow
}

beforeEach(() => {
  server = fakeApi([
    ...[0, 1, 2].map((i) => camera(i)),
    camera(3, { deletedAt: '2026-10-10T01:00:00.000Z' }),
  ])
  vi.stubGlobal('fetch', server.fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CameraPanel', () => {
  it('shows active views with rendered thumbnails and offers removed ones for restore', async () => {
    renderPanel(viewer())
    expect(await screen.findByText('视角（3）')).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll('.camera-thumb img')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: '恢复「右后方」' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST')).toMatchObject({
        method: 'POST',
        path: `/api/v1/cameras/${camera(3).id}/restore`,
      }),
    )
  })

  it('adds and re-aims views from the current 3D view, and removes them', async () => {
    renderPanel(viewer())
    await screen.findByText('视角（3）')

    fireEvent.click(screen.getByRole('button', { name: '添加当前视角' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: '自定义视角 4',
        ...pose,
      }),
    )

    const second = screen.getByText('左前方').closest('li') as HTMLElement
    fireEvent.click(within(second).getByRole('button', { name: '设为当前' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')).toMatchObject({
        path: `/api/v1/cameras/${camera(1).id}`,
        body: pose,
      }),
    )
    fireEvent.click(within(second).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'DELETE')?.path).toBe(
        `/api/v1/cameras/${camera(1).id}`,
      ),
    )
  })

  it('shows a view in 3D when its thumbnail is clicked', async () => {
    const onShow = renderPanel(viewer())
    fireEvent.click(await screen.findByRole('button', { name: '查看视角 右前方' }))
    expect(onShow).toHaveBeenCalledWith(camera(2).camera)
  })
})
