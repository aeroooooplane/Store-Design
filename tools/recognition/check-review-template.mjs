import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
export async function loadReview(dataset, initialStorage = {}) {
  const template = await readFile(new URL('./review-template.html', import.meta.url), 'utf8')
  const code = template
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/\/\*DATASET\*\/\s*null/, () => JSON.stringify(dataset).replaceAll('<', '\\u003c'))
  const nodes = new Map(),
    storage = new Map(Object.entries(initialStorage)),
    events = {}
  const get = (s) => {
    if (!nodes.has(s))
      nodes.set(s, {
        value: s === '#filter' ? 'all' : '',
        hidden: true,
        style: {},
        clientWidth: 1200,
        innerHTML: '',
        textContent: '',
        handlers: {},
        setAttribute() {},
        addEventListener(k, f) {
          this.handlers[k] = f
        },
      })
    return nodes.get(s)
  }
  const context = vm.createContext({
    document: {
      querySelector: get,
      querySelectorAll: () => [],
      addEventListener(k, f) {
        events[k] = f
      },
    },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    URL,
    URLSearchParams,
  })
  vm.runInContext(
    code +
      '\nglobalThis.api={safeRecord,validate,scaleOf,fresh,decodePack,exportPack,entrancePoints,open,change,restore,closeEditor,getRecords:()=>records,getCurrent:()=>current,setMode};',
    context,
  )
  return { api: context.api, context, nodes, get, storage, events }
}
async function run() {
  const sample = {
    id: 'A',
    name: '合成',
    page: 1,
    sourceSha256: 'source',
    image: { width: 500, height: 500, sha256: 'image', path: 'images/A.png' },
  }
  const data = {
    id: 'synthetic',
    fingerprint: 'fp',
    acceptanceListSha256: 'acceptance',
    samples: [sample, { ...sample, id: 'B' }],
  }
  const env = await loadReview(data),
    { api } = env
  const old = {
    boundary: [
      [20, 20],
      [220, 20],
      [220, 220],
      [20, 220],
    ],
    calibration: [
      [20, 20],
      [220, 20],
    ],
    entrance: [
      [50, 20],
      [100, 20],
    ],
    lengthMm: 2000,
    geometry: '直墙',
    pageType: 'vector-text',
    reviewer: '测试',
    notes: '',
    status: 'reviewed',
    reviewedAt: '2026-11-04T00:00:00Z',
    origin: 'manual',
  }
  const valid = api.safeRecord(old, sample)
  assert.equal(api.validate(valid, sample).length, 0)
  assert.equal(api.scaleOf(valid), 10)
  assert.equal(valid.entrances.length, 1)
  assert.equal(valid.reviewedAt, old.reviewedAt)
  assert.equal(
    api.validate(
      {
        ...valid,
        entrances: [
          {
            kind: 'polyline',
            points: [
              [50, 20],
              [220, 20],
              [220, 100],
            ],
          },
          {
            kind: 'polyline',
            points: [
              [20, 50],
              [20, 150],
            ],
          },
        ],
      },
      sample,
    ).length,
    0,
  )
  assert.ok(
    api
      .validate(
        {
          ...valid,
          entrances: [
            {
              kind: 'polyline',
              points: [
                [20, 20],
                [220, 220],
              ],
            },
          ],
        },
        sample,
      )
      .some((e) => e.includes('沿轮廓')),
  )
  const arc = {
    kind: 'arc',
    points: [
      [50, 150],
      [150, 50],
      [250, 150],
    ],
  }
  const arcBoundary = [...api.entrancePoints(arc), [250, 300], [50, 300]]
  assert.equal(
    api.validate({ ...valid, boundary: arcBoundary, entrances: [arc] }, sample).length,
    0,
  )
  assert.ok(
    api.validate(
      {
        ...valid,
        entrances: [
          {
            kind: 'arc',
            points: [
              [20, 20],
              [50, 20],
              [100, 20],
            ],
          },
        ],
      },
      sample,
    ).length,
  )
  assert.ok(
    api.validate(
      {
        ...valid,
        entrances: [
          {
            kind: 'arc',
            points: [
              [20, 20],
              [50, 20],
            ],
          },
        ],
      },
      sample,
    ).length,
  )
  assert.ok(api.validate({ ...valid, entrances: [] }, sample).length)
  assert.ok(
    api
      .validate(
        {
          ...valid,
          boundary: [
            [20, 20],
            [220, 220],
            [20, 220],
            [220, 20],
          ],
        },
        sample,
      )
      .some((e) => e.includes('自相交')),
  )
  assert.throws(
    () => api.safeRecord({ ...old, entrances: [{ kind: 'arc', points: [[NaN, 20]] }] }, sample),
    /坐标/,
  )
  assert.equal(api.safeRecord({ ...old, origin: 'recognizer' }, sample).status, 'pending')
  const pack = {
    schemaVersion: 1,
    datasetId: data.id,
    fingerprint: data.fingerprint,
    acceptanceListSha256: data.acceptanceListSha256,
    annotations: [
      { ...old, store_id: 'A', page: 1, sourceSha256: sample.sourceSha256, image: sample.image },
    ],
  }
  assert.equal(api.decodePack(pack).A.status, 'reviewed')
  assert.throws(
    () => api.decodePack({ ...pack, annotations: [...pack.annotations, ...pack.annotations] }),
    /重复/,
  )
  assert.throws(() => api.decodePack({ ...pack, fingerprint: 'bad' }), /不匹配/)
  assert.throws(
    () => api.decodePack({ ...pack, annotations: [{ ...pack.annotations[0], page: 2 }] }),
    /不匹配/,
  )
  api.getRecords().A = JSON.parse(JSON.stringify(valid))
  api.open('A')
  api.change((r) => r.boundary.push([70, 70]))
  assert.equal(api.getRecords().A.status, 'pending')
  env.events.keydown({
    key: 'z',
    ctrlKey: true,
    target: { closest: () => null },
    preventDefault() {},
  })
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getRecords().A)),
    JSON.parse(JSON.stringify(valid)),
  )
  env.events.keydown({
    key: 'y',
    ctrlKey: true,
    target: { closest: () => null },
    preventDefault() {},
  })
  assert.equal(api.getRecords().A.boundary.length, 5)
  env.get('#cancel').onclick()
  assert.equal(api.getCurrent(), null)
  assert.equal(api.getRecords().A.status, 'reviewed')
  api.open('A')
  env.get('#reviewer').value = '记住我'
  env.get('#approve').onclick()
  assert.equal(api.getCurrent(), null)
  assert.equal(env.storage.get('recognition-reviewer'), '记住我')
  api.open('B')
  assert.equal(env.get('#reviewer').value, '记住我')
  api.closeEditor()
  const exported = api.exportPack()
  assert.equal(exported.schemaVersion, 2)
  assert.equal(exported.fullStoreQualificationAvailable, false)
  assert.equal(api.decodePack(exported).A.reviewer, '记住我')
  const legacyKey = 'recognition-review:synthetic',
    raw = JSON.stringify({ datasetId: data.id, fingerprint: data.fingerprint, records: { A: old } })
  const migrated = await loadReview(data, { [legacyKey]: raw })
  assert.equal(migrated.api.getRecords().A.status, 'reviewed')
  assert.equal(migrated.storage.get(legacyKey), raw)
  assert.equal(migrated.storage.get(legacyKey + ':backup-before-v2'), raw)
  const embedded = await loadReview(
    { ...data, reviewedPack: pack },
    {
      [legacyKey]: JSON.stringify({
        datasetId: data.id,
        fingerprint: data.fingerprint,
        records: { A: { ...old, status: 'pending' } },
      }),
    },
  )
  assert.equal(embedded.api.getRecords().A.status, 'reviewed')
  console.log(
    '审核页检查通过：多入口/转角/圆弧、跨内区拒绝、旧包迁移、原子导入、撤销重做、取消、记住审核人、确认返回和记录隔离。',
  )
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await run()
