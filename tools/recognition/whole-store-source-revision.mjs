import { readFile, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clone, decodeWholePack, entryErrors, polygonErrors } from './whole-store-core.mjs'
import { writeWholeBundle } from './whole-store-supplement.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
const safeRelative = (p) =>
  typeof p === 'string' &&
  /^[A-Za-z0-9_./-]+$/.test(p) &&
  !p.startsWith('/') &&
  !p.split('/').some((x) => !x || x === '.' || x === '..')
const need = (ok, message) => {
  if (!ok) throw Error(message)
}
export function applySourceRevision(data, pack, spec, sourceSha256) {
  need(spec.schemaVersion === 1 && spec.reviewSha256 === sourceSha256, '原图修订来源不符')
  need(Array.isArray(spec.stores) && Array.isArray(spec.evidence), '原图修订格式错误')
  const next = clone(data),
    records = decodeWholePack(pack, data),
    seen = new Set(),
    log = [],
    boundaries = clone(data.sourceRevision?.boundaries || []),
    evidence = new Map()
  for (const e of spec.evidence) {
    const ref = data.referencePack.annotations.find((a) => a.store_id === e.storeId)
    need(
      ref &&
        !evidence.has(e.id) &&
        /^[A-Za-z0-9_-]+$/.test(e.id) &&
        safeRelative(e.path) &&
        Number.isInteger(e.page) &&
        e.page > 0 &&
        e.sourceSha256 === ref.sourceSha256 &&
        /^[a-f0-9]{64}$/.test(e.sha256),
      '原页证据身份或路径错误',
    )
    evidence.set(e.id, e)
  }
  for (const patch of spec.stores) {
    const s = next.stores.find((s) => s.id === patch.id),
      r = records[patch.id]
    need(s && !seen.has(patch.id), '修订门店未知或重复')
    seen.add(patch.id)
    need(
      Array.isArray(patch.evidenceIds) &&
        patch.evidenceIds.length &&
        patch.evidenceIds.every((id) => evidence.get(id)?.storeId === patch.id),
      '修订缺少同店原图依据',
    )
    need(typeof patch.reason === 'string' && patch.reason.trim(), '修订须说明原因')
    const changes = [],
      touched = new Set()
    for (const u of patch.updates || []) {
      const o = r.objects.find((o) => o.id === u.id)
      need(o && !touched.has(u.id), '修订物体未知或重复')
      touched.add(u.id)
      need(u.set && typeof u.set === 'object' && !Array.isArray(u.set), '属性修订格式错误')
      const allowed = [
        'label',
        'category',
        'sourceDimensions',
        'note',
        'wallProperties',
        'sourceAllocation',
      ]
      need(
        Object.keys(u.set).length && Object.keys(u.set).every((k) => allowed.includes(k)),
        '不允许覆盖既有几何或身份',
      )
      if (Object.hasOwn(u.set, 'sourceAllocation'))
        need(['new', 'reused', 'unknown'].includes(u.set.sourceAllocation), '设备来源属性无效')
      const encoded = JSON.stringify(u.set)
      need(!/"(?:__proto__|constructor|prototype)"\s*:/.test(encoded), '属性包含无效键')
      const before = clone(o)
      for (const [k, v] of Object.entries(u.set)) {
        if (['sourceDimensions', 'wallProperties'].includes(k)) {
          need(v && typeof v === 'object' && !Array.isArray(v), '嵌套属性无效')
          o[k] = { ...o[k], ...clone(v) }
        } else o[k] = clone(v)
      }
      changes.push({ kind: 'update', objectId: o.id, before, after: clone(o) })
    }
    for (const o of patch.additions || []) {
      need(!r.objects.some((x) => x.id === o.id), '新增物体不得覆盖原标注')
      need(
        o.source?.sourceSha256 ===
          data.referencePack.annotations.find((a) => a.store_id === s.id).sourceSha256 &&
          o.source?.imageSha256 === s.image.sha256 &&
          o.source?.page === s.page,
        '新增物体原图身份错误',
      )
      r.objects.push(clone(o))
      changes.push({ kind: 'add', objectId: o.id, after: clone(o) })
    }
    for (const q of patch.questions || []) {
      need(
        q &&
          /^[A-Za-z0-9_-]+$/.test(q.id) &&
          !s.questions.some((x) => x.id === q.id) &&
          typeof q.question === 'string' &&
          q.question.trim() &&
          Array.isArray(q.options) &&
          q.options.length &&
          q.options.every((x) => typeof x === 'string') &&
          typeof q.recommendation === 'string',
        '新增问题无效或重复',
      )
      s.questions.push(clone(q))
      changes.push({ kind: 'question', questionId: q.id })
    }
    if (patch.boundary) {
      const b = patch.boundary
      need(JSON.stringify(b.before) === JSON.stringify(s.boundary), '边界修订基线不符')
      need(!polygonErrors(b.after, s.image).length, '修订边界几何无效')
      need(
        b.userDecision &&
          r.answers[b.userDecision.questionId] === b.userDecision.answer &&
          b.userDecision.answer?.trim(),
        '边界修订缺少已确认答复',
      )
      const previous = boundaries.find((x) => x.storeId === s.id)
      if (previous) boundaries.splice(boundaries.indexOf(previous), 1)
      boundaries.push({
        storeId: s.id,
        ...clone(b),
        ...(previous
          ? {
              before: clone(previous.before),
              editBefore: clone(b.before),
              previousRevision: clone(previous),
            }
          : {}),
        evidenceIds: clone(patch.evidenceIds),
        status: 'agent-verified-from-user-decision',
      })
      s.boundary = clone(b.after)
      changes.push({ kind: 'boundary', before: clone(b.before), after: clone(b.after) })
    }
    need(changes.length, '空修订')
    r.status = 'agent_corrected'
    r.reviewedAt = null
    s.supplementNote = '已有审核保留；本轮按原图补注，未代替你签核。'
    s.notes.push(patch.reason)
    const errors = entryErrors(r, s)
    need(!errors.length, s.id + ' ' + errors.join('；'))
    log.push({
      storeId: s.id,
      reason: patch.reason,
      evidenceIds: clone(patch.evidenceIds),
      changes,
    })
  }
  next.initialRecords = records
  next.sourceRevision = {
    batch: hash(JSON.stringify(spec)),
    reviewSha256: sourceSha256,
    sourcePack: clone(pack),
    evidence: clone(spec.evidence),
    log,
    boundaries,
  }
  return next
}
async function main() {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    need(i >= 0 && process.argv[i + 1], '缺少 --' + k)
    return path.resolve(process.argv[i + 1])
  }
  const input = arg('bundle'),
    out = arg('out'),
    specPath = arg('revision'),
    evidenceRoot = arg('evidence'),
    raw = await readFile(path.join(input, '整店标注草稿.json')),
    spec = JSON.parse(await readFile(specPath, 'utf8'))
  need(
    out !== input &&
      !out.startsWith(input + path.sep) &&
      out !== evidenceRoot &&
      !out.startsWith(evidenceRoot + path.sep),
    '输出须为独立目录',
  )
  for (const f of JSON.parse(await readFile(path.join(input, '文件指纹.json'), 'utf8'))) {
    const p = path.resolve(input, f.path)
    need(p.startsWith(input + path.sep) && hash(await readFile(p)) === f.sha256, '输入指纹不符')
  }
  const data = applySourceRevision(
    JSON.parse(await readFile(path.join(input, '构建数据.json'), 'utf8')),
    JSON.parse(raw),
    spec,
    hash(raw),
  )
  for (const e of spec.evidence)
    need(hash(await readFile(path.join(evidenceRoot, e.path))) === e.sha256, '证据文件指纹不符')
  await writeWholeBundle({
    input,
    out,
    data,
    raw,
    extraFiles: [
      { source: specPath, name: '原图修订依据.json' },
      { source: path.join(input, '整店标注草稿.json'), name: '修订前整店标注.json' },
    ],
    beforeManifest: async () => {
      await cp(evidenceRoot, path.join(out, 'source-evidence'), { recursive: true })
    },
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
