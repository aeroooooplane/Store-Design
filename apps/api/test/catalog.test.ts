import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Asset } from '@store/shared'
import { storageRoots } from '../src/app.ts'
import { loadConfig } from '../src/config/env.ts'
import {
  LIBRARY_DIR,
  WEB_MODEL_DIR,
  functionFor,
  importCatalog,
} from '../src/modules/assets/importer.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

let resource: string
let t: TestApp
const glb = Buffer.from('glTF-fake-binary-for-tests')
const preview = Buffer.from('jpeg-bytes')
const white = Buffer.from('glTF-light-white-model')

function whiteRecord(sourceSha256: string) {
  return {
    tool: 'test',
    sourceSha256,
    sha256: sha(white),
    bytes: white.length,
    sourceBytes: glb.length,
    trianglesBefore: 100,
    trianglesAfter: 10,
    driftM: 0,
  }
}

async function put(relative: string, content: Buffer | string) {
  const file = path.join(resource, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

function entry(id: string, standardName: string, category: string, previewName?: string) {
  return {
    asset_id: id,
    standard_name: standardName,
    variant: '测试变体',
    material_category: category,
    si_family: 'SI1.0',
    judgment: '测试',
    preview: previewName,
    named_sha256: 'a'.repeat(64),
    tight_face_bounds_xyz_mm: [1000, 1800, 1327],
  }
}

function conversion(id: string, bytes: Buffer) {
  return { id, bytes: bytes.length, glbSha256: sha(bytes), dimensions: { w: 1, h: 1.327, d: 1.8 } }
}

beforeAll(async () => {
  resource = await mkdtemp(path.join(tmpdir(), 'catalog-'))
  await put(
    `${LIBRARY_DIR}/manifest.json`,
    // A byte order mark must not break parsing.
    '﻿' +
      JSON.stringify({
        assets: [
          entry('asset-1', '1800mm普通中岛桌', '软装物料', '预览/asset-1.jpg'),
          entry('asset-2', '徕卡墙画面与标识组合', '软装物料'),
          entry('asset-3', '广告机', '信息化物料', '预览/missing.jpg'),
          entry('asset-4', '1.8米收银边柜', '软装物料'),
        ],
      }),
  )
  await put(`${LIBRARY_DIR}/预览/asset-1.jpg`, preview)
  for (const id of ['asset-1', 'asset-2']) {
    await put(`${WEB_MODEL_DIR}/${id}/model.glb`, glb)
    await put(`${WEB_MODEL_DIR}/${id}/conversion.json`, JSON.stringify(conversion(id, glb)))
  }
  // asset-1 has a current light white model; asset-2's was built from an older model.glb.
  await put(`${WEB_MODEL_DIR}/asset-1/white.glb`, white)
  await put(`${WEB_MODEL_DIR}/asset-1/white.json`, JSON.stringify(whiteRecord(sha(glb))))
  await put(`${WEB_MODEL_DIR}/asset-2/white.glb`, white)
  await put(`${WEB_MODEL_DIR}/asset-2/white.json`, JSON.stringify(whiteRecord('b'.repeat(64))))
  // asset-4 has a conversion record but only an un-pulled LFS pointer.
  await put(
    `${WEB_MODEL_DIR}/asset-4/model.glb`,
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 9\n',
  )
  await put(`${WEB_MODEL_DIR}/asset-4/conversion.json`, JSON.stringify(conversion('asset-4', glb)))
  await put(
    `${WEB_MODEL_DIR}/facing.json`,
    JSON.stringify({
      assets: {
        'asset-1': { front: 'any', confidence: 'high' },
        'asset-2': { front: '+Z', confidence: 'high', installation: 'wall' },
      },
    }),
  )
  t = await createTestApp({ RESOURCE_ROOT: resource, STORAGE_ROOT: path.join(resource, 'storage') })
})

afterAll(async () => {
  await t.close()
  await rm(resource, { recursive: true, force: true })
})

const roots = () =>
  storageRoots(
    loadConfig({ RESOURCE_ROOT: resource, STORAGE_ROOT: path.join(resource, 'storage') }),
  )

describe('functionFor', () => {
  it.each([
    ['1800mm边桌收银柜', 'cashier'],
    ['1800mm开箱储物柜', 'unboxing_table'],
    ['1.8米亮脚中岛桌', 'island_table'],
    ['1.8米配件边柜(带托盘)', 'side_cabinet'],
    ['1800mm边桌配件柜', 'side_cabinet'],
    ['3.6米配件柜', 'accessory_cabinet'],
    ['1800mm边桌储物柜', 'storage'],
    ['产品展示台', 'display_stand'],
    ['字母凳', 'seating'],
    ['曲面LED屏', 'screen'],
    ['吊挂LOGO', 'signage'],
    ['消防栓箱', 'other'],
  ])('%s → %s', (name, expected) => {
    expect(functionFor(name)).toBe(expected)
  })
})

describe('importCatalog', () => {
  it('attaches verified models, honours facing and reports missing files', async () => {
    const report = await importCatalog(t.database.db, roots())
    expect(report).toMatchObject({
      assets: 4,
      withGlb: 2,
      withWhite: 1,
      placeable: 1,
      withPreview: 1,
    })
    expect(report.problems).toEqual([
      expect.stringContaining('asset-2: 白模轻量版已过期'),
      expect.stringContaining('asset-3: 缺少文件'),
      expect.stringContaining('asset-4: 未下载的 LFS 指针'),
    ])
  })

  it('is idempotent and refreshes rows in place', async () => {
    await importCatalog(t.database.db, roots())
    expect(await t.database.db.select().from(schema.assets)).toHaveLength(4)
    expect(await t.database.db.select().from(schema.storedFiles)).toHaveLength(4)
  })

  it('refuses a model whose bytes differ from its conversion record', async () => {
    await put(`${WEB_MODEL_DIR}/asset-1/model.glb`, Buffer.from('tampered'))
    const report = await importCatalog(t.database.db, roots())
    expect(report.problems).toContainEqual(
      expect.stringContaining('asset-1: model.glb 与 conversion.json'),
    )
    const [row] = await t.database.db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, 'asset-1'))
    expect(row).toMatchObject({ placeable: false, glbFileId: null })
    await put(`${WEB_MODEL_DIR}/asset-1/model.glb`, glb)
    await importCatalog(t.database.db, roots())
  })
})

describe('GET /assets', () => {
  it('lists the catalogue with footprint, facing and file links', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/assets' })
    expect(response.statusCode).toBe(200)
    const { items, total } = response.json<{ items: Asset[]; total: number }>()
    expect(total).toBe(4)
    const island = items.find((a) => a.id === 'asset-1')
    expect(island).toMatchObject({
      function: 'island_table',
      installation: 'floor',
      placeable: true,
      front: 'any',
      footprint: { w: 1, d: 1.8, h: 1.327 },
      footprintSource: 'glb',
    })
    expect(island?.glb?.url).toMatch(/^\/api\/v1\/files\/[0-9a-f-]{36}$/)
    expect(island?.whiteGlb).toMatchObject({ bytes: white.length, sha256: sha(white) })
    expect(items.find((a) => a.id === 'asset-2')).toMatchObject({
      installation: 'wall',
      placeable: false,
      whiteGlb: null,
    })
    // Without a web model the SketchUp bounds (X, Y, Z-up in mm) give the footprint.
    expect(items.find((a) => a.id === 'asset-3')).toMatchObject({
      installation: null,
      footprintSource: 'source',
      footprint: { w: 1, d: 1.8, h: 1.327 },
      glb: null,
    })
  })

  it('filters by placeability and searches names literally', async () => {
    const placeable = await t.app.inject({ method: 'GET', url: '/api/v1/assets?placeable=true' })
    expect(placeable.json<{ items: Asset[] }>().items.map((a) => a.id)).toEqual(['asset-1'])
    const search = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assets?q=${encodeURIComponent('收银')}`,
    })
    expect(search.json<{ items: Asset[] }>().items.map((a) => a.id)).toEqual(['asset-4'])
    const missing = await t.app.inject({ method: 'GET', url: '/api/v1/assets/asset-999' })
    expect(missing.statusCode).toBe(404)
  })
})

describe('GET /files/:id', () => {
  async function glbUrl() {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/assets/asset-1' })
    return response.json<Asset>().glb?.url ?? ''
  }

  it('streams the file with its content type and supports conditional requests', async () => {
    const url = await glbUrl()
    const response = await t.app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('model/gltf-binary')
    expect(response.rawPayload.equals(glb)).toBe(true)
    const cached = await t.app.inject({
      method: 'GET',
      url,
      headers: { 'if-none-match': `"${sha(glb)}"` },
    })
    expect(cached.statusCode).toBe(304)
  })

  it('reports un-pulled LFS pointers and keeps tampered keys inside the root', async () => {
    const [pointer] = await t.database.db
      .insert(schema.storedFiles)
      .values({
        root: 'resource',
        storageKey: `${WEB_MODEL_DIR}/asset-4/model.glb`,
        kind: 'glb',
        contentType: 'model/gltf-binary',
        bytes: 1,
        sha256: 'b'.repeat(64),
      })
      .returning()
    const lfs = await t.app.inject({ method: 'GET', url: `/api/v1/files/${pointer?.id}` })
    expect(lfs.statusCode).toBe(404)
    expect(lfs.json().error.details).toEqual({ reason: 'lfs_pointer' })

    const outside = path.join(path.dirname(resource), `outside-${path.basename(resource)}.txt`)
    await writeFile(outside, 'secret')
    try {
      const [escape] = await t.database.db
        .insert(schema.storedFiles)
        .values({
          root: 'resource',
          storageKey: `../${path.basename(outside)}`,
          kind: 'other',
          contentType: 'text/plain',
          bytes: 6,
          sha256: 'c'.repeat(64),
        })
        .returning()
      const blocked = await t.app.inject({ method: 'GET', url: `/api/v1/files/${escape?.id}` })
      expect(blocked.statusCode).toBe(403)
    } finally {
      await rm(outside, { force: true })
    }
  })

  it('returns 404 for unknown ids', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/api/v1/files/00000000-0000-4000-8000-000000000000',
    })
    expect(response.statusCode).toBe(404)
  })
})
