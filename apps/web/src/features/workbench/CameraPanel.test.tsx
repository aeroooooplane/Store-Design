import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW_NAMES } from '@store/shared'
import type { Camera, NodeCamera } from '@store/shared'
import { makeCamera } from '../../test-utils/factories.ts'
import { json, stubFetch } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { CameraPanel } from './CameraPanel.tsx'

const NODE = '55555555-5555-4555-8555-555555555555'
const pose = { position: [1, 2, 3], target: [4, 0.8, 3], fovDeg: 50 } as const

function camera(i: number, overrides: Partial<NodeCamera> = {}): NodeCamera {
  return makeCamera(i, NODE, DEFAULT_VIEW_NAMES[i] ?? `视角 ${i}`, overrides)
}

function fakeApi(cameras: NodeCamera[]) {
  return stubFetch(({ request, url }) => {
    if (request.method === 'GET') return json(200, { nodeId: NODE, cameras })
    const target = cameras.find((c) => url.pathname.includes(c.id)) ?? cameras[0]
    return json(request.method === 'POST' && url.pathname.endsWith('/cameras') ? 201 : 200, target)
  })
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
  renderWithClient(
    <CameraPanel
      nodeId={NODE}
      viewer={{ current: handle }}
      viewerReady
      layout={{ schemaVersion: 3, items: [], planning: null }}
      onShow={onShow}
    />,
  )
  return onShow
}

beforeEach(() => {
  server = fakeApi([
    ...[0, 1, 2].map((i) => camera(i)),
    camera(3, { deletedAt: '2026-10-10T01:00:00.000Z' }),
  ])
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
