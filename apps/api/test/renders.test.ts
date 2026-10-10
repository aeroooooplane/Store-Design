import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type {
  NodeCameraList,
  NodeCreated,
  NodeRenderList,
  Project,
  RenderImage,
} from '@store/shared'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp
let storage: string

beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), 'store-renders-'))
  t = await createTestApp({ STORAGE_ROOT: storage })
})

afterAll(async () => {
  await t.close()
  await rm(storage, { recursive: true, force: true })
})

/** A real, tiny grey PNG. */
function png(width: number, height: number, shade = 200): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(0, 9) // greyscale
  const rows = Buffer.alloc((width + 1) * height, shade)
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0 // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const layout = {
  schemaVersion: 3,
  items: [
    {
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
    },
  ],
}

async function inject(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
  return t.app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) })
}

const upload = (nodeId: string, cameraId: string, mode: string, body: Buffer | string) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/v1/nodes/${nodeId}/renders/${cameraId}/${mode}`,
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'image/png' },
    payload: body,
  })

/** space → plan → white → render; returns the nodes and the render node's views. */
async function renderNode() {
  const project = (
    await inject('POST', '/projects', { name: '渲染测试', shopType: 'side_hall' })
  ).json<Project>()
  const create = async (payload: object) => {
    const response = await inject('POST', `/projects/${project.id}/nodes`, payload)
    expect(response.statusCode).toBe(201)
    return response.json<NodeCreated>().node
  }
  const space = await create({
    parentId: null,
    kind: 'space',
    name: '空间',
    space: { ...rectangleSpace(8, 6, 3.2), entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }] },
  })
  const plan = await create({ parentId: space.id, kind: 'plan', name: '方案', layout })
  const white = await create({ parentId: plan.id, kind: 'white', name: '白模确认', layout })
  const render = await create({
    parentId: white.id,
    kind: 'render',
    name: '渲染',
    siStyle: 'SI1.0',
    layout,
  })
  const cameras = (await inject('GET', `/nodes/${render.id}/cameras`)).json<NodeCameraList>()
    .cameras
  return { project, plan, white, render, cameras }
}

const images = async (nodeId: string) =>
  (await inject('GET', `/nodes/${nodeId}/renders`)).json<NodeRenderList>().images

describe('renders', () => {
  it('stores a browser-rendered PNG per view and mode and serves it back', async () => {
    const { render, cameras } = await renderNode()
    expect(cameras).toHaveLength(8)
    expect(await images(render.id)).toEqual([])
    const [front, left] = cameras
    if (!front || !left) throw new Error('views missing')

    const picture = png(180, 120)
    const saved = await upload(render.id, front.id, 'material', picture)
    expect(saved.statusCode).toBe(201)
    const image = saved.json<RenderImage>()
    expect(image).toMatchObject({ cameraId: front.id, mode: 'material', width: 180, height: 120 })
    expect(image.stale).toBe(false)
    expect((await upload(render.id, left.id, 'white', png(180, 120, 90))).statusCode).toBe(201)

    // Listed in view order, newest per view and mode.
    const listed = await images(render.id)
    expect(listed.map((i) => [i.cameraId, i.mode])).toEqual([
      [front.id, 'material'],
      [left.id, 'white'],
    ])
    const file = await t.app.inject({ method: 'GET', url: image.url })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('image/png')
    expect(Buffer.compare(file.rawPayload, picture)).toBe(0)

    // Uploading again replaces the newest image of that view and mode.
    const again = (
      await upload(render.id, front.id, 'material', png(180, 120, 30))
    ).json<RenderImage>()
    const relisted = await images(render.id)
    expect(relisted).toHaveLength(2)
    expect(relisted[0]?.url).toBe(again.url)
  })

  it('marks an image stale when its view is re-aimed, not when it is renamed', async () => {
    const { render, cameras } = await renderNode()
    const [front] = cameras
    if (!front) throw new Error('views missing')
    await upload(render.id, front.id, 'white', png(96, 64))

    await inject('PATCH', `/cameras/${front.id}`, { name: '门口看进去' })
    expect((await images(render.id))[0]?.stale).toBe(false)

    await inject('PATCH', `/cameras/${front.id}`, { fovDeg: 60 })
    expect((await images(render.id))[0]?.stale).toBe(true)
    // A new image for the new pose is current again.
    await upload(render.id, front.id, 'white', png(96, 64, 10))
    expect((await images(render.id))[0]?.stale).toBe(false)
  })

  it('refuses non-PNG bodies, unknown views and nodes that are not renders', async () => {
    const { white, render, cameras } = await renderNode()
    const [front] = cameras
    if (!front) throw new Error('views missing')

    const text = await upload(render.id, front.id, 'white', 'not an image')
    expect(text.statusCode).toBe(400)
    const fake = await upload(render.id, front.id, 'white', Buffer.from('GIF89a not a png at all'))
    expect(fake.statusCode).toBe(400)
    const tiny = await upload(render.id, front.id, 'white', png(10, 10))
    expect(tiny.statusCode).toBe(400)

    const unknown = await upload(
      render.id,
      '00000000-0000-4000-8000-000000000000',
      'white',
      png(96, 64),
    )
    expect(unknown.statusCode).toBe(404)

    const whiteCameras = (await inject('GET', `/nodes/${white.id}/cameras`)).json<NodeCameraList>()
    const onWhite = await upload(white.id, whiteCameras.cameras[0]?.id ?? '', 'white', png(96, 64))
    expect(onWhite.statusCode).toBe(409)
    expect(await images(white.id)).toEqual([])
  })

  it('downloads the current images as a ZIP named by view and mode', async () => {
    const { render, cameras } = await renderNode()
    const empty = await inject('GET', `/nodes/${render.id}/renders/archive`)
    expect(empty.statusCode).toBe(409)

    const [front, left] = cameras
    if (!front || !left) throw new Error('views missing')
    await upload(render.id, front.id, 'white', png(96, 64))
    await upload(render.id, front.id, 'material', png(96, 64, 40))
    await upload(render.id, left.id, 'material', png(96, 64, 80))
    // A stale image is left out of the download.
    await inject('PATCH', `/cameras/${left.id}`, { fovDeg: 70 })

    const archive = await inject('GET', `/nodes/${render.id}/renders/archive`)
    expect(archive.statusCode).toBe(200)
    expect(archive.headers['content-type']).toBe('application/zip')
    expect(decodeURIComponent(String(archive.headers['content-disposition']))).toContain(
      '渲染图-渲染.zip',
    )
    const files = unzipSync(new Uint8Array(archive.rawPayload))
    expect(Object.keys(files).sort()).toEqual(['01-正面鸟瞰-材质.png', '01-正面鸟瞰-白模.png'])
  })
})
