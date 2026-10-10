import { useEffect, useImperativeHandle } from 'react'
import type { Ref } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Delivery, DesignNode, NodeCamera, Project, RenderImage } from '@store/shared'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { RenderStage } from './RenderStage.tsx'

const looks = vi.hoisted(() => [] as string[])

// The real viewer needs WebGL; this one renders a tiny PNG and reports which look it used.
vi.mock('../viewer3d/Viewer3D.tsx', () => ({
  Viewer3D: ({ ref, onReady }: { ref?: Ref<Viewer3DHandle>; onReady?: () => void }) => {
    useImperativeHandle(ref, () => ({
      currentView: () => ({ position: [0, 1, 0], target: [0, 0, 0], fovDeg: 48 }),
      showView: () => undefined,
      renderViews: async (views, _width, _height, look) => {
        looks.push(look ?? 'shown')
        return views.map(() => 'data:image/png;base64,iVBORw0KGgo=')
      },
    }))
    useEffect(() => onReady?.(), [onReady])
    return <canvas aria-label="三维" />
  },
}))

// jsdom cannot draw on a canvas; the plan export itself is exercised in the browser.
vi.mock('./plan-export.ts', () => ({
  exportPlan: async () => ({
    png: 'iVBORw0KGgo=',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  }),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const NODE = '22222222-2222-4222-8222-222222222222'

const project: Project = {
  id: PROJECT,
  name: '渲染测试',
  shopType: 'side_hall',
  market: 'domestic',
  siStyle: 'SI1.0',
  revision: 1,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  deletedAt: null,
}

const node: DesignNode = {
  id: NODE,
  projectId: PROJECT,
  parentId: '33333333-3333-4333-8333-333333333333',
  kind: 'render',
  name: '渲染',
  strategy: null,
  siStyle: 'SI1.0',
  origin: 'user',
  importedFrom: null,
  hidden: false,
  createdAt: '2026-10-10T00:00:00.000Z',
  space: null,
  layout: { schemaVersion: 3, items: [], planning: null },
}

function camera(i: number, name: string): NodeCamera {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    nodeId: NODE,
    sort: i,
    camera: { name, position: [i, 5, 9], target: [4, 0.8, 3], fovDeg: 48, source: 'auto' },
    deletedAt: null,
  }
}

function image(cameraId: string, mode: 'white' | 'material', stale = false): RenderImage {
  const id = crypto.randomUUID()
  return {
    id,
    cameraId,
    mode,
    url: `/api/v1/files/${id}`,
    width: 1800,
    height: 1200,
    stale,
    createdAt: '2026-10-10T00:00:00.000Z',
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeApi(cameras: NodeCamera[], images: RenderImage[]) {
  const uploads: { path: string; type: string | null }[] = []
  const deliveries: Delivery[] = []
  const posted: unknown[] = []
  const fetchMock = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    if (pathname.endsWith('/deliveries')) {
      if (request.method === 'POST') {
        posted.push(await request.json())
        const file = (name: string) => ({ url: `/api/v1/files/${name}`, name, bytes: 2048 })
        const delivery: Delivery = {
          id: '44444444-4444-4444-8444-444444444444',
          nodeId: NODE,
          folderName: '影石渲染测试店_边厅店_48.0㎡_2026-10-10',
          archivePath: 'D:/archive/影石渲染测试店_边厅店_48.0㎡_2026-10-10',
          fullPdf: file('00-影石渲染测试店完整方案.pdf'),
          showPdf: file('影石渲染测试店方案.pdf'),
          zip: file('交付.zip'),
          pages: { full: 5, show: 3 },
          views: 2,
          createdAt: '2026-10-10T10:00:00.000Z',
        }
        deliveries.unshift(delivery)
        return json(201, delivery)
      }
      return json(200, { nodeId: NODE, deliveries })
    }
    if (request.method === 'PUT') {
      uploads.push({ path: pathname, type: request.headers.get('content-type') })
      const [, cameraId = '', mode] = pathname.match(/renders\/([^/]+)\/(white|material)$/) ?? []
      const saved = image(cameraId, mode === 'white' ? 'white' : 'material')
      images.push(saved)
      return json(201, saved)
    }
    if (pathname.endsWith('/cameras')) return json(200, { nodeId: NODE, cameras })
    if (pathname.endsWith('/renders')) return json(200, { nodeId: NODE, images })
    return json(404, { error: { code: 'NOT_FOUND', message: '不存在', requestId: 'x' } })
  })
  return { uploads, posted, fetchMock }
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RenderStage
        left={null}
        project={project}
        node={node}
        space={rectangleSpace(8, 6, 3.2)}
        assets={new Map()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  looks.length = 0
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RenderStage', () => {
  it('renders every missing view once, white first, and uploads PNGs', async () => {
    const { uploads, fetchMock } = fakeApi([camera(0, '正面鸟瞰'), camera(1, '入口方向')], [])
    vi.stubGlobal('fetch', fetchMock)
    show()

    await waitFor(() => expect(uploads).toHaveLength(4))
    expect(looks).toEqual(['white', 'white', 'material', 'material'])
    expect(uploads.every((u) => u.type === 'image/png')).toBe(true)
    expect(uploads.map((u) => u.path.split('/').pop())).toEqual([
      'white',
      'white',
      'material',
      'material',
    ])
    expect(await screen.findByText(/已渲染 4\/4 张/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载图片' })).toHaveProperty('disabled', false)
    // Every view current: the delivery can be made.
    expect(screen.getByRole('button', { name: '生成交付文件' })).toHaveProperty('disabled', false)
  })

  it('sends the numbered plan for the delivery and lists the files', async () => {
    const front = camera(0, '正面鸟瞰')
    const images = [image(front.id, 'white'), image(front.id, 'material')]
    const { posted, fetchMock } = fakeApi([front], images)
    vi.stubGlobal('fetch', fetchMock)
    show()

    const deliver = await screen.findByRole('button', { name: '生成交付文件' })
    await waitFor(() => expect(deliver).toHaveProperty('disabled', false))
    expect(screen.getByText(/生成后这里列出每次交付/)).toBeTruthy()
    fireEvent.click(deliver)

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      planPng: 'iVBORw0KGgo=',
      planSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    })
    const full = await screen.findByRole('link', { name: '完整版 PDF（5 页）' })
    expect(full.getAttribute('href')).toBe('/api/v1/files/00-影石渲染测试店完整方案.pdf')
    expect(screen.getByRole('link', { name: '展示版 PDF（3 页）' })).toBeTruthy()
    expect(screen.getByText('影石渲染测试店_边厅店_48.0㎡_2026-10-10')).toBeTruthy()
  })

  it('marks stale images and does not re-render them on its own', async () => {
    const front = camera(0, '正面鸟瞰')
    const images = [image(front.id, 'white'), image(front.id, 'material', true)]
    const { uploads, fetchMock } = fakeApi([front], images)
    vi.stubGlobal('fetch', fetchMock)
    show()

    expect(await screen.findByText('1 张过期')).toBeTruthy()
    expect(screen.getByText('过期')).toBeTruthy()
    expect(screen.getByText(/已渲染 1\/2 张/)).toBeTruthy()
    expect(screen.getByRole('img', { name: '正面鸟瞰 材质图' })).toBeTruthy()
    expect(uploads).toHaveLength(0)
    expect(looks).toEqual([])
    expect(screen.getByRole('button', { name: '生成交付文件' })).toHaveProperty('disabled', true)
  })
})
