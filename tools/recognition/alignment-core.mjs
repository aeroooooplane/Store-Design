import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const sha256 = (b) => createHash('sha256').update(b).digest('hex')
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
export function validateAnnotation(data) {
  assert.equal(data.coordinateSystem, 'source-pixels', '只能使用原图像素坐标')
  assert.ok(data.image.width > 0 && data.image.height > 0)
  const ids = new Set()
  const point = (p) => {
    assert.ok(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite), '坐标无效')
    assert.ok(
      p[0] >= 0 && p[1] >= 0 && p[0] <= data.image.width && p[1] <= data.image.height,
      '超出原图',
    )
  }
  for (const f of data.features) {
    assert.ok(f.id && !ids.has(f.id), '对象编号重复')
    ids.add(f.id)
    assert.ok(
      ['agent-manual', 'automatic-retained', 'user-corrected'].includes(f.origin),
      '来源缺失',
    )
    const g = f.geometry
    if (['polygon', 'polyline'].includes(g.type)) {
      assert.ok(g.points.length >= (g.type === 'polygon' ? 3 : 2))
      g.points.forEach(point)
      for (const hole of g.holes ?? []) {
        assert.ok(hole.length >= 3)
        hole.forEach(point)
      }
    } else if (['rect', 'roundedRect'].includes(g.type)) {
      assert.ok(g.width > 0 && g.height > 0 && Number.isFinite(g.radius ?? 0))
      point([g.x, g.y])
      point([g.x + g.width, g.y + g.height])
      assert.ok((g.radius ?? 0) >= 0 && (g.radius ?? 0) <= Math.min(g.width, g.height) / 2)
    } else if (g.type === 'arc') {
      assert.ok([g.cx, g.cy, g.radius, g.start, g.end].every(Number.isFinite) && g.radius > 0)
      for (let i = 0; i <= 32; i++) {
        const t = ((g.start + ((g.end - g.start) * i) / 32) * Math.PI) / 180
        point([g.cx + g.radius * Math.cos(t), g.cy + g.radius * Math.sin(t)])
      }
    } else assert.fail('未知几何类型')
  }
  assert.equal(
    data.agentManualFeatures,
    data.features.filter((f) => f.origin === 'agent-manual').length,
    '人工贡献计数不符',
  )
  assert.equal(
    data.automaticFinalFeatures,
    data.features.filter((f) => f.origin === 'automatic-retained').length,
    '自动贡献计数不符',
  )
  return true
}
export function shapePath(g) {
  if (g.type === 'polygon')
    return [g.points, ...(g.holes ?? [])]
      .map((p) => 'M' + p.map((v) => v.join(',')).join('L') + 'Z')
      .join('')
  if (g.type === 'polyline') return 'M' + g.points.map((v) => v.join(',')).join('L')
  if (g.type === 'rect' || g.type === 'roundedRect') {
    const { x, y, width: w, height: h } = g,
      r = g.radius ?? 0
    return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`
  }
  if (g.type === 'arc') {
    const a = (g.start * Math.PI) / 180,
      b = (g.end * Math.PI) / 180,
      r = g.radius
    return `M${g.cx + r * Math.cos(a)},${g.cy + r * Math.sin(a)}A${r},${r} 0 ${Math.abs(g.end - g.start) > 180 ? 1 : 0} ${g.end >= g.start ? 1 : 0} ${g.cx + r * Math.cos(b)},${g.cy + r * Math.sin(b)}`
  }
  throw Error('未知形状')
}
export function changeSummary(raw, data) {
  validateAnnotation(data)
  return {
    automaticBoundaryCandidates: raw.polygons.length,
    automaticFinalFeatures: data.automaticFinalFeatures,
    agentManualFeatures: data.agentManualFeatures,
    objects: data.features.length,
    automaticComplete: false,
    userReviewed: data.userReviewed,
    byKind: Object.fromEntries(
      [...new Set(data.features.map((f) => f.kind))].map((k) => [
        k,
        data.features.filter((f) => f.kind === k).length,
      ]),
    ),
  }
}
export function durationSummary(events) {
  const pair = (a, b) => {
    const from = events.find((e) => e.event === a),
      to = events.find((e) => e.event === b)
    if (!from || !to) return null
    const seconds = (Date.parse(to.at) - Date.parse(from.at)) / 1000
    assert.ok(seconds >= 0, '时间顺序不符')
    return seconds
  }
  return {
    automaticSeconds: pair('automatic_started', 'automatic_finished'),
    agentCorrectionSessionSeconds: pair('correction_started', 'correction_draft_finished'),
    agentCorrectionRecheckSeconds: pair(
      'correction_recheck_started',
      'correction_recheck_finished',
    ),
    userCorrectionSeconds: null,
    note: '代理校正为查图、录点和局部验证的会话墙钟，含工具等待；不是用户纯点击工时。审核页制作、工程测试另计，未虚构逐对象耗时。',
  }
}
