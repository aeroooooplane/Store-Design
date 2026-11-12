import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { hash, assertIsolation, adapt, projectFor } from './core.mjs'
import { isolatedOutput } from '../recognition/pilot-contract.mjs'
const read = async (p) => JSON.parse((await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
export async function build(config) {
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.api).hostname),
    '本轮只允许本机API',
  )
  const [acceptance, development] = await Promise.all([
    read(config.acceptanceIndex),
    read(config.developmentIndex),
  ])
  const isolation = assertIsolation(config.ids, acceptance, development)
  assert.ok(config.ids.length >= 20 && config.ids.length <= 30)
  const repo = path.resolve(import.meta.dirname, '../..')
  config = {
    ...config,
    out: await isolatedOutput(config.out, [
      repo,
      config.bundle,
      config.resourceRoot ?? path.join(repo, '资源库'),
      path.dirname(config.acceptanceIndex),
      path.dirname(config.developmentIndex),
    ]),
  }
  await fs.mkdir(config.out, { recursive: false })
  const save = async (p, v) =>
    fs.writeFile(path.join(config.out, p), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' })
  // 名单先冻结，之后才读取逐店标注和调用排布器；不能用生成结果换样本。
  await save('选样与隔离.json', {
    ids: config.ids,
    isolation,
    selectedAt: new Date().toISOString(),
    basis: '复用已审核开发标注，按铺型/版本/异形/多入口覆盖；生成前冻结',
    trainingPerformed: false,
  })
  const bundle = await read(path.join(config.bundle, '构建数据.json')),
    rows = []
  await fs.mkdir(path.join(config.out, '原标注'))
  await fs.mkdir(path.join(config.out, '工作台项目'))
  await fs.mkdir(path.join(config.out, 'images'))
  const request = async (url, body) => {
    let res = await fetch(config.api + url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    })
    for (let attempt = 0; res.status === 429 && attempt < 2; attempt++) {
      const retry = Math.min(60, Math.max(1, Number(res.headers.get('retry-after') || 60)))
      console.log(JSON.stringify({ event: 'rate-limit', url, retrySeconds: retry }))
      await res.arrayBuffer()
      await new Promise((resolve) => setTimeout(resolve, retry * 1000))
      res = await fetch(config.api + url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        ...(body
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      })
    }
    const v = await res.json()
    assert.ok(res.ok, JSON.stringify(v))
    return v
  }
  for (const id of config.ids) {
    const start = performance.now(),
      meta = bundle.stores.find((s) => s.id === id)
    assert.ok(meta)
    const sourcePath = path.join(config.bundle, 'annotations', id + '.json'),
      bytes = await fs.readFile(sourcePath),
      a = JSON.parse(bytes)
    assert.ok(
      development.stores
        .find((s) => s.store_id === id)
        .sourceSha256s.includes(a.originalApprovedReference.sourceSha256),
      '审核来源不在开发身份记录',
    )
    await fs.writeFile(path.join(config.out, '原标注', id + '.json'), bytes, { flag: 'wx' })
    const image = await fs.readFile(path.join(config.bundle, meta.image.path))
    assert.equal(hash(image), meta.image.sha256)
    await fs.writeFile(path.join(config.out, 'images', id + '.png'), image, { flag: 'wx' })
    let row
    try {
      row = adapt(meta, a)
    } catch (e) {
      row = {
        id,
        name: meta.name,
        blocked: true,
        questions: [],
        failure: String(e),
        trainingEligible: false,
      }
    }
    Object.assign(row, {
      sourceFileHash: hash(bytes),
      imageHash: hash(image),
      image: meta.image,
      originPx: a.originPx,
      mmPerPixel: a.mmPerPixel,
    })
    row.candidates = []
    if (!row.blocked) {
      try {
        const before = performance.now(),
          result = await request('/layouts/generate', {
            space: row.space,
            shopType: row.shopType,
            siStyle: row.siStyle,
            strategies: ['max', 'area', 'min'],
          })
        row.generationSeconds = (performance.now() - before) / 1000
        row.candidates = result.candidates
        const project = projectFor(row, row.candidates, new Date().toISOString())
        await save('工作台项目/' + id + '.store-design.json', project)
        row.projectFile = '工作台项目/' + id + '.store-design.json'
        row.projectHash = hash(project)
        row.generatedValid = row.candidates.filter(
          (c) => !c.issues.some((i) => i.severity === 'error') && c.layout.items.length,
        ).length
      } catch (e) {
        row.generationFailure = String(e)
      }
    }
    row.processingSeconds = (performance.now() - start) / 1000
    rows.push(row)
    await save('原标注/' + id + '-派生记录.json', row)
    console.log(
      JSON.stringify({
        id,
        blocked: row.blocked,
        valid: row.generatedValid ?? 0,
        issues: row.spaceIssues,
        obstacles: row.space?.obstacles.length,
        failure: row.failure ?? row.generationFailure,
      }),
    )
  }
  const report = {
    schemaVersion: 1,
    id: 'layout-pilot-20261112',
    createdAt: new Date().toISOString(),
    isolation,
    rows,
    scope: {
      developmentOnly: true,
      trainingPerformed: false,
      cloudRequests: 0,
      recognitionIteration: 'paused',
      referenceCoordinatesUsedForGeneration: false,
    },
    questions: [
      {
        id: 'LP-height',
        question: '本轮层高沿用3米预览默认值，不代表实测；请仅补充与现状不符的门店。',
        owner: 'user',
      },
      {
        id: 'LP-island',
        question:
          '中岛先按开放场地排布，原入口线仅作结果参照；有必须保持通行的指定边，请填写门店和位置。',
        owner: 'user',
      },
      {
        id: 'LP-requirements',
        question:
          '首轮自动排布仅覆盖中岛桌、收银与配件柜。是否有必须配置的数量/功能？可按门店或统一填写。',
        owner: 'user',
      },
    ],
    limitations: [
      '24家仍为开发集，不能用于训练或宣称独立验收通过。',
      '既有规则排布，未训练新模型，也未把原图家具位置复制为自动结果。',
      '3米层高仅用于原生格式和预览；参考对象未知高度不补填。',
      '原隔断/包板/后场/设备投影保留为避让区，暂不自动重设计硬装。',
      '灯箱广告机保留二维标注，未变成嵌墙实体。',
      '几何校验通过不等于满足经营需求、施工或消防验收。',
    ],
  }
  report.fingerprint = hash({
    ids: config.ids,
    sources: rows.map((r) => [r.id, r.sourceFileHash]),
    isolation,
  })
  await save('试点数据.json', report)
  const template = await fs.readFile(new URL('./review.html', import.meta.url), 'utf8')
  await fs.writeFile(
    path.join(config.out, '审核页.html'),
    template.replace('/*__DATA__*/', JSON.stringify(report).replace(/</g, '\\u003c')),
    { flag: 'wx' },
  )
  return {
    count: rows.length,
    importFiles: rows.filter((r) => r.projectFile).length,
    candidates: rows.reduce((n, r) => n + (r.generatedValid ?? 0), 0),
    blocked: rows.filter((r) => r.blocked).map((r) => r.id),
    out: config.out,
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  console.log(JSON.stringify(await build(await read(process.argv[2])), null, 2))
