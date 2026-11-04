import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { applySupplement } from './whole-store-supplement.mjs'
import {
  clone,
  initialEntry,
  entryErrors,
  polygonErrors,
  entranceErrors,
  exportWholePack,
  decodeWholePack,
  evaluationPack,
  objectInventory,
  entranceDrawPoints,
  wallAreaPolicy,
  wallPropertyErrors,
} from './whole-store-core.mjs'
const store = {
    id: 'SYN-001',
    image: { width: 1000, height: 1000 },
    objects: [
      {
        id: 'SYN-001-O001',
        label: '组合桌',
        category: 'furniture',
        polygon: [
          [10, 10],
          [20, 10],
          [20, 20],
          [10, 20],
        ],
        sourceDimensions: { length: 1800, attachedSeats: 4 },
        assetId: null,
      },
    ],
    questions: [{ id: 'q', question: '用途' }],
  },
  ref = {
    store_id: store.id,
    status: 'reviewed',
    reviewer: '甲',
    reviewedAt: '2026-01-01',
    boundary: [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ],
    entrances: [
      {
        kind: 'polyline',
        points: [
          [0, 1000],
          [1000, 1000],
        ],
      },
    ],
    entranceReviewVersion: 1,
  }
function fixture() {
  const data = {
    stores: [clone(store)],
    fingerprint: 'f',
    annotationBatch: 'b',
    originalReviewSha256: 'sha',
    originalReviewPack: { annotations: [clone(ref)] },
    referencePack: { annotations: [clone(ref)] },
  }
  return { data, records: { [store.id]: initialEntry(store, ref) } }
}
test('初始新增层不会继承原用户确认', () => {
  const { records } = fixture(),
    r = records[store.id]
  assert.equal(r.status, 'agent_corrected')
  assert.equal(r.entranceStatus, 'partial')
  assert.equal(r.reviewedAt, null)
  assert.deepEqual(entryErrors(r, store), [])
})
test('整包往返完整保留原记录与扩展证据', () => {
  const { data, records } = fixture()
  records[store.id].objects[0].customEvidence = { page: 3 }
  assert.deepEqual(decodeWholePack(exportWholePack(data, records), data), records)
  assert.deepEqual(data.originalReviewPack.annotations[0], ref)
})
test('错来源、错批次、少店、重复店与原记录篡改均拒绝', () => {
  const { data, records } = fixture(),
    p = exportWholePack(data, records)
  for (const edit of [
    (x) => (x.fingerprint = 'x'),
    (x) => (x.annotationBatch = 'x'),
    (x) => (x.originalReviewSha256 = 'x'),
    (x) => (x.entries = []),
    (x) => x.entries.push(x.entries[0]),
    (x) => (x.originalReviewPack.annotations[0].reviewer = '乙'),
  ]) {
    const q = clone(p)
    edit(q)
    assert.throws(() => decodeWholePack(q, data))
  }
})
test('家具确认必须有签名和问题裁决，不影响入口状态', () => {
  const { records } = fixture(),
    r = records[store.id]
  r.status = 'reviewed'
  assert.ok(entryErrors(r, store).length)
  r.reviewedAt = '2026-01-02'
  r.answers.q = '保留'
  assert.deepEqual(entryErrors(r, store), [])
  assert.equal(r.entranceStatus, 'partial')
})
test('部分参照导出最新已描入口，保留原入口且不能自动计完整分', () => {
  const { data, records } = fixture()
  records[store.id].entrances = [
    {
      kind: 'polyline',
      points: [
        [0, 0],
        [500, 0],
      ],
    },
  ]
  const p = evaluationPack(data, records)
  assert.deepEqual(p.annotations[0].entrances, records[store.id].entrances)
  assert.deepEqual(p.annotations[0].originalEntrances, ref.entrances)
  assert.equal(p.annotations[0].entranceReviewVersion, 2)
  assert.equal(p.annotations[0].entranceSemantics, 'observed-current-layout')
  assert.equal(p.annotations[0].entranceReviewedBy, undefined)
  assert.equal(p.annotations[0].entranceCoverage, 'partial')
})
test('显式完整性确认导出全部入口，并保留原入口与原审核', () => {
  const { data, records } = fixture(),
    r = records[store.id]
  r.entrances.push({
    kind: 'arc',
    points: [
      [100, 100],
      [150, 150],
      [200, 100],
    ],
  })
  r.entranceStatus = 'complete'
  r.entranceReviewer = '乙'
  r.entranceReviewedAt = '2026-01-02'
  const p = evaluationPack(data, records)
  assert.equal(p.annotations[0].entrances.length, 2)
  assert.equal(p.annotations[0].entranceReviewVersion, 2)
  assert.equal(p.annotations[0].entranceCoverage, 'complete')
  assert.deepEqual(p.annotations[0].originalEntrances, ref.entrances)
  assert.equal(p.annotations[0].reviewer, '甲')
  assert.deepEqual(data.referencePack.annotations[0], ref)
})
test('缺签名不能伪装完整入口', () => {
  const { data, records } = fixture()
  records[store.id].entranceStatus = 'complete'
  assert.throws(() => evaluationPack(data, records))
})
test('入口用途待定时不能提前完成全集确认', () => {
  const { data, records } = fixture(),
    r = records[store.id]
  data.stores[0].questions[0].question = '是否为顾客入口'
  r.entranceStatus = 'complete'
  r.entranceReviewer = '甲'
  r.entranceReviewedAt = '2026-01-02'
  assert.throws(() => evaluationPack(data, records))
  r.answers.q = '仅辅助出口'
  assert.equal(evaluationPack(data, records).annotations[0].entranceCoverage, 'complete')
})
test('重合、自交、越界与非有限物体坐标拒绝', () => {
  for (const p of [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [20, 20],
      [0, 20],
      [20, 0],
    ],
    [
      [0, 0],
      [20, 0],
      [20, 0],
      [0, 20],
    ],
    [
      [0, 0],
      [2000, 0],
      [0, 20],
    ],
    [
      [0, 0],
      [NaN, 0],
      [0, 20],
    ],
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [10, 0],
      [0, 20],
    ],
  ])
    assert.ok(polygonErrors(p, store.image).length)
})
test('入口弧线格式、共线与重复点拒绝', () => {
  for (const paths of [
    [],
    [
      {
        kind: 'arc',
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
    ],
    [
      {
        kind: 'arc',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
    ],
    [
      {
        kind: 'polyline',
        points: [
          [0, 0],
          [0, 0],
        ],
      },
    ],
    [
      {
        kind: 'polyline',
        points: [
          [0, 0],
          [Infinity, 0],
        ],
      },
    ],
  ])
    assert.ok(entranceErrors(paths, store.image).length)
})
test('圆弧显示包含三点指定的一侧，端点不变', () => {
  const p = entranceDrawPoints({
    kind: 'arc',
    points: [
      [100, 100],
      [150, 150],
      [200, 100],
    ],
  })
  assert.ok(Math.abs(p[0][0] - 100) < 1e-8)
  assert.ok(Math.abs(p.at(-1)[0] - 200) < 1e-8)
  assert.ok(p.some((q) => q[1] > 149))
})
test('附属座位不重复计独立物体，未知资产不补造', () => {
  const { records } = fixture(),
    bom = objectInventory(records[store.id])
  assert.equal(bom.length, 1)
  assert.equal(bom[0].quantity, 1)
  assert.equal(bom[0].attachedSeats, 4)
  assert.equal(bom[0].assetId, null)
})
test('导入拒绝可注入属性的物体编号和缺失尺寸记录', () => {
  const { data, records } = fixture(),
    p = exportWholePack(data, records)
  p.entries[0].objects[0].id = 'x" onclick="alert(1)'
  assert.throws(() => decodeWholePack(p, data))
  p.entries[0].objects[0].id = 'O1'
  delete p.entries[0].objects[0].sourceDimensions
  assert.throws(() => decodeWholePack(p, data))
})
test('离线页面可编译且禁止外发与自动接口', async () => {
  const html = await readFile(new URL('./whole-store-template.html', import.meta.url), 'utf8'),
    core = (await readFile(new URL('./whole-store-core.mjs', import.meta.url), 'utf8')).replace(
      /^export /gm,
      '',
    )
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('/*CORE*/', () => core)
  new vm.Script(script)
  assert.match(html, /connect-src 'none'/)
  assert.doesNotMatch(script, /\bfetch\(|XMLHttpRequest|WebSocket/)
  for (const id of ['undo', 'redo', 'cancel', 'approveObjects', 'approveEntrance', 'questionsTab'])
    assert.match(html, new RegExp('id="' + id + '"'))
})

test('空实与新旧独立，后加实心墙也只避让，未知不猜扣面积', () => {
  assert.equal(
    wallAreaPolicy({ phase: 'added', solidity: 'solid', role: 'partition' }),
    'avoid-only',
  )
  assert.equal(
    wallAreaPolicy({ phase: 'existing', solidity: 'unknown', role: 'core' }),
    'deduct-core',
  )
  assert.equal(wallAreaPolicy({ phase: 'unknown', solidity: 'solid', role: 'core' }), 'unknown')
  assert.equal(
    wallAreaPolicy({ phase: 'existing', solidity: 'hollow', role: 'cladding' }),
    'unknown',
  )
})
test('包墙关联、判断依据校验及整包往返', () => {
  const { data, records } = fixture(),
    r = records[store.id],
    core = r.objects[0]
  core.category = 'column'
  const cover = {
    ...clone(core),
    id: 'COVER',
    category: 'cladding',
    wallProperties: {
      phase: 'added',
      solidity: 'unknown',
      role: 'cladding',
      wrapsObjectId: core.id,
      evidence: '原图标包柱',
    },
  }
  r.objects.push(cover)
  assert.deepEqual(entryErrors(r, store), [])
  assert.deepEqual(decodeWholePack(exportWholePack(data, records), data), records)
  cover.wallProperties.wrapsObjectId = 'MISSING'
  assert.ok(wallPropertyErrors(cover, r.objects).length)
  cover.wallProperties.wrapsObjectId = cover.id
  assert.ok(wallPropertyErrors(cover, r.objects).length)
  cover.wallProperties.wrapsObjectId = core.id
  cover.wallProperties.evidence = ''
  assert.ok(wallPropertyErrors(cover, r.objects).length)
})

test('增补保留前轮整包和用户坐标，只重开增补门店，隔离旧批次', () => {
  const { data, records } = fixture(),
    r = records[store.id]
  r.status = 'reviewed'
  r.reviewer = '甲'
  r.reviewedAt = '2026-01-01'
  r.answers.q = '保留'
  const pack = clone(exportWholePack(data, records)),
    before = clone(pack)
  const supplement = {
    schemaVersion: 1,
    reviewSha256: 'sha',
    stores: [
      {
        id: store.id,
        objects: [],
        questions: [{ id: 'new', question: '墙体空实', options: ['待定'], recommendation: '待定' }],
      },
    ],
  }
  const next = applySupplement(data, pack, supplement, 'sha')
  assert.deepEqual(pack, before)
  assert.deepEqual(next.priorWholeReviewPack, before)
  assert.deepEqual(next.initialRecords[store.id].entrances, r.entrances)
  assert.deepEqual(next.initialRecords[store.id].objects, r.objects)
  assert.equal(next.initialRecords[store.id].status, 'agent_corrected')
  assert.equal(next.initialRecords[store.id].answers.q, '保留')
  assert.throws(() => decodeWholePack(pack, next))
  assert.deepEqual(
    decodeWholePack(exportWholePack(next, next.initialRecords), next),
    next.initialRecords,
  )
  const empty = applySupplement(data, pack, { ...supplement, stores: [] }, 'sha')
  assert.equal(empty.initialRecords[store.id].status, 'reviewed')
  assert.throws(() => applySupplement(data, pack, supplement, 'wrong'))
  supplement.stores[0].objects = [clone(r.objects[0])]
  assert.throws(() => applySupplement(data, pack, supplement, 'sha'))
})
