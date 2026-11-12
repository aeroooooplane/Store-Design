import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  validateAnnotation,
  shapePath,
  durationSummary,
  changeSummary,
  sha256,
} from './alignment-core.mjs'
import { buildReport } from './alignment-report.mjs'
const sample = () => ({
  coordinateSystem: 'source-pixels',
  image: { width: 100, height: 100 },
  features: [
    {
      id: 'W1',
      origin: 'agent-manual',
      kind: 'wall',
      geometry: {
        type: 'polygon',
        points: [
          [0, 0],
          [50, 0],
          [50, 50],
          [0, 50],
        ],
        holes: [
          [
            [10, 10],
            [20, 10],
            [20, 20],
            [10, 20],
          ],
        ],
      },
    },
  ],
  agentManualFeatures: 1,
  automaticFinalFeatures: 0,
  userReviewed: false,
})
test('手工校正不得冒充自动贡献', () => {
  const d = sample()
  assert.equal(validateAnnotation(d), true)
  d.automaticFinalFeatures = 1
  assert.throws(() => validateAnnotation(d), /自动贡献/)
})
test('拒绝归一化坐标声明与越界点', () => {
  const d = sample()
  d.coordinateSystem = 'normalized'
  assert.throws(() => validateAnnotation(d))
  d.coordinateSystem = 'source-pixels'
  d.features[0].geometry.points[0] = [101, 2]
  assert.throws(() => validateAnnotation(d), /超出/)
})
test('重复编号与未知来源不能通过', () => {
  const d = sample()
  d.features.push(structuredClone(d.features[0]))
  assert.throws(() => validateAnnotation(d), /重复/)
  d.features.pop()
  d.features[0].origin = 'unknown'
  assert.throws(() => validateAnnotation(d), /来源/)
})
test('图面凹位独立保留，不填平广告机位置', () => {
  const p = shapePath(sample().features[0].geometry)
  assert.equal((p.match(/M/g) || []).length, 2)
  assert.ok(p.includes('M10,10L20,10L20,20L10,20Z'))
})
test('未知用户耗时保持空值，缺少结束事件不填零', () => {
  const t = durationSummary([{ event: 'correction_started', at: '2026-01-01T00:00:00Z' }])
  assert.equal(t.agentCorrectionSessionSeconds, null)
  assert.equal(t.userCorrectionSeconds, null)
})
test('校正和复核分别计时，拒绝倒序', () => {
  const es = [
    { event: 'correction_started', at: '2026-01-01T00:00:00Z' },
    { event: 'correction_draft_finished', at: '2026-01-01T00:01:30Z' },
  ]
  assert.equal(durationSummary(es).agentCorrectionSessionSeconds, 90)
  es[1].at = '2025-01-01T00:00:00Z'
  assert.throws(() => durationSummary(es), /时间/)
})
test('自动候选数量不是完整结果数量', () => {
  const s = changeSummary({ polygons: [{}, {}] }, sample())
  assert.equal(s.automaticBoundaryCandidates, 2)
  assert.equal(s.automaticFinalFeatures, 0)
  assert.equal(s.automaticComplete, false)
  assert.equal(s.agentManualFeatures, 1)
})
test('冻结原始结果被修改时拒绝生成审核页', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'alignment-test-'))
  try {
    const contents = {
      '校正结果.json': sample(),
      '自动原始/raw.json': { polygons: [] },
      '自动结果冻结.json': { files: [{ name: 'raw.json', sha256: sha256('original') }] },
      '阶段记录.json': [],
      '贴线检查.json': {},
      '逐项改动.json': [],
      '复核修订.json': [],
    }
    await fs.mkdir(path.join(tmp, '自动原始'))
    await Promise.all(
      Object.entries(contents).map(([name, v]) =>
        fs.writeFile(path.join(tmp, name), JSON.stringify(v)),
      ),
    )
    await assert.rejects(buildReport(tmp, path.join(tmp, 'out')), /冻结后被改动/)
  } finally {
    assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(tmp).startsWith('alignment-test-'))
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('实际报告保留文本与来源，危险标签不能结束内联数据', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'alignment-test-'))
  try {
    const d = { ...sample(), sourceSha256: sha256('source'), viewBox: [0, 0, 100, 100] }
    d.features[0].label = '墙体 </script><script>测试</script>'
    const raw = {
      width: 100,
      height: 100,
      inputSha256: d.sourceSha256,
      polygons: [
        {
          points: [
            [0, 0],
            [50, 0],
            [50, 50],
          ],
        },
      ],
    }
    const rawText = JSON.stringify(raw),
      image = Buffer.from('synthetic-image-placeholder')
    await fs.mkdir(path.join(tmp, '自动原始'))
    const contents = {
      '校正结果.json': d,
      '自动结果冻结.json': {
        beforeManualCorrection: true,
        files: [
          { name: 'raw.json', sha256: sha256(rawText) },
          { name: 'input.png', sha256: sha256(image) },
        ],
      },
      '阶段记录.json': [],
      '贴线检查.json': {},
      '逐项改动.json': [],
      '复核修订.json': [],
      '来源.json': { test: true },
      '自动原始/reading.json': {},
    }
    await Promise.all(
      Object.entries(contents).map(([name, v]) =>
        fs.writeFile(path.join(tmp, name), JSON.stringify(v)),
      ),
    )
    await fs.writeFile(path.join(tmp, '自动原始/raw.json'), rawText)
    await fs.writeFile(path.join(tmp, '自动原始/input.png'), image)
    const out = path.join(tmp, 'out')
    await buildReport(tmp, out)
    const html = await fs.readFile(path.join(out, '审核页.html'), 'utf8')
    const embedded = html.match(
      /<script id="data" type="application\/json">([\s\S]*?)<\/script>/,
    )[1]
    assert.equal(JSON.parse(embedded).annotation.features[0].label, d.features[0].label)
    assert.ok(!embedded.includes('<'))
    assert.ok(!html.includes('CROPBOX'))
    const final = JSON.parse(await fs.readFile(path.join(out, '校正结果.json'), 'utf8'))
    assert.deepEqual(final, d)
    d.sourceSha256 = sha256('different')
    await fs.writeFile(path.join(tmp, '校正结果.json'), JSON.stringify(d))
    await assert.rejects(buildReport(tmp, out), /来源不匹配/)
  } finally {
    assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(tmp).startsWith('alignment-test-'))
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
