import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Asset } from '@store/shared'
import { storageRoots } from '../src/app.ts'
import { loadConfig } from '../src/config/env.ts'
import { LIBRARY_DIR, importCatalog } from '../src/modules/assets/importer.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

let resource: string
let t: TestApp
const domestic = Buffer.from('glTF-影石Insta360')
const overseas = Buffer.from('glTF-Insta360')

async function put(relative: string, content: Buffer | string) {
  const file = path.join(resource, LIBRARY_DIR, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

const logo = (id: string) => ({
  asset_id: id,
  standard_name: '墙面LOGO',
  variant: `影石Insta360_${id}`,
  material_category: '展陈物料',
  category: '品牌标识',
  web_model: `品牌标识/${id}/网页模型`,
  si_family: '通用',
  tight_face_bounds_xyz_mm: [2930, 50, 400],
})

/** A self-built LOGO: model.glb is the domestic version, overseas.glb the other one. */
function conversion(id: string, variant: Buffer) {
  return {
    id,
    bytes: domestic.length,
    glbSha256: sha(domestic),
    dimensions: { w: 2.93, h: 0.4, d: 0.05 },
    market: 'domestic',
    variants: {
      overseas: { file: 'overseas.glb', bytes: variant.length, glbSha256: sha(variant) },
    },
  }
}

const roots = () =>
  storageRoots(
    loadConfig({ RESOURCE_ROOT: resource, STORAGE_ROOT: path.join(resource, 'storage') }),
  )

async function writeManifest(ids: string[]) {
  await put('manifest.json', JSON.stringify({ assets: ids.map(logo) }))
}

beforeAll(async () => {
  resource = await mkdtemp(path.join(tmpdir(), 'catalog-markets-'))
  for (const id of ['asset-10', 'asset-11']) {
    await put(`品牌标识/${id}/网页模型/model.glb`, domestic)
    await put(`品牌标识/${id}/网页模型/overseas.glb`, overseas)
  }
  await put(
    '品牌标识/asset-10/网页模型/conversion.json',
    JSON.stringify(conversion('asset-10', overseas)),
  )
  // asset-11's record does not match its overseas.glb: the variant is left out.
  await put(
    '品牌标识/asset-11/网页模型/conversion.json',
    JSON.stringify(conversion('asset-11', Buffer.from('something else'))),
  )
  await put(
    'facing.json',
    JSON.stringify({
      assets: {
        'asset-10': { front: '+Z', confidence: 'high', installation: 'wall' },
        'asset-11': { front: '+Z', confidence: 'high', installation: 'wall' },
      },
    }),
  )
  await writeManifest(['asset-10', 'asset-11'])
  t = await createTestApp({ RESOURCE_ROOT: resource, STORAGE_ROOT: path.join(resource, 'storage') })
})

afterAll(async () => {
  await t.close()
  await rm(resource, { recursive: true, force: true })
})

const list = async () =>
  (await t.app.inject({ method: 'GET', url: '/api/v1/assets' })).json<{ items: Asset[] }>().items

describe('LOGO versions per market', () => {
  it('attaches the other market version when its bytes match the record', async () => {
    const report = await importCatalog(t.database.db, roots())
    expect(report.problems).toEqual([
      'asset-11: overseas.glb 与 conversion.json 的哈希或字节数不一致，未挂接',
    ])
    const items = await list()
    const good = items.find((a) => a.id === 'asset-10')
    expect(good).toMatchObject({ market: 'domestic', placeable: true })
    expect(good?.otherMarketGlb?.sha256).toBe(sha(overseas))
    const file = await t.app.inject({ method: 'GET', url: good?.otherMarketGlb?.url ?? '' })
    expect(file.rawPayload.equals(overseas)).toBe(true)
    expect(items.find((a) => a.id === 'asset-11')).toMatchObject({
      market: null,
      otherMarketGlb: null,
    })
  })

  it('retires a model taken out of the manifest on the next import', async () => {
    await writeManifest(['asset-10'])
    const report = await importCatalog(t.database.db, roots())
    expect(report.retiredMissing).toBe(1)
    const items = await list()
    expect(items.find((a) => a.id === 'asset-11')?.retired).toBe(true)
    expect(items.find((a) => a.id === 'asset-10')?.retired).toBe(false)
    expect((await importCatalog(t.database.db, roots())).retiredMissing).toBe(0)
  })
})
