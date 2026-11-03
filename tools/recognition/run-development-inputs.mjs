// 对固定输入包运行任意代码版本。只记录运行与闭合，不读取标注，不计算正式成绩。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? null : process.argv[i + 1]
}
for (const key of ['inputs', 'engine', 'out']) if (!arg(key)) throw new Error(`必须指定 --${key}`)
const inputs = path.resolve(arg('inputs')),
  engine = path.resolve(arg('engine')),
  out = path.resolve(arg('out'))
if (inputs === out || out.startsWith(inputs + path.sep)) throw new Error('不得覆盖固定输入包')
const hash = (b) => createHash('sha256').update(b).digest('hex'),
  json = async (p) => JSON.parse(await readFile(p, 'utf8'))
const index = await json(path.join(inputs, 'inputs.json')),
  catalogBytes = await readFile(path.join(inputs, 'catalog.json'))
if (!index.complete || hash(catalogBytes) !== index.catalogSnapshotSha256)
  throw new Error('输入包不完整或目录快照指纹不符')
const catalog = JSON.parse(catalogBytes.toString('utf8'))
const revision = execFileSync('git', ['-C', engine, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const sourceDiff = execFileSync(
  'git',
  ['-C', engine, 'diff', 'HEAD', '--', 'apps/api/src/modules/recognition', 'packages/shared/src'],
  { encoding: 'utf8' },
)
if (sourceDiff.trim()) throw new Error('识别引擎含未提交改动，必须先固定代码版本')
const mod = (p) => import(pathToFileURL(path.join(engine, p)).href)
const { recognizeVector } = await mod('apps/api/src/modules/recognition/local.ts')
const { checkDraft, failureReason } = await mod('apps/api/src/modules/recognition/check.ts')
const { isSimplePolygon, polygonArea } = await mod('packages/shared/src/index.ts')
await mkdir(out, { recursive: true })
const rows = []
for (const sample of index.samples) {
  const row = { id: sample.id, inputSha256: sample.inputSha256 }
  try {
    const bytes = await readFile(path.join(inputs, `${sample.id}.json`))
    if (hash(bytes) !== sample.inputSha256) throw new Error('固定输入指纹不符')
    const input = JSON.parse(bytes.toString('utf8')),
      started = performance.now()
    // 无矢量图片与当前产品路径一致：本阶段不声称支持自动边界识别。
    const draft = input.vector.lines.length
      ? checkDraft(recognizeVector(input.vector, {}, catalog, input.si, input.chains))
      : null
    await writeFile(path.join(out, `${sample.id}.json`), JSON.stringify(draft, null, 2))
    Object.assign(row, {
      failure: draft ? failureReason(draft) : '图片无矢量线，需描点量尺',
      closed: Boolean(draft?.space && isSimplePolygon(draft.space.boundary)),
      vertices: draft?.space?.boundary.length ?? 0,
      areaM2: draft?.space ? polygonArea(draft.space.boundary) : null,
      mmPerPixel: draft?.scale?.mmPerPixel ?? null,
      items: draft?.items.length ?? 0,
      pending: draft?.pending ?? [],
      notes: draft?.notes ?? [],
      ms: Math.round(performance.now() - started),
    })
  } catch (e) {
    row.executionError = e.message
  }
  rows.push(row)
  console.log(
    JSON.stringify({
      id: row.id,
      closed: row.closed,
      failure: row.failure,
      executionError: row.executionError,
    }),
  )
}
await writeFile(
  path.join(out, 'results.json'),
  JSON.stringify(
    {
      scope: '开发集固定输入运行诊断；非人工标注准确率或整店合格率',
      datasetId: index.datasetId,
      datasetFingerprint: index.datasetFingerprint,
      inputsIndexSha256: hash(await readFile(path.join(inputs, 'inputs.json'))),
      revision,
      rows,
    },
    null,
    2,
  ),
)
if (rows.some((r) => r.executionError)) process.exitCode = 1
