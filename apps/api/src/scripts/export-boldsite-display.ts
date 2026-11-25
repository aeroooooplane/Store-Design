import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { createDatabase, schema } from '@store/database'
import { DisplayRulesViewSchema } from '@store/shared'
import { resolveStoredFile, sha256File } from '../lib/storage.ts'
import { rulesView } from '../modules/displays/common.ts'
import { importDisplayRules } from '../modules/displays/importer.ts'
import { DISPLAY_RESOURCE_DIR, DISPLAY_WORKBOOK } from '../modules/displays/workbook.ts'

const [resourceArg, catalogArg] = process.argv.slice(2)
if (!resourceArg || !catalogArg) {
  throw new Error(
    '用法：node apps/api/src/scripts/export-boldsite-display.ts <资源库目录> <新建目录快照>',
  )
}
const resource = path.resolve(resourceArg)
const catalog = path.resolve(catalogArg)
const lock = JSON.parse(
  await readFile(new URL('../../../../resources.lock.json', import.meta.url), 'utf8'),
) as {
  requiredFiles: Record<string, string>
}
const workbook = path.join(resource, DISPLAY_WORKBOOK)
const version = await sha256File(workbook)
if (version !== lock.requiredFiles[DISPLAY_WORKBOOK]?.toLowerCase()) {
  throw new Error('展陈规则工作簿与当前发布的版本锁不一致')
}
const indexFile = path.join(catalog, 'index.json')
const index = JSON.parse(await readFile(indexFile, 'utf8')) as {
  manifest: string
  items: unknown[]
  files: Record<string, { name: string; contentType: string; sha256: string }>
}
if (!index.manifest || !Array.isArray(index.items) || !index.files)
  throw new Error('请使用新建的模型目录快照')

const db = createDatabase('pglite://memory')
try {
  await db.migrate()
  const roots = { resource, storage: catalog }
  const report = await importDisplayRules(db.db, roots)
  if (report.status !== 'imported' || report.photos === 0 || report.missingPhotos.length > 0) {
    throw new Error('正式展陈规则或照片不完整：' + JSON.stringify(report))
  }
  const view = DisplayRulesViewSchema.parse(await rulesView(db.db))
  const table = schema.storedFiles
  const ids = view.rules.photos.flatMap((photo) => (photo.fileId ? [photo.fileId] : []))
  const files = await db.db.select().from(table).where(inArray(table.id, ids))
  for (const f of files) {
    if (f.root !== 'resource' || !f.storageKey.startsWith(DISPLAY_RESOURCE_DIR + '/')) {
      throw new Error('图像不在正式展陈目录')
    }
    const { file } = await resolveStoredFile(roots, 'resource', f.storageKey)
    if ((await sha256File(file)) !== f.sha256) throw new Error('展陈图像与入库字节不一致')
    const name = f.id + '.webp'
    const output = path.join(catalog, 'files', name)
    if (index.files[f.id]) throw new Error('模型目录中已经存在此展陈图像')
    await sharp(file)
      .rotate()
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(output)
    index.files[f.id] = { name, contentType: 'image/webp', sha256: await sha256File(output) }
  }
  if ((await sha256File(workbook)) !== version) throw new Error('导出期间展陈规则工作簿发生变化')
  const pending = path.join(catalog, 'display-index.next')
  await writeFile(pending, JSON.stringify(index) + '\n', { flag: 'wx' })
  await rename(pending, indexFile)
  await writeFile(path.join(catalog, 'display.json'), JSON.stringify(view) + '\n', { flag: 'wx' })
  console.log(
    JSON.stringify({ displayVersion: view.version, photos: files.length, source: version }),
  )
} finally {
  await db.close()
}
