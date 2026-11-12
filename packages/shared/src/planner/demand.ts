import type { Asset } from '../schemas/asset.ts'
import type { DemandEntry } from '../schemas/demand.ts'
import type { ItemFunction, SiStyle } from '../enums.ts'
import type { Space } from '../schemas/space.ts'
import type { GeneratedStrategy } from './planner.ts'
import { LayoutSchema, validateLayout } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { obbGap, placedBox } from '../geometry/index.ts'
const roleName: Partial<Record<ItemFunction, RegExp>> = {
  cashier: /收银/,
  unboxing_table: /开箱/,
  storage: /储物|储藏/,
  side_cabinet: /配件/,
  accessory_cabinet: /配件/,
  island_table: /中岛/,
  seating: /凳|椅/,
  display_stand: /展示|展柜|展桌/,
}
export function matchDemandAssets(entity: DemandEntry, assets: readonly Asset[], style: SiStyle) {
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
              (entity.dimensions.length ?? entity.dimensions.width ?? 0) / 1000,
          ) <=
            Math.max(
              0.02,
              ((entity.dimensions.length ?? entity.dimensions.width ?? 0) / 1000) * 0.05,
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

/** 有界离散搜索，仅接收类别、数量和尺寸，不接收原家具坐标。 */
export function generateRequired(
  space: Space,
  entities: readonly DemandEntry[],
  assets: readonly Asset[],
  style: SiStyle,
  strategy: GeneratedStrategy = 'area',
) {
  const started = performance.now()
  const xs = space.boundary.map((p) => p[0]),
    zs = space.boundary.map((p) => p[1])
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs)
  const step = Math.max(0.1, (x1 - x0) / 250, (z1 - z0) / 250)
  const expanded = entities.flatMap((e, row) =>
    Array.from({ length: e.quantity }, (_, n) => ({
      ...e,
      id: `demand-${row + 1}-${n + 1}`,
      sourceId: e.id,
    })),
  )
  type Model = {
    id: string | null
    function: ItemFunction
    footprint: { w: number; d: number; h: number }
    placeholder?: boolean
  }
  const models = new Map<string, Model[]>()
  for (const e of expanded) {
    if (models.has(e.sourceId)) continue
    const list: Model[] = matchDemandAssets(e, assets, style).slice(0, 4)
    if (!list.length && e.placeholderFootprint && !e.roles.includes('other'))
      list.push({
        id: null,
        function: e.roles[0]!,
        footprint: e.placeholderFootprint,
        placeholder: true,
      })
    models.set(e.sourceId, list)
  }
  const slots = new Map<string, LayoutItem[]>()
  let checked = 0
  // 防止极端清单占满接口；预算不足如实报告，不扩大空间或缩小模型。
  const budget = 300000
  const pairBudget = 5000000
  let pairChecks = 0
  function positions(model: Model) {
    const key = JSON.stringify([model.id, model.function, model.footprint])
    const cached = slots.get(key)
    if (cached) return cached
    const found: LayoutItem[] = []
    if (model.footprint.h <= space.height) {
      for (const rotation of [0, 90]) {
        const w = rotation ? model.footprint.d : model.footprint.w
        const d = rotation ? model.footprint.w : model.footprint.d
        for (let iz = 0; iz <= 250 && z0 + d + iz * step <= z1 + 1e-8; iz++) {
          for (let ix = 0; ix <= 250 && x0 + w + ix * step <= x1 + 1e-8; ix++) {
            if (checked >= budget) break
            checked++
            const item: LayoutItem = {
              id: 'slot',
              name: '候选',
              assetId: model.id,
              function: model.function,
              cx: x0 + w / 2 + ix * step,
              cz: z0 + d / 2 + iz * step,
              rotation,
              w,
              d,
              h: model.footprint.h,
              placeholder: !!model.placeholder,
              locked: false,
            }
            if (
              validateLayout(space, { schemaVersion: 3, items: [item], planning: null }).some(
                (i) => i.severity === 'error',
              )
            )
              continue
            if (
              space.entrances.some(
                (e) =>
                  Math.min(
                    Math.hypot(item.cx - e.a[0], item.cz - e.a[1]),
                    Math.hypot(item.cx - e.b[0], item.cz - e.b[1]),
                  ) < 0.8,
              )
            )
              continue
            found.push(item)
          }
        }
      }
    }
    const score = (item: LayoutItem) =>
      strategy === 'min'
        ? -item.cx - item.cz
        : strategy === 'max'
          ? item.cx + item.cz
          : item.cz + item.cx * 0.01
    found.sort((a, b) => score(a) - score(b))
    slots.set(key, found)
    return found
  }
  const rank = (e: DemandEntry) =>
    e.roles.includes('cashier')
      ? 0
      : e.roles.includes('unboxing_table')
        ? 1
        : e.roles.includes('island_table')
          ? 2
          : 3
  const area = (e: (typeof expanded)[number]) => {
    const f = models.get(e.sourceId)?.[0]?.footprint
    return f ? f.w * f.d : 0
  }
  const base = [...expanded].sort(
    (a, b) => rank(a) - rank(b) || a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id),
  )
  const orders = [
    base,
    [...base].sort((a, b) => area(b) - area(a) || rank(a) - rank(b)),
    [...base].sort((a, b) => rank(b) - rank(a) || area(b) - area(a)),
    [...base].sort((a, b) => rank(a) - rank(b) || area(b) - area(a)),
    [...base].sort((a, b) => rank(a) - rank(b) || b.sourceId.localeCompare(a.sourceId)),
  ]
  const runs = orders.map((ordered) => {
    const placed: LayoutItem[] = []
    const assignments: {
      sourceId: string
      itemId: string
      assetId: string | null
      roles: ItemFunction[]
      placeholder: boolean
    }[] = []
    const shortages: { id: string; label: string; roles: ItemFunction[]; reason: string }[] = []
    for (const e of ordered) {
      const candidates = models.get(e.sourceId) ?? []
      let chosen: LayoutItem | undefined
      for (const model of candidates) {
        for (const item of positions(model)) {
          if (pairChecks >= pairBudget) break
          const fits = placed.every((p) => {
            pairChecks++
            return pairChecks <= pairBudget && obbGap(placedBox(p), placedBox(item)) >= 0.6 - 1e-8
          })
          if (fits) {
            chosen = item
            break
          }
        }
        if (chosen) break
      }
      if (chosen) {
        const item = { ...chosen, id: e.id, name: e.label }
        placed.push(item)
        assignments.push({
          sourceId: e.sourceId,
          itemId: item.id,
          assetId: item.assetId,
          roles: e.roles,
          placeholder: item.placeholder,
        })
      } else
        shortages.push({
          id: e.sourceId,
          label: e.label,
          roles: e.roles,
          reason: !candidates.length
            ? '缺少对应型号或可靠占位尺寸'
            : checked >= budget || pairChecks >= pairBudget
              ? '搜索预算已用完，需人工排布复核'
              : '有限搜索未找到满足墙体及间距的位置',
        })
    }
    return { placed, assignments, shortages }
  })
  // 必配收银/开箱优先，之后才比较总件数；不以删除要求制造“齐配”。
  const essential = (run: (typeof runs)[number]) =>
    run.assignments.filter((a) => a.roles.includes('cashier') || a.roles.includes('unboxing_table'))
      .length
  runs.sort(
    (a, b) =>
      essential(b) - essential(a) ||
      b.placed.length - a.placed.length ||
      a.placed.filter((i) => i.placeholder).length - b.placed.filter((i) => i.placeholder).length,
  )
  const best = runs[0]!
  const report = entities.map((e) => ({
    id: e.id,
    label: e.label,
    required: e.quantity,
    placed: best.assignments.filter((a) => a.sourceId === e.id).length,
    placeholders: best.assignments.filter((a) => a.sourceId === e.id && a.placeholder).length,
    reason: best.shortages.find((s) => s.id === e.id)?.reason ?? null,
  }))
  const note = `清单${expanded.length}件，已放${best.placed.length}件，其中占位${best.placed.filter((i) => i.placeholder).length}件。0.6米间距为指导值；未验证完整通行网络。`
  const layout = LayoutSchema.parse({
    schemaVersion: 3,
    items: best.placed,
    planning: {
      strategy,
      requested: expanded.length,
      placed: best.placed.length,
      relaxations: [],
      note,
      demand: report,
    },
  })
  return {
    strategy,
    layout,
    issues: validateLayout(space, layout),
    notes: report
      .filter((r) => r.placed < r.required)
      .map((r) => `${r.label}：缺${r.required - r.placed}件，${r.reason}`),
    assignments: best.assignments,
    shortages: best.shortages,
    generationSeconds: (performance.now() - started) / 1000,
    businessApproved: false,
  }
}
