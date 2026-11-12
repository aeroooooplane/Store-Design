import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {
  DemandSchema,
  ProjectExportSchema,
  normalizeSpace,
  generateRequired,
} from '../../packages/shared/src/index.ts'
import { assertIsolation, hash } from './core.mjs'
import { isolatedOutput } from '../recognition/pilot-contract.mjs'

const read = async (p) => JSON.parse((await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
export async function buildDemand(config) {
  const old = await read(path.join(config.source, '试点数据.json'))
  const development = await read(config.developmentIndex)
  const isolation = assertIsolation(
    old.rows.map((r) => r.id),
    await read(config.acceptanceIndex),
    development,
  )
  const out = await isolatedOutput(config.out, [
    path.resolve(import.meta.dirname, '../..'),
    config.source,
    path.dirname(config.acceptanceIndex),
    path.dirname(config.developmentIndex),
    config.resourceRoot,
  ])
  await fs.mkdir(out, { recursive: false })
  const write = (p, v) =>
    fs.writeFile(path.join(out, p), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' })
  const assets = await read(config.assets),
    supplements = await read(config.supplements)
  const data = {
    ...old,
    id: 'layout-demand-workbench-20261112',
    createdAt: new Date().toISOString(),
    previousFingerprint: old.fingerprint,
    isolation,
    rows: [],
  }
  for (const dir of ['images', '原标注', '工作台项目', '道具清单', '空间与需求'])
    await fs.mkdir(path.join(out, dir))
  for (const source of old.rows) {
    const bytes = await fs.readFile(path.join(config.source, '原标注', source.id + '.json'))
    assert.equal(hash(bytes), source.sourceFileHash)
    const a = JSON.parse(bytes)
    assert.equal(a.storeId, source.id)
    assert.equal(a.status, 'reviewed')
    assert.ok(
      development.stores
        .find((s) => s.store_id === source.id)
        ?.sourceSha256s.includes(a.originalApprovedReference.sourceSha256),
    )
    await fs.writeFile(path.join(out, '原标注', source.id + '.json'), bytes, { flag: 'wx' })
    const img = await fs.readFile(path.join(config.source, 'images', source.id + '.png'))
    assert.equal(hash(img), source.imageHash)
    await fs.writeFile(path.join(out, 'images', source.id + '.png'), img, { flag: 'wx' })
    const supplement = supplements[source.id]
    const demand = DemandSchema.parse({
      schemaVersion: 1,
      sourceStoreId: source.id,
      entities: source.demand.entities.map((e) => ({ ...e, ...supplement?.entries?.[e.id] })),
    })
    const space = normalizeSpace({ ...source.space, demand }),
      geometry = structuredClone(space)
    delete geometry.demand
    assert.deepEqual(geometry, normalizeSpace(source.space))
    const before = hash(space)
    const candidates = ['max', 'area', 'min'].map((s) =>
      generateRequired(space, demand.entities, assets, source.siStyle, s),
    )
    assert.equal(hash(space), before)
    assert.ok(candidates.every((c) => !c.issues.some((i) => i.severity === 'error')))
    const project = await read(path.join(config.source, source.projectFile))
    const oldNodes = structuredClone(project.nodes)
    project.nodes.push({
      ...oldNodes.find((n) => n.kind === 'space'),
      id: 'space-demand',
      name: '清单排布 · 原空间保留',
      space,
    })
    for (const c of candidates)
      project.nodes.push({
        id: 'demand-' + c.strategy,
        parentId: 'space-demand',
        kind: 'plan',
        name: '清单排布 · ' + c.strategy,
        space: null,
        layout: c.layout,
        strategy: c.strategy,
        siStyle: source.siStyle,
        origin: 'generator',
        importedFrom: null,
        hidden: false,
      })
    assert.deepEqual(project.nodes.slice(0, oldNodes.length), oldNodes)
    project.exportedAt = data.createdAt
    const native = ProjectExportSchema.parse(project)
    await write(source.projectFile, native)
    await write('道具清单/' + source.id + '.json', demand)
    const row = {
      ...source,
      space,
      demand: { ...source.demand, ...demand },
      previousRequiredCandidates: source.candidates,
      candidates,
      generatedValid: candidates.filter(
        (c) => c.layout.items.length && !c.issues.some((i) => i.severity === 'error'),
      ).length,
      generationSeconds: candidates.reduce((n, c) => n + c.generationSeconds, 0),
      supplement: supplement ?? null,
      projectHash: hash(native),
      questions: [...source.questions, ...(supplement?.questions ?? [])],
    }
    if (supplement?.replaceQuestion)
      row.questions = row.questions.map((q) =>
        q.id === supplement.replaceQuestion.id ? supplement.replaceQuestion : q,
      )
    data.rows.push(row)
    await write('空间与需求/' + row.id + '.json', {
      id: row.id,
      space,
      demand,
      audit: row.audit,
      priorReview: row.priorReview,
      supplement: row.supplement,
      candidates,
    })
    console.log(row.id, candidates.map((c) => c.layout.items.length).join('/'))
  }
  const best = data.rows.map((r) => ({
    row: r,
    c: [...r.candidates].sort(
      (a, b) =>
        a.shortages.length - b.shortages.length ||
        a.layout.items.filter((i) => i.placeholder).length -
          b.layout.items.filter((i) => i.placeholder).length,
    )[0],
  }))
  const metricRole = (role) => ({
    required: data.rows.filter((r) =>
      r.demand.entities.some((e) => e.roles.includes(role) && e.quantity),
    ).length,
    complete: data.rows.filter(
      (r) =>
        r.candidates.some((c) =>
          r.demand.entities
            .filter((e) => e.roles.includes(role))
            .every((e) => c.assignments.filter((a) => a.sourceId === e.id).length >= e.quantity),
        ) && r.demand.entities.some((e) => e.roles.includes(role) && e.quantity),
    ).length,
  })
  data.metrics = {
    stores: 24,
    physicalDemand: best.reduce(
      (n, { row }) => n + row.demand.entities.reduce((n, e) => n + e.quantity, 0),
      0,
    ),
    completeStores: best.filter((x) => !x.c.shortages.length).map((x) => x.row.id),
    placed: best.reduce((n, x) => n + x.c.layout.items.length, 0),
    placeholders: best.reduce(
      (n, x) => n + x.c.layout.items.filter((i) => i.placeholder).length,
      0,
    ),
    missing: best
      .filter((x) => x.c.shortages.length)
      .map((x) => ({ id: x.row.id, shortages: x.c.shortages })),
    newValid: data.rows.reduce((n, r) => n + r.generatedValid, 0),
    generationSeconds: data.rows.reduce((n, r) => n + r.generationSeconds, 0),
    cashier: metricRole('cashier'),
    unboxing: metricRole('unboxing_table'),
    humanCorrectionSeconds: null,
    businessApprovedStores: 0,
    cloudRequests: 0,
    previous: old.metrics,
  }
  data.limitations = [
    ...old.limitations,
    '清单与缺项明细已接入工作台；新增清单空间版本保留原节点。手动修改后的数量报告是生成时记录，需重新生成才能复评。',
  ]
  data.fingerprint = hash({
    previous: old.fingerprint,
    supplements,
    assets: hash(assets),
    rows: data.rows.map((r) => ({ space: r.space, candidates: r.candidates.map((c) => c.layout) })),
  })
  await write('试点数据.json', data)
  await write('复评汇总.json', data.metrics)
  await write('补充依据.json', supplements)
  const template = await fs.readFile(new URL('./requirements-review.html', import.meta.url), 'utf8')
  await fs.writeFile(
    path.join(out, '审核页.html'),
    template.replace('/*__DATA__*/', JSON.stringify(data).replace(/</g, '\\u003c')),
    { flag: 'wx' },
  )
  return data.metrics
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  console.log(await buildDemand(await read(process.argv[2])))
