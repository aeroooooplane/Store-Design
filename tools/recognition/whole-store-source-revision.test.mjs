import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySourceRevision } from './whole-store-source-revision.mjs'
import {
  clone,
  exportWholePack,
  decodeWholePack,
  evaluationPack,
  initialEntry,
} from './whole-store-core.mjs'
function fixture() {
  const boundary = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ]
  const object = {
    id: 'S-O1',
    label: '原柜',
    category: 'furniture',
    polygon: [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ],
    sourceDimensions: { length: 100 },
    assetId: null,
  }
  const store = {
    id: 'S',
    page: 1,
    image: { width: 100, height: 100, sha256: 'image' },
    boundary,
    objects: [object],
    notes: [],
    questions: [{ id: 'lease', question: '范围' }],
  }
  const ref = {
    store_id: 'S',
    sourceSha256: 'source',
    status: 'reviewed',
    reviewer: '甲',
    reviewedAt: '2026-01-01',
    boundary,
    entrances: [
      {
        kind: 'polyline',
        points: [
          [0, 100],
          [100, 100],
        ],
      },
    ],
  }
  const data = {
    datasetId: 'synthetic',
    stores: [store],
    fingerprint: 'f',
    annotationBatch: 'b',
    originalReviewSha256: 'original',
    originalReviewPack: { annotations: [clone(ref)] },
    referencePack: { annotations: [clone(ref)] },
  }
  const r = initialEntry(store, ref)
  r.status = 'reviewed'
  r.reviewedAt = '2026-01-02'
  r.answers.lease = '已增租'
  const pack = exportWholePack(data, { S: r })
  const spec = {
    schemaVersion: 1,
    reviewSha256: 'review',
    evidence: [
      {
        id: 'e',
        storeId: 'S',
        sourceSha256: 'source',
        page: 1,
        path: 'S/page-1.png',
        sha256: 'a'.repeat(64),
      },
    ],
    stores: [
      {
        id: 'S',
        reason: '按原图补注',
        evidenceIds: ['e'],
        updates: [{ id: 'S-O1', set: { label: '原柜（利旧）', sourceAllocation: 'reused' } }],
        additions: [
          {
            ...clone(object),
            id: 'S-W1',
            label: '新增墙',
            category: 'partition',
            source: { sourceSha256: 'source', imageSha256: 'image', page: 1 },
          },
        ],
        questions: [
          { id: 'detail', question: '名称？', options: ['待补'], recommendation: '待补' },
        ],
        boundary: {
          before: clone(boundary),
          after: [
            [0, 0],
            [90, 0],
            [100, 100],
            [0, 100],
          ],
          userDecision: { questionId: 'lease', answer: '已增租' },
        },
      },
    ],
  }
  return { data, pack, spec }
}
test('原图修订完整保留审核、坐标与答复，新增层不继承签核', () => {
  const { data, pack, spec } = fixture(),
    before = clone({ data, pack, spec }),
    next = applySourceRevision(data, pack, spec, 'review')
  assert.deepEqual({ data, pack, spec }, before)
  assert.deepEqual(next.sourceRevision.sourcePack, pack)
  assert.deepEqual(next.initialRecords.S.objects[0].polygon, pack.entries[0].objects[0].polygon)
  assert.deepEqual(next.initialRecords.S.entrances, pack.entries[0].entrances)
  assert.deepEqual(next.initialRecords.S.answers, pack.entries[0].answers)
  assert.equal(next.initialRecords.S.reviewedAt, null)
  assert.equal(next.initialRecords.S.status, 'agent_corrected')
  assert.deepEqual(
    decodeWholePack(exportWholePack(next, next.initialRecords), next),
    next.initialRecords,
  )
  const ref = evaluationPack(next, next.initialRecords).annotations[0]
  assert.deepEqual(ref.originalBoundary, data.stores[0].boundary)
  assert.deepEqual(ref.boundary, spec.stores[0].boundary.after)
  assert.equal(ref.boundaryRevision.status, 'agent-verified-from-user-decision')
  assert.equal(ref.entranceCoverage, 'partial')
})
const badCases = {
  来源摘要: (s) => (s.reviewSha256 = 'wrong'),
  跨店证据: (s) => (s.evidence[0].storeId = 'OTHER'),
  证据源图: (s) => (s.evidence[0].sourceSha256 = 'wrong'),
  证据路径: (s) => (s.evidence[0].path = '../secret.png'),
  缺少依据: (s) => (s.stores[0].evidenceIds = []),
  原物体几何: (s) =>
    (s.stores[0].updates[0].set.polygon = [
      [0, 0],
      [1, 1],
      [2, 2],
    ]),
  无效来源分类: (s) => (s.stores[0].updates[0].set.sourceAllocation = 'invented'),
  重复物体: (s) => (s.stores[0].additions[0].id = 'S-O1'),
  新增物体错页: (s) => (s.stores[0].additions[0].source.page = 2),
  新增物体自交: (s) =>
    (s.stores[0].additions[0].polygon = [
      [0, 0],
      [50, 50],
      [0, 50],
      [50, 0],
    ]),
  重复问题: (s) => (s.stores[0].questions[0].id = 'lease'),
  边界旧坐标: (s) => (s.stores[0].boundary.before[0][0] = 5),
  边界越界: (s) => (s.stores[0].boundary.after[0][0] = -1),
  伪造答复: (s) => (s.stores[0].boundary.userDecision.answer = '不同意'),
}
for (const [name, edit] of Object.entries(badCases))
  test('拒绝' + name, () => {
    const { data, pack, spec } = fixture()
    edit(spec)
    assert.throws(() => applySourceRevision(data, pack, spec, 'review'))
  })
test('拒绝旧轮审核包与原图修订记录篡改', () => {
  const { data, pack, spec } = fixture(),
    next = applySourceRevision(data, pack, spec, 'review'),
    out = exportWholePack(next, next.initialRecords)
  assert.throws(() => decodeWholePack(pack, next))
  out.sourceRevision.sourcePack.entries[0].reviewer = '伪造'
  assert.throws(() => decodeWholePack(out, next))
})

for (const reviseAgain of [false, true])
  test('连续原图修订保留边界及历次来源 ' + reviseAgain, () => {
    const { data, pack, spec } = fixture(),
      one = applySourceRevision(data, pack, spec, 'review'),
      nextSpec = clone(spec)
    nextSpec.stores[0].additions = []
    nextSpec.stores[0].questions = []
    if (reviseAgain) {
      nextSpec.stores[0].boundary.before = clone(one.stores[0].boundary)
      nextSpec.stores[0].boundary.after = [
        [0, 0],
        [95, 0],
        [100, 100],
        [0, 100],
      ]
    } else delete nextSpec.stores[0].boundary
    const two = applySourceRevision(
        one,
        exportWholePack(one, one.initialRecords),
        nextSpec,
        'review',
      ),
      ref = evaluationPack(two, two.initialRecords).annotations[0]
    assert.deepEqual(ref.originalBoundary, data.stores[0].boundary)
    assert.deepEqual(ref.boundary, two.stores[0].boundary)
    assert.deepEqual(ref.boundaryRevision.before, ref.originalBoundary)
    assert.deepEqual(ref.boundaryRevision.after, ref.boundary)
    assert.deepEqual(two.sourceRevision.sourcePack.sourceRevision, one.sourceRevision)
  })
