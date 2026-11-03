// 仅复现 Issue #139 指定的两张原图；不读取 plan.json，不计算金标准得分。
// node tools/recognition/reproduce-openings.mjs --source-repo "D:/text demo" --out <目录>
// 比较另一版本：加 --engine <代码仓库> --inputs <首次输出目录>，共用相同输入及模型目录。
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? fallback : process.argv[at + 1]
}
const own = path.resolve(import.meta.dirname, '../..')
const engine = path.resolve(option('engine', own))
const resourceArg =
  option('resource-root') ??
  (option('source-repo') ? path.join(option('source-repo'), '资源库') : null)
const resources = resourceArg ? path.resolve(resourceArg) : null
const output = option('out')
if (!output) throw new Error('必须指定 --out；不得覆盖档案或金标准目录')
const out = path.resolve(output)
const inputs = option('inputs')
if (resources) {
  const relative = path.relative(resources, out)
  if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    throw new Error('复现输出必须在只读资源库以外')
}
if (inputs && path.resolve(inputs) === out) throw new Error('复现输出不得覆盖固定输入目录')
if (!inputs && !resources)
  throw new Error('必须指定 --resource-root（只读资源库）或 --inputs（固定复现输入）')
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const hash = (data) => createHash('sha256').update(data).digest('hex')
const mod = (file) => import(pathToFileURL(path.join(engine, file)).href)
const { functionFor, polygonArea, isSimplePolygon } = await mod('packages/shared/src/index.ts')
const { recognizeVector } = await mod('apps/api/src/modules/recognition/local.ts')
const { checkDraft, failureReason } = await mod('apps/api/src/modules/recognition/check.ts')
const ids = ['NEW-095', 'PDF-293']
await mkdir(out, { recursive: true })
const rows = []
for (const id of ids) {
  let input
  if (inputs) input = await json(path.join(inputs, `${id}-input.json`))
  else {
    const archive = path.join(resources, '09_门店档案')
    const folder = (await readdir(archive)).find((name) => name.startsWith(`${id}__`))
    if (!folder) throw new Error(`缺少 ${id} 档案元数据`)
    const store = await json(path.join(archive, folder, 'store.json'))
    const sources = await json(path.join(archive, '来源清单.json'))
    const pdf = sources.sources.find((row) => row.source_id === id)
    if (!pdf) throw new Error(`缺少 ${id} 来源`)
    const sourceFile = path.resolve(resources, pdf.path.replace(/^资源库[\\/]/, ''))
    const relative = path.relative(resources, sourceFile)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('来源路径超出资源库')
    const bytes = await readFile(sourceFile)
    const sha = hash(bytes)
    if (sha !== store.source.sha256) throw new Error(`${id} 原图哈希与档案不一致`)
    const fromWeb = createRequire(path.join(engine, 'apps/web/package.json'))
    const pdfjsPath = fromWeb.resolve('pdfjs-dist/legacy/build/pdf.mjs')
    const pdfjs = await import(pathToFileURL(pdfjsPath).href)
    const { createCanvas } = createRequire(pdfjsPath)('@napi-rs/canvas')
    const { extractPageVector, pageScale } = await mod(
      'apps/web/src/features/recognition/pdf-vector.ts',
    )
    const { readDimensionChains, readPageTexts } = await mod(
      'apps/api/src/modules/recognition/ocr.ts',
    )
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    }).promise
    try {
      const pageNumber = store.pages.main_plan_page
      const page = await doc.getPage(pageNumber)
      const scale = pageScale(page, 2400)
      const viewport = page.getViewport({ scale })
      const vector = await extractPageVector(page, scale, pdfjs.OPS)
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const png = canvas.toBuffer('image/png')
      await writeFile(path.join(out, `${id}-source.png`), png)
      const chains = await readDimensionChains(png, vector)
      if (vector.texts.filter((t) => /[一-鿿]/.test(t.text)).length < 3)
        vector.texts.push(...(await readPageTexts(png, vector)))
      const manifestBytes = await readFile(path.join(resources, '04_模型库/manifest.json'))
      const bodyBytes = await readFile(path.join(resources, '04_模型库/body-footprint.json'))
      const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''))
      const body = JSON.parse(bodyBytes.toString('utf8').replace(/^\uFEFF/, '')).assets
      const catalog = manifest.assets.map((a) => ({
        id: a.asset_id,
        name: a.display_name ?? a.standard_name,
        standardName: a.standard_name,
        variant: a.variant,
        siFamily: a.si_family,
        category: a.category,
        function: functionFor(a.standard_name),
        footprint: {
          w: body[a.asset_id]?.w ?? a.tight_face_bounds_xyz_mm[0] / 1000,
          d: body[a.asset_id]?.d ?? a.tight_face_bounds_xyz_mm[1] / 1000,
          h: a.tight_face_bounds_xyz_mm[2] / 1000,
        },
        placeable: Boolean(a.web_model),
        retired: Boolean(a.retired),
      }))
      input = {
        id,
        page: pageNumber,
        si: store.si.value,
        sourceSha256: sha,
        catalogSha256: hash(manifestBytes),
        bodySha256: hash(bodyBytes),
        pngSha256: hash(png),
        vector,
        chains,
        catalog,
      }
    } finally {
      await doc.destroy()
    }
  }
  if (input.id !== id) throw new Error(`输入与 ${id} 不符`)
  const encoded = JSON.stringify(input)
  await writeFile(path.join(out, `${id}-input.json`), encoded)
  const started = performance.now()
  const draft = checkDraft(recognizeVector(input.vector, {}, input.catalog, input.si, input.chains))
  const summary = {
    id,
    page: input.page,
    si: input.si,
    inputSha256: hash(encoded),
    sourceSha256: input.sourceSha256,
    chainReadings: input.chains.length,
    failure: failureReason(draft),
    simple: draft.space ? isSimplePolygon(draft.space.boundary) : false,
    vertices: draft.space?.boundary.length ?? 0,
    areaM2: draft.space ? polygonArea(draft.space.boundary) : null,
    mmPerPixel: draft.scale?.mmPerPixel ?? null,
    verified: draft.scale?.verified ?? false,
    ms: Math.round(performance.now() - started),
    notes: draft.notes,
    pending: draft.pending,
  }
  await writeFile(path.join(out, `${id}-draft.json`), JSON.stringify(draft, null, 2))
  rows.push(summary)
  console.log(JSON.stringify(summary))
}
const revision = execFileSync('git', ['-C', engine, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const dirty = Boolean(
  execFileSync('git', ['-C', engine, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
)
await writeFile(
  path.join(out, 'summary.json'),
  JSON.stringify(
    {
      scope: '仅两张指定原图的问题复现，不是开发集或验收集评分',
      revision,
      dirty,
      rows,
    },
    null,
    2,
  ),
)
