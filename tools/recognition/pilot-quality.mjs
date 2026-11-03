import { SpaceSchema, validateSpace } from '../../packages/shared/src/schemas/space.ts'
import {
  LayoutSchema,
  validateLayout,
  checkAssetFit,
  itemCorners,
} from '../../packages/shared/src/schemas/layout.ts'
import { jsonSha256 } from './pilot-contract.mjs'
export { itemCorners }
export function quality(plan, bom, input, sample, manifest, assets) {
  const issues = [],
    add = (code, message) => issues.push({ severity: 'error', code, message })
  if (
    plan.contract !== 'store-pilot/1' ||
    plan.schemaVersion !== 1 ||
    plan.store_id !== sample.store_id ||
    plan.manifestSha256 !== jsonSha256(manifest) ||
    plan.handoffSha256 !== input.handoffSha256
  )
    add('identity', '校正包身份/输入版本不符')
  if (plan.si !== sample.si || !['SI1.0', 'SI2.0'].includes(plan.si))
    add('si', 'SI未知或与冻结名单不一致')
  if (
    plan.versions?.modelsVersion !== manifest.modelsVersion ||
    plan.versions?.resourceLockSha256 !== manifest.resourceLockSha256
  )
    add('resources', '校正包资源版本不符')
  const sp = SpaceSchema.safeParse(plan.space),
    ly = LayoutSchema.safeParse(plan.layout)
  if (!sp.success) add('space_schema', sp.error.message)
  if (!ly.success) add('layout_schema', ly.error.message)
  // Zod默认剥离旧档案字段；保留原JSON并阻止把这种转换报告成无损。
  function checkKeys(raw, parsed, where) {
    if (!raw || typeof raw !== 'object') return
    for (const key of Object.keys(raw)) {
      if (!Object.hasOwn(parsed ?? {}, key))
        add('unmapped_field', '未映射字段：' + where + '.' + key)
      else checkKeys(raw[key], parsed[key], where + '.' + key)
    }
  }
  if (sp.success) checkKeys(plan.space, sp.data, 'space')
  if (ly.success) checkKeys(plan.layout, ly.data, 'layout')
  if (sp.success) issues.push(...validateSpace(sp.data))
  if (sp.success && ly.success) issues.push(...validateLayout(sp.data, ly.data, assets))
  if (ly.success) issues.push(...checkAssetFit(ly.data, assets))
  const t = plan.transform,
    c = input.h.dimensions.find((d) => d.id === t?.calibrationId && d.role === 'calibration')
  let independentChecks = []
  if (
    !t ||
    !Number.isFinite(t.mmPerPixel) ||
    t.mmPerPixel <= 0 ||
    t.originPx?.length !== 2 ||
    !t.originPx.every(Number.isFinite) ||
    !c
  )
    add('scale', '缺有效定标与原点')
  else {
    const length = (d) =>
      Math.hypot(d.pointsPx[1][0] - d.pointsPx[0][0], d.pointsPx[1][1] - d.pointsPx[0][1])
    if (Math.abs((length(c) * t.mmPerPixel) / c.lengthMm - 1) > 0.0001)
      add('scale_mismatch', '比例与所引用原尺寸不一致')
    const samePoints = (a, b) => a.every((p, i) => p.every((v, k) => v === b[i][k]))
    const checks = input.h.dimensions.filter(
      (d) =>
        d.role === 'independent-check' &&
        !samePoints(d.pointsPx, c.pointsPx) &&
        !samePoints([...d.pointsPx].reverse(), c.pointsPx),
    )
    if (!checks.length) add('independent_dimension', '缺未参与定标的独立尺寸；不能批准比例')
    independentChecks = checks.map((d) => ({
      id: d.id,
      error: Math.abs((length(d) * t.mmPerPixel) / d.lengthMm - 1),
    }))
    if (independentChecks.some((d) => d.error > 0.01)) add('dimension_error', '独立尺寸误差超过1%')
  }
  if (!Array.isArray(plan.unresolved)) add('unresolved_missing', '缺显式歧义列表')
  for (const q of plan.unresolved ?? []) {
    if (
      !q.id ||
      !q.question ||
      !Array.isArray(q.options) ||
      q.options.length < 2 ||
      !q.recommendation ||
      !q.evidencePath ||
      q.regionPx?.length !== 4
    )
      add('conflict_format', '歧义须有问题、选项、推荐和原图局部')
    add('unresolved', q.question ?? '未解决歧义')
  }
  for (const missing of input.missing) add('input_missing', missing)
  const observations = new Set(input.evidence.observations.map((e) => e.id))
  const backed = (refs) =>
    Array.isArray(refs) && refs.length > 0 && refs.every((r) => observations.has(r))
  if (!backed(plan.evidence?.boundary)) add('boundary_evidence', '缺边界原图依据')
  if (sp.success) {
    if (!sp.data.entrances.some((e) => e.kind === 'main')) add('main_entrance', '主入口未确定')
    if (!backed(plan.evidence?.entrances)) add('entrance_evidence', '缺入口原图依据')
    if (!backed(plan.evidence?.obstacles))
      add('obstacle_evidence', '须提供柱/管井/后加构件核对依据，无障碍也须说明')
  }
  if (
    !['draft', 'agent_corrected', 'blocked'].includes(plan.review?.status) ||
    plan.review?.userSampled !== false
  )
    add('review_state', '本工具不接收伪装为交叉检查或用户抽审的输入状态')
  if (
    !Array.isArray(plan.review?.history) ||
    !plan.review.history.length ||
    plan.review.history.some(
      (e) => !e.actor || e.role !== 'agent' || !Number.isFinite(Date.parse(e.at)) || !e.reason,
    )
  )
    add('review_history', '缺可追溯代理修改记录，禁止冒充用户角色')
  if (ly.success) {
    const seen = new Set()
    if (bom.store_id !== sample.store_id || !Array.isArray(bom.rows))
      add('bom_schema', 'BOM身份/行结构错误')
    const rowIds = new Set()
    for (const row of bom.rows ?? []) {
      if (!row.id || rowIds.has(row.id)) add('bom_id', 'BOM行编号缺失/重复')
      rowIds.add(row.id)
      if (
        !['件', '组'].includes(row.unit) ||
        !Number.isInteger(row.quantity) ||
        row.quantity < 0 ||
        !Array.isArray(row.itemIds) ||
        !backed(row.sourceRefs)
      )
        add('bom_row', 'BOM单位/数量/实例/原证据不完整')
      const multiplier = row.unit === '组' ? row.componentsPerUnit : 1
      if (
        !Number.isInteger(multiplier) ||
        multiplier < 1 ||
        row.itemIds?.length !== row.quantity * multiplier
      )
        add('bom_count', 'BOM数量与实例/组合口径不一致')
      for (const id of row.itemIds ?? []) {
        const it = ly.data.items.find((i) => i.id === id)
        if (!it || seen.has(id) || it.assetId !== row.assetId)
          add('bom_instance', 'BOM未知/重复实例或型号不符：' + id)
        seen.add(id)
      }
    }
    for (const it of ly.data.items) {
      if (!seen.has(it.id)) add('bom_omitted', 'BOM遗漏实例：' + it.id)
      if (!it.assetId || it.placeholder || !assets.has(it.assetId))
        add('unknown_asset', '未知型号不强配：' + it.id)
      if (assets.get(it.assetId)?.retired)
        add('retired_asset', '使用停用型号，需另行裁决：' + it.id)
      if (!backed(plan.evidence?.items?.[it.id]))
        add('item_evidence', '缺位置/尺寸/朝向/型号原图依据：' + it.id)
    }
  }
  return {
    schemaVersion: 1,
    store_id: sample.store_id,
    status: issues.some((i) => i.severity === 'error') ? 'blocked' : 'needs_cross_check',
    automaticChecksPassed: !issues.some((i) => i.severity === 'error'),
    issues,
    independentChecks,
    trainingEligible: false,
    userSampled: false,
    manualChecksPending: [
      '原图边界/入口/障碍/道具逐件交叉核对',
      '原BOM与规范化计数映射核对',
      '隔离编辑器保存重载及导出无损',
      '用户实际抽审/歧义裁决',
    ],
    space: sp.success ? sp.data : null,
    layout: ly.success ? ly.data : null,
  }
}
