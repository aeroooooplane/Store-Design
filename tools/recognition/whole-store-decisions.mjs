import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clone, decodeWholePack, entryErrors, entrancePurposes } from './whole-store-core.mjs'
import { writeWholeBundle } from './whole-store-supplement.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
export function applyDecisions(data, pack, spec, sourceSha256) {
  if (
    spec.schemaVersion !== 1 ||
    spec.reviewSha256 !== sourceSha256 ||
    !Array.isArray(spec.decisions)
  )
    throw Error('答复落实来源不符')
  const next = clone(data),
    records = decodeWholePack(pack, data),
    log = [],
    seen = new Set()
  for (const d of spec.decisions) {
    const r = records[d.storeId],
      s = next.stores.find((s) => s.id === d.storeId),
      key = d.storeId + '/' + d.questionId
    if (
      !r ||
      r.status !== 'reviewed' ||
      !s.questions.some((q) => q.id === d.questionId) ||
      !d.answer?.trim() ||
      r.answers[d.questionId] !== d.answer ||
      seen.has(key)
    )
      throw Error('答复不匹配、未确认或重复：' + key)
    seen.add(key)
    const changes = []
    for (const a of d.objects || []) {
      const o = r.objects.find((o) => o.id === a.id)
      if (
        !o ||
        !a.set ||
        Object.keys(a.set).some(
          (k) =>
            ![
              'label',
              'category',
              'note',
              'sourceDimensions',
              'wallProperties',
              'sourceAllocation',
            ].includes(k),
        )
      )
        throw Error('属性对象或可修改字段无效')
      if (
        a.set.sourceAllocation != null &&
        !['reused', 'new', 'mixed', 'unknown'].includes(a.set.sourceAllocation)
      )
        throw Error('利旧来源属性无效')
      const before = clone(o)
      for (const [k, v] of Object.entries(a.set)) {
        if (['sourceDimensions', 'wallProperties'].includes(k)) {
          if (
            !v ||
            typeof v !== 'object' ||
            Array.isArray(v) ||
            Object.keys(v).some((x) => ['__proto__', 'prototype', 'constructor'].includes(x))
          )
            throw Error('嵌套属性格式无效')
          o[k] = { ...o[k], ...clone(v) }
        } else o[k] = clone(v)
      }
      changes.push({ objectId: o.id, before, after: clone(o) })
    }
    for (const a of d.paths || []) {
      const p = r.entrances[a.index]
      if (
        !Number.isInteger(a.index) ||
        !p ||
        !Object.hasOwn(entrancePurposes, a.purpose) ||
        JSON.stringify(p.points) !== JSON.stringify(a.expectedPoints)
      )
        throw Error('路径用途与审核几何不匹配')
      const before = clone(p)
      p.purpose = a.purpose
      changes.push({ pathIndex: a.index, before, after: clone(p) })
    }
    const errors = entryErrors(r, s)
    if (errors.length) throw Error(key + ' ' + errors.join('；'))
    log.push({
      storeId: d.storeId,
      questionId: d.questionId,
      answer: d.answer,
      reviewer: r.reviewer,
      reviewedAt: r.reviewedAt,
      outcome: d.outcome || 'applied',
      note: d.note || '',
      changes,
    })
  }
  const total = Object.values(records).reduce((n, r) => n + Object.keys(r.answers).length, 0)
  if (seen.size !== total) throw Error('答复台账未覆盖本轮全部已答问题')
  next.initialRecords = records
  next.decisionSourcePack = clone(pack)
  next.wholeReviewSha256 = sourceSha256
  next.decisionBatch = hash(JSON.stringify(spec))
  next.decisionLog = log
  return next
}
async function main() {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    if (i < 0 || !process.argv[i + 1]) throw Error('缺少 --' + k)
    return path.resolve(process.argv[i + 1])
  }
  const input = arg('bundle'),
    review = arg('reviewed'),
    decisions = arg('decisions'),
    out = arg('out')
  for (const f of JSON.parse(await readFile(path.join(input, '文件指纹.json'), 'utf8'))) {
    const p = path.resolve(input, f.path)
    if (!p.startsWith(input + path.sep) || hash(await readFile(p)) !== f.sha256)
      throw Error('输入指纹不符')
  }
  const raw = await readFile(review),
    data = applyDecisions(
      JSON.parse(await readFile(path.join(input, '构建数据.json'), 'utf8')),
      JSON.parse(raw),
      JSON.parse(await readFile(decisions, 'utf8')),
      hash(raw),
    )
  await writeWholeBundle({
    input,
    out,
    data,
    raw,
    extraFiles: [
      { source: review, name: '本轮原始审核包.json' },
      { source: decisions, name: '答复落实依据.json' },
    ],
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
