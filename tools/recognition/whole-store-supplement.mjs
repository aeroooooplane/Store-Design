import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clone,
  decodeWholePack,
  entryErrors,
  exportWholePack,
  evaluationPack,
  objectInventory,
} from './whole-store-core.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
// 增量只允许新增物体和问题，既有用户坐标、答复与签名另存原包。
export function applySupplement(data, pack, supplement, sourceSha256) {
  if (supplement.schemaVersion !== 1 || supplement.reviewSha256 !== sourceSha256)
    throw Error('增补来源不符')
  const next = clone(data),
    records = decodeWholePack(pack, data),
    seen = new Set()
  for (const patch of supplement.stores) {
    const s = next.stores.find((s) => s.id === patch.id),
      r = records[patch.id]
    if (!s || seen.has(patch.id)) throw Error('增补门店未知或重复')
    seen.add(patch.id)
    if (!Array.isArray(patch.objects) || !Array.isArray(patch.questions))
      throw Error('增补格式错误')
    const objectIds = new Set(r.objects.map((o) => o.id)),
      questionIds = new Set(s.questions.map((q) => q.id))
    for (const o of patch.objects) {
      if (objectIds.has(o.id)) throw Error('不能覆盖既有物体')
      objectIds.add(o.id)
    }
    for (const q of patch.questions) {
      if (
        !/^[A-Za-z0-9_-]+$/.test(q.id) ||
        questionIds.has(q.id) ||
        typeof q.question !== 'string' ||
        !Array.isArray(q.options) ||
        !q.options.length ||
        q.options.some((v) => typeof v !== 'string') ||
        typeof q.recommendation !== 'string'
      )
        throw Error('增补问题无效或重复')
      questionIds.add(q.id)
    }
    r.objects.push(...clone(patch.objects))
    s.questions.push(...clone(patch.questions))
    if (patch.objects.length || patch.questions.length) {
      r.status = 'agent_corrected'
      r.reviewedAt = null
      s.supplementNote = '原整店审核已保留，本次只需核对新增墙体或通行问题。'
    }
    const errors = entryErrors(r, s)
    if (errors.length) throw Error(patch.id + ' ' + errors.join('；'))
  }
  next.initialRecords = records
  next.priorWholeReviewPack = clone(pack)
  next.wholeReviewSha256 = sourceSha256
  next.supplementBatch = hash(JSON.stringify(supplement))
  return next
}
async function main() {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    if (i < 0 || !process.argv[i + 1]) throw Error('缺少 --' + k)
    return path.resolve(process.argv[i + 1])
  }
  const input = arg('bundle'),
    out = arg('out'),
    patchPath = arg('supplement')
  if (out === input || out.startsWith(input + path.sep)) throw Error('输出须为新的独立目录')
  const manifest = JSON.parse(await readFile(path.join(input, '文件指纹.json'), 'utf8'))
  for (const f of manifest) {
    const p = path.resolve(input, f.path)
    if (!p.startsWith(input + path.sep) || hash(await readFile(p)) !== f.sha256)
      throw Error('输入文件指纹不符')
  }
  const raw = await readFile(path.join(input, '原始整店审核包.json')),
    data = applySupplement(
      JSON.parse(await readFile(path.join(input, '构建数据.json'), 'utf8')),
      JSON.parse(raw),
      JSON.parse(await readFile(patchPath, 'utf8')),
      hash(raw),
    )
  await writeWholeBundle({
    input,
    out,
    data,
    raw,
    extraFiles: [{ source: patchPath, name: '增补依据.json' }],
  })
}
export async function writeWholeBundle({ input, out, data, raw, extraFiles = [], beforeManifest }) {
  if (out === input || out.startsWith(input + path.sep)) throw Error('输出须为新的独立目录')
  await mkdir(out)
  await cp(input, out, { recursive: true })
  for (const f of extraFiles) await cp(f.source, path.join(out, f.name))
  const records = data.initialRecords,
    escape = (s) =>
      String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  for (const s of data.stores) {
    const r = records[s.id],
      a = JSON.parse(await readFile(path.join(out, 'annotations', s.id + '.json'), 'utf8'))
    Object.assign(a, clone(r))
    if (data.sourceRevision) {
      a.boundaryPx = clone(s.boundary)
      a.metricBoundary = s.boundary.map((p) =>
        p.map((v, j) => ((v - a.originPx[j]) * s.mmPerPixel) / 1000),
      )
      a.sourceRevisionBatch = data.sourceRevision.batch
      a.sourceRevision = clone(data.sourceRevision.log.filter((x) => x.storeId === s.id))
    }
    a.metricObjects = r.objects.map((o) => ({
      ...clone(o),
      polygon: o.polygon.map((p) => p.map((v, j) => ((v - a.originPx[j]) * s.mmPerPixel) / 1000)),
    }))
    a.inventory = objectInventory(r)
    await writeFile(path.join(out, 'annotations', s.id + '.json'), JSON.stringify(a, null, 2))
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
      [s.crop.left, s.crop.top, s.crop.width, s.crop.height].join(' ') +
      '"><image href="../' +
      s.image.path +
      '" width="' +
      s.image.width +
      '" height="' +
      s.image.height +
      '"/>' +
      r.objects
        .map(
          (o) =>
            '<polygon points="' +
            o.polygon.map((p) => p.join(',')).join(' ') +
            '" fill="' +
            (o.category === 'cladding' ? '#ffd200' : '#6b675f') +
            '" fill-opacity=".15" stroke="#111" stroke-width="1.5"><title>' +
            escape(o.label) +
            '</title></polygon>',
        )
        .join('') +
      '</svg>'
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
  await writeFile(path.join(out, '构建数据.json'), JSON.stringify(data))
  await writeFile(
    path.join(out, '整店标注草稿.json'),
    JSON.stringify(exportWholePack(data, records), null, 2),
  )
  await writeFile(
    path.join(out, '入口复评参照.json'),
    JSON.stringify(evaluationPack(data, records), null, 2),
  )
  const report = {
    stores: data.stores.length,
    priorReviewed: JSON.parse(raw).entries.filter((r) => r.status === 'reviewed').length,
    unchangedReviewed: Object.values(records).filter((r) => r.status === 'reviewed').length,
    objects: Object.values(records).reduce((n, r) => n + r.objects.length, 0),
    newObjects:
      Object.values(records).reduce((n, r) => n + r.objects.length, 0) -
      JSON.parse(raw).entries.reduce((n, r) => n + r.objects.length, 0),
    pendingQuestions: data.stores.flatMap((s) =>
      s.questions
        .filter((q) => !records[s.id].answers[q.id]?.trim())
        .map((q) => ({ storeId: s.id, ...q })),
    ),
    sourceSha256: hash(raw),
    supplementBatch: data.supplementBatch,
    decisionBatch: data.decisionBatch,
    decisionLog: data.decisionLog,
    sourceRevisionBatch: data.sourceRevision?.batch,
    sourceRevisionLog: data.sourceRevision?.log,
    limitations: [
      '仅补有原页依据的墙体范围，未穷尽48家包墙',
      '空实、厚度和承重无依据时待定',
      '面积字段仅描述规则，未接入业务面积或自动排布',
    ],
  }
  await writeFile(path.join(out, '核验报告.json'), JSON.stringify(report, null, 2))
  if (beforeManifest) await beforeManifest()
  const files = []
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (p !== path.join(out, '文件指纹.json'))
        files.push({
          path: path.relative(out, p).replaceAll('\\', '/'),
          sha256: hash(await readFile(p)),
        })
    }
  }
  await walk(out)
  await writeFile(path.join(out, '文件指纹.json'), JSON.stringify(files, null, 2))
  console.log(
    JSON.stringify({
      stores: report.stores,
      priorReviewed: report.priorReviewed,
      unchangedReviewed: report.unchangedReviewed,
      objects: report.objects,
      newObjects: report.newObjects,
      pendingQuestions: report.pendingQuestions.length,
      sourceRevisionBatch: report.sourceRevisionBatch,
    }),
  )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
