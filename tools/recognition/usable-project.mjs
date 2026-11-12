// 将有来源依据的代理描点转成工作台原生空间；不运行训练或云端识别。
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProjectExportSchema } from '../../packages/shared/src/schemas/exchange.ts'
import { SpaceSchema, validateSpace } from '../../packages/shared/src/schemas/space.ts'
import { validateManifest, jsonSha256, sha256, isolatedOutput } from './pilot-contract.mjs'

const readJson = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' })

export function makeProject({ sample, plan, dimensions, exportedAt }) {
  assert.equal(plan.store_id, sample.store_id, '描点与样本编号不符')
  assert.equal(dimensions.store_id, sample.store_id, '量尺与样本编号不符')
  assert.equal(dimensions.sourceSha256, sample.source.sha256, '量尺来源不符')
  assert.equal(dimensions.sourcePage, sample.source.page, '量尺页号不符')
  assert.equal(dimensions.mmPerPixel, plan.transform.mmPerPixel, '量尺比例与描点不符')
  assert.ok(dimensions.dimensions.some((d) => d.role === 'calibration'))
  const checks = dimensions.dimensions.filter((d) => d.role === 'independent-check')
  assert.ok(checks.length, '缺少独立尺寸复核')
  const errors = checks.map((d) => {
    assert.ok(d.lengthMm > 0 && d.pointsPx.length === 2)
    const [a, b] = d.pointsPx
    return Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) * dimensions.mmPerPixel / d.lengthMm - 1)
  })
  assert.ok(errors.every((e) => Number.isFinite(e) && e < 0.01), '独立尺寸误差超过1%')
  const space = SpaceSchema.parse({
    ...plan.space,
    calibration: { method: 'dimension', reference: '原图尺寸定标、独立尺寸交叉复核；代理描点，未作现场复测', verified: false },
  })
  assert.deepEqual(validateSpace(space).filter((i) => i.severity === 'error'), [], '空间几何不合规')
  const shopType = { '边厅': 'side_hall', '中岛': 'island', '专区': 'zone' }[sample.shopType]
  const project = ProjectExportSchema.parse({
    format: 'store-design-project', schemaVersion: 1, exportedAt,
    project: { name: `${sample.name} · 识图可用样例`, shopType, market: 'domestic', siStyle: sample.si },
    nodes: [{ id: `source-${sample.store_id}`, parentId: null, kind: 'space', name: '原图空间 · 代理校正',
      space, layout: null, strategy: null, siStyle: sample.si, origin: 'agent', importedFrom: sample.store_id, hidden: false }],
    draft: null,
  })
  return { project, independentRelativeErrors: errors }
}

export async function buildUsable(config) {
  assert.ok(Array.isArray(config.reviewQuestions), '必须显式提供审核问题，无歧义时用空数组')
  const manifest = await readJson(config.manifest)
  // 先只读取身份清单排除45/48，再接触选定图纸与描点；不读取金标准几何。
  const acceptance = await readJson(config.acceptanceIndex)
  const development = await readJson(config.developmentIndex)
  validateManifest(manifest, acceptance, development)
  const sample = manifest.samples.find((s) => s.store_id === config.storeId)
  assert.ok(sample, '样本不在独立试点冻结清单')
  const plan = await readJson(config.plan)
  assert.equal(plan.manifestSha256, jsonSha256(manifest), '描点的冻结清单不符')
  const dimensions = await readJson(config.dimensions)
  assert.equal(sha256(await readFile(config.sourcePdf)), sample.source.sha256, '原PDF内容变更')
  const result = makeProject({ sample, plan, dimensions, exportedAt: config.exportedAt })
  const out = await isolatedOutput(config.out, [
    path.resolve(import.meta.dirname, '../..'), config.resourceRoot,
    ...['manifest', 'acceptanceIndex', 'developmentIndex', 'plan', 'dimensions', 'preview'].map((k) => path.dirname(path.resolve(config[k]))),
  ])
  await mkdir(out)
  await save(path.join(out, '原图空间.store-design.json'), result.project)
  await copyFile(config.preview, path.join(out, '原图.png'))
  await save(path.join(out, '尺寸依据.json'), dimensions)
  await save(path.join(out, '来源与限制.json'), {
    storeId: sample.store_id, source: sample.source, manifestSha256: jsonSha256(manifest),
    inputPlanSha256: sha256(await readFile(config.plan)), sourcePreviewSha256: sha256(await readFile(config.preview)),
    independentRelativeErrors: result.independentRelativeErrors,
    method: '既有代理描点＋原图人工核对＋本地几何校验', humanReviewed: false,
    trainingPerformed: false, cloudRequests: 0, acceptance: '仅身份索引排重', development: '仅身份索引排重',
    scope: '轮廓、入口、内部隔墙、可修改尺寸与三维空间预览；道具保持人工摆放',
    omittedItems: plan.layout?.items.length ?? 0,
    unresolved: config.reviewQuestions.map((q) => ({ ...q, humanReviewed: false })),
    corrections: config.corrections ?? [],
    limitations: ['这是一家代理辅助校正样例，不代表自动识别成功率或施工图验收。',
      '尺寸修改是独立设计版本，不回写原图标注；隔墙不会随外轮廓自动移动。',
      '原生项目不携带全部审核与来源元数据，须连同本文件及尺寸依据归档。',
      '灯箱和广告机不在本样例自动摆放；后续采用贴墙面表达，不挖墙洞。'],
    priorReview: plan.review,
  })
  return { out, storeId: sample.store_id, independentRelativeErrors: result.independentRelativeErrors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, '用法：node tools/recognition/usable-project.mjs 配置.json')
  console.log(JSON.stringify(await buildUsable(await readJson(process.argv[2])), null, 2))
}
