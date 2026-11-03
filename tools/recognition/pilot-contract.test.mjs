import test from 'node:test'
import './pilot-first6.test.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  sha256,
  jsonSha256,
  normalizeName,
  relativeFile,
  validateManifest,
  checkedFile,
  isolatedOutput,
} from './pilot-contract.mjs'

const identity = (prefix, i) => ({
  store_id: `${prefix}-${i}`,
  name: `${prefix}门店${i}`,
  aliases: [],
  sameStoreKeys: [`${prefix}-family-${i}`],
  sourceSha256s: [sha256(`${prefix}-${i}`)],
})
function fixture() {
  const a = {
    schemaVersion: 1,
    kind: 'acceptance',
    revision: 'synthetic',
    sourceManifestSha256: sha256('a'),
    stores: Array.from({ length: 45 }, (_, i) => identity('A', i)),
  }
  const d = {
    schemaVersion: 1,
    kind: 'development',
    revision: 'synthetic',
    sourceManifestSha256: sha256('d'),
    stores: Array.from({ length: 48 }, (_, i) => identity('D', i)),
  }
  const m = {
    schemaVersion: 1,
    contract: 'store-pilot/1',
    pilotId: 'synthetic-test-only',
    status: 'frozen',
    frozenAt: '2026-11-03T00:00:00Z',
    selectedBy: 'synthetic',
    selectionBasis: 'source-stratified-before-recognition',
    coverageGaps: ['合成测试，不代表真实覆盖'],
    resourceLockSha256: sha256('lock'),
    modelsVersion: 'synthetic',
    exclusions: { acceptanceSha256: jsonSha256(a), developmentSha256: jsonSha256(d) },
    samples: Array.from({ length: 24 }, (_, i) => ({
      ...identity('P', i),
      batch: i < 6 ? 1 : 2,
      selectionReason: '合成测试',
      mallGroupKey: '同商场可分组但不等同同店',
      nearDuplicateGroupKeys: [],
      si: 'SI1.0',
      shopType: '边厅',
      pageType: 'vector-text',
      geometry: 'regular',
      missing: [],
      source: {
        path: `01_各门店原图纸/source-${i}.pdf`,
        sha256: sha256(`P-${i}`),
        page: 1,
        pageCount: 2,
      },
    })),
  }
  return { m, a, d }
}
test('固定24家保留全部分母、分批与不准入状态', () => {
  const { m, a, d } = fixture(),
    r = validateManifest(m, a, d)
  assert.equal(r.rows.length, 24)
  assert.equal(r.trainingEligible, false)
  assert.equal(r.rows.filter((s) => s.batch === 1).length, 6)
  assert.equal(r.strata['SI1.0/边厅/vector-text/regular'], 24)
})
for (const [label, change] of [
  ['未冻结', ({ m }) => (m.status = 'draft')],
  ['冻结时间缺时区', ({ m }) => (m.frozenAt = '2026-11-03T12:00:00')],
  ['缺样', ({ m }) => m.samples.pop()],
  ['错分批', ({ m }) => (m.samples[0].batch = 2)],
  ['零基页号', ({ m }) => (m.samples[0].source.page = 0)],
  ['页号超限', ({ m }) => (m.samples[0].source.page = 3)],
  ['源文件上溯', ({ m }) => (m.samples[0].source.path = '../gold.pdf')],
  ['拒绝将标注当原PDF', ({ m }) => (m.samples[0].source.path = '09_门店档案/plan.json')],
  ['按成功选样', ({ m }) => (m.selectionBasis = 'recognition-success')],
  ['未声明缺层', ({ m }) => delete m.coverageGaps],
  ['索引指纹变化', ({ a }) => (a.revision = 'changed')],
  [
    '索引漏店',
    ({ m, a }) => {
      a.stores.pop()
      m.exclusions.acceptanceSha256 = jsonSha256(a)
    },
  ],
  ['编号泄漏', ({ m, a }) => (m.samples[0].store_id = a.stores[0].store_id)],
  ['别名泄漏', ({ m, a }) => (m.samples[0].aliases = [a.stores[0].name])],
  ['同店异版泄漏', ({ m, d }) => (m.samples[0].sameStoreKeys = d.stores[0].sameStoreKeys)],
  ['源哈希泄漏', ({ m, d }) => m.samples[0].sourceSha256s.push(d.stores[0].sourceSha256s[0])],
  ['本批重复', ({ m }) => (m.samples[1].aliases = [m.samples[0].name])],
])
  test(label + '被拒绝', () => {
    const f = fixture()
    change(f)
    assert.throws(() => validateManifest(f.m, f.a, f.d))
  })
test('元数据哈希不受键顺序或换行影响，数组顺序仍影响冻结版本', () => {
  assert.equal(jsonSha256({ a: 1, b: [2, 3] }), jsonSha256(JSON.parse('{\r\n"b":[2,3],"a":1\r\n}')))
  assert.notEqual(jsonSha256([1, 2]), jsonSha256([2, 1]))
  assert.equal(normalizeName('Ｓｔｏｒｅ（Ａ）'), 'storea')
  for (const p of ['C:/x', '/x', '../x', 'x/../y', 'x\\y', 'x//y', 'https://x'])
    assert.equal(relativeFile(p), false)
})

test('真实路径隔离、哈希拒绝、CLI逐店失败保留；无真实图纸或外网', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'store-pilot-contract-'))
  try {
    const repo = path.join(root, 'repo'),
      resources = path.join(root, 'resources'),
      input = path.join(root, 'inputs')
    for (const p of [repo, resources, input]) await mkdir(p)
    await writeFile(path.join(repo, '.git'), 'gitdir: synthetic')
    await mkdir(path.join(resources, '04_模型库'))
    await mkdir(path.join(resources, '01_各门店原图纸'))
    const catalog = '{"synthetic":true}',
      lock = {
        releaseVersions: { models: 'synthetic' },
        requiredFiles: { '04_模型库/manifest.json': sha256(catalog) },
      }
    await writeFile(path.join(resources, '04_模型库', 'manifest.json'), catalog)
    await writeFile(path.join(repo, 'resources.lock.json'), JSON.stringify(lock))
    const { m, a, d } = fixture()
    m.resourceLockSha256 = jsonSha256(lock)
    for (const [i, s] of m.samples.entries())
      await writeFile(path.join(resources, s.source.path), `P-${i}`)
    for (const [name, value] of [
      ['manifest', m],
      ['acceptance', a],
      ['development', d],
    ])
      await writeFile(path.join(input, name + '.json'), JSON.stringify(value))
    assert.equal(
      (
        await checkedFile(resources, m.samples[0].source.path, m.samples[0].source.sha256)
      ).toString(),
      'P-0',
    )
    await assert.rejects(
      checkedFile(resources, m.samples[0].source.path, sha256('wrong')),
      /SHA256/,
    )
    await assert.rejects(isolatedOutput(path.join(repo, 'out'), []), /Git/)
    await assert.rejects(isolatedOutput(input, []), /已存在/)
    const link = path.join(root, 'link')
    await symlink(resources, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(isolatedOutput(path.join(link, 'out'), [resources]), /受保护/)
    const escape = path.join(resources, 'escape')
    await symlink(input, escape, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(
      checkedFile(resources, 'escape/manifest.json', sha256(JSON.stringify(m))),
      /越出/,
    )
    const cli = fileURLToPath(new URL('./pilot-check.mjs', import.meta.url))
    const run = (out) =>
      spawnSync(
        process.execPath,
        [
          cli,
          '--manifest',
          path.join(input, 'manifest.json'),
          '--acceptance-index',
          path.join(input, 'acceptance.json'),
          '--development-index',
          path.join(input, 'development.json'),
          '--repo',
          repo,
          '--resources',
          resources,
          '--out',
          out,
        ],
        { encoding: 'utf8' },
      )
    const out = path.join(root, 'good'),
      good = run(out)
    assert.equal(good.status, 0, good.stderr)
    assert.equal(JSON.parse(await readFile(path.join(out, 'manifest-check.json'))).rows.length, 24)
    assert.notEqual(run(out).status, 0, '不得覆盖原报告')
    await writeFile(path.join(resources, m.samples[2].source.path), 'tampered')
    const badOut = path.join(root, 'bad'),
      bad = run(badOut)
    assert.equal(bad.status, 1, bad.stderr)
    const report = JSON.parse(await readFile(path.join(badOut, 'manifest-check.json')))
    assert.equal(report.inputErrorCount, 1)
    assert.equal(report.rows.length, 24)
    assert.equal(report.rows[2].inputStatus, 'invalid')
  } finally {
    // 仅清理由本测试直接创建的随机临时目录，Junction不会递归删除目标。
    assert.equal(path.dirname(root), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('store-pilot-contract-'))
    await rm(root, { recursive: true, force: true })
  }
})
