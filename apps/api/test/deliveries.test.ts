import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Delivery, DeliveryList, NodeCameraList, NodeCreated, Project } from '@store/shared'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp
let dir: string
let archive: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'store-deliveries-'))
  archive = path.join(dir, 'archive')
  t = await createTestApp({ STORAGE_ROOT: path.join(dir, 'files'), ARCHIVE_ROOT: archive })
})

afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

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

/** A render node whose eight views all have a white and a material image. */
async function renderedNode(name: string) {
  const project = (
    await inject('POST', '/projects', { name, shopType: 'side_hall' })
  ).json<Project>()
  const create = async (payload: object) =>
    (await inject('POST', `/projects/${project.id}/nodes`, payload)).json<NodeCreated>().node
  const space = await create({
    parentId: null,
    kind: 'space',
    name: '空间',
    space: { ...rectangleSpace(8, 6, 3.2), entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }] },
  })
  const plan = await create({ parentId: space.id, kind: 'plan', name: '方案 · 按面积推荐', layout })
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
  for (const [i, camera] of cameras.entries()) {
    for (const mode of ['white', 'material']) {
      const response = await t.app.inject({
        method: 'PUT',
        url: `/api/v1/nodes/${render.id}/renders/${camera.id}/${mode}`,
        headers: { 'content-type': 'image/png' },
        payload: png(150, 100, mode === 'white' ? 230 : 40 + i * 20),
      })
      expect(response.statusCode).toBe(201)
    }
  }
  return { project, render, cameras }
}

const planPng = png(400, 300, 250).toString('base64')

describe('deliveries', () => {
  it('builds both PDFs, the ZIP and the archive folder of a fully rendered node', async () => {
    const { render, cameras } = await renderedNode('西安赛高世纪金花照材店')
    const response = await inject('POST', `/nodes/${render.id}/deliveries`, {
      planPng,
      planSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    })
    expect(response.statusCode).toBe(201)
    const delivery = response.json<Delivery>()
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(delivery.folderName).toBe(`影石西安赛高世纪金花照材店_边厅店_48.0㎡_${date}`)
    expect(delivery.fullPdf.name).toBe('00-影石西安赛高世纪金花照材店完整方案.pdf')
    expect(delivery.showPdf.name).toBe('影石西安赛高世纪金花照材店方案.pdf')
    // 完整版: plan, overview, one page per view, white-model sheet. 展示版: plan + one per view.
    expect(delivery.views).toBe(cameras.length)
    expect(delivery.pages).toEqual({ full: cameras.length + 3, show: cameras.length + 1 })

    for (const file of [delivery.fullPdf, delivery.showPdf]) {
      const pdf = await t.app.inject({ method: 'GET', url: file.url })
      expect(pdf.statusCode).toBe(200)
      expect(pdf.headers['content-type']).toBe('application/pdf')
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    }

    const zip = await t.app.inject({ method: 'GET', url: delivery.zip.url })
    const entries = Object.keys(unzipSync(new Uint8Array(zip.rawPayload)))
    const root = `${delivery.folderName}/`
    expect(entries).toContain(`${root}${delivery.fullPdf.name}`)
    expect(entries).toContain(`${root}${delivery.showPdf.name}`)
    expect(entries).toContain(`${root}01_平面图/平面图.png`)
    expect(entries).toContain(`${root}01_平面图/平面图.svg`)
    expect(entries).toContain(`${root}02_效果图/01-正面鸟瞰.png`)
    expect(entries).toContain(`${root}03_总览/01-正面鸟瞰-白模.png`)
    expect(entries).toContain(`${root}04_源文件与记录/交付记录.json`)
    expect(entries).toContain(`${root}04_源文件与记录/项目.json`)

    expect(delivery.archivePath).toBe(path.join(archive, delivery.folderName))
    expect(existsSync(path.join(archive, delivery.folderName, delivery.fullPdf.name))).toBe(true)
    expect(await readdir(path.join(archive, delivery.folderName, '02_效果图'))).toHaveLength(
      cameras.length,
    )

    // A second delivery the same day gets its own revision folder.
    const again = (
      await inject('POST', `/nodes/${render.id}/deliveries`, { planPng })
    ).json<Delivery>()
    expect(again.folderName).toBe(`${delivery.folderName}_修订02`)
    const list = (await inject('GET', `/nodes/${render.id}/deliveries`)).json<DeliveryList>()
    expect(list.deliveries.map((d) => d.folderName)).toEqual([
      again.folderName,
      delivery.folderName,
    ])
  })

  it('refuses while images are missing or stale, and refuses a non-PNG plan', async () => {
    const { render, cameras } = await renderedNode('专区测试')
    const [front] = cameras
    if (!front) throw new Error('views missing')
    await inject('PATCH', `/cameras/${front.id}`, { fovDeg: 60 })
    const stale = await inject('POST', `/nodes/${render.id}/deliveries`, { planPng })
    expect(stale.statusCode).toBe(409)
    expect(stale.json<{ error: { details: unknown } }>().error.details).toEqual({
      missing: 0,
      stale: 2,
    })

    const { render: other } = await renderedNode('平面测试')
    const notPng = await inject('POST', `/nodes/${other.id}/deliveries`, {
      planPng: Buffer.from('not a picture at all').toString('base64'),
    })
    expect(notPng.statusCode).toBe(400)
  })
})
