// 独立开发集候选：只读来源、档案元数据和原图；不读取 plan.json、旧评分或识别输出。
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const option = (key, fallback) => {
  const at = process.argv.indexOf(`--${key}`)
  return at < 0 ? fallback : process.argv[at + 1]
}
const resourceArg =
  option('resource-root') ??
  (option('source-repo') ? path.join(option('source-repo'), '资源库') : null)
if (!resourceArg)
  throw new Error('必须用 --resource-root 明确指定只读资源库；也可使用 --source-repo <仓库>')
const resources = path.resolve(resourceArg)
const out = option('out')
if (!out) throw new Error('必须指定 --out，输出到独立审核目录')
const outputRelative = path.relative(resources, path.resolve(out))
if (
  !outputRelative.startsWith('..' + path.sep) &&
  outputRelative !== '..' &&
  !path.isAbsolute(outputRelative)
)
  throw new Error('审核输出必须在只读资源库以外')
const seed = option('seed', 'recognition-development-20261029-v1')
const archive = path.join(resources, '09_门店档案')
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const hash = (data) => createHash('sha256').update(data).digest('hex')
const goldBytes = await readFile(path.join(archive, '金标准名单.json'))
const gold = JSON.parse(goldBytes.toString('utf8').replace(/^\uFEFF/, ''))
const goldIds = new Set(gold.map((r) => r.store_id))
const sources = (await json(path.join(archive, '来源清单.json'))).sources
const sourceOf = new Map(sources.map((s) => [s.source_id, s]))
// 对迁址、重复文件等做保守同店隔离；宁可少选候选，不把同店另一份 PDF 放入开发集。
const normalize = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, '')
    .replace(/授权体验店|授权专卖店|直营旗舰店|直营店|专卖店|照材店|中岛店|边厅店|\.pdf$/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
const stores = []
for (const folder of await readdir(archive, { withFileTypes: true })) {
  if (!folder.isDirectory() || !/^(NEW|PDF)-\d+__/.test(folder.name)) continue
  const s = await json(path.join(archive, folder.name, 'store.json'))
  stores.push({ ...s, folder: folder.name })
}
const identities = (s) =>
  [s.name, ...(s.aliases?.filenames ?? []), s.aliases?.feishu_1009, s.aliases?.feishu_0923]
    .filter(Boolean)
    .map(normalize)
    .filter(Boolean)
if (
  [...goldIds].some(
    (id) => !stores.some((s) => s.store_id === id || s.source.source_ids?.includes(id)),
  )
)
  throw new Error('部分验收门店缺少档案元数据，不能完成别名及源文件隔离')
const excludedIds = new Set(goldIds)
const excludedHashes = new Set()
const excludedNames = new Set()
// 传递闭包：别名或哈希相同的记录继续传播隔离，避免绕过规范 ID。
let changed = true
while (changed) {
  changed = false
  for (const s of stores) {
    if (
      !excludedIds.has(s.store_id) &&
      !(s.source.source_ids ?? []).some((id) => excludedIds.has(id)) &&
      !excludedHashes.has(s.source.sha256) &&
      !identities(s).some((name) => excludedNames.has(name))
    )
      continue
    if (!excludedIds.has(s.store_id)) {
      excludedIds.add(s.store_id)
      changed = true
    }
    for (const id of s.source.source_ids ?? [])
      if (!excludedIds.has(id)) {
        excludedIds.add(id)
        changed = true
      }
    if (!excludedHashes.has(s.source.sha256)) {
      excludedHashes.add(s.source.sha256)
      changed = true
    }
    for (const name of identities(s))
      if (!excludedNames.has(name)) {
        excludedNames.add(name)
        changed = true
      }
  }
}
const featureFile = option('features')
if (!featureFile) throw new Error('必须用 --features 指定页面特征.jsonl（不是金标准评分）')
const features = new Map()
const featureBytes = await readFile(featureFile)
for (const line of featureBytes.toString('utf8').trim().split(/\r?\n/)) {
  const row = JSON.parse(line)
  features.set(row.store_id, row.pages)
}
const typeOf = (f) =>
  !f
    ? 'unknown'
    : f.cover >= 0.7
      ? 'raster'
      : (f.text.match(/[一-鿿]/g) ?? []).length >= 30
        ? 'vector-text'
        : 'vector-outline'
const pool = stores
  .filter(
    (s) => !excludedIds.has(s.store_id) && s.pages?.main_plan_page && sourceOf.has(s.store_id),
  )
  .map((s) => {
    const f = features.get(s.store_id)?.find((p) => p.page === s.pages.main_plan_page)
    return {
      id: s.store_id,
      name: s.name,
      page: s.pages.main_plan_page,
      si: s.si?.value ?? '待确认',
      shopType: s.shop_type?.value ?? '待确认',
      region: s.region?.value ?? '待确认',
      sourceSha256: s.source.sha256,
      sourcePath: sourceOf.get(s.store_id).path,
      sourceIds: s.source.source_ids,
      identities: identities(s),
      preliminaryType: typeOf(f),
      geometry: '待人工确认',
      reviewStatus: '待审核',
      rank: hash(`${seed}/${s.store_id}`),
      feature: f ? { chars: f.chars, imageCover: f.cover } : null,
    }
  })
const selected = [],
  chosenHashes = new Set(),
  chosenNames = new Set()
const quotas = { 'vector-text': 32, 'vector-outline': 12, raster: 4 }
for (const [type, count] of Object.entries(quotas)) {
  const buckets = new Map()
  for (const s of pool
    .filter((s) => s.preliminaryType === type)
    .sort((a, b) => a.rank.localeCompare(b.rank))) {
    const key = `${s.si}/${s.shopType}/${s.region}`
    const bucket = buckets.get(key) ?? []
    bucket.push(s)
    buckets.set(key, bucket)
  }
  const groups = [...buckets.entries()].sort(([a], [b]) =>
    hash(`${seed}/${a}`).localeCompare(hash(`${seed}/${b}`)),
  )
  let taken = 0
  while (taken < count) {
    let progress = false
    for (const [, group] of groups) {
      let s
      do {
        s = group.shift()
      } while (
        s &&
        (chosenHashes.has(s.sourceSha256) || s.identities.some((n) => chosenNames.has(n)))
      )
      if (!s) continue
      selected.push(s)
      chosenHashes.add(s.sourceSha256)
      s.identities.forEach((n) => chosenNames.add(n))
      taken++
      progress = true
      if (taken === count) break
    }
    if (!progress) throw new Error(`${type} 仅有 ${taken} 个独立候选，不能静默修改配额 ${count}`)
  }
}
const manifest = {
  schemaVersion: 1,
  id: seed,
  status: '候选已固定；标注未审核，不可作为标准答案',
  selection: '在查看识别结果前，按图纸初筛类型配额及 SI/铺型/地区分层，固定种子排序轮选',
  acceptanceListSha256: hash(goldBytes),
  featureSha256: hash(featureBytes),
  acceptanceCount: gold.length,
  excludedStoreCount: stores.filter((s) => excludedIds.has(s.store_id)).length,
  poolCount: pool.length,
  quotas,
  overlap: { storeId: 0, sourceHash: 0, normalizedAlias: 0 },
  annotationScope: ['边界', '比例', '主入口', '形态标签'],
  fullStoreQualificationAvailable: false,
  samples: selected.sort((a, b) => a.id.localeCompare(b.id)),
}
if (
  selected.some(
    (s) =>
      excludedIds.has(s.id) ||
      excludedHashes.has(s.sourceSha256) ||
      s.identities.some((n) => excludedNames.has(n)),
  )
)
  throw new Error('与验收集存在同店/哈希/别名重叠')
await mkdir(path.join(out, 'images'), { recursive: true })
const csv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
await writeFile(path.join(out, 'candidates.json'), JSON.stringify(manifest, null, 2))
await writeFile(
  path.join(out, '候选清单.csv'),
  '\uFEFF' +
    [
      ['编号', '门店', '页码', 'SI', '铺型', '地区', '图纸类型初筛', '几何形态', '审核状态'],
      ...manifest.samples.map((s) => [
        s.id,
        s.name,
        s.page,
        s.si,
        s.shopType,
        s.region,
        s.preliminaryType,
        s.geometry,
        s.reviewStatus,
      ]),
    ]
      .map((row) => row.map(csv).join(','))
      .join('\r\n'),
)
console.log(
  JSON.stringify({
    samples: selected.length,
    pool: pool.length,
    excluded: manifest.excludedStoreCount,
    quotas,
  }),
)
const own = path.resolve(import.meta.dirname, '../..')
const fromWeb = createRequire(path.join(own, 'apps/web/package.json'))
const pdfjsPath = fromWeb.resolve('pdfjs-dist/legacy/build/pdf.mjs')
const pdfjs = await import(pathToFileURL(pdfjsPath).href)
const { createCanvas } = createRequire(pdfjsPath)('@napi-rs/canvas')
const sharp = createRequire(path.join(own, 'package.json'))('sharp')
for (const sample of manifest.samples) {
  try {
    const file = path.resolve(resources, sample.sourcePath.replace(/^资源库[\\/]/, ''))
    const relative = path.relative(resources, file)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('来源路径超出资源库')
    const bytes = await readFile(file)
    if (hash(bytes) !== sample.sourceSha256) throw new Error('原图哈希不符或只有 LFS 指针')
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    }).promise
    try {
      const page = await doc.getPage(sample.page),
        unit = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 2400 / Math.max(unit.width, unit.height) })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const png = canvas.toBuffer('image/png')
      sample.image = {
        width: canvas.width,
        height: canvas.height,
        path: `images/${sample.id}.png`,
        sha256: hash(png),
      }
      await writeFile(path.join(out, sample.image.path), png)
      await sharp(png)
        .resize({ width: 600 })
        .webp({ quality: 75 })
        .toFile(path.join(out, `images/${sample.id}-thumb.webp`))
      console.log(`${sample.id} 第${sample.page}页 已渲染`)
    } finally {
      await doc.destroy()
    }
  } catch (error) {
    sample.renderError = String(error)
    console.error(sample.id, sample.renderError)
  }
}
manifest.fingerprint = hash(
  JSON.stringify(manifest.samples.map((s) => [s.id, s.sourceSha256, s.page, s.image?.sha256])),
)
await writeFile(path.join(out, 'candidates.json'), JSON.stringify(manifest, null, 2))
const template = await readFile(path.join(import.meta.dirname, 'review-template.html'), 'utf8')
await writeFile(
  path.join(out, '开发集审核.html'),
  template.replace(/\/\*DATASET\*\/\s*null/, JSON.stringify(manifest).replaceAll('<', '\\u003c')),
)
console.log(
  JSON.stringify({
    rendered: manifest.samples.filter((s) => s.image).length,
    errors: manifest.samples.filter((s) => s.renderError).length,
  }),
)
if (manifest.samples.some((s) => s.renderError)) process.exitCode = 1
