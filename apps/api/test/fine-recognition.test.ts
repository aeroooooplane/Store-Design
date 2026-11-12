import { itemCorners, openingPieces } from '@store/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'
import { createProject } from './fixtures.ts'
import { convertFine } from '../src/modules/recognition/fine-convert.ts'
import type { FineDraft } from '../src/modules/recognition/fine-contract.ts'
import type { FineRecord } from '../src/modules/recognition/fine-service.ts'
vi.mock('../src/modules/recognition/ocr.ts', () => ({
  readPageTexts: vi.fn(async () => []),
  readDimensionChains: vi.fn(async () => []),
  cachedReading: vi.fn(),
}))
const base: FineDraft = {
  objects: [],
  boundary: [
    [5, 5],
    [195, 5],
    [195, 195],
    [5, 195],
  ],
  calibration: { a: [5, 5], b: [195, 5], mm: 6000 },
  heightMm: 3000,
  openEdges: [0, 1, 2, 3],
  entrances: [],
  structureReviewed: true,
  reviewer: '测试',
  notes: '',
}
describe('精细几何草稿与原生转换', () => {
  let t: TestApp, root: string, id: string, record: FineRecord
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fine-test-'))
    t = await createTestApp({ STORAGE_ROOT: root })
    const p = await createProject(t, { name: '精细识别测试', shopType: 'island' })
    const u = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects/' + p.id + '/uploads',
      headers: { 'content-type': 'image/png' },
      payload: png(200, 200, 255),
    })
    expect(u.statusCode).toBe(201)
    id = u.json().id
  }, 60000)
  afterAll(async () => {
    await t?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })
  it('默认无草稿；本地提取保存原始来源且重复请求不覆盖', async () => {
    expect((await t.app.inject('/api/v1/uploads/' + id + '/fine')).json()).toBeNull()
    const a = await t.app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/fine' })
    expect(a.statusCode, a.body).toBe(200)
    record = a.json()
    expect(record.cloudRequests).toBe(0)
    expect(record.draft.heightMm).toBeNull()
    expect(record.draft.boundary).toEqual([])
    const b = await t.app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/fine' })
    expect(b.json()).toEqual(record)
  })
  it('保存持久化且拒绝过期写入，原始提取不变', async () => {
    const a = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/uploads/' + id + '/fine',
      payload: { revision: 0, draft: base },
    })
    expect(a.statusCode, a.body).toBe(200)
    expect(a.json().raw).toEqual(record.raw)
    expect((await t.app.inject('/api/v1/uploads/' + id + '/fine')).json().draft).toEqual(base)
    const b = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/uploads/' + id + '/fine',
      payload: { revision: 0, draft: base },
    })
    expect(b.statusCode).toBe(409)
  })
  it('拒绝图外坐标、伪造候选与重复对象', async () => {
    for (const objects of [
      [
        {
          id: 'M1',
          candidateId: 'fake',
          kind: 'column',
          label: '柱',
          points: [
            [1, 1],
            [2, 1],
            [2, 2],
          ],
          status: 'keep',
          heightMm: null,
        },
      ],
      [
        {
          id: 'M1',
          candidateId: null,
          kind: 'column',
          label: '柱',
          points: [
            [1, 1],
            [300, 1],
            [2, 2],
          ],
          status: 'keep',
          heightMm: null,
        },
      ],
    ]) {
      const a = await t.app.inject({
        method: 'PUT',
        url: '/api/v1/uploads/' + id + '/fine',
        payload: { revision: 1, draft: { ...base, objects } },
      })
      expect(a.statusCode).toBe(400)
    }
  })
  it('量尺和层高未知时不生成空间', () => {
    expect(() => convertFine({ ...base, heightMm: null })).toThrow()
    expect(() => convertFine({ ...base, calibration: null })).toThrow()
    expect(() => convertFine({ ...base, structureReviewed: false })).toThrow()
  })
  it('屏幕与越界柱保留二维，不造嵌墙块', () => {
    const d: FineDraft = {
      ...base,
      objects: [
        {
          id: 'C',
          candidateId: null,
          kind: 'column',
          label: '柱',
          points: [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
          status: 'keep',
          heightMm: null,
        },
        {
          id: 'S',
          candidateId: null,
          kind: 'wall-display',
          label: '灯箱',
          points: [
            [40, 40],
            [80, 40],
            [80, 44],
            [40, 44],
          ],
          status: 'keep',
          heightMm: 1000,
        },
      ],
    }
    const c = convertFine(d)
    expect(c.omissions.map((x) => x.id)).toEqual(['C', 'S'])
    expect(c.layout.items).toHaveLength(0)
    expect(c.space.obstacles).toHaveLength(0)
  })
  it('明确排除清单后原生空间生成，重复确认拒绝', async () => {
    const draft: FineDraft = {
      ...base,
      objects: [
        {
          id: 'M1',
          candidateId: null,
          kind: 'furniture',
          label: '桌',
          points: [
            [40, 40],
            [80, 40],
            [80, 60],
            [40, 60],
          ],
          status: 'keep',
          heightMm: 900,
        },
        {
          id: 'M2',
          candidateId: null,
          kind: 'wall-display',
          label: '屏',
          points: [
            [100, 40],
            [120, 40],
            [120, 44],
            [100, 44],
          ],
          status: 'keep',
          heightMm: null,
        },
      ],
    }
    const body = { revision: 1, draft, name: '识别空间', acknowledgedOmissions: [] as string[] }
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/v1/uploads/' + id + '/fine/confirm',
          payload: body,
        })
      ).statusCode,
    ).toBe(400)
    body.acknowledgedOmissions = ['M2']
    const a = await t.app.inject({
      method: 'POST',
      url: '/api/v1/uploads/' + id + '/fine/confirm',
      payload: body,
    })
    expect(a.statusCode, a.body).toBe(200)
    expect(a.json().confirmedNodeId).toBeTruthy()
    const node = await t.app.inject('/api/v1/nodes/' + a.json().confirmedNodeId)
    expect(node.statusCode).toBe(200)
    expect(node.json().layout.items).toHaveLength(1)
    expect(node.json().space.openEdges).toHaveLength(4)
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/v1/uploads/' + id + '/fine/confirm',
          payload: body,
        })
      ).statusCode,
    ).toBe(409)
  })
})

it('斜矩形原生外框与多入口折线路径保持', () => {
  const points: [number, number][] = [
    [50, 30],
    [90, 70],
    [70, 90],
    [30, 50],
  ]
  const d: FineDraft = {
    ...base,
    entrances: [
      { a: [100, 5], b: [195, 100], kind: 'main' },
      { a: [5, 100], b: [100, 195], kind: 'side' },
    ],
    objects: [
      {
        id: 'D',
        candidateId: null,
        kind: 'furniture',
        label: '斜桌',
        points,
        status: 'keep',
        heightMm: 900,
      },
    ],
  }
  const c = convertFine(d),
    corners = itemCorners(c.layout.items[0]!),
    scale = 6000 / 190 / 1000
  for (const p of points)
    expect(
      Math.min(
        ...corners.map((q) => Math.hypot(q[0] - (p[0] - 5) * scale, q[1] - (p[1] - 5) * scale)),
      ),
    ).toBeLessThan(0.002)
  expect(c.space.entrances).toHaveLength(2)
  expect(openingPieces(c.space, c.space.entrances[0]!)).toHaveLength(2)
})
