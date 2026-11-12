import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { hash, assertIsolation, projectFor } from './core.mjs'
import { inventory, reviseSpace, generateRequired, rolesFor } from './requirements.mjs'
import { validateLayout } from '../../packages/shared/src/schemas/layout.ts'
import { isolatedOutput } from '../recognition/pilot-contract.mjs'
const read = async (p) => JSON.parse((await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
export async function buildRequirements(config) {
  const old = await read(path.join(config.source, '试点数据.json'))
  const isolation = assertIsolation(
    old.rows.map((r) => r.id),
    await read(config.acceptanceIndex),
    await read(config.developmentIndex),
  )
  const repo = path.resolve(import.meta.dirname, '../..')
  const out = await isolatedOutput(config.out, [
    repo,
    config.source,
    path.dirname(config.acceptanceIndex),
    path.dirname(config.developmentIndex),
    config.resourceRoot,
  ])
  await fs.mkdir(out, { recursive: false })
  const write = async (p, v) =>
    fs.writeFile(path.join(out, p), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' })
  const [corrections, assets] = await Promise.all([read(config.corrections), read(config.assets)])
  const data = {
    schemaVersion: 1,
    id: 'layout-requirements-20261112',
    createdAt: new Date().toISOString(),
    isolation,
    previousFingerprint: old.fingerprint,
    rows: [],
    questions: old.questions.filter((q) => q.id !== 'LP-requirements'),
    limitations: [
      '24家仍为开发复评，45家只核对身份索引；未训练、无云端请求。',
      '轮廓沿用旧审核；新增墙体是代理手工补标草稿，未冒充用户审核。',
      '数量是本店原注配置，不是全店统一采购/必配标准。组合台一件多功能，附带座位不重复相加。',
      '自动只使用空间、道具类别数量和尺寸，不复制原图家具位置。',
      '有真实模型则按其原尺寸排布；无模型但原注三维尺寸齐全时使用明确标记的占位块。',
      '0.6米间距只是本轮实验条件；没有验证服务朝向、连续动线、消防、施工或经营适用性。',
      '图中灯箱和广告机保留二维贴面参考，不生成嵌墙实体。未知墙高仍未实测。',
      '页面修改仅形成审核修订包；修改后的空间必须再次生成/校验，旧候选不自动视为有效。',
    ],
  }
  await write('选样与隔离.json', {
    ids: old.rows.map((r) => r.id),
    isolation,
    frozenBeforeGeneration: true,
    sourceDatasetHash: hash(await fs.readFile(path.join(config.source, '试点数据.json'))),
    assetSnapshotHash: hash(await fs.readFile(config.assets)),
    correctionInputHash: hash(await fs.readFile(config.corrections)),
  })
  for (const dir of ['images', '原标注', '工作台项目', '空间与需求'])
    await fs.mkdir(path.join(out, dir))
  for (const [i, source] of old.rows.entries()) {
    const bytes = await fs.readFile(path.join(config.source, '原标注', source.id + '.json'))
    assert.equal(hash(bytes), source.sourceFileHash)
    const originalAnnotation = JSON.parse(bytes)
    assert.equal(originalAnnotation.storeId, source.id)
    assert.equal(originalAnnotation.status, 'reviewed')
    const development = await read(config.developmentIndex)
    assert.ok(
      development.stores
        .find((s) => s.store_id === source.id)
        ?.sourceSha256s.includes(originalAnnotation.originalApprovedReference.sourceSha256),
      '原标注来源必须属于开发身份记录',
    )
    await fs.writeFile(path.join(out, '原标注', source.id + '.json'), bytes, { flag: 'wx' })
    const image = await fs.readFile(path.join(config.source, 'images', source.id + '.png'))
    assert.equal(hash(image), source.imageHash)
    await fs.writeFile(path.join(out, 'images', source.id + '.png'), image, { flag: 'wx' })
    const audit = reviseSpace(source, i, corrections[source.id]),
      demand = inventory(source)
    const row = {
      ...structuredClone(source),
      space: audit.space,
      audit,
      demand,
      previousCandidates: source.candidates,
      candidates: [],
      questions: [...source.questions],
      generatedValid: 0,
    }
    if (audit.question)
      row.questions.push({ id: source.id + '-space-demand', question: audit.question })
    row.previousRecheck = source.candidates.map((c) => ({
      strategy: c.strategy,
      items: c.layout.items.length,
      issues: validateLayout(audit.space, c.layout),
    }))
    for (const strategy of ['max', 'area', 'min'])
      row.candidates.push(
        generateRequired(audit.space, demand.entities, assets, source.siStyle, strategy),
      )
    row.generatedValid = row.candidates.filter(
      (c) => c.layout.items.length && !c.issues.some((x) => x.severity === 'error'),
    ).length
    row.projectFile = '工作台项目/' + row.id + '.store-design.json'
    await write(row.projectFile, projectFor(row, row.candidates, new Date().toISOString()))
    await write('空间与需求/' + row.id + '.json', {
      id: row.id,
      space: row.space,
      audit,
      demand,
      priorReview: row.priorReview,
      questions: row.questions,
      candidates: row.candidates,
    })
    data.rows.push(row)
    console.log(
      JSON.stringify({
        id: row.id,
        walls: audit.additions.length,
        requested: demand.physicalCount,
        placed: row.candidates.map((c) => c.layout.items.length),
        shortages: row.candidates[1].shortages.length,
      }),
    )
  }
  const beforeRoles = (c) => {
    const counts = {}
    for (const item of c.layout.items) {
      const rs = rolesFor(item.name)
      for (const role of rs[0] === 'other' ? [item.function] : rs)
        counts[role] = (counts[role] ?? 0) + 1
    }
    return counts
  }
  const meets = (counts, demand, role) => (counts[role] ?? 0) >= (demand.roleCounts[role] ?? 0)
  const aggregate = (role) => ({
    requiredStores: data.rows.filter((r) => (r.demand.roleCounts[role] ?? 0) > 0).length,
    before: data.rows.filter(
      (r) =>
        (r.demand.roleCounts[role] ?? 0) > 0 &&
        r.previousCandidates.some((c) => meets(beforeRoles(c), r.demand, role)),
    ).length,
    after: data.rows.filter(
      (r) =>
        (r.demand.roleCounts[role] ?? 0) > 0 &&
        r.candidates.some((c) => {
          const n = c.assignments.filter((a) => a.roles.includes(role)).length
          return n >= r.demand.roleCounts[role]
        }),
    ).length,
  })
  data.metrics = {
    stores: data.rows.length,
    oldObjects: data.rows.reduce((n, r) => n + r.objects.length, 0),
    addedWallPolygons: data.rows.reduce(
      (n, r) => n + r.audit.additions.filter((a) => a.category === 'wall-assembly').length,
      0,
    ),
    physicalDemand: data.rows.reduce((n, r) => n + r.demand.physicalCount, 0),
    oldValid: data.rows.reduce(
      (n, r) =>
        n +
        r.previousCandidates.filter(
          (c) => c.layout.items.length && !c.issues.some((i) => i.severity === 'error'),
        ).length,
      0,
    ),
    oldValidWithWalls: data.rows.reduce(
      (n, r) =>
        n +
        r.previousRecheck.filter((c) => c.items && !c.issues.some((i) => i.severity === 'error'))
          .length,
      0,
    ),
    newValid: data.rows.reduce((n, r) => n + r.generatedValid, 0),
    completeStores: data.rows
      .filter((r) => r.candidates.some((c) => !c.shortages.length))
      .map((r) => r.id),
    cashier: aggregate('cashier'),
    unboxing: aggregate('unboxing_table'),
    generationSeconds: data.rows.reduce(
      (n, r) => n + r.candidates.reduce((n, c) => n + c.generationSeconds, 0),
      0,
    ),
    humanCorrectionSeconds: null,
    businessApprovedStores: 0,
    cloudRequests: 0,
  }
  data.fingerprint = hash({
    previous: old.fingerprint,
    corrections,
    assets: hash(assets),
    isolation,
  })
  await write('试点数据.json', data)
  const template = await fs.readFile(new URL('./requirements-review.html', import.meta.url), 'utf8')
  await fs.writeFile(
    path.join(out, '审核页.html'),
    template.replace('/*__DATA__*/', JSON.stringify(data).replace(/</g, '\\u003c')),
    { flag: 'wx' },
  )
  await write('复评汇总.json', data.metrics)
  return data.metrics
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  console.log(await buildRequirements(await read(process.argv[2])))
