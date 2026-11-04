import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clone, decodeWholePack, entryErrors, isWallAnnotation } from './whole-store-core.mjs'
import { writeWholeBundle } from './whole-store-supplement.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
const need = (ok, msg) => {
  if (!ok) throw Error(msg)
}
// 图形签核与代理派生的表达说明分开，后者不制造用户构造签核。
export function applyWallAssemblies(data, pack, spec, reviewSha256) {
  need(
    spec.schemaVersion === 1 && spec.reviewSha256 === reviewSha256 && Array.isArray(spec.stores),
    '墙体表达来源不符',
  )
  const next = clone(data),
    records = decodeWholePack(pack, data),
    log = [],
    seen = new Set()
  for (const patch of spec.stores) {
    const s = next.stores.find((s) => s.id === patch.id),
      r = records[patch.id]
    need(s && !seen.has(s.id) && Array.isArray(patch.objects), '门店未知、重复或格式错误')
    seen.add(s.id)
    const ref = data.referencePack.annotations.find((a) => a.store_id === s.id)
    need(
      patch.imageSha256 === s.image.sha256 &&
        patch.sourceSha256 === ref.sourceSha256 &&
        patch.page === s.page,
      '墙体表达原页身份不符',
    )
    const ids = new Set()
    for (const item of patch.objects) {
      const o = r.objects.find((o) => o.id === item.id)
      need(
        o &&
          !ids.has(o.id) &&
          Object.keys(item).every((k) =>
            ['id', 'representation', 'installation', 'evidence'].includes(k),
          ),
        '物体重复、未知或不允许改几何',
      )
      ids.add(o.id)
      need(typeof item.evidence === 'string' && item.evidence.trim(), '表达说明缺少依据')
      const before = clone(o)
      if (item.representation != null) {
        need(isWallAnnotation(o), '墙体表达只能用于墙体')
        o.wallGeometry = {
          representation: item.representation,
          evidence: item.evidence,
          status: 'agent_interpreted',
          display3d: 'simplified-wall',
          cutForEmbedded: false,
        }
      }
      if (item.installation) {
        need(
          Object.keys(item.installation).every((k) => ['hostObjectId', 'planMode'].includes(k)),
          '安装关系字段无效',
        )
        o.wallInstallation = {
          ...clone(item.installation),
          evidence: item.evidence,
          status: 'agent_interpreted',
          display3d: 'wall-surface',
          cutWall: false,
          solidBody: false,
        }
      }
      need(item.representation != null || item.installation, '空表达说明')
      log.push({
        storeId: s.id,
        objectId: o.id,
        origin: 'agent_interpreted',
        before,
        after: clone(o),
      })
    }
  }
  for (const d of spec.decisions || []) {
    const r = records[d.storeId],
      s = next.stores.find((s) => s.id === d.storeId),
      o = r?.objects.find((o) => o.id === d.objectId)
    need(
      o &&
        r.status === 'reviewed' &&
        s.questions.some((q) => q.id === d.questionId) &&
        d.answer?.trim() &&
        r.answers[d.questionId] === d.answer,
      '用户答复不匹配或未审核',
    )
    need(
      d.set &&
        Object.keys(d.set).every((k) =>
          ['label', 'category', 'sourceAllocation', 'note'].includes(k),
        ),
      '答复不得改写几何',
    )
    need(
      d.set.sourceAllocation == null ||
        ['new', 'reused', 'mixed', 'unknown'].includes(d.set.sourceAllocation),
      '来源分类无效',
    )
    const before = clone(o)
    Object.assign(o, clone(d.set))
    log.push({
      storeId: s.id,
      objectId: o.id,
      origin: 'user-answer',
      questionId: d.questionId,
      answer: d.answer,
      reviewer: r.reviewer,
      reviewedAt: r.reviewedAt,
      before,
      after: clone(o),
    })
  }
  for (const s of next.stores) {
    const errors = entryErrors(records[s.id], s)
    need(!errors.length, s.id + ' ' + errors.join('；'))
  }
  next.initialRecords = records
  next.wallAssemblyBatch = hash(JSON.stringify(spec))
  next.wallAssemblySourcePack = clone(pack)
  next.wallAssemblyReviewSha256 = reviewSha256
  next.wallAssemblyLog = log
  return next
}
async function main() {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    need(i >= 0 && process.argv[i + 1], '缺少 --' + k)
    return path.resolve(process.argv[i + 1])
  }
  const input = arg('bundle'),
    review = arg('reviewed'),
    specPath = arg('spec'),
    out = arg('out')
  need(input !== out && !out.startsWith(input + path.sep), '输出不得覆盖输入')
  for (const f of JSON.parse(await readFile(path.join(input, '文件指纹.json'), 'utf8'))) {
    const p = path.resolve(input, f.path)
    need(p.startsWith(input + path.sep) && hash(await readFile(p)) === f.sha256, '输入指纹不符')
  }
  const raw = await readFile(review),
    data = applyWallAssemblies(
      JSON.parse(await readFile(path.join(input, '构建数据.json'), 'utf8')),
      JSON.parse(raw),
      JSON.parse(await readFile(specPath, 'utf8')),
      hash(raw),
    )
  await writeWholeBundle({
    input,
    out,
    data,
    raw,
    extraFiles: [
      { source: review, name: '本轮原始审核包.json' },
      { source: specPath, name: '墙体表达依据.json' },
    ],
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
