import test from 'node:test'
import assert from 'node:assert/strict'
import { reviseSpace, rolesFor, inventory, generateRequired, matchAssets } from './requirements.mjs'
const space = {
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [8, 0],
    [8, 8],
    [0, 8],
  ],
  height: 3,
  entrances: [],
  openEdges: [],
  obstacles: [],
}
const asset = {
  id: 'asset-1',
  name: '收银台',
  standardName: '收银台',
  siFamily: 'SI1.0',
  placeable: true,
  retired: false,
  function: 'cashier',
  installation: 'floor',
  footprint: { w: 1.8, d: 0.6, h: 0.9 },
}
test('组合台一件多功能，座位参考不重复算独立实体', () => {
  const r = inventory({
    objects: [
      {
        id: 'a',
        category: 'furniture',
        label: '收银开箱储物组合',
        sourceDimensions: { attachedSeats: 4 },
      },
    ],
    reference: { items: [] },
  })
  assert.equal(r.physicalCount, 1)
  assert.deepEqual(r.roleCounts, { cashier: 1, unboxing_table: 1, storage: 1 })
  assert.equal(r.attachedSeatReferences, 4)
})
test('只筛查家具，灯箱墙不算道具', () =>
  assert.equal(
    inventory({
      objects: [{ category: 'partition', label: '开箱桌后墙' }],
      reference: { items: [] },
    }).physicalCount,
    0,
  ))
test('中岛无实体墙也能排收银台', () => {
  const c = generateRequired(
    space,
    [{ id: 'a', label: '收银台', roles: ['cashier'], dimensions: {} }],
    [asset],
    'SI1.0',
  )
  assert.equal(c.layout.items.length, 1)
  assert.equal(c.shortages.length, 0)
  assert.equal(c.issues.length, 0)
})
test('整空间障碍会报告缺配，不能生成穿墙物体', () => {
  const c = generateRequired(
    {
      ...space,
      obstacles: [{ kind: 'fixed', polygon: space.boundary, height: null, label: '满场墙' }],
    },
    [{ id: 'a', label: '收银台', roles: ['cashier'], dimensions: {} }],
    [asset],
    'SI1.0',
  )
  assert.equal(c.layout.items.length, 0)
  assert.equal(c.shortages.length, 1)
})
test('无模型的多功能台不冒用单收银模型', () =>
  assert.deepEqual(
    matchAssets({ roles: ['cashier', 'unboxing_table'], dimensions: {} }, [asset], 'SI1.0'),
    [],
  ))
test('保留真实模型尺寸；不读原图位置', () => {
  const e = {
    id: 'a',
    label: '收银台',
    roles: ['cashier'],
    dimensions: { length: 1800 },
    cx: 999,
    cz: 999,
  }
  const c = generateRequired(space, [e], [asset], 'SI1.0')
  assert.equal(c.layout.items[0].w, 1.8)
  assert.notEqual(c.layout.items[0].cx, 999)
})
test('占位必须来源已知三维尺寸并明确标记', () => {
  const c = generateRequired(
    space,
    [
      {
        id: 'a',
        label: '组合台',
        roles: ['cashier', 'unboxing_table'],
        dimensions: {},
        placeholderFootprint: { w: 1.8, d: 0.6, h: 0.9 },
      },
    ],
    [],
    'SI1.0',
  )
  assert.equal(c.layout.items[0].placeholder, true)
  assert.equal(c.layout.items[0].assetId, null)
  assert.equal(c.assignments[0].roles.length, 2)
})
test('整组凳子不能拿来补单凳数量', () =>
  assert.equal(
    matchAssets(
      { roles: ['seating'], dimensions: {} },
      [{ ...asset, function: 'seating', footprint: { w: 1.3, d: 1.3, h: 0.35 } }],
      'SI1.0',
    ).length,
    0,
  ))
test('未知道具不能映射到任意other类模型', () =>
  assert.equal(
    matchAssets({ roles: ['other'], dimensions: {} }, [{ ...asset, function: 'other' }], 'SI1.0')
      .length,
    0,
  ))
test('凳、展示台、边柜分类保留', () => {
  assert.deepEqual(rolesFor('子母凳-1'), ['seating'])
  assert.deepEqual(rolesFor('配件边柜'), ['side_cabinet'])
  assert.deepEqual(rolesFor('方形展桌'), ['display_stand'])
})
test('补墙与禁放分层，矮墙高度沿用，原空间不改写', () => {
  const row = {
    id: 'DEV-A',
    space: structuredClone(space),
    image: { width: 1000, height: 1000 },
    originPx: [0, 0],
    mmPerPixel: 10,
    imageHash: 'test',
  }
  const before = JSON.stringify(row)
  const result = reviseSpace(row, 0, {
    walls: [
      [
        [300, 300],
        [400, 300],
        [400, 400],
        [300, 400],
      ],
    ],
    heightsMm: { 0: 1100 },
    keepouts: [
      [
        [500, 300],
        [600, 300],
        [600, 400],
        [500, 400],
      ],
    ],
    note: '合成图',
  })
  assert.equal(JSON.stringify(row), before)
  assert.equal(result.space.obstacles[0].height, 1.1)
  assert.equal(result.space.obstacles[1].height, 0.001)
  assert.equal(result.additions[1].category, 'no-placement-zone')
  assert.equal(result.businessApproved, false)
})

test('900毫米收银不能静默换成1800毫米', () =>
  assert.equal(
    matchAssets({ roles: ['cashier'], dimensions: { length: 900 } }, [asset], 'SI1.0').length,
    0,
  ))
