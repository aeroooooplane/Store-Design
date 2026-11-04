import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clone,
  initialEntry,
  exportWholePack,
  decodeWholePack,
  exportWholeDraft,
  decodeWholeDraft,
  wallDrawingStyle,
  wallDrawingObjects,
  wallAssemblyErrors,
  evaluationPack,
  objectInventory,
} from './whole-store-core.mjs'
import { applyWallAssemblies } from './whole-store-wall-assemblies.mjs'
function fixture() {
  const poly = [
      [10, 10],
      [90, 10],
      [90, 20],
      [10, 20],
    ],
    objects = [
      { id: 'S-screen', label: '灯箱', category: 'signage', polygon: poly, sourceDimensions: {} },
      {
        id: 'S-wall',
        label: '墙',
        category: 'partition',
        polygon: poly,
        sourceDimensions: { height: 1000 },
      },
      {
        id: 'S-table',
        label: '利旧',
        category: 'display-prop',
        polygon: poly,
        sourceDimensions: {},
      },
    ]
  const s = {
      id: 'S',
      page: 1,
      image: { width: 100, height: 100, sha256: 'img' },
      objects,
      questions: [{ id: 'type', question: '类别' }],
    },
    ref = {
      store_id: 'S',
      sourceSha256: 'pdf',
      reviewer: '甲',
      reviewedAt: '2026-11-04',
      status: 'reviewed',
      boundary: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      entrances: [
        {
          kind: 'polyline',
          points: [
            [0, 100],
            [100, 100],
          ],
        },
      ],
    },
    data = {
      datasetId: 's',
      fingerprint: 'f',
      annotationBatch: 'b',
      originalReviewSha256: 'orig',
      stores: [s],
      referencePack: { annotations: [ref] },
      originalReviewPack: { annotations: [clone(ref)] },
    }
  const r = initialEntry(s, ref)
  r.status = 'reviewed'
  r.reviewedAt = '2026-11-04'
  r.answers.type = '中岛桌'
  data.initialRecords = { S: r }
  const pack = exportWholePack(data, data.initialRecords),
    spec = {
      schemaVersion: 1,
      reviewSha256: 'sha',
      stores: [
        {
          id: 'S',
          page: 1,
          imageSha256: 'img',
          sourceSha256: 'pdf',
          objects: [
            { id: 'S-wall', representation: 'assembly-envelope', evidence: '原图整体范围' },
            {
              id: 'S-screen',
              installation: { hostObjectId: 'S-wall', planMode: 'embedded' },
              evidence: '原图明确内嵌',
            },
          ],
        },
      ],
      decisions: [
        {
          storeId: 'S',
          objectId: 'S-table',
          questionId: 'type',
          answer: '中岛桌',
          set: { label: '利旧中岛桌', category: 'furniture', sourceAllocation: 'reused' },
        },
      ],
    }
  return { data, pack, spec }
}
test('墙体说明与贴面策略不改变用户几何、签名、入口与源包', () => {
  const { data, pack, spec } = fixture(),
    before = clone({ data, pack, spec }),
    next = applyWallAssemblies(data, pack, spec, 'sha'),
    r = next.initialRecords.S
  assert.deepEqual({ data, pack, spec }, before)
  assert.deepEqual(next.wallAssemblySourcePack, pack)
  assert.deepEqual(
    r.objects.map((o) => o.polygon),
    pack.entries[0].objects.map((o) => o.polygon),
  )
  assert.deepEqual(r.entrances, pack.entries[0].entrances)
  assert.equal(r.status, 'reviewed')
  assert.equal(r.reviewedAt, pack.entries[0].reviewedAt)
  assert.deepEqual(r.answers, pack.entries[0].answers)
  assert.equal(r.objects[2].category, 'furniture')
  assert.equal(r.objects[2].sourceAllocation, 'reused')
  assert.equal(r.objects[0].wallInstallation.display3d, 'wall-surface')
  assert.equal(r.objects[0].wallInstallation.cutWall, false)
  assert.equal(r.objects[0].wallInstallation.solidBody, false)
  assert.deepEqual(
    evaluationPack(next, next.initialRecords),
    evaluationPack(data, data.initialRecords),
  )
  assert.deepEqual(
    decodeWholePack(exportWholePack(next, next.initialRecords), next),
    next.initialRecords,
  )
  const inventory = objectInventory(r)
  assert.equal(inventory[1].cutForEmbedded, false)
  assert.equal(inventory[0].wallInstallation.solidBody, false)
})
test('墙体先画且无填充，设施始终在上层；原数组顺序不变', () => {
  const { data } = fixture(),
    objects = data.stores[0].objects,
    before = clone(objects)
  assert.deepEqual(
    wallDrawingObjects(objects).map((x) => x.o.id),
    ['S-wall', 'S-screen', 'S-table'],
  )
  assert.deepEqual(objects, before)
  for (const selected of [false, true]) {
    assert.equal(wallDrawingStyle(objects[1], selected).fill, 'none')
    assert.notEqual(wallDrawingStyle(objects[0], selected).fill, 'none')
  }
  assert.equal(
    wallDrawingStyle({ ...objects[1], wallGeometry: { representation: 'plan-wall-band' } }).dash,
    '',
  )
  assert.equal(wallDrawingStyle(objects[1]).dash, '6 4')
})
const bad = {
  错误审核SHA: (s) => (s.reviewSha256 = 'wrong'),
  源图错配: (s) => (s.stores[0].sourceSha256 = 'other'),
  图像错配: (s) => (s.stores[0].imageSha256 = 'other'),
  页码错配: (s) => (s.stores[0].page = 2),
  重复门店: (s) => s.stores.push(clone(s.stores[0])),
  重复物体: (s) => s.stores[0].objects.push(clone(s.stores[0].objects[0])),
  覆盖坐标: (s) => (s.stores[0].objects[0].polygon = []),
  虚构实体类型: (s) => (s.stores[0].objects[0].representation = 'solid'),
  漏依据: (s) => (s.stores[0].objects[0].evidence = ''),
  无效宿主: (s) => (s.stores[0].objects[1].installation.hostObjectId = 'missing'),
  非墙体宿主: (s) => (s.stores[0].objects[1].installation.hostObjectId = 'S-table'),
  强制挖洞: (s) => (s.stores[0].objects[1].installation.cutWall = true),
  虚构安装类别: (s) => (s.stores[0].objects[1].installation.planMode = 'recessed-solid'),
  伪造用户答复: (s) => (s.decisions[0].answer = '不是中岛桌'),
  答复改写几何: (s) => (s.decisions[0].set.polygon = []),
}
for (const [name, edit] of Object.entries(bad))
  test('拒绝' + name, () => {
    const { data, pack, spec } = fixture()
    edit(spec)
    assert.throws(() => applyWallAssemblies(data, pack, spec, 'sha'))
  })
test('导入不能把墙面贴片改成厚实体或挖洞；不能静默丢宿主', () => {
  const { data, pack, spec } = fixture(),
    next = applyWallAssemblies(data, pack, spec, 'sha'),
    p = exportWholePack(next, next.initialRecords)
  for (const edit of [
    (x) => (x.entries[0].objects[0].wallInstallation.cutWall = true),
    (x) => (x.entries[0].objects[0].wallInstallation.solidBody = true),
    (x) => x.entries[0].objects.splice(1, 1),
    (x) => (x.wallAssemblySourcePack.entries[0].reviewer = '乙'),
  ]) {
    const bad = clone(p)
    edit(bad)
    assert.throws(() => decodeWholePack(bad, next))
  }
  assert.throws(() => decodeWholePack(pack, next))
})
test('精简本机草稿保留实际修改，不重复缓存整条审核链；支持旧完整包', () => {
  const { data, pack, spec } = fixture(),
    next = applyWallAssemblies(data, pack, spec, 'sha'),
    records = clone(next.initialRecords)
  records.S.objects[0].label = '已改灯箱'
  const draft = exportWholeDraft(next, records)
  assert.equal(draft.wallAssemblySourcePack, undefined)
  assert.deepEqual(decodeWholeDraft(draft, next), records)
  assert.deepEqual(decodeWholeDraft(exportWholePack(next, records), next), records)
  const bad = clone(draft)
  bad.binding[0] = 'wrong'
  assert.throws(() => decodeWholeDraft(bad, next))
  const duplicate = clone(draft)
  duplicate.entries.push(clone(draft.entries[0]))
  assert.throws(() => decodeWholeDraft(duplicate, next))
})
test('未提供平面安装依据时可记待定，三维仍为贴面', () => {
  const { data, pack, spec } = fixture()
  spec.stores[0].objects[1].installation.planMode = 'unknown'
  const next = applyWallAssemblies(data, pack, spec, 'sha'),
    o = next.initialRecords.S.objects[0]
  assert.deepEqual(wallAssemblyErrors(o, next.initialRecords.S.objects), [])
  assert.equal(o.wallInstallation.display3d, 'wall-surface')
})
