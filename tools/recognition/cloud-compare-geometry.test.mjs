import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectGeometry } from './cloud-compare-geometry.mjs'
const size = { width: 1000, height: 1000 }
const base = {
  regions: [
    {
      points: [
        [100, 100],
        [700, 100],
        [700, 700],
        [100, 700],
        [100, 100],
      ],
    },
  ],
  entrances: [
    {
      path: [
        [200, 700],
        [600, 700],
      ],
    },
  ],
  obstacles: [],
  dimensions: [
    { text: '6000', mm: 6000, start: [100, 80], end: [700, 80] },
    { text: '3000', mm: 3000, start: [80, 100], end: [80, 400] },
  ],
  ceilingHeight: 3000,
}
test('闭环重复首点仅去重表示，合理比例仍不冒充人工确认', () => {
  const r = inspectGeometry(base, size)
  assert.equal(r.geometryChecksPassed, true)
  assert.equal(r.automaticComplete, false)
  assert.equal(r.canAutoImport, false)
  assert.equal(r.scaleCandidate.verified, false)
})
test('沿相邻两边的折线入口通过，向内或跨店直线被拦截', () => {
  const good = {
    ...base,
    entrances: [
      {
        path: [
          [500, 100],
          [700, 100],
          [700, 300],
        ],
      },
    ],
  }
  assert.equal(inspectGeometry(good, size).geometryChecksPassed, true)
  for (const path of [
    [
      [500, 100],
      [500, 200],
    ],
    [
      [100, 400],
      [700, 400],
    ],
  ])
    assert.ok(
      inspectGeometry({ ...base, entrances: [{ path }] }, size).issues.some(
        (x) => x.code === 'entrance-off-boundary',
      ),
    )
})
test('面积不当长度、冲突比例不取多数掩盖', () => {
  const bad = {
    ...base,
    dimensions: [
      ...base.dimensions,
      { text: '4.2m²', mm: 4200, start: [0, 0], end: [30, 0] },
      { text: '5000', mm: 5000, start: [100, 80], end: [300, 80] },
    ],
  }
  const codes = inspectGeometry(bad, size).issues.map((i) => i.code)
  assert.ok(codes.includes('area-as-length'))
  assert.ok(codes.includes('conflicting-scale'))
})
test('越界与自交轮廓、未知层高阻断', () => {
  for (const points of [
    [
      [0, 0],
      [1500, 0],
      [500, 500],
    ],
    [
      [0, 0],
      [600, 600],
      [600, 0],
      [0, 600],
    ],
  ])
    assert.equal(inspectGeometry({ ...base, regions: [{ points }] }, size).canAutoImport, false)
  assert.ok(
    inspectGeometry({ ...base, ceilingHeight: null }, size).issues.some(
      (i) => i.code === 'height-unresolved',
    ),
  )
})
