import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewProject } from './raw-project.mjs'
import { scaleCandidates, heightCandidates } from './raw-semantics.mjs'
const raw = {
  width: 1000,
  height: 800,
  inputSha256: 'a'.repeat(64),
  modelSha256: 'b'.repeat(64),
  polygons: [
    {
      points: [
        [100, 100],
        [700, 100],
        [700, 600],
        [100, 600],
      ],
    },
  ],
}
const options = {
  shopType: 'side_hall',
  polygonIndex: 0,
  mmPerPixel: 10,
  heightMm: 3000,
  acknowledgeIncomplete: true,
}
test('没有真实尺度或层高时拒绝导出，不填默认尺寸', () => {
  for (const patch of [
    { mmPerPixel: null },
    { mmPerPixel: NaN },
    { heightMm: 0 },
    { acknowledgeIncomplete: false },
    { polygonIndex: 4 },
  ])
    assert.throws(() => previewProject(raw, { ...options, ...patch }))
})
test('量尺使用两端实际距离，原始候选不变且未知项不冒充识别结果', () => {
  const before = structuredClone(raw),
    r = previewProject(raw, {
      ...options,
      mmPerPixel: null,
      reference: { a: [100, 100], b: [700, 100], lengthMm: 6000 },
    })
  assert.deepEqual(raw, before)
  assert.equal(r.provenance.mmPerPixel, 10)
  assert.equal(r.provenance.automaticComplete, false)
  assert.deepEqual(r.project.nodes[0].space.boundary, [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ])
  assert.equal(r.project.nodes[0].space.calibration.verified, false)
  assert.equal(r.project.nodes[0].layout, null)
  assert.ok(r.provenance.unknown.includes('entrances'))
})
test('越界/零长度参照和自交几何被拒绝', () => {
  for (const ref of [
    { a: [0, 0], b: [0, 0], lengthMm: 1000 },
    { a: [-1, 0], b: [100, 0], lengthMm: 1000 },
  ])
    assert.throws(() => previewProject(raw, { ...options, reference: ref }))
  assert.throws(() =>
    previewProject(
      {
        ...raw,
        polygons: [
          {
            points: [
              [0, 0],
              [600, 500],
              [600, 0],
              [0, 500],
            ],
          },
        ],
      },
      options,
    ),
  )
})
test('不把公区、LOGO、门头高度或OCR平方米当成室内层高', () => {
  const texts = [
    '公区天花高度：3.09m',
    'LOGO高度：350mm',
    '门头高度：2000mm',
    '店铺现有吊顶高度：3㎡',
    '天花高度：2850mm',
    '店铺现有吊顶高度：3300mm',
  ].map((text) => ({ text, x: 0, y: 0, w: 100, h: 20 }))
  assert.deepEqual(
    heightCandidates(texts).map((h) => Math.round(h.metres * 1000)),
    [2850, 3300],
  )
})
test('一处尺寸或重复同一长度不冒充独立比例依据', () => {
  const t = { text: '5000', x: 280, y: 70, w: 40, h: 20 },
    l = { x1: 50, y1: 100, x2: 550, y2: 100 }
  assert.deepEqual(scaleCandidates([t], [l]), [])
  assert.deepEqual(scaleCandidates([t, { ...t, y: 270 }], [l, { ...l, y1: 300, y2: 300 }]), [])
})
test('不同尺寸线一致才输出未确认候选，冲突尺度拒绝', () => {
  const texts = [
      { text: '5000', x: 280, y: 70, w: 40, h: 20 },
      { text: '3000', x: 180, y: 270, w: 40, h: 20 },
    ],
    lines = [
      { x1: 50, y1: 100, x2: 550, y2: 100 },
      { x1: 50, y1: 300, x2: 350, y2: 300 },
    ]
  const c = scaleCandidates(texts, lines)
  assert.equal(c[0].mmPerPixel, 10)
  assert.equal(c[0].verified, false)
  assert.deepEqual(
    scaleCandidates(
      [
        ...texts,
        { text: '6000', x: 180, y: 470, w: 40, h: 20 },
        { text: '10000', x: 280, y: 670, w: 40, h: 20 },
      ],
      [...lines, { x1: 50, y1: 500, x2: 350, y2: 500 }, { x1: 50, y1: 700, x2: 550, y2: 700 }],
    ),
    [],
  )
})

test('门店类型须确认，存在孔洞时不能静默填满', () => {
  assert.throws(() => previewProject(raw, { ...options, shopType: null }))
  assert.throws(() => previewProject({ ...raw, holeCount: 1 }, options))
  const h = previewProject(
    {
      ...raw,
      holeCount: 2,
      holes: [
        [
          [1, 1],
          [2, 1],
          [1, 2],
        ],
      ],
    },
    { ...options, acknowledgeOmittedHoles: true },
  )
  assert.equal(h.provenance.omittedHoleCount, 2)
  assert.ok(h.provenance.omittedHoles)
  const p = previewProject(raw, { ...options, shopType: 'island' })
  assert.equal(p.project.project.shopType, 'island')
  assert.equal(p.provenance.shopTypeSource, 'user')
})
