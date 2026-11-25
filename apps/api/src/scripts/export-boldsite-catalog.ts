import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { createDatabase, schema } from '@store/database'
import { AssetListSchema } from '@store/shared'
import type { Asset, FileRef } from '@store/shared'
import { systemContext } from '../context/actor.ts'
import { resolveStoredFile, sha256File } from '../lib/storage.ts'
import { importCatalog, LIBRARY_DIR } from '../modules/assets/importer.ts'
import { listAssets } from '../modules/assets/service.ts'

const [resourceArg, outputArg] = process.argv.slice(2)
if (!resourceArg || !outputArg) {
  throw new Error(
    '用法：node apps/api/src/scripts/export-boldsite-catalog.ts <资源库目录> <新建发布目录>',
  )
}

const repo = new URL('../../../../', import.meta.url)
const lock = JSON.parse(await readFile(new URL('resources.lock.json', repo), 'utf8')) as {
  requiredFiles: Record<string, string>
}
const resource = path.resolve(resourceArg)
const manifestKey = LIBRARY_DIR + '/manifest.json'
const manifest = await sha256File(path.join(resource, manifestKey))
if (lock.requiredFiles[manifestKey]?.toLowerCase() !== manifest) {
  throw new Error('模型清单与当前发布的版本锁不一致')
}

const output = path.resolve(outputArg)
const storage = await mkdtemp(path.join(tmpdir(), 'store-catalog-'))
const roots = { resource, storage }
const database = createDatabase('pglite://memory')
const keys = [
  'glb',
  'whiteGlb',
  'finishGlb',
  'otherMarketGlb',
  'preview',
  'planSymbol',
  'productImage',
] as const
const mime = new Map([
  ['.glb', 'model/gltf-binary'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

function webAsset(asset: Asset): Asset {
  // Release the official lightweight web variant as the default when both markets use it.
  // Models with market-specific artwork keep their original market variants.
  return {
    ...asset,
    glb: asset.otherMarketGlb ? asset.glb : (asset.finishGlb ?? asset.glb),
  }
}

try {
  await database.migrate()
  const report = await importCatalog(database.db, roots)
  if (!report.assets || !report.withGlb) throw new Error('正式目录没有可发布的网页模型')
  const catalog = await listAssets(database.db, systemContext(), {})
  const items = catalog.items.map(webAsset)
  const refs = new Map<string, FileRef>()
  for (const asset of items) {
    for (const key of keys) {
      const ref = asset[key]
      if (ref) refs.set(ref.fileId, ref)
    }
  }

  const storedFiles = schema.storedFiles
  const records = await database.db
    .select()
    .from(storedFiles)
    .where(inArray(storedFiles.id, [...refs.keys()]))
  if (records.length !== refs.size) throw new Error('目录引用了未登记的文件')
  const files: Record<string, { name: string; contentType: string; sha256: string }> = {}
  const replacements = new Map<string, FileRef>()
  let bytes = 0
  await mkdir(output)
  await mkdir(path.join(output, 'files'))
  for (const record of records) {
    if (record.root !== 'resource' && record.root !== 'storage') throw new Error('无效模型文件来源')
    if (record.root === 'resource' && !record.storageKey.startsWith(LIBRARY_DIR + '/')) {
      throw new Error('模型发布只允许模型库中的已登记文件')
    }
    const { file, bytes: length } = await resolveStoredFile(roots, record.root, record.storageKey)
    if (length !== record.bytes || (await sha256File(file)) !== record.sha256) {
      throw new Error('模型发布文件与入库时的字节不一致：' + record.id)
    }
    const resize = record.kind === 'preview' || record.kind === 'product_image'
    const ext = resize ? '.webp' : path.extname(file).toLowerCase()
    const contentType = mime.get(ext)
    if (!contentType) throw new Error('模型发布含不支持的文件格式：' + ext)
    const name = record.id + ext
    const destination = path.join(output, 'files', name)
    if (resize) {
      await sharp(file)
        .rotate()
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(destination)
      const fileBytes = (await stat(destination)).size
      const digest = await sha256File(destination)
      files[record.id] = { name, contentType, sha256: digest }
      replacements.set(record.id, {
        fileId: record.id,
        url: '/api/v1/files/' + record.id + '?v=' + digest.slice(0, 16),
        bytes: fileBytes,
        sha256: digest,
      })
      bytes += fileBytes
    } else {
      await copyFile(file, destination)
      if ((await sha256File(destination)) !== record.sha256) {
        throw new Error('模型复制期间发生变化：' + name)
      }
      files[record.id] = { name, contentType, sha256: record.sha256 }
      bytes += length
    }
  }
  if ((await sha256File(path.join(resource, manifestKey))) !== manifest)
    throw new Error('导出期间模型清单发生变化')
  for (const item of items) {
    for (const key of keys) {
      const ref = item[key]
      if (ref) item[key] = replacements.get(ref.fileId) ?? ref
    }
  }
  const published = AssetListSchema.parse({ items, total: items.length }).items
  await writeFile(
    path.join(output, 'index.json'),
    JSON.stringify({ manifest, items: published, files }, null, 2) + '\n',
    { flag: 'wx' },
  )
  console.log(
    JSON.stringify(
      {
        assets: items.length,
        webModels: items.filter((a) => a.glb).length,
        placeable: items.filter((a) => a.placeable && !a.retired).length,
        files: refs.size,
        bytes,
        problems: report.problems,
      },
      null,
      2,
    ),
  )
} finally {
  await database.close()
  // The temporary directory is allocated for this import and contains generated files only.
  await rm(storage, { recursive: true, force: true })
}
