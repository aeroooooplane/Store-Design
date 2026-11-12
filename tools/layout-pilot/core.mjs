import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { SpaceSchema, validateSpace } from '../../packages/shared/src/schemas/space.ts'
import {
  LayoutSchema,
  normalizeRotation,
  validateLayout,
} from '../../packages/shared/src/schemas/layout.ts'
import { ProjectExportSchema } from '../../packages/shared/src/schemas/exchange.ts'
import {
  polygonArea,
  polygonInsidePolygon,
  isSimplePolygon,
  signedArea,
} from '../../packages/shared/src/geometry/index.ts'

export const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest('hex')
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const clean = (ps) => {
  const out = []
  for (const p of ps)
    if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 1e-8) out.push(p)
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-8)
    out.pop()
  return out
}
export function triangles(poly) {
  assert.ok(isSimplePolygon(poly), '轮廓必须是简单多边形')
  let ps = clean(poly).map((p) => [...p])
  if (signedArea(ps) < 0) ps.reverse()
  let changed = true
  while (changed && ps.length > 3) {
    changed = false
    for (let i = 0; i < ps.length; i++)
      if (
        Math.abs(cross(ps[(i + ps.length - 1) % ps.length], ps[i], ps[(i + 1) % ps.length])) < 1e-9
      ) {
        ps.splice(i, 1)
        changed = true
        break
      }
  }
  const out = []
  while (ps.length > 3) {
    let found = false
    for (let i = 0; i < ps.length; i++) {
      const a = ps[(i + ps.length - 1) % ps.length],
        b = ps[i],
        c = ps[(i + 1) % ps.length]
      if (cross(a, b, c) <= 1e-10) continue
      if (
        ps.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            cross(a, b, p) >= -1e-10 &&
            cross(b, c, p) >= -1e-10 &&
            cross(c, a, p) >= -1e-10,
        )
      )
        continue
      out.push([a, b, c])
      ps.splice(i, 1)
      found = true
      break
    }
    assert.ok(found, '无法安全分解轮廓；停止转换')
  }
  out.push(ps)
  return out
}
function convexClip(subject, clip) {
  let out = subject
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length],
      input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j],
        q = input[(j + 1) % input.length],
        dp = cross(a, b, p),
        dq = cross(a, b, q)
      if (dp >= -1e-10) out.push(p)
      if (dp >= -1e-10 !== dq >= -1e-10) {
        const t = dp / (dp - dq)
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
      }
    }
    out = clean(out)
    if (out.length < 3) return []
  }
  return polygonArea(out) > 1e-8 ? out : []
}
// 精确相交后保存不重叠三角片；只裁切派生避让区，不改原标注或租赁范围。
export function clippedObstacle(poly, boundary) {
  assert.ok(isSimplePolygon(poly), '障碍物轮廓无效')
  if (polygonInsidePolygon(poly, boundary)) return [poly]
  const parts = triangles(poly)
    .flatMap((a) => triangles(boundary).map((b) => convexClip(a, b)))
    .filter((p) => p.length >= 3)
  // 合并同一障碍的相邻凸片，消除三角剖分产生的亚毫米短边；不扩张避让面积。
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const hull = convexHull([...parts[i], ...parts[j]])
        if (Math.abs(polygonArea(hull) - polygonArea(parts[i]) - polygonArea(parts[j])) < 1e-8) {
          parts[i] = hull
          parts.splice(j, 1)
          changed = true
          break outer
        }
      }
  }
  return parts
}
function convexHull(points) {
  const ps = [...new Map(points.map((p) => [p.join(','), p])).values()].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    ),
    half = (arr) => {
      const out = []
      for (const p of arr) {
        while (out.length > 1 && cross(out.at(-2), out.at(-1), p) <= 1e-12) out.pop()
        out.push(p)
      }
      return out
    }
  return [...half(ps).slice(0, -1), ...half([...ps].reverse()).slice(0, -1)]
}
const normalized = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '')
const tokens = (s) => [
  'id:' + s.store_id,
  ...[s.name, ...s.aliases].map((n) => 'name:' + normalized(n)),
  ...s.sameStoreKeys.map((n) => 'key:' + normalized(n)),
  ...s.sourceSha256s.map((n) => 'sha:' + n),
]
export function assertIsolation(ids, acceptance, development) {
  assert.equal(acceptance.kind, 'acceptance')
  assert.equal(acceptance.stores.length, 45)
  assert.equal(development.kind, 'development')
  assert.equal(development.stores.length, 48)
  assert.equal(new Set(ids).size, ids.length)
  const forbidden = new Set(acceptance.stores.flatMap(tokens)),
    seen = new Set()
  for (const id of ids) {
    const row = development.stores.find((s) => s.store_id === id)
    assert.ok(row, '选样不在开发集身份清单')
    for (const t of new Set(tokens(row))) {
      assert.ok(!forbidden.has(t), '选样与45家验收存在身份/来源重叠')
      assert.ok(!seen.has(t), '试点存在同店重复')
      seen.add(t)
    }
  }
  return {
    acceptanceIndexHash: hash(acceptance),
    developmentIndexHash: hash(development),
    trainingEligible: false,
  }
}
export const functionFor = (s) =>
  /收银/.test(s)
    ? 'cashier'
    : /开箱/.test(s)
      ? 'unboxing_table'
      : /中岛|中桌|展示桌/.test(s)
        ? 'island_table'
        : /边柜|边桌/.test(s)
          ? 'side_cabinet'
          : /配件柜/.test(s)
            ? 'accessory_cabinet'
            : /凳|椅/.test(s)
              ? 'seating'
              : /储物|水吧/.test(s)
                ? 'storage'
                : 'other'
function rectangle(o) {
  const ps = o.polygon
  if (ps.length !== 4) return null
  const [a, b, c, d] = ps,
    u = [b[0] - a[0], b[1] - a[1]],
    v = [d[0] - a[0], d[1] - a[1]],
    w = Math.hypot(...u),
    depth = Math.hypot(...v)
  if (
    w < 0.005 ||
    depth < 0.005 ||
    Math.abs(u[0] * v[0] + u[1] * v[1]) > w * depth * 0.025 ||
    Math.hypot(c[0] - b[0] - d[0] + a[0], c[1] - b[1] - d[1] + a[1]) > 0.02
  )
    return null
  const rotation = normalizeRotation((Math.atan2(u[1], u[0]) * 180) / Math.PI),
    swap = Math.round(rotation / 90) % 2 !== 0
  return {
    cx: (a[0] + c[0]) / 2,
    cz: (a[1] + c[1]) / 2,
    w: swap ? depth : w,
    d: swap ? w : depth,
    rotation,
  }
}
function nearest(p, boundary) {
  let best = null
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))),
      q = [a[0] + dx * t, a[1] + dz * t],
      distance = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (!best || distance < best.distance) best = { point: q, distance, edge: i }
  }
  return best
}
export function adapt(meta, a) {
  assert.equal(meta.id, a.storeId)
  assert.equal(a.status, 'reviewed', '必须复用已审核版本')
  assert.ok(a.mmPerPixel > 0 && Number.isFinite(a.mmPerPixel))
  assert.ok(a.originPx?.length === 2)
  const point = (p) => p.map((v, i) => ((v - a.originPx[i]) * a.mmPerPixel) / 1000)
  const boundary = a.boundaryPx.map(point),
    shopType = { 边厅店: 'side_hall', 中岛店: 'island', 专区: 'zone' }[meta.shopType]
  assert.ok(shopType)
  assert.ok(isSimplePolygon(boundary))
  const trace = [],
    questions = [],
    omitted = [],
    objects = a.objects.map((o) => ({ ...structuredClone(o), polygon: o.polygon.map(point) }))
  const space = {
    schemaVersion: 1,
    boundary,
    height: 3,
    entrances: [],
    openEdges: [],
    obstacles: [],
    calibration: {
      method: 'dimension',
      reference: '沿用已审核原图量尺；层高3米仅为既定H3预览默认值，非原图实测',
      verified: false,
    },
  }
  if (shopType === 'island') {
    space.openEdges = boundary.map((p, i) => ({ a: p, b: boundary[(i + 1) % boundary.length] }))
    trace.push({
      kind: 'island-access',
      note: '原审核通行路径只作设计结果参照；试点按开放场地排布，不把单条入口当设计起点。已有墙/隔断投影仍避让。',
    })
  } else {
    for (const [i, e] of a.entrances.entries()) {
      if (['auxiliary', 'unknown'].includes(e.purpose)) {
        trace.push({ kind: 'reference-path-only', index: i, purpose: e.purpose })
        continue
      }
      const ends = [point(e.points[0]), point(e.points.at(-1))],
        snapped = ends.map((p) => nearest(p, boundary)),
        max = Math.max(...snapped.map((p) => p.distance))
      if (max > 0.25) {
        questions.push({
          id: `${meta.id}-access-${i}`,
          question: '原通行路径离边界较远，请确认实际开放边或入口位置。',
          owner: 'user',
          distanceM: max,
        })
        continue
      }
      const segment = { a: snapped[0].point, b: snapped[1].point }
      if (Math.hypot(segment.a[0] - segment.b[0], segment.a[1] - segment.b[1]) < 0.02) {
        questions.push({
          id: `${meta.id}-access-${i}`,
          question: '通行路径两端投影到同一点，请确认开放边。',
          owner: 'user',
        })
        continue
      }
      if (e.purpose === 'open-frontage') space.openEdges.push(segment)
      else space.entrances.push({ ...segment, kind: space.entrances.length ? 'side' : 'main' })
      trace.push({
        kind: 'opening-projection',
        index: i,
        source: ends,
        result: segment,
        maxDistanceM: max,
      })
      if (max > 0.02)
        questions.push({
          id: `${meta.id}-access-${i}`,
          question: `入口仅在派生空间中投影到边界，最大移动${Math.round(max * 1000)}毫米；请确认。`,
          owner: 'user',
        })
    }
  }
  const fixed = new Set([
    'column',
    'existing-wall',
    'rear-zone',
    'service',
    'partition',
    'cladding',
    'structure-unknown',
  ])
  for (const o of objects.filter((o) => fixed.has(o.category))) {
    const pieces = clippedObstacle(o.polygon, boundary),
      addedLater = o.category !== 'column' && o.category !== 'existing-wall'
    for (const [i, p] of pieces.entries())
      space.obstacles.push({
        kind: o.category === 'column' ? 'column' : 'fixed',
        polygon: p,
        height:
          Number.isFinite(o.sourceDimensions?.height) &&
          o.sourceDimensions.height > 0 &&
          o.sourceDimensions.height <= 20000
            ? o.sourceDimensions.height / 1000
            : null,
        label: `${o.label} [${o.id}:${i + 1}]`.slice(0, 100),
        addedLater,
      })
    trace.push({
      kind: 'obstacle-intersection',
      id: o.id,
      category: o.category,
      sourceArea: polygonArea(o.polygon),
      insideArea: pieces.reduce((n, p) => n + polygonArea(p), 0),
      pieces: pieces.length,
      role: ['partition', 'cladding'].includes(o.category)
        ? 'existing-design-reserved'
        : 'fixed-or-reserved',
    })
    if (o.category === 'structure-unknown')
      questions.push({
        id: o.id + '-fixed',
        question: `“${o.label}”暂按避让区保留；它是固定构件还是可移动道具？`,
        owner: 'user',
      })
  }
  const layout = { schemaVersion: 3, items: [], planning: null }
  for (const o of objects.filter((o) => !fixed.has(o.category))) {
    const rect = rectangle(o),
      height = o.sourceDimensions?.height
    if (o.category !== 'furniture' || !rect || !height || height < 10 || height > 10000) {
      omitted.push({
        id: o.id,
        label: o.label,
        reason:
          o.category === 'screen' || o.category === 'signage'
            ? '保留二维，安装面/标高未齐；不生成嵌墙实体'
            : !height
              ? '高度未知，保留二维'
              : !rect
                ? '非矩形，保留二维'
                : '尚未映射原生道具',
      })
      continue
    }
    layout.items.push({
      id: o.id,
      assetId: null,
      function: functionFor(o.label),
      name: o.label,
      ...rect,
      h: height / 1000,
      placeholder: true,
      locked: false,
    })
  }
  const parsed = SpaceSchema.safeParse(space)
  const spaceIssues = parsed.success
    ? validateSpace(parsed.data)
    : parsed.error.issues.map((i) => ({
        severity: 'error',
        code: 'schema',
        message: i.message,
        path: i.path,
      }))
  const reference = LayoutSchema.parse(layout),
    referenceIssues = parsed.success ? validateLayout(parsed.data, reference) : []
  const blocked =
    spaceIssues.some((i) => i.severity === 'error') ||
    (!space.entrances.length && !space.openEdges.length)
  return {
    id: meta.id,
    name: meta.name,
    shopType,
    siStyle: meta.si,
    space,
    reference,
    objects,
    trace,
    questions,
    omitted,
    spaceIssues,
    referenceIssues,
    blocked,
    trainingEligible: false,
    annotationHash: hash(a),
    sourceSha256: a.originalApprovedReference.sourceSha256,
    priorReview: {
      status: a.status,
      reviewer: a.reviewer,
      reviewedAt: a.reviewedAt,
      answers: a.answers,
    },
    assumptions: [
      '原图已确认坐标保持不变；派生空间以米为单位。',
      '层高3米仅用于平面链路与预览；未知家具高度不补值。',
      '原隔断、包板、设备与后场暂保留避让；本轮只重排核心家具，未自动设计硬装。',
      '参考布局不是硬性数量需求；未将参考家具坐标传给排布器。',
    ],
  }
}
export function projectFor(row, candidates, exportedAt) {
  assert.ok(!row.blocked, '空间存在阻断问题')
  const node = (id, name, kind, layout, strategy = null) => ({
    id,
    parentId: kind === 'space' ? null : 'space',
    name,
    kind,
    space: kind === 'space' ? row.space : null,
    layout,
    strategy,
    siStyle: row.siStyle,
    origin: id === 'reference' || kind === 'space' ? 'import' : 'generator',
    importedFrom: row.id,
    hidden: false,
  })
  return ProjectExportSchema.parse({
    format: 'store-design-project',
    schemaVersion: 1,
    exportedAt,
    project: {
      name: row.name + ' · 排布试点草稿',
      shopType: row.shopType,
      market: /新加坡|泰国|印尼|菲律宾|马来西亚|韩国/.test(row.name) ? 'overseas' : 'domestic',
      siStyle: row.siStyle,
    },
    nodes: [
      node('space', '已审核范围 · 试点条件', 'space', null),
      node('reference', '原图参考 · 仅已知高度对象', 'edit', row.reference),
      ...candidates
        .filter((c) => !c.issues.some((i) => i.severity === 'error') && c.layout.items.length)
        .map((c) =>
          node(
            'layout-' + c.strategy,
            { max: '多放', area: '按面积', min: '少放' }[c.strategy] + ' · 自动候选',
            'plan',
            c.layout,
            c.strategy,
          ),
        ),
    ],
    draft: null,
  })
}
