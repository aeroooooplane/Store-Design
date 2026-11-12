import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triangles, clippedObstacle, adapt, assertIsolation, projectFor } from './core.mjs'
import { polygonArea, polygonInsidePolygon } from '../../packages/shared/src/geometry/index.ts'
const rect = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
test('凹形与反向多边形分解保持面积，不填平凹口', () => {
  const p = [
    [0, 0],
    [6, 0],
    [6, 2],
    [2, 2],
    [2, 5],
    [0, 5],
  ]
  for (const ring of [p, [...p].reverse()]) {
    const ts = triangles(ring)
    assert.ok(Math.abs(ts.reduce((n, t) => n + polygonArea(t), 0) - 18) < 1e-8)
    assert.ok(ts.every((t) => polygonInsidePolygon(t, p)))
  }
})
test('跨界柱仅转换店内相交部分，原始几何不变', () => {
  const p = [
      [-1, 1],
      [1, 1],
      [1, 3],
      [-1, 3],
    ],
    before = JSON.stringify(p),
    parts = clippedObstacle(p, rect)
  assert.ok(parts.every((t) => polygonInsidePolygon(t, rect)))
  assert.ok(Math.abs(parts.reduce((n, t) => n + polygonArea(t), 0) - 2) < 1e-8)
  assert.equal(JSON.stringify(p), before)
  assert.deepEqual(
    clippedObstacle(
      [
        [8, 8],
        [9, 8],
        [9, 9],
        [8, 9],
      ],
      rect,
    ),
    [],
  )
})
test('凹形障碍与边界相交的片段无缺面积', () => {
  const p = [
      [-1, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [-1, 3],
    ],
    pieces = clippedObstacle(p, rect)
  assert.ok(Math.abs(pieces.reduce((n, t) => n + polygonArea(t), 0) - 5) < 1e-8)
})
const input = () => ({
  storeId: 'D',
  status: 'reviewed',
  reviewer: '审核人',
  reviewedAt: '2026-11-12',
  answers: { old: '已回答' },
  mmPerPixel: 1000,
  originPx: [0, 0],
  boundaryPx: rect,
  entrances: [
    {
      points: [
        [0, 4],
        [6, 4],
      ],
    },
  ],
  originalApprovedReference: { sourceSha256: 'a'.repeat(64) },
  objects: [
    {
      id: 'table',
      label: '中岛桌',
      category: 'furniture',
      polygon: [
        [1, 1],
        [3, 1],
        [3, 2],
        [1, 2],
      ],
      sourceDimensions: { height: 900 },
    },
    {
      id: 'screen',
      label: '内嵌广告机',
      category: 'screen',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 0.1],
        [0, 0.1],
      ],
      sourceDimensions: { height: 900 },
    },
  ],
})
test('中岛开放边独立于原通行路径；原审核不被修改', () => {
  const a = input(),
    before = JSON.stringify(a),
    r = adapt({ id: 'D', name: '店', shopType: '中岛店', si: 'SI1.0' }, a)
  assert.equal(r.space.entrances.length, 0)
  assert.equal(r.space.openEdges.length, 4)
  assert.equal(JSON.stringify(a), before)
  assert.equal(r.trainingEligible, false)
  assert.deepEqual(r.priorReview.answers, a.answers)
})
test('灯箱广告机不生成嵌墙实体；未知高度不补填', () => {
  const a = input()
  a.objects[0].sourceDimensions = {}
  const r = adapt({ id: 'D', name: '店', shopType: '边厅店', si: 'SI1.0' }, a)
  assert.equal(r.reference.items.length, 0)
  assert.equal(r.omitted.length, 2)
})
test('远离边界的入口不静默吸附，阻断并集中提问', () => {
  const a = input()
  a.entrances = [
    {
      points: [
        [1, 2],
        [3, 2],
      ],
    },
  ]
  const r = adapt({ id: 'D', name: '店', shopType: '边厅店', si: 'SI1.0' }, a)
  assert.equal(r.blocked, true)
  assert.equal(r.questions.length, 1)
  assert.throws(() => projectFor(r, [], new Date().toISOString()))
})
test('项目只发布无硬错误的自动候选，不把参考布局当生成结果', () => {
  const r = adapt({ id: 'D', name: '店', shopType: '中岛店', si: 'SI1.0' }, input()),
    layout = r.reference
  const p = projectFor(
    r,
    [
      { strategy: 'area', layout, issues: [] },
      { strategy: 'max', layout, issues: [{ severity: 'error' }] },
    ],
    new Date().toISOString(),
  )
  assert.equal(p.nodes.length, 3)
  assert.equal(p.nodes[1].origin, 'import')
  assert.equal(p.nodes[2].id, 'layout-area')
})
test('验收同店别名或同源PDF一律拒绝进入开发试点', () => {
  const row = (i) => ({
      store_id: 'ID' + i,
      name: '店' + i,
      aliases: [],
      sameStoreKeys: ['key' + i],
      sourceSha256s: [String(i).padStart(64, '0')],
    }),
    acceptance = { kind: 'acceptance', stores: Array.from({ length: 45 }, (_, i) => row(i)) },
    development = {
      kind: 'development',
      stores: Array.from({ length: 48 }, (_, i) => row(i + 100)),
    }
  assertIsolation(['ID100'], acceptance, development)
  development.stores[0].aliases = ['店0']
  assert.throws(() => assertIsolation(['ID100'], acceptance, development))
  development.stores[0].aliases = []
  development.stores[0].sourceSha256s = acceptance.stores[0].sourceSha256s
  assert.throws(() => assertIsolation(['ID100'], acceptance, development))
})

test('批处理拒绝外部API，检查发生在读取标注之前', async () => {
  const { build } = await import('./build.mjs')
  await assert.rejects(build({ api: 'https://example.com/api/v1' }), /本机API/)
})

test('已标注的矮墙高度沿用原值，不展示为默认通高墙', () => {
  const a = input()
  a.objects.push({
    id: 'wall',
    label: '1030矮墙',
    category: 'partition',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 0.1],
      [0, 0.1],
    ],
    sourceDimensions: { height: 1030 },
  })
  const r = adapt({ id: 'D', name: '店', shopType: '中岛店', si: 'SI1.0' }, a)
  assert.equal(r.space.obstacles[0].height, 1.03)
})
