import assert from 'node:assert/strict'
import { LayoutSchema, validateLayout } from '../../packages/shared/src/schemas/layout.ts'
import { SpaceSchema, validateSpace } from '../../packages/shared/src/schemas/space.ts'
import {
  obbGap,
  placedBox,
  polygonArea,
  isSimplePolygon,
  polygonInsidePolygon,
} from '../../packages/shared/src/geometry/index.ts'
import { clippedObstacle } from './core.mjs'

export function rolesFor(label) {
  const roles = []
  if (/收银/.test(label)) roles.push('cashier')
  if (/开箱|open a box/i.test(label)) roles.push('unboxing_table')
  if (/储物|储藏/.test(label)) roles.push('storage')
  if (/配件/.test(label))
    roles.push(/边柜|边桌|桌/.test(label) ? 'side_cabinet' : 'accessory_cabinet')
  if (/中岛|中桌/.test(label)) roles.push('island_table')
  if (/凳|椅/.test(label)) roles.push('seating')
  if (/方形展桌|明星展柜|展示桌/.test(label)) roles.push('display_stand')
  return roles.length ? roles : ['other']
}

/** 一行对应一件实体；组合台保留多个功能，不拆成重复采购数量。 */
export function inventory(row) {
  const entities = row.objects
    .filter((o) => o.category === 'furniture')
    .map((o) => ({
      id: o.id,
      label: o.label,
      roles: rolesFor(o.label),
      quantity: 1,
      dimensions: structuredClone(o.sourceDimensions ?? {}),
      placeholderFootprint: (() => {
        const item = row.reference.items.find((i) => i.id === o.id)
        return item ? { w: item.w, d: item.d, h: item.h } : null
      })(),
      origin: 'reviewed-annotation',
      sourceAnnotationHash: row.sourceFileHash,
    }))
  const counts = {}
  for (const e of entities) for (const role of e.roles) counts[role] = (counts[role] ?? 0) + 1
  const attachedSeats = entities.reduce((n, e) => n + (e.dimensions.attachedSeats ?? 0), 0)
  return {
    entities,
    physicalCount: entities.length,
    roleCounts: counts,
    attachedSeatReferences: attachedSeats,
    rule: '逐店原注数量作为本轮复现需求；不是所有新店统一必配标准。附带座位仅留参考，未与独立凳子相加。',
    unresolved: entities.filter((e) => e.roles.includes('other')).map((e) => e.id),
  }
}

/** 审图接触表上的录点转回原图坐标，记录变换，禁止改写旧标注。 */
export function contactToPixels(row, index, polygon) {
  const ps = row.space.boundary.map((p) =>
    p.map((v, k) => (v * 1000) / row.mmPerPixel + row.originPx[k]),
  )
  const left = Math.max(0, Math.floor(Math.min(...ps.map((p) => p[0])) - 60))
  const top = Math.max(0, Math.floor(Math.min(...ps.map((p) => p[1])) - 60))
  const width = Math.min(
    row.image.width - left,
    Math.ceil(Math.max(...ps.map((p) => p[0])) + 60 - left),
  )
  const height = Math.min(
    row.image.height - top,
    Math.ceil(Math.max(...ps.map((p) => p[1])) + 60 - top),
  )
  const scale = Math.min(900 / width, 900 / height)
  // sharp contain uses rounded resized dimensions and centres the remainder.
  const dx = Math.floor((900 - Math.round(width * scale)) / 2) + (index % 2) * 900
  const dy =
    Math.floor((900 - Math.round(height * scale)) / 2) + Math.floor((index % 4) / 2) * 940 + 40
  return polygon.map(([x, y]) => [left + (x - dx) / scale, top + (y - dy) / scale])
}

export function reviseSpace(row, index, correction) {
  assert.ok(correction && Array.isArray(correction.walls), '每店必须有审图记录')
  const space = structuredClone(row.space),
    additions = []
  const entries = [
    ...correction.walls.map((polygon, j) => ({
      polygon,
      height: correction.heightsMm?.[j] ? correction.heightsMm[j] / 1000 : null,
      keepout: false,
    })),
    ...(correction.keepouts ?? []).map((polygon) => ({ polygon, height: 0.001, keepout: true })),
  ]
  for (const [j, entry] of entries.entries()) {
    const ps = entry.polygon,
      label = entry.keepout ? '补标禁放区' : '补标墙体'
    const pixels = contactToPixels(row, index, ps)
    const polygon = pixels.map((p) =>
      p.map((v, k) => ((v - row.originPx[k]) * row.mmPerPixel) / 1000),
    )
    assert.ok(isSimplePolygon(polygon), '新增墙体自交')
    const id = `${row.id}-${entry.keepout ? 'KEEPOUT' : 'WALL'}-${j + 1}`
    const exactParts = clippedObstacle(polygon, space.boundary)
    const parts = exactParts
      .map((p) => {
        const q = p.filter(
          (v, k) =>
            Math.hypot(
              v[0] - p[(k + p.length - 1) % p.length][0],
              v[1] - p[(k + p.length - 1) % p.length][1],
            ) > 0.001,
        )
        if (
          isSimplePolygon(q) &&
          polygonInsidePolygon(q, space.boundary) &&
          Math.abs(polygonArea(q) - polygonArea(p)) < 0.001
        )
          return q
        if (polygonArea(p) < 0.00002) return null
        return p
      })
      .filter(Boolean)
    const areaAdjustmentM2 =
      parts.reduce((s, p) => s + polygonArea(p), 0) -
      exactParts.reduce((s, p) => s + polygonArea(p), 0)
    additions.push({
      id,
      category: entry.keepout ? 'no-placement-zone' : 'wall-assembly',
      label: `${label} ${j + 1}`,
      polygon,
      pixels,
      state: 'agent-draft',
      sourceImageHash: row.imageHash,
      height: entry.keepout ? null : entry.height,
      method: entry.keepout
        ? '图纸明确禁止摆放；原生适配为1毫米高禁放标记，不代表实体墙'
        : '代理对照原图手工录点；含包墙和装饰基层，非结构性质鉴定',
      sourceAreaM2: polygonArea(polygon),
      insideAreaM2: parts.reduce((s, p) => s + polygonArea(p), 0),
      areaAdjustmentM2,
    })
    parts.forEach((p, k) =>
      space.obstacles.push({
        kind: entry.keepout ? 'other' : 'fixed',
        polygon: p,
        height: entry.height,
        addedLater: true,
        label: `${label} [${id}:${k + 1}]`,
      }),
    )
  }
  SpaceSchema.parse(space)
  const errors = validateSpace(space).filter((i) => i.severity === 'error')
  assert.deepEqual(errors, [], '修订空间未通过几何检查')
  return {
    space,
    additions,
    note: correction.note,
    question: correction.question ?? null,
    boundary: { state: 'inherited-reviewed', vertexCount: space.boundary.length, changed: false },
    wallCompleteness: 'agent-draft',
    businessApproved: false,
    rule: '轮廓表示允许使用范围；补标墙体按实际占地避让；开放边不等同实体墙。灯箱广告机按贴面保留二维表达。',
  }
}

const roleName = {
  cashier: /收银/,
  unboxing_table: /开箱/,
  storage: /储物|储藏/,
  side_cabinet: /配件/,
  accessory_cabinet: /配件/,
  island_table: /中岛/,
  seating: /凳|椅/,
  display_stand: /展示|展柜|展桌/,
}
export function matchAssets(entity, assets, style) {
  return assets
    .filter(
      (a) =>
        a.placeable &&
        !a.retired &&
        (!a.installation || a.installation === 'floor') &&
        !entity.roles.includes('other') &&
        (!(entity.dimensions.length ?? entity.dimensions.width) ||
          Math.abs(
            Math.max(a.footprint.w, a.footprint.d) -
              (entity.dimensions.length ?? entity.dimensions.width) / 1000,
          ) <=
            Math.max(
              0.02,
              ((entity.dimensions.length ?? entity.dimensions.width) / 1000) * 0.05,
            )) &&
        (!entity.roles.includes('seating') || Math.max(a.footprint.w, a.footprint.d) <= 0.8) &&
        ['通用', style].includes(a.siFamily) &&
        entity.roles.every((role) =>
          entity.roles.length === 1
            ? a.function === role
            : roleName[role]?.test(a.name + ' ' + a.standardName),
        ),
    )
    .sort(
      (a, b) =>
        Number(a.siFamily !== style) - Number(b.siFamily !== style) ||
        // 明确标注的长边先按5%或20毫米容差筛选；不拉伸模型，不复制原坐标。
        Math.abs(
          Math.max(a.footprint.w, a.footprint.d) - (entity.dimensions.length ?? 1800) / 1000,
        ) -
          Math.abs(
            Math.max(b.footprint.w, b.footprint.d) - (entity.dimensions.length ?? 1800) / 1000,
          ) ||
        a.id.localeCompare(b.id),
    )
}

/** 有界离散搜索：原注只传类别/数量/尺寸，不接受原图家具位置。 */
export function generateRequired(space, entities, assets, style, strategy = 'area') {
  const started = performance.now(),
    placed = [],
    shortages = [],
    assignments = []
  const xs = space.boundary.map((p) => p[0]),
    zs = space.boundary.map((p) => p[1])
  const bounds = {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  }
  const rank = (e) =>
    e.roles.includes('cashier')
      ? 0
      : e.roles.includes('unboxing_table')
        ? 1
        : e.roles.includes('island_table')
          ? 2
          : 3
  const ordered = [...entities].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  // 全策略满足相同数量；改变寻位顺序，不删除必配来制造“少放”成功。
  const step = 0.1,
    gap = 0.6
  for (const entity of ordered) {
    const candidates = matchAssets(entity, assets, style)
    if (!candidates.length && entity.placeholderFootprint && !entity.roles.includes('other'))
      candidates.push({
        id: null,
        function: entity.roles[0],
        footprint: entity.placeholderFootprint,
        placeholder: true,
      })
    let best = null
    for (const asset of candidates.slice(0, 4)) {
      if (asset.footprint.h > space.height) continue
      for (const rotation of [0, 90, 180, 270]) {
        const swap = rotation % 180 !== 0,
          w = swap ? asset.footprint.d : asset.footprint.w,
          d = swap ? asset.footprint.w : asset.footprint.d
        const nx = Math.min(250, Math.ceil((bounds.x1 - bounds.x0) / step)),
          nz = Math.min(250, Math.ceil((bounds.z1 - bounds.z0) / step))
        for (let iz = 0; iz <= nz; iz++)
          for (let ix = 0; ix <= nx; ix++) {
            const cx = bounds.x0 + w / 2 + ix * step,
              cz = bounds.z0 + d / 2 + iz * step
            if (cx + w / 2 > bounds.x1 + 1e-8 || cz + d / 2 > bounds.z1 + 1e-8) continue
            const item = {
              id: entity.id,
              assetId: asset.id,
              function: asset.function,
              name: entity.label,
              cx,
              cz,
              rotation,
              w,
              d,
              h: asset.footprint.h,
              placeholder: !!asset.placeholder,
              locked: false,
            }
            if (placed.some((p) => obbGap(placedBox(p), placedBox(item)) < gap - 1e-8)) continue
            if (
              validateLayout(space, { schemaVersion: 3, items: [item] }).some(
                (i) => i.severity === 'error',
              )
            )
              continue
            const frontClearance = space.entrances.some(
              (e) =>
                Math.min(
                  Math.hypot(cx - e.a[0], cz - e.a[1]),
                  Math.hypot(cx - e.b[0], cz - e.b[1]),
                ) < 0.8,
            )
            if (frontClearance) continue
            const score =
              strategy === 'min' ? -cx - cz : strategy === 'max' ? cx + cz : cz + cx * 0.01
            if (!best || score < best.score) best = { item, score, assetId: asset.id }
          }
      }
      if (best) break
    }
    if (best) {
      placed.push(best.item)
      assignments.push({
        sourceId: entity.id,
        itemId: best.item.id,
        assetId: best.assetId,
        roles: entity.roles,
        placeholder: best.item.placeholder,
      })
    } else
      shortages.push({
        id: entity.id,
        label: entity.label,
        roles: entity.roles,
        reason: candidates.length
          ? '有限搜索未找到满足墙体/间距的位置（不等于数学上不可放）'
          : '无同SI/通用的对应功能模型；组合台不拆分、不重复计数',
      })
  }
  const layout = LayoutSchema.parse({
    schemaVersion: 3,
    items: placed,
    planning: {
      strategy,
      requested: entities.length,
      placed: placed.length,
      relaxations: [],
      note: '按逐店原注实体数量复现；0.6米道具间距为实验参数。未验证完整通行网络/消防/经营布局。',
    },
  })
  return {
    strategy,
    layout,
    issues: validateLayout(space, layout),
    notes: shortages.map((s) => `${s.label}：${s.reason}`),
    assignments,
    shortages,
    generationSeconds: (performance.now() - started) / 1000,
    businessApproved: false,
  }
}
