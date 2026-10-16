import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Asset, PlanUpload, RecognitionRun, RecognizeResponse } from '@store/shared'
import { makeAsset, makeNode } from '../../test-utils/factories.ts'
import { json, notFound, stubFetch } from '../../test-utils/fake-api.ts'
import type { FakeRequest } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import { RecognitionPanel } from './RecognitionPanel.tsx'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const UPLOAD = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'

const asset = (id: string, name: string, fn: Asset['function'], w: number, d: number): Asset =>
  makeAsset({ id, name, standardName: name, function: fn, footprint: { w, d, h: 0.9 } })
const ASSETS = [
  asset('asset-1', '1.8米普通中岛桌', 'island_table', 1, 1.8),
  asset('asset-2', '1.2米配件柜', 'accessory_cabinet', 1.2, 0.45),
]

const upload: PlanUpload = {
  id: UPLOAD,
  projectId: PROJECT,
  fileId: '44444444-4444-4444-8444-444444444444',
  url: '/api/v1/files/44444444-4444-4444-8444-444444444444',
  originalName: '简图.png',
  page: null,
  width: 1000,
  height: 800,
  createdAt: '2026-10-12T01:00:00.000Z',
}

const run: RecognitionRun = {
  id: RUN,
  uploadId: UPLOAD,
  method: 'llm',
  provider: 'dashscope',
  model: 'qwen3-vl-flash',
  status: 'succeeded',
  draft: {
    space: {
      boundary: [
        [0, 0],
        [6, 0],
        [6, 4.5],
        [0, 4.5],
      ],
      entrances: [{ a: [2, 4.5], b: [3.5, 4.5], kind: 'main' }],
      obstacles: [],
      height: null,
    },
    items: [
      {
        ref: 'm1',
        label: '中岛桌',
        assetId: null,
        function: 'island_table',
        source: 'requested',
        cx: 1.9,
        cz: 2,
        w: 1.8,
        d: 1,
        // Read 2° off a quarter turn: counts as 90°.
        rotation: 92,
        confidence: 0.5,
        note: '「中岛桌」有多种尺寸，请选择型号',
      },
      {
        ref: 'm2',
        label: '配件柜',
        assetId: 'asset-2',
        function: 'accessory_cabinet',
        source: 'existing',
        cx: 4,
        cz: 0.3,
        w: 1.2,
        d: 0.45,
        // A slanted cabinet keeps its angle.
        rotation: 30,
        confidence: 0.9,
        note: null,
      },
      {
        ref: 'm3',
        label: '楼梯',
        assetId: null,
        function: 'other',
        source: 'outside',
        cx: 3,
        cz: 6,
        w: 2,
        d: 1,
        rotation: 0,
        confidence: 0.8,
        note: null,
      },
    ],
    scale: {
      method: 'dimension',
      reference: '尺寸标注 5400、4800',
      mmPerPixel: 10,
      originPx: [100, 100],
      verified: true,
    },
    pending: ['图上没有层高，请填写', '入口宽度按默认 1.5 m，请核对'],
    confidence: 0.85,
    notes: ['比例按 2 处尺寸标注交叉核对得出'],
  },
  error: null,
  fallbackOf: null,
  confirmedNodeId: null,
  createdAt: '2026-10-12T01:00:01.000Z',
  finishedAt: '2026-10-12T01:00:05.000Z',
}

/** Uploads are recorded by their content type; JSON bodies are parsed. */
async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? ''
  return type.startsWith('application/json') ? JSON.parse(await request.text()) : type
}

function fakeApi() {
  const handle = ({ request, path: pathname }: FakeRequest) => {
    if (request.method === 'POST' && pathname.endsWith('/uploads')) return json(201, upload)
    if (request.method === 'POST' && pathname.endsWith('/recognize')) {
      const response: RecognizeResponse = { run, attempted: null }
      return json(200, response)
    }
    if (pathname.endsWith('/runs')) return json(200, [run])
    if (request.method === 'POST' && pathname.endsWith('/confirm')) {
      return json(201, {
        node: makeNode('55555555-5555-4555-8555-555555555555', null, {
          projectId: PROJECT,
          kind: 'space',
          name: '识别空间',
          origin: 'recognition',
          createdAt: '2026-10-12T01:00:10.000Z',
        }),
        issues: [],
      })
    }
    return notFound()
  }
  return stubFetch(handle, { readBody })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RecognitionPanel', () => {
  it('uploads a picture, shows the result, lets the model be chosen, and confirms the space', async () => {
    const server = fakeApi()
    const onCreated = vi.fn()
    renderWithClient(<RecognitionPanel projectId={PROJECT} assets={ASSETS} onCreated={onCreated} />)

    const file = new File([new Uint8Array([137, 80, 78, 71])], '简图.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('选择简图文件'), { target: { files: [file] } })
    await screen.findByText(/简图\.png/)
    expect(server.calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/v1/projects/${PROJECT}/uploads`,
      body: 'image/png',
    })
    expect(screen.getByRole('img', { name: '上传的简图' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '识别' }))
    await screen.findByText('待确认（2）')
    expect(screen.getByText('图上没有层高，请填写')).toBeTruthy()
    expect(screen.getByText(/模型 qwen3-vl-flash · 置信度 0.85/)).toBeTruthy()
    const rows = within(screen.getByRole('table', { name: '识别到的道具' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[2] as HTMLElement).getByText('不放入')).toBeTruthy()

    // The island table had no model yet: pick one; the cabinet keeps its own.
    const island = screen.getByLabelText<HTMLSelectElement>('中岛桌 对应模型')
    expect(island.value).toBe('')
    fireEvent.change(island, { target: { value: 'asset-1' } })
    expect(screen.getByLabelText<HTMLSelectElement>('配件柜 对应模型').value).toBe('asset-2')

    fireEvent.change(screen.getByLabelText('层高（毫米）'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: '保存空间' }))
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555'),
    )
    const confirm = server.calls.find((c) => c.path.endsWith('/confirm'))?.body as {
      name: string
      space: { height: number; boundary: number[][]; entrances: unknown[] }
      layout: {
        items: {
          id: string
          assetId: string | null
          placeholder: boolean
          rotation: number
          w: number
        }[]
      }
    }
    expect(confirm.space.height).toBe(3)
    expect(confirm.space.boundary).toHaveLength(4)
    expect(confirm.space.entrances).toHaveLength(1)
    // Outside props are left out; the chosen model gives its size and is not a placeholder.
    expect(confirm.layout.items.map((i) => i.id)).toEqual(['m1', 'm2'])
    expect(confirm.layout.items[0]).toMatchObject({
      assetId: 'asset-1',
      placeholder: false,
      rotation: 90,
      w: 1.8,
    })
    expect(confirm.layout.items[1]).toMatchObject({ assetId: 'asset-2', rotation: 30, w: 1.2 })
  })

  it('explains a failed run and refuses files it cannot read', async () => {
    const server = fakeApi()
    const failed: RecognitionRun = {
      ...run,
      status: 'failed',
      error: '比例无法标定',
      draft: { ...run.draft!, scale: null, space: null, confidence: 0.2 },
    }
    server.fetchMock.mockImplementation(async (request: Request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/uploads')) return json(201, upload)
      if (pathname.endsWith('/recognize')) return json(200, { run: failed, attempted: null })
      return json(200, [])
    })
    renderWithClient(<RecognitionPanel projectId={PROJECT} assets={ASSETS} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('选择简图文件'), {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    })
    expect(await screen.findByText(/只支持 JPG、PNG 或 PDF/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('选择简图文件'), {
      target: { files: [new File(['x'], '简图.png', { type: 'image/png' })] },
    })
    await screen.findByText(/简图\.png/)
    fireEvent.click(screen.getByRole('button', { name: '识别' }))
    expect(await screen.findByText(/比例无法标定/)).toBeTruthy()
    expect(screen.getByText(/指定一段已知长度后重新识别/)).toBeTruthy()
  })
})
