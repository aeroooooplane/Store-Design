import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadReview } from './check-review-template.mjs'
import {
  initialEntry,
  entryErrors,
  exportWholePack,
  evaluationPack,
  objectInventory,
  categories,
} from './whole-store-core.mjs'
const arg = (k) => process.argv[process.argv.indexOf('--' + k) + 1],
  json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex')
for (const k of ['dataset', 'reviewed', 'reference', 'inventory', 'manual-dir', 'out'])
  if (!process.argv.includes('--' + k)) throw Error('缺少 --' + k)
const dataset = await json(arg('dataset')),
  raw = await readFile(arg('reviewed')),
  original = JSON.parse(raw),
  reference = await json(arg('reference')),
  inventory = await json(arg('inventory')),
  root = path.dirname(path.resolve(arg('dataset'))),
  out = path.resolve(arg('out'))
for (const k of ['dataset', 'reviewed', 'reference', 'inventory', 'manual-dir']) {
  const dir = k === 'manual-dir' ? path.resolve(arg(k)) : path.dirname(path.resolve(arg(k)))
  if (out === dir || (k !== 'manual-dir' && out.startsWith(dir + path.sep)))
    throw Error('不能覆盖输入目录或在原资料内写输出')
}
const migrated = await loadReview({ ...dataset, reviewedPack: original }),
  approved = migrated.api.exportPack()
if (JSON.stringify(approved.annotations) !== JSON.stringify(reference.annotations))
  throw Error('迁移参照与原用户包不一致')
if (
  reference.annotations.length !== dataset.samples.length ||
  inventory.length !== dataset.samples.length
)
  throw Error('固定样本全集不符')
const manual = {},
  manualHashes = []
for (const f of (await readdir(arg('manual-dir')))
  .filter((f) => /^whole-store-manual-20261104(?:-batch\d+)?\.json$/.test(f))
  .sort()) {
  const b = await readFile(path.join(arg('manual-dir'), f))
  manualHashes.push({ file: f, sha256: hash(b) })
  for (const [id, m] of Object.entries(JSON.parse(b).stores)) {
    if (manual[id]) throw Error('人工批次重复门店 ' + id)
    manual[id] = m
  }
}
if (Object.keys(manual).length !== dataset.samples.length) throw Error('人工记录未覆盖固定全集')
const data = {
    schemaVersion: 1,
    datasetId: dataset.datasetId || reference.datasetId,
    fingerprint: dataset.fingerprint,
    originalReviewSha256: hash(raw),
    originalReviewPack: original,
    referencePack: reference,
    annotationBatch: hash(
      JSON.stringify(manualHashes) + (await readFile(arg('inventory'), 'utf8')),
    ),
    stores: [],
  },
  records = {}
const report = {
  stores: 0,
  objects: 0,
  columns: 0,
  questions: 0,
  questionStores: 0,
  oldUserReviewed: 0,
  newUserReviewed: 0,
  completeEntranceReferences: 0,
  geometryApproximation: '代理描点约±6原图像素；曲线可能为折线近似，非竣工测绘',
  categories: {},
  manualHashes,
  sourceHashes: [],
  limitations: [
    '未绑定资产、未核准全部安装高度；不自动摆放道具',
    '组合桌附属座位数量单列，物体总数不等于家具BOM件数',
    '原图用途与尺寸冲突保留，未决问题集中审核',
    '家具未获用户签核；完整入口未获用户确认，完整评分暂不可用',
  ],
}
for (const s of dataset.samples) {
  const ref = reference.annotations.find((r) => r.store_id === s.id),
    inv = inventory.find((r) => r.id === s.id),
    m = manual[s.id]
  if (
    !ref ||
    !inv ||
    !m?.sourceReviewed ||
    ref.status !== 'reviewed' ||
    m.viewSize.some((x) => !Number.isFinite(x) || x <= 0)
  )
    throw Error(s.id + ' 输入或原审核缺失')
  const ip = path.resolve(root, s.image.path)
  if (!ip.startsWith(root + path.sep) || hash(await readFile(ip)) !== s.image.sha256)
    throw Error(s.id + ' 原图哈希不符')
  const point = ([x, y]) => [
    +(inv.crop.left + (x / m.viewSize[0]) * inv.crop.width).toFixed(3),
    +(inv.crop.top + (y / m.viewSize[1]) * inv.crop.height).toFixed(3),
  ]
  const objects = m.objects.map(([label, category, box, dim = {}], i) => {
    let p = m.polygons?.[label] || [
      [box[0], box[1]],
      [box[2], box[1]],
      [box[2], box[3]],
      [box[0], box[3]],
    ]
    if (dim.shape === 'ellipse')
      p = Array.from({ length: 32 }, (_, j) => [
        (box[0] + box[2]) / 2 + ((box[2] - box[0]) / 2) * Math.cos((j * 2 * Math.PI) / 32),
        (box[1] + box[3]) / 2 + ((box[3] - box[1]) / 2) * Math.sin((j * 2 * Math.PI) / 32),
      ])
    return {
      id: s.id + '-O' + String(i + 1).padStart(3, '0'),
      label,
      category,
      polygon: p.map(point),
      sourceDimensions: dim,
      assetId: null,
      geometryStatus: 'agent_traced',
      source: {
        page: s.page,
        imageSha256: s.image.sha256,
        sourceSha256: s.sourceSha256,
        preview: 'previews/' + s.id + '.jpg',
      },
      note: '',
    }
  })
  const store = {
    id: s.id,
    name: s.name,
    page: s.page,
    shopType: s.shopType,
    si: s.si,
    image: { ...s.image, path: 'images/' + s.id + '.png' },
    crop: inv.crop,
    objects,
    questions: m.questions || [],
    notes: m.notes || [],
    proposedEntrances: (m.entrancePaths || []).map((p) => ({
      kind: 'polyline',
      points: p.map(point),
    })),
    mmPerPixel: ref.mmPerPixel,
    boundary: ref.boundary,
    previousReviewedAt: ref.reviewedAt,
    previousReviewer: ref.reviewer,
  }
  records[s.id] = initialEntry(store, ref)
  const errors = entryErrors(records[s.id], store)
  if (errors.length) throw Error(s.id + ' ' + errors.join('；'))
  data.stores.push(store)
  report.stores++
  report.oldUserReviewed++
  report.objects += objects.length
  report.questions += store.questions.length
  report.questionStores += Number(store.questions.length > 0)
  report.columns += objects.filter((o) => o.category === 'column').length
  for (const o of objects) {
    if (!categories[o.category]) throw Error('未知分类 ' + o.category)
    report.categories[o.category] = (report.categories[o.category] || 0) + 1
  }
  report.sourceHashes.push({ id: s.id, image: s.image.sha256, source: s.sourceSha256 })
}
data.initialRecords = records
await mkdir(out)
for (const dir of ['images', 'previews', 'annotations', 'evidence', 'inputs'])
  await mkdir(path.join(out, dir))
for (const h of manualHashes)
  await copyFile(path.join(arg('manual-dir'), h.file), path.join(out, 'inputs', h.file))
await copyFile(arg('inventory'), path.join(out, 'inputs', 'inventory.json'))
await copyFile(arg('reference'), path.join(out, 'inputs', '原审核迁移参照.json'))
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
for (const s of data.stores) {
  const orig = dataset.samples.find((x) => x.id === s.id)
  await copyFile(path.resolve(root, orig.image.path), path.join(out, s.image.path))
  await copyFile(
    path.join(path.dirname(arg('inventory')), s.id + '.jpg'),
    path.join(out, 'previews', s.id + '.jpg'),
  )
  const origin = [
      Math.min(...s.boundary.map((p) => p[0])),
      Math.min(...s.boundary.map((p) => p[1])),
    ],
    record = records[s.id]
  await writeFile(
    path.join(out, 'annotations', s.id + '.json'),
    JSON.stringify(
      {
        coordinateSystem: '原页像素，左上原点',
        originPx: origin,
        mmPerPixel: s.mmPerPixel,
        originalApprovedReference: reference.annotations.find((r) => r.store_id === s.id),
        ...record,
        metricObjects: record.objects.map((o) => ({
          ...o,
          polygon: o.polygon.map((p) => p.map((v, j) => ((v - origin[j]) * s.mmPerPixel) / 1000)),
        })),
        inventory: objectInventory(record),
        fullStoreQualificationAvailable: false,
      },
      null,
      2,
    ),
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.crop.left} ${s.crop.top} ${s.crop.width} ${s.crop.height}"><image href="../${s.image.path}" x="0" y="0" width="${s.image.width}" height="${s.image.height}"/>${s.objects.map((o, i) => `<polygon points="${o.polygon.map((p) => p.join(',')).join(' ')}" fill="${o.category === 'column' ? '#ef7e20' : '#187aaf'}" fill-opacity=".13" stroke="${o.category === 'column' ? '#d55b00' : '#0875a8'}" stroke-width="1.5"><title>${i + 1} ${escape(o.label)}</title></polygon>`).join('')}</svg>`
  await writeFile(path.join(out, 'evidence', s.id + '.svg'), svg)
}
const core = (await readFile(new URL('./whole-store-core.mjs', import.meta.url), 'utf8')).replace(
    /^export /gm,
    '',
  ),
  template = await readFile(new URL('./whole-store-template.html', import.meta.url), 'utf8')
await writeFile(
  path.join(out, '整店审核.html'),
  template
    .replace('/*CORE*/', () => core)
    .replace(/\/\*DATA\*\/\s*null/, () => JSON.stringify(data).replaceAll('<', '\\u003c')),
)
await writeFile(
  path.join(out, '整店标注草稿.json'),
  JSON.stringify(exportWholePack(data, records), null, 2),
)
await writeFile(
  path.join(out, '入口复评参照.json'),
  JSON.stringify(evaluationPack(data, records), null, 2),
)
await writeFile(path.join(out, '构建数据.json'), JSON.stringify(data))
await copyFile(arg('reviewed'), path.join(out, '原始用户审核包.json'))
await writeFile(path.join(out, '核验报告.json'), JSON.stringify(report, null, 2))
const manifest = []
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else
      manifest.push({
        path: path.relative(out, p).replaceAll('\\', '/'),
        sha256: hash(await readFile(p)),
      })
  }
}
await walk(out)
await writeFile(path.join(out, '文件指纹.json'), JSON.stringify(manifest, null, 2))
console.log(
  JSON.stringify({
    ...report,
    manualHashes: manualHashes.length,
    sourceHashes: report.sourceHashes.length,
  }),
)
