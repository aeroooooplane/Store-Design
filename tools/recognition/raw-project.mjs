import assert from 'node:assert/strict'
import { ProjectExportSchema } from '../../packages/shared/src/schemas/exchange.ts'
import { SpaceSchema, validateSpace } from '../../packages/shared/src/schemas/space.ts'

export function previewProject(raw, options, now = new Date().toISOString()) {
  assert.equal(options.acknowledgeIncomplete, true, '必须知晓入口、柱位尚未识别，导出仅为轮廓候选')
  assert.ok(Number.isInteger(options.polygonIndex) && options.polygonIndex >= 0, '必须选择候选区域')
  const polygon = raw.polygons[options.polygonIndex]?.points
  assert.ok(polygon && polygon.length >= 3 && polygon.length <= 200, '候选顶点数不满足工作台要求')
  let ratio = options.mmPerPixel
  if (options.reference) {
    const { a, b, lengthMm } = options.reference
    assert.ok(
      [a, b].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)),
      '量尺点无效',
    )
    assert.ok(
      [a, b].every((p) => p[0] >= 0 && p[1] >= 0 && p[0] <= raw.width && p[1] <= raw.height),
      '量尺点超出图片',
    )
    const pixels = Math.hypot(a[0] - b[0], a[1] - b[1])
    assert.ok(pixels >= 10 && Number.isFinite(lengthMm) && lengthMm > 0, '参考长度不足')
    ratio = lengthMm / pixels
  }
  assert.ok(Number.isFinite(ratio) && ratio > 0 && ratio < 1000, '缺少有效比例，不能猜测真实尺寸')
  assert.ok(
    Number.isFinite(options.heightMm) && options.heightMm >= 1500 && options.heightMm <= 20000,
    '缺少有效层高',
  )
  assert.ok(['side_hall', 'island'].includes(options.shopType), '必须确认门店类型；模型尚未判定')
  assert.ok(
    !(raw.holeCount > 0) || options.acknowledgeOmittedHoles === true,
    '存在内部孔洞，须明确允许仅预览外轮廓；孔洞不会带入三维',
  )
  const origin = [Math.min(...polygon.map((p) => p[0])), Math.min(...polygon.map((p) => p[1]))]
  const space = SpaceSchema.parse({
    schemaVersion: 1,
    boundary: polygon.map((p) => p.map((n, i) => Math.round((n - origin[i]) * ratio) / 1000)),
    height: options.heightMm / 1000,
    entrances: [],
    openEdges: [],
    obstacles: [],
    calibration: {
      method: options.reference ? 'manual' : 'dimension',
      reference: '本地位图候选比例；入口、柱位未识别，只供形状预览',
      verified: false,
    },
  })
  const errors = validateSpace(space).filter((i) => i.severity === 'error')
  assert.deepEqual(errors, [], '候选几何未通过，需在审核页保留失败而非导入')
  const project = ProjectExportSchema.parse({
    format: 'store-design-project',
    schemaVersion: 1,
    exportedAt: now,
    project: {
      name: '原图自动轮廓候选 · 入口柱位未识别',
      shopType: options.shopType,
      market: 'domestic',
      siStyle: 'SI2.0',
    },
    nodes: [
      {
        id: 'raw-candidate',
        parentId: null,
        kind: 'space',
        name: '轮廓预览 · 非完整门店',
        space,
        layout: null,
        strategy: null,
        siStyle: null,
        origin: 'recognition',
        importedFrom: null,
        hidden: false,
      },
    ],
    draft: null,
  })
  return {
    project,
    provenance: {
      inputSha256: raw.inputSha256,
      modelSha256: raw.modelSha256,
      polygonIndex: options.polygonIndex,
      mmPerPixel: ratio,
      reference: options.reference ?? null,
      heightMm: options.heightMm,
      shopType: options.shopType,
      shopTypeSource: 'user',
      omittedHoleCount: raw.holeCount ?? 0,
      omittedHoles: raw.holes ?? null,
      automaticComplete: false,
      outlineReviewed: false,
      unknown: ['entrances', 'columns', 'walls', 'furniture'],
      notes: [
        '空入口/障碍数组只是原生格式的占位，绝不代表原图无入口或柱子。',
        '三维会按未开口的壳体显示；不能作为完整门店或施工结果。',
      ],
      createdAt: now,
    },
  }
}
