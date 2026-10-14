import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Delivery,
  DisplayExport,
  DisplayRulesView,
  DisplayTask,
  DisplayTaskList,
  NodeDisplay,
} from '@store/shared'
import { importDisplayRules } from '../src/modules/displays/importer.ts'
import { api, renderChain } from './fixtures.ts'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

const RESOURCE = path.resolve(import.meta.dirname, '../../../资源库')
let t: TestApp
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'store-displays-'))
  t = await createTestApp({
    STORAGE_ROOT: path.join(dir, 'files'),
    ARCHIVE_ROOT: path.join(dir, 'archive'),
    RESOURCE_ROOT: RESOURCE,
  })
  const report = await importDisplayRules(t.database.db, {
    storage: path.join(dir, 'files'),
    resource: RESOURCE,
  })
  expect(report.status).toBe('imported')
})

afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const inject = api(() => t)
const ifMatch = (revision: number) => ({ 'if-match': `"${revision}"` })

async function download(link: { url: string }) {
  const response = await t.app.inject({ method: 'GET', url: link.url })
  expect(response.statusCode).toBe(200)
  return response
}

describe('display rules', () => {
  it('serves the rules in force with photo links', async () => {
    const view = (await inject('GET', '/display-rules/current')).json<DisplayRulesView>()
    expect(view.version).toBe('2026-10-13')
    expect(view.photos.length).toBeGreaterThan(50)
    const photo = view.photos[0]
    if (photo) await download(photo)
  })
})

describe('display tasks (uploaded plan and render)', () => {
  it('stores the pictures, keeps the tables placed by hand and exports the PPT and checklist', async () => {
    const created = await inject('POST', '/display-tasks', {
      name: '武汉荟聚边厅专卖店',
      market: 'domestic',
      siStyle: 'SI2.0',
    })
    expect(created.statusCode).toBe(201)
    let task = created.json<DisplayTask>()
    expect(task.plan).toBeNull()

    const put = (which: 'plan' | 'render', revision: number, data: Buffer) =>
      t.app.inject({
        method: 'PUT',
        url: `/api/v1/display-tasks/${task.id}/${which}?originalName=${encodeURIComponent(`${which}.png`)}&page=3`,
        headers: { 'content-type': 'image/png', ...ifMatch(revision) },
        payload: data,
      })
    let response = await put('plan', task.revision, png(400, 300, 230))
    expect(response.statusCode).toBe(200)
    task = response.json<DisplayTask>()
    expect(task.plan).toMatchObject({ width: 400, height: 300, page: 3, originalName: 'plan.png' })
    response = await put('render', task.revision, png(300, 200, 120))
    task = response.json<DisplayTask>()
    expect(task.render).toMatchObject({ width: 300, height: 200 })
    // A stale revision is refused.
    expect((await put('render', 1, png(300, 200))).statusCode).toBe(409)

    // No vector content and no model: nothing found, the notes say what to do.
    response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/display-tasks/${task.id}/detect`,
      headers: ifMatch(task.revision),
      payload: { useModel: false },
    })
    expect(response.statusCode).toBe(200)
    task = response.json<DisplayTask>()
    expect(task.state.tables).toEqual([])
    expect(task.state.detection?.method).toBe('manual')

    // The user places three portrait tables and one side table, and labels them on the render.
    const table = (id: string, x: number, y: number, kind: 'island' | 'side' = 'island') => ({
      id,
      kind,
      x,
      y,
      w: 0.05,
      h: 0.12,
      render: { x: x * 0.8, y: 0.6 },
      label: null,
    })
    response = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/display-tasks/${task.id}`,
      headers: ifMatch(task.revision),
      payload: {
        state: {
          ...task.state,
          entrance: 'bottom',
          tables: [
            table('c', 0.5, 0.3),
            table('a', 0.4, 0.6),
            table('b', 0.6, 0.6),
            table('s', 0.1, 0.5, 'side'),
          ],
          edits: {
            orientation: null,
            landscapeEnd: 'left',
            slots: { a: { L1: 'X6' } },
            modules: {},
          },
        },
      },
    })
    expect(response.statusCode).toBe(200)
    task = response.json<DisplayTask>()

    const exported = await inject('POST', `/display-tasks/${task.id}/export`)
    expect(exported.statusCode).toBe(201)
    const files = exported.json<DisplayExport>()
    expect(files.pptx.name).toBe('影石武汉荟聚边厅专卖店展陈方案.pptx')
    expect(files.xlsx.name).toBe('影石武汉荟聚边厅专卖店展陈清单.xlsx')
    const pptx = await download(files.pptx)
    expect(pptx.headers['content-type']).toContain('presentationml')
    const slides = Object.keys(unzipSync(new Uint8Array(pptx.rawPayload))).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(n),
    )
    // Cover, overview, three islands, one side table, counts.
    expect(slides).toHaveLength(7)
    await download(files.xlsx)

    const again = (await inject('GET', `/display-tasks/${task.id}`)).json<DisplayTask>()
    expect(again.exports).toHaveLength(1)
    const list = (await inject('GET', '/display-tasks')).json<DisplayTaskList>()
    expect(list.find((l) => l.id === task.id)).toMatchObject({ tables: 4, exported: true })

    expect((await inject('DELETE', `/display-tasks/${task.id}`)).statusCode).toBe(204)
    expect((await inject('GET', `/display-tasks/${task.id}`)).statusCode).toBe(404)
  })
})

describe('display of a render node', () => {
  /** A render node whose views all have a material image. */
  async function renderedNode(name: string) {
    const chain = await renderChain(t, { projectName: name })
    for (const [i, camera] of chain.cameras.entries()) {
      const response = await t.app.inject({
        method: 'PUT',
        url: `/api/v1/nodes/${chain.render.id}/renders/${camera.id}/material`,
        headers: { 'content-type': 'image/png' },
        payload: png(150, 100, 40 + i * 20),
      })
      expect(response.statusCode).toBe(201)
    }
    return chain
  }
  const exportBody = {
    planPng: png(400, 300, 250).toString('base64'),
    planViewBox: [-1, -1, 10, 8],
  }

  it('numbers the tables from the layout, finds them on the views and keeps the edits', async () => {
    const { render } = await renderedNode('展陈节点店')
    let display = (await inject('GET', `/nodes/${render.id}/display`)).json<NodeDisplay>()
    expect(display.revision).toBe(0)
    expect(display.tables).toHaveLength(1)
    const [table] = display.tables
    // One island table is not a standard count: laid out as 2-1 and marked 单店单议.
    expect(table).toMatchObject({ label: 'A', kind: 'island', seat: '2-1', custom: true })
    // The 1.8 m side runs along the entrance edge (z = 6): landscape.
    expect(table?.orientation).toBe('landscape')
    const seen = display.views.filter((v) => v.marks.A)
    expect(seen.length).toBeGreaterThan(0)
    expect(display.views.every((v) => v.imageUrl)).toBe(true)
    expect(display.tableViews.A).toBeTruthy()
    expect(display.overviewCameraId).toBeTruthy()

    const saved = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${render.id}/display`,
      payload: {
        edits: { orientation: 'portrait', landscapeEnd: 'right', slots: {}, modules: {} },
      },
    })
    expect(saved.statusCode).toBe(200)
    display = saved.json<NodeDisplay>()
    expect(display.revision).toBe(1)
    expect(display.tables[0]?.orientation).toBe('portrait')
    // A second save must name the revision.
    const stale = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${render.id}/display`,
      headers: ifMatch(5),
      payload: { edits: display.edits },
    })
    expect(stale.statusCode).toBe(409)

    const exported = await inject('POST', `/nodes/${render.id}/display/export`, exportBody)
    expect(exported.statusCode).toBe(201)
    await download(exported.json<DisplayExport>().pptx)
    display = (await inject('GET', `/nodes/${render.id}/display`)).json<NodeDisplay>()
    expect(display.exports).toHaveLength(1)
  })

  it('adds the PPT and the checklist to a delivery when asked', async () => {
    const { render } = await renderedNode('展陈交付店')
    const plain = (
      await inject('POST', `/nodes/${render.id}/deliveries`, { planPng: exportBody.planPng })
    ).json<Delivery>()
    expect(plain.displayPpt).toBeNull()
    const response = await inject('POST', `/nodes/${render.id}/deliveries`, {
      planPng: exportBody.planPng,
      display: exportBody,
    })
    expect(response.statusCode).toBe(201)
    const delivery = response.json<Delivery>()
    expect(delivery.displayPpt?.name).toBe('影石展陈交付店展陈方案.pptx')
    const zip = await download(delivery.zip)
    const entries = Object.keys(unzipSync(new Uint8Array(zip.rawPayload)))
    const root = `${delivery.folderName}/`
    expect(entries).toContain(`${root}影石展陈交付店展陈方案.pptx`)
    expect(entries).toContain(`${root}04_展陈方案/影石展陈交付店展陈清单.xlsx`)
    expect(entries).toContain(`${root}04_展陈方案/展陈平面.png`)
  })
})
