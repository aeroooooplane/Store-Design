// 只读固定开发候选及原图；不读取 plan.json 或验收评分。输出为可跨机重放的输入包。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? null : process.argv[i + 1]
}
for (const name of ['dataset', 'resource-root', 'out'])
  if (!arg(name)) throw new Error(`必须指定 --${name}`)
const repo = path.resolve(import.meta.dirname, '../..'),
  resources = path.resolve(arg('resource-root')),
  out = path.resolve(arg('out'))
const inside = (parent, child) => {
  const r = path.relative(parent, child)
  return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r))
}
if (inside(resources, out) || inside(path.dirname(path.resolve(arg('dataset'))), out))
  throw new Error('输出必须独立于资源库及候选审核目录')
const hash = (b) => createHash('sha256').update(b).digest('hex')
const readJson = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
const data = await readJson(arg('dataset'))
const frozen = await readJson(path.join(repo, 'docs/recognition-development-20261029-v1.json'))
if (
  data.fingerprint !== frozen.fingerprint ||
  JSON.stringify(data.samples.map((s) => [s.id, s.page, s.sourceSha256])) !==
    JSON.stringify(frozen.samples.map((s) => [s.id, s.page, s.sourceSha256]))
)
  throw new Error('候选与已提交固定清单不符')
const goldBytes = await readFile(path.join(resources, '09_门店档案/金标准名单.json'))
const gold = JSON.parse(goldBytes.toString('utf8').replace(/^\uFEFF/, ''))
if (
  hash(goldBytes) !== data.acceptanceListSha256 ||
  data.samples.some((s) =>
    gold.some((g) => g.store_id === s.id || s.sourceIds?.includes(g.store_id)),
  )
)
  throw new Error('验收名单变化或候选含验收门店，停止')
const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const fromWeb = createRequire(path.join(repo, 'apps/web/package.json')),
  pdfjsPath = fromWeb.resolve('pdfjs-dist/legacy/build/pdf.mjs')
const pdfjs = await import(pathToFileURL(pdfjsPath).href),
  { createCanvas } = createRequire(pdfjsPath)('@napi-rs/canvas')
const mod = (file) => import(pathToFileURL(path.join(repo, file)).href)
const { extractPageVector, pageScale } = await mod(
  'apps/web/src/features/recognition/pdf-vector.ts',
)
const { readDimensionChains, readPageTexts } = await mod('apps/api/src/modules/recognition/ocr.ts')
const { functionFor } = await mod('packages/shared/src/index.ts')
const manifestBytes = await readFile(path.join(resources, '04_模型库/manifest.json')),
  bodyBytes = await readFile(path.join(resources, '04_模型库/body-footprint.json'))
const modelManifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, '')),
  bodies = JSON.parse(bodyBytes.toString('utf8').replace(/^\uFEFF/, '')).assets
const catalog = modelManifest.assets.map((a) => ({
  id: a.asset_id,
  name: a.display_name ?? a.standard_name,
  standardName: a.standard_name,
  variant: a.variant,
  siFamily: a.si_family,
  category: a.category,
  function: functionFor(a.standard_name),
  footprint: {
    w: bodies[a.asset_id]?.w ?? a.tight_face_bounds_xyz_mm[0] / 1000,
    d: bodies[a.asset_id]?.d ?? a.tight_face_bounds_xyz_mm[1] / 1000,
    h: a.tight_face_bounds_xyz_mm[2] / 1000,
  },
  placeable: Boolean(a.web_model),
  retired: Boolean(a.retired),
}))
await mkdir(out, { recursive: true })
const indexPath = path.join(out, 'inputs.json')
try {
  await readFile(indexPath)
  throw new Error('输入包已存在，禁止覆盖；请指定新的独立目录')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
const index = {
  schemaVersion: 1,
  datasetId: data.id,
  datasetFingerprint: data.fingerprint,
  acceptanceListSha256: data.acceptanceListSha256,
  extractorRevision: revision,
  catalogSha256: hash(manifestBytes),
  bodySha256: hash(bodyBytes),
  samples: [],
}
await writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog))
index.catalogSnapshotSha256 = hash(JSON.stringify(catalog))
for (const sample of data.samples) {
  const row = {
    id: sample.id,
    page: sample.page,
    si: sample.si,
    sourceSha256: sample.sourceSha256,
    imageSha256: sample.image.sha256,
  }
  try {
    const pdfFile = path.resolve(resources, sample.sourcePath.replace(/^资源库[\\/]/, ''))
    if (!inside(resources, pdfFile)) throw new Error('源文件超出资源根')
    const bytes = await readFile(pdfFile)
    if (hash(bytes) !== sample.sourceSha256) throw new Error('原 PDF 指纹不符或仅为 LFS 指针')
    const document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    }).promise
    try {
      const page = await document.getPage(sample.page),
        scale = pageScale(page, 2400),
        viewport = page.getViewport({ scale })
      const vector = await extractPageVector(page, scale, pdfjs.OPS),
        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const picture = canvas.toBuffer('image/png')
      if (hash(picture) !== sample.image.sha256) throw new Error('渲染图与固定审核坐标不一致')
      await writeFile(path.join(out, `${sample.id}.png`), picture)
      const nativeTextCount = vector.texts.length,
        ocrErrors = []
      let chains = []
      try {
        chains = await readDimensionChains(picture, vector)
      } catch (e) {
        ocrErrors.push(`尺寸链：${e.message}`)
      }
      if (vector.texts.filter((t) => /[一-鿿]/.test(t.text)).length < 3) {
        try {
          vector.texts.push(...(await readPageTexts(picture, vector)))
        } catch (e) {
          ocrErrors.push(`整页文字：${e.message}`)
        }
      }
      const input = {
        id: sample.id,
        page: sample.page,
        si: sample.si,
        sourceSha256: sample.sourceSha256,
        pngSha256: sample.image.sha256,
        vector,
        chains,
        nativeTextCount,
        ocrErrors,
      }
      const encoded = JSON.stringify(input)
      await writeFile(path.join(out, `${sample.id}.json`), encoded)
      Object.assign(row, {
        inputSha256: hash(encoded),
        vectorLines: vector.lines.length,
        nativeTextCount,
        totalTexts: vector.texts.length,
        chainReadings: chains.length,
        ocrErrors,
      })
    } finally {
      await document.destroy()
    }
  } catch (e) {
    row.error = e.message
  }
  index.samples.push(row)
  await writeFile(indexPath, JSON.stringify(index, null, 2))
  console.log(JSON.stringify(row))
}
index.complete =
  index.samples.length === data.samples.length &&
  index.samples.every((s) => !s.error && !s.ocrErrors?.length)
await writeFile(indexPath, JSON.stringify(index, null, 2))
if (!index.complete) process.exitCode = 1
