import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema } from '@store/database'
import type { NodeCameraList, NodeRenderList, RenderImage } from '@store/shared'
import { api, renderChain } from './fixtures.ts'
import { createTestApp, png } from './helpers.ts'
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

const inject = api(() => t)

/** A white-model image as made before 2026-10-12: a copy of a material row, mode 'white'. */
async function seedOldWhite(nodeId: string, cameraId: string) {
  const { renders } = schema
  const [row] = await t.database.db
    .select()
    .from(renders)
    .where(and(eq(renders.nodeId, nodeId), eq(renders.cameraId, cameraId)))
  if (!row) throw new Error('upload a material image first')
  const { id: _id, ...rest } = row
  await t.database.db.insert(renders).values({ ...rest, mode: 'white' })
}

const upload = (nodeId: string, cameraId: string, mode: string, body: Buffer | string) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/v1/nodes/${nodeId}/renders/${cameraId}/${mode}`,
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'image/png' },
    payload: body,
  })

/** space → plan → white → render; returns the nodes and the render node's views. */
const renderNode = () => renderChain(t, { projectName: '渲染测试' })

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
    expect((await upload(render.id, left.id, 'material', png(180, 120, 90))).statusCode).toBe(201)
    // New white-model images are refused; old ones (made before 2026-10-12) are no longer listed.
    expect((await upload(render.id, left.id, 'white', png(180, 120, 60))).statusCode).toBe(400)
    await seedOldWhite(render.id, left.id)

    // Listed in view order, newest per view.
    const listed = await images(render.id)
    expect(listed.map((i) => [i.cameraId, i.mode])).toEqual([
      [front.id, 'material'],
      [left.id, 'material'],
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
    await upload(render.id, front.id, 'material', png(96, 64))

    await inject('PATCH', `/cameras/${front.id}`, { name: '门口看进去' })
    expect((await images(render.id))[0]?.stale).toBe(false)

    await inject('PATCH', `/cameras/${front.id}`, { fovDeg: 60 })
    expect((await images(render.id))[0]?.stale).toBe(true)
    // A new image for the new pose is current again.
    await upload(render.id, front.id, 'material', png(96, 64, 10))
    expect((await images(render.id))[0]?.stale).toBe(false)
  })

  it('refuses non-PNG bodies, unknown views and nodes that are not renders', async () => {
    const { white, render, cameras } = await renderNode()
    const [front] = cameras
    if (!front) throw new Error('views missing')

    const text = await upload(render.id, front.id, 'material', 'not an image')
    expect(text.statusCode).toBe(400)
    const fake = await upload(
      render.id,
      front.id,
      'material',
      Buffer.from('GIF89a not a png at all'),
    )
    expect(fake.statusCode).toBe(400)
    const tiny = await upload(render.id, front.id, 'material', png(10, 10))
    expect(tiny.statusCode).toBe(400)

    const unknown = await upload(
      render.id,
      '00000000-0000-4000-8000-000000000000',
      'material',
      png(96, 64),
    )
    expect(unknown.statusCode).toBe(404)

    const whiteCameras = (await inject('GET', `/nodes/${white.id}/cameras`)).json<NodeCameraList>()
    const onWhite = await upload(
      white.id,
      whiteCameras.cameras[0]?.id ?? '',
      'material',
      png(96, 64),
    )
    expect(onWhite.statusCode).toBe(409)
    expect(await images(white.id)).toEqual([])
  })

  it('downloads the current material images as a ZIP named by view', async () => {
    const { render, cameras } = await renderNode()
    const empty = await inject('GET', `/nodes/${render.id}/renders/archive`)
    expect(empty.statusCode).toBe(409)

    const [front, left] = cameras
    if (!front || !left) throw new Error('views missing')
    await upload(render.id, front.id, 'material', png(96, 64, 40))
    await seedOldWhite(render.id, front.id)
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
    // Old white-model images are not downloaded either.
    expect(Object.keys(files)).toEqual(['01-正面鸟瞰-材质.png'])
  })
})
