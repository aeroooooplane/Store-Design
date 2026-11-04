// 独立整店标注契约。原用户审核只读；新增图层有独立状态。
export const categories = {
  furniture: '家具',
  column: '柱',
  partition: '隔断',
  cladding: '包墙/包柱',
  'existing-wall': '原墙',
  'rear-zone': '后场',
  service: '设备',
  screen: '屏幕',
  signage: '标识/灯箱',
  'display-prop': '陈列道具',
  'structure-unknown': '待定构件',
}
export const clone = (x) => JSON.parse(JSON.stringify(x))
export function signedArea(p) {
  return (
    p.reduce((a, v, i) => {
      const w = p[(i + 1) % p.length]
      return a + v[0] * w[1] - w[0] * v[1]
    }, 0) / 2
  )
}
export function polygonErrors(p, image) {
  if (!Array.isArray(p) || p.length < 3 || p.length > 2000) return ['轮廓至少3点，最多2000点']
  if (
    p.some(
      (v) =>
        !Array.isArray(v) ||
        v.length !== 2 ||
        v.some((n) => !Number.isFinite(n)) ||
        v[0] < 0 ||
        v[1] < 0 ||
        v[0] > image.width ||
        v[1] > image.height,
    )
  )
    return ['坐标超出原图或不是有限数']
  if (Math.abs(signedArea(p)) < 1) return ['轮廓面积过小']
  if (
    p.some(
      (v, i) =>
        Math.hypot(v[0] - p[(i + 1) % p.length][0], v[1] - p[(i + 1) % p.length][1]) < 0.001,
    )
  )
    return ['轮廓相邻点重合']
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length]
      const on = (v, w, q) =>
        Math.abs(cross(v, w, q)) < 1e-8 &&
        q[0] >= Math.min(v[0], w[0]) &&
        q[0] <= Math.max(v[0], w[0]) &&
        q[1] >= Math.min(v[1], w[1]) &&
        q[1] <= Math.max(v[1], w[1])
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return ['轮廓自交或重叠']
    }
  return []
}
export function entranceErrors(paths, image) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100)
    return ['请保留至少一条入口，最多100条']
  const errors = []
  for (const p of paths) {
    if (
      !['polyline', 'arc'].includes(p.kind) ||
      !Array.isArray(p.points) ||
      p.points.length < 2 ||
      p.points.length > 2000 ||
      (p.kind === 'arc' && p.points.length !== 3)
    ) {
      errors.push('入口路径格式错误')
      continue
    }
    if (
      p.points.some(
        (v) =>
          !Array.isArray(v) ||
          v.length !== 2 ||
          v.some((n) => !Number.isFinite(n)) ||
          v[0] < 0 ||
          v[1] < 0 ||
          v[0] > image.width ||
          v[1] > image.height,
      )
    )
      errors.push('入口坐标无效')
    else if (
      p.points.some(
        (v, i) => i && Math.hypot(v[0] - p.points[i - 1][0], v[1] - p.points[i - 1][1]) < 0.01,
      )
    )
      errors.push('入口连续点重合')
    if (p.kind === 'arc' && Math.abs(signedArea(p.points)) < 0.01) errors.push('圆弧三点不能共线')
  }
  return errors
}
export function entryErrors(entry, store) {
  const errors = [],
    ids = new Set()
  if (entry.storeId !== store.id) errors.push('门店身份不一致')
  if (!Array.isArray(entry.objects) || entry.objects.length > 2000) return ['物体列表无效']
  for (const o of entry.objects) {
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(o.id) || ids.has(o.id))
      errors.push('物体编号无效或重复')
    ids.add(o.id)
    if (
      !o.sourceDimensions ||
      typeof o.sourceDimensions !== 'object' ||
      Array.isArray(o.sourceDimensions)
    )
      errors.push('尺寸记录格式无效')
    if (!o.label?.trim() || !categories[o.category]) errors.push('物体名称或分类无效')
    errors.push(...wallPropertyErrors(o, entry.objects))
    errors.push(...polygonErrors(o.polygon, store.image).map((x) => o.label + '：' + x))
    for (const k of ['length', 'width', 'depth', 'height'])
      if (
        o.sourceDimensions?.[k] != null &&
        (!Number.isFinite(o.sourceDimensions[k]) || o.sourceDimensions[k] <= 0)
      )
        errors.push(o.label + '：尺寸须为正数或留空')
  }
  errors.push(...entranceErrors(entry.entrances, store.image))
  if (
    !['agent_corrected', 'reviewed'].includes(entry.status) ||
    !['partial', 'complete'].includes(entry.entranceStatus)
  )
    errors.push('审核状态无效')
  if (entry.status === 'reviewed' && (!entry.reviewer?.trim() || !entry.reviewedAt))
    errors.push('家具审核签名缺失')
  if (entry.status === 'reviewed' && store.questions.some((q) => !entry.answers?.[q.id]?.trim()))
    errors.push('待确认问题尚未填写')
  if (
    entry.entranceStatus === 'complete' &&
    (!entry.entranceReviewer?.trim() || !entry.entranceReviewedAt)
  )
    errors.push('入口全集确认签名缺失')
  if (
    entry.entranceStatus === 'complete' &&
    store.questions.some((q) => isEntranceQuestion(q) && !entry.answers?.[q.id]?.trim())
  )
    errors.push('入口用途问题尚未裁决')
  return errors
}
export function isEntranceQuestion(q) {
  return /入口|顾客|开放|出口/.test(q.question)
}
export function initialEntry(store, reference, reviewer = '') {
  return {
    storeId: store.id,
    objects: clone(store.objects),
    status: 'agent_corrected',
    reviewer: reviewer || reference.reviewer || '',
    reviewedAt: null,
    answers: {},
    notes: '',
    entrances: clone(reference.entrances),
    entranceStatus: 'partial',
    entranceReviewer: null,
    entranceReviewedAt: null,
  }
}
export function decodeWholePack(pack, data) {
  if (
    data.supplementBatch &&
    (pack.supplementBatch !== data.supplementBatch ||
      JSON.stringify(pack.priorWholeReviewPack) !== JSON.stringify(data.priorWholeReviewPack))
  )
    throw Error('增补批次或前轮整店审核不符')
  if (
    pack.schemaVersion !== 1 ||
    pack.kind !== 'whole-store-review' ||
    pack.fingerprint !== data.fingerprint ||
    pack.annotationBatch !== data.annotationBatch ||
    pack.originalReviewSha256 !== data.originalReviewSha256
  )
    throw Error('审核包版本或来源不符')
  if (JSON.stringify(pack.originalReviewPack) !== JSON.stringify(data.originalReviewPack))
    throw Error('原审核记录不可替换')
  if (!Array.isArray(pack.entries) || pack.entries.length !== data.stores.length)
    throw Error('审核包必须包含完整门店集')
  const records = {},
    ids = new Set()
  for (const e of pack.entries) {
    const s = data.stores.find((s) => s.id === e.storeId)
    if (!s || ids.has(e.storeId)) throw Error('未知或重复门店')
    ids.add(e.storeId)
    const errors = entryErrors(e, s)
    if (errors.length) throw Error(s.id + ' ' + errors.join('；'))
    records[e.storeId] = clone(e)
  }
  return records
}
export function exportWholePack(data, records) {
  const pack = {
    ...(data.supplementBatch
      ? {
          supplementBatch: data.supplementBatch,
          priorWholeReviewPack: clone(data.priorWholeReviewPack),
        }
      : {}),
    schemaVersion: 1,
    kind: 'whole-store-review',
    datasetId: data.datasetId,
    fingerprint: data.fingerprint,
    annotationBatch: data.annotationBatch,
    originalReviewSha256: data.originalReviewSha256,
    originalReviewPack: clone(data.originalReviewPack),
    entries: data.stores.map((s) => clone(records[s.id])),
    fullStoreQualificationAvailable: false,
  }
  decodeWholePack(pack, data)
  return pack
}
export function evaluationPack(data, records) {
  const p = clone(data.referencePack)
  p.entranceReviewScope = '当前布局下已标出的顾客通行口；不代表开放边或规划硬约束，完整性单独确认'
  p.entranceSemantics = 'observed-current-layout'
  for (const r of p.annotations) {
    const e = records[r.store_id],
      s = data.stores.find((x) => x.id === r.store_id)
    const errors = entryErrors(e, s)
    if (errors.length) throw Error(errors.join('；'))
    r.originalEntrances = clone(r.entrances)
    r.entrances = clone(e.entrances)
    r.entranceReviewVersion = 2
    r.entranceSemantics = 'observed-current-layout'
    if (e.entranceStatus === 'complete') {
      r.entranceCoverage = 'complete'
      r.entranceReviewVersion = 2
      r.entranceReviewedBy = e.entranceReviewer
      r.entranceReviewedAt = e.entranceReviewedAt
    } else {
      r.entranceCoverage = 'partial'
      delete r.entranceReviewedBy
      delete r.entranceReviewedAt
    }
  }
  return p
}
export function objectInventory(entry) {
  return entry.objects.map((o) => ({
    id: o.id,
    label: o.label,
    category: o.category,
    quantity: 1,
    attachedSeats: o.sourceDimensions?.attachedSeats || 0,
    assetId: o.assetId ?? null,
    sourceDimensions: clone(o.sourceDimensions || {}),
    status: entry.status,
  }))
}
export function entranceDrawPoints(p) {
  if (p.kind !== 'arc') return p.points
  const [a, b, c] = p.points,
    d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-8) return p.points
  const n = (q) => q[0] ** 2 + q[1] ** 2,
    cx = (n(a) * (b[1] - c[1]) + n(b) * (c[1] - a[1]) + n(c) * (a[1] - b[1])) / d,
    cy = (n(a) * (c[0] - b[0]) + n(b) * (a[0] - c[0]) + n(c) * (b[0] - a[0])) / d
  const tau = 2 * Math.PI,
    norm = (x) => ((x % tau) + tau) % tau,
    start = Math.atan2(a[1] - cy, a[0] - cx),
    mid = norm(Math.atan2(b[1] - cy, b[0] - cx) - start),
    end = norm(Math.atan2(c[1] - cy, c[0] - cx) - start),
    sweep = mid <= end ? end : end - tau,
    r = Math.hypot(a[0] - cx, a[1] - cy)
  return Array.from({ length: 65 }, (_, i) => [
    cx + r * Math.cos(start + (sweep * i) / 64),
    cy + r * Math.sin(start + (sweep * i) / 64),
  ])
}

// 空实与新旧分开；后加实心构件也不能直接扣租赁面积。
export function wallAreaPolicy(w) {
  if (!w) return 'unknown'
  if (w.phase === 'added') return 'avoid-only'
  if (w.phase === 'existing' && w.role === 'core') return 'deduct-core'
  return 'unknown'
}
export function wallPropertyErrors(o, objects) {
  const w = o.wallProperties
  if (w == null) return []
  if (typeof w !== 'object' || Array.isArray(w)) return ['墙体信息格式无效']
  const errors = []
  if (
    !['existing', 'added', 'unknown'].includes(w.phase) ||
    !['solid', 'hollow', 'unknown'].includes(w.solidity) ||
    !['core', 'cladding', 'partition', 'unknown'].includes(w.role)
  )
    errors.push('墙体新旧、空实或作用无效')
  if (typeof w.evidence !== 'string' || w.evidence.length > 4000) errors.push('墙体依据须为文字')
  if (
    (w.phase !== 'unknown' || w.solidity !== 'unknown' || w.role !== 'unknown') &&
    (typeof w.evidence !== 'string' || !w.evidence.trim())
  )
    errors.push('墙体判断需填写依据')
  if (w.wrapsObjectId != null) {
    const core = objects.find((x) => x.id === w.wrapsObjectId)
    if (
      w.role !== 'cladding' ||
      !core ||
      core.id === o.id ||
      !['column', 'existing-wall', 'structure-unknown'].includes(core.category) ||
      core.wallProperties?.role === 'cladding'
    )
      errors.push('包覆关系必须指向独立原墙柱核心')
  }
  return errors
}
