import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeSynthetic } from './pilot-first6-fixture.mjs'
import { runFirstSix } from './pilot-first6.mjs'
import { inspectInput, validateRender, validateHandoff, openPdf } from './pilot-input.mjs'
import { quality } from './pilot-quality.mjs'
import { scene } from './pilot-render.mjs'
import { sha256 } from './pilot-contract.mjs'
import { catalogReader } from './pilot-assets.mjs'
import sharp from 'sharp'

describe('首6输入、校正质检与出图（纯合成）', () => {
  let root, args, m, s, input, plan, bom, report
  const read = async (p) => JSON.parse(await readFile(p, 'utf8'))
  const assets = new Map([['asset-1', { footprint: { w: 0.8, d: 0.6, h: 0.8 }, placeable: true }]])
  const evaluate = (p = structuredClone(plan), b = structuredClone(bom), i = input) =>
    quality(p, b, i, s, m, assets)
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'store-pilot-first6-'))
    args = await makeSynthetic(root)
    m = await read(args.manifest)
    s = m.samples[0]
    input = await inspectInput({
      bundle: args.bundle,
      resources: args.resources,
      sample: s,
      manifest: m,
    })
    plan = await read(path.join(args.corrections, s.store_id, 'plan.json'))
    bom = await read(path.join(args.corrections, s.store_id, 'bom.json'))
    report = await runFirstSix(args)
  })
  after(async () => {
    if (root) {
      assert.equal(path.dirname(root), path.resolve(tmpdir()))
      assert.ok(path.basename(root).startsWith('store-pilot-first6-'))
      await rm(root, { recursive: true, force: true })
    }
  })
  it('合成六家全部保留，未知型号阻塞且不冒充真实完成', () => {
    assert.equal(report.count, 6)
    assert.equal(report.generated, 6)
    assert.equal(report.automaticChecksPassed, 5)
    assert.equal(report.realCompleted, 0)
    assert.equal(report.trainingEligible, false)
    assert.ok(report.rows[5].issues.some((i) => i.code === 'unknown_asset'))
  })
  it('正常校正只通过自动检查；保留交叉核对/编辑器/用户抽审待办', () => {
    const q = evaluate()
    assert.equal(q.status, 'needs_cross_check')
    assert.equal(q.userSampled, false)
    assert.equal(q.trainingEligible, false)
    assert.equal(q.manualChecksPending.length, 4)
  })
  it('拒绝镜像、拉伸及旋转矩阵不一致', () => {
    for (const change of [
      { pageToPreview: [-2, 0, 0, 2, 1200, 0] },
      { pageToPreview: [2, 0, 0, 3, 0, 0] },
      { rotationCW: 90 },
    ])
      assert.throws(() => validateRender({ ...input.h.render, ...change }))
    validateRender({
      pageSizePt: [600, 400],
      cropBoxPt: [0, 0, 600, 400],
      rotationCW: 90,
      widthPx: 800,
      heightPx: 1200,
      pageToPreview: [0, 2, -2, 0, 800, 0],
    })
  })
  it('交接身份、重复文件和越界尺寸不可放行', () => {
    for (const edit of [
      (h) => (h.store_id = 'WRONG'),
      (h) => h.files.push(h.files[0]),
      (h) => (h.dimensions[0].pointsPx[0] = [-1, 0]),
    ]) {
      const h = structuredClone(input.h)
      edit(h)
      assert.throws(() => validateHandoff(h, s, m))
    }
  })
  it('90和270度真实旋转预览按原页先裁后转，不发生裁切越界', async () => {
    const dir = path.join(args.bundle, s.store_id),
      hp = path.join(dir, 'handoff.json'),
      pp = path.join(dir, 'source/preview.png')
    const hb = await readFile(hp),
      pb = await readFile(pp)
    try {
      for (const angle of [90, 270]) {
        const bytes = await sharp(pb).rotate(angle).png().toBuffer(),
          h = JSON.parse(hb)
        h.render = {
          ...h.render,
          rotationCW: angle,
          widthPx: 800,
          heightPx: 1200,
          pageToPreview: angle === 90 ? [0, 2, -2, 0, 800, 0] : [0, -2, 2, 0, 0, 1200],
        }
        h.dimensions = []
        h.files.find((f) => f.path === 'source/preview.png').sha256 = sha256(bytes)
        await writeFile(pp, bytes)
        await writeFile(hp, JSON.stringify(h))
        const r = await inspectInput({
          bundle: args.bundle,
          resources: args.resources,
          sample: s,
          manifest: m,
        })
        assert.ok(r.checks.previewDifference < 0.03)
      }
    } finally {
      await writeFile(pp, pb)
      await writeFile(hp, hb)
    }
  })
  it('独立量尺必须不同且误差不超过1%', () => {
    const h = structuredClone(input.h)
    h.dimensions[1].pointsPx = h.dimensions[0].pointsPx
    assert.ok(
      evaluate(undefined, undefined, { ...input, h }).issues.some(
        (i) => i.code === 'independent_dimension',
      ),
    )
    h.dimensions[1] = structuredClone(input.h.dimensions[1])
    h.dimensions[1].lengthMm = 3500
    assert.ok(
      evaluate(undefined, undefined, { ...input, h }).issues.some(
        (i) => i.code === 'dimension_error',
      ),
    )
  })
  it('错误资产尺寸、BOM重复/漏项及冒充用户审核均被阻止', () => {
    const p = structuredClone(plan)
    p.layout.items[0].w = 1.2
    p.review.userSampled = true
    const b = structuredClone(bom)
    b.rows[0].itemIds.push('table-1')
    const codes = evaluate(p, b).issues.map((i) => i.code)
    for (const c of ['item_asset_size_mismatch', 'bom_count', 'bom_instance', 'review_state'])
      assert.ok(codes.includes(c), c)
    assert.ok(
      evaluate(undefined, { ...bom, rows: [] }).issues.some((i) => i.code === 'bom_omitted'),
    )
  })
  it('旧档案未知字段不得被Zod静默剥离后宣称无损', () => {
    const p = structuredClone(plan)
    p.layout.items[0].ref = 'A01'
    assert.ok(
      evaluate(p).issues.some((i) => i.code === 'unmapped_field' && i.message.includes('ref')),
    )
  })
  it('资产尺寸优先转换记录，并校验桌体范围/冻结目录指纹', async () => {
    const model = await read(path.join(args.resources, '04_模型库/manifest.json'))
    model.assets[0].tight_face_bounds_xyz_mm = [999, 999, 999]
    const lock = await read(path.join(args.repo, 'resources.lock.json'))
    const reader = catalogReader({ resources: args.resources, model, bodies: {}, lock })
    assert.deepEqual((await reader.forLayout(plan.layout)).get('asset-1').footprint, {
      w: 0.8,
      d: 0.6,
      h: 0.8,
    })
    assert.equal(reader.snapshots.size, 1)
    const bad = catalogReader({
      resources: args.resources,
      model,
      bodies: { 'asset-1': { w: 2, d: 2, offset: [0, 0] } },
      lock,
    })
    await assert.rejects(bad.forLayout(plan.layout))
    lock.requiredFiles['04_模型库/synthetic/conversion.json'] = '0'.repeat(64)
    await assert.rejects(
      catalogReader({ resources: args.resources, model, bodies: {}, lock }).forLayout(plan.layout),
    )
  })
  it('沿折线入口渲染实际边界片段而非跨角弦线', () => {
    const p = evaluate()
    p.space.entrances = [{ a: [4, 0], b: [5, 1], kind: 'main' }]
    const lines = scene(p).shapes.filter((s) => s.stroke === '#129d6f')
    assert.equal(lines.length, 2)
    assert.deepEqual(lines[0].points, [
      [4, 0],
      [5, 0],
    ])
  })
  it('原预览被篡改即拒绝，源文件未被工具修改', async () => {
    const f = path.join(args.bundle, s.store_id, 'source/preview.png'),
      bytes = await readFile(f)
    try {
      await writeFile(f, 'tampered')
      await assert.rejects(
        inspectInput({ bundle: args.bundle, resources: args.resources, sample: s, manifest: m }),
      )
    } finally {
      await writeFile(f, bytes)
    }
    assert.equal(sha256(await readFile(path.join(args.resources, s.source.path))), s.source.sha256)
  })
  it('PDF包含中文标记、编号与物料且没有多余空白页', async () => {
    const doc = await openPdf(await readFile(path.join(args.out, s.store_id, 'plan.pdf')))
    try {
      assert.equal(doc.numPages, 1)
      const page = await doc.getPage(1)
      const text = (await page.getTextContent()).items.map((i) => i.str).join('')
      for (const word of ['合成', '校正审核图', '5000', 'asset-1'])
        assert.ok(text.includes(word), word)
    } finally {
      await doc.destroy()
    }
  })
  it('审核页资源可打开，产物哈希与独立歧义局部完整', async () => {
    const html = await readFile(path.join(args.out, 'review/index.html'), 'utf8')
    for (const match of html.matchAll(/(?:src|href)="(\.\.\/[^"#]+)"/g))
      assert.ok((await stat(path.resolve(args.out, 'review', match[1]))).isFile(), match[1])
    const hashes = await read(path.join(args.out, 'file-hashes.json'))
    for (const [name, hash] of Object.entries(hashes))
      assert.equal(sha256(await readFile(path.join(args.out, name))), hash, name)
    const conflicts = await read(path.join(args.out, 'conflicts.json'))
    assert.equal(conflicts.length, 1)
    assert.ok(conflicts[0].crop)
  })
  it('缺校正不丢店，语法失败检查链接存在，旧输出不可覆盖', async () => {
    await assert.rejects(runFirstSix(args))
    const p = structuredClone(plan)
    p.space.boundary = []
    await writeFile(path.join(args.corrections, s.store_id, 'plan.json'), JSON.stringify(p))
    await rm(path.join(args.corrections, m.samples[1].store_id, 'plan.json'))
    const out = path.join(root, 'failed-output'),
      r = await runFirstSix({ ...args, out })
    assert.equal(r.count, 6)
    assert.equal(r.generated, 4)
    assert.equal(r.rows[0].checkFile, 'qa.json')
    assert.equal(r.rows[1].checkFile, 'failure.json')
    assert.equal(r.realCompleted, 0)
  })
})
