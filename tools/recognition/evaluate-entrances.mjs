import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { isSimplePolygon } from '../../packages/shared/src/index.ts'
import { loadReview } from './check-review-template.mjs'
import { iou } from './development-metrics.mjs'
import { scoreEntrances } from './entrance-metrics.mjs'
import { entranceErrors } from './whole-store-core.mjs'
const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    return i < 0 ? null : process.argv[i + 1]
  },
  json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex')
for (const k of ['dataset', 'reviewed', 'inputs', 'baseline', 'candidate', 'out'])
  if (!arg(k)) throw Error('缺少 --' + k)
const data = await json(arg('dataset')),
  pack = await json(arg('reviewed')),
  index = await json(path.join(arg('inputs'), 'inputs.json'))
if (pack.annotations.length !== data.samples.length) throw Error('审核包必须覆盖固定全集')
// 现状通行线不一定与旧租赁轮廓重合。旧轮廓、量尺仍按原审核独立校验；
// 新线只接受显式语义且携带原入口的参照，另校验其几何，不移动用户坐标。
const observed = pack.entranceSemantics === 'observed-current-layout'
if (
  observed &&
  pack.annotations.some(
    (a) => a.entranceSemantics !== 'observed-current-layout' || !Array.isArray(a.originalEntrances),
  )
)
  throw Error('现状通行参照缺少原入口或语义不一致')
const validationPack = observed
  ? {
      ...pack,
      annotations: pack.annotations.map((a) => ({ ...a, entrances: a.originalEntrances })),
    }
  : pack
const { api } = await loadReview({ ...data, reviewedPack: validationPack }),
  refs = api.getRecords(),
  runs = {}
const inputHash = hash(await readFile(path.join(arg('inputs'), 'inputs.json')))
const out = path.resolve(arg('out'))
for (const k of ['dataset', 'reviewed', 'inputs', 'baseline', 'candidate']) {
  const p = path.resolve(arg(k)),
    dir = ['dataset', 'reviewed'].includes(k) ? path.dirname(p) : p
  if (out === dir || out.startsWith(dir + path.sep)) throw Error('输出不得覆盖输入')
}
for (const v of ['baseline', 'candidate']) {
  runs[v] = await json(path.join(arg(v), 'results.json'))
  if (
    runs[v].datasetFingerprint !== data.fingerprint ||
    runs[v].inputsIndexSha256 !== inputHash ||
    JSON.stringify(runs[v].rows.map((r) => r.id)) !== JSON.stringify(data.samples.map((r) => r.id))
  )
    throw Error('固定运行输入或样本不一致')
}
if (
  index.datasetFingerprint !== data.fingerprint ||
  index.acceptanceListSha256 !== data.acceptanceListSha256
)
  throw Error('固定输入身份不符')
const rows = []
for (const s of data.samples) {
  const r = refs[s.id],
    entry = index.samples.find((x) => x.id === s.id),
    inputFile = path.join(arg('inputs'), s.id + '.json')
  if (
    !entry ||
    entry.sourceSha256 !== s.sourceSha256 ||
    entry.imageSha256 !== s.image.sha256 ||
    hash(await readFile(inputFile)) !== entry.inputSha256
  )
    throw Error(s.id + ' 固定输入指纹不符')
  if (!r || r.status !== 'reviewed' || api.validate(r, s).length)
    throw Error(s.id + ' 审核参照未通过校验')
  const original = pack.annotations.find((a) => a.store_id === s.id)
  const referencePaths = observed ? original.entrances : r.entrances
  const pathErrors = entranceErrors(referencePaths, s.image)
  if (pathErrors.length) throw Error(s.id + ' 入口几何错误：' + pathErrors.join('；'))
  const coverage =
    original.entranceCoverage === 'complete' && r.entranceReviewVersion === 2
      ? 'complete'
      : 'partial'
  const row = {
    id: s.id,
    name: s.name,
    page: s.page,
    referenceStatus: r.status,
    entranceCoverage: coverage,
    entranceSemantics: observed ? 'observed-current-layout' : 'boundary-opening',
    referenceWarnings: observed
      ? api.validate({ ...r, entrances: referencePaths }, s).filter((e) => e.startsWith('入口 '))
      : [],
    referenceMmPerPixel: api.scaleOf(r),
    versions: {},
  }
  for (const v of ['baseline', 'candidate']) {
    const file = await readFile(path.join(arg(v), s.id + '.json')),
      draft = JSON.parse(file),
      validScale =
        Number.isFinite(draft.scale?.mmPerPixel) &&
        draft.scale.mmPerPixel > 0 &&
        Array.isArray(draft.scale.originPx) &&
        draft.scale.originPx.length === 2 &&
        draft.scale.originPx.every(Number.isFinite)
    const px = (p) => [
      draft.scale.originPx[0] + (p[0] * 1000) / draft.scale.mmPerPixel,
      draft.scale.originPx[1] + (p[1] * 1000) / draft.scale.mmPerPixel,
    ]
    const polygon = validScale && draft.space?.boundary ? draft.space.boundary.map(px) : [],
      closed = polygon.length >= 3 && isSimplePolygon(polygon),
      scaleError = validScale
        ? Math.abs(draft.scale.mmPerPixel / row.referenceMmPerPixel - 1)
        : null
    let entrance,
      predictionError = null
    try {
      entrance = scoreEntrances(
        referencePaths,
        validScale
          ? (draft.space?.entrances ?? [])
              .filter((e) => e.kind !== 'back')
              .map((e) => ({ kind: 'polyline', points: [px(e.a), px(e.b)] }))
          : [],
        { coverage },
      )
    } catch (e) {
      predictionError = e.message
      entrance = scoreEntrances(r.entrances, [], { coverage })
    }
    const overlap = closed ? iou(r.boundary, polygon) : 0
    row.versions[v] = {
      draftSha256: hash(file),
      closed,
      iou: overlap,
      scaleError,
      boundaryPass: overlap >= 0.9,
      scalePass: scaleError !== null && scaleError <= 0.02,
      entrance,
      predictionError,
      allThree:
        coverage === 'complete'
          ? overlap >= 0.9 && scaleError !== null && scaleError <= 0.02 && entrance.pass
          : false,
    }
    if (coverage !== 'complete') row.versions[v].allThree = null
  }
  rows.push(row)
}
const summary = {
  protocol: 'entrance-path-coverage-v1',
  scope:
    '使用用户已审核参照重放固定基线/候选输出；不是重新运行引擎或45家验收。旧单入口仅评已知路径覆盖，不推定所有入口已标齐。',
  datasetFingerprint: data.fingerprint,
  reviewedSha256: hash(await readFile(arg('reviewed'))),
  inputsIndexSha256: inputHash,
  samples: rows.length,
  humanReviewed: rows.length,
  completeEntranceReferences: rows.filter((r) => r.entranceCoverage === 'complete').length,
  baselineRevision: runs.baseline.revision,
  candidateRevision: runs.candidate.revision,
  versions: {},
  criteria: {
    boundaryIoU: 0.9,
    scaleRelativeError: 0.02,
    pathTolerancePx: 12,
    pathSamplingMaxPx: 4,
    directionToleranceDegrees: 30,
    completePass: 'precision和recall均不低于0.9，重复预测长度小于1px；部分参照不计算完整分',
    allEntranceKinds: '所有非back入口；不会只取第一个main',
  },
}
for (const v of ['baseline', 'candidate']) {
  const values = rows.map((r) => r.versions[v]),
    full = values.filter((x) => x.entrance.coverage === 'complete')
  summary.versions[v] = {
    closed: values.filter((x) => x.closed).length,
    boundaryPass: values.filter((x) => x.boundaryPass).length,
    scalePass: values.filter((x) => x.scalePass).length,
    knownPathCoverageMean:
      values.reduce((sum, x) => sum + (x.entrance.knownReferenceCoverage ?? 0), 0) / values.length,
    completeEntrance: { eligible: full.length, passed: full.filter((x) => x.entrance.pass).length },
    allThree: { eligible: full.length, passed: full.filter((x) => x.allThree).length },
    invalidPredictions: values.filter((x) => x.predictionError).length,
  }
}
await mkdir(out)
await writeFile(path.join(out, '多入口复评.json'), JSON.stringify({ ...summary, rows }, null, 2))
const cell = (x) => '"' + String(x ?? '未完整标注').replaceAll('"', '""') + '"'
await writeFile(
  path.join(out, '逐店复评.csv'),
  '\uFEFF' +
    [
      [
        '编号',
        '名称',
        '入口参照完整性',
        '基线IoU',
        '候选IoU',
        '基线已知入口覆盖',
        '候选已知入口覆盖',
        '候选完整入口F1',
      ],
      ...rows.map((r) => [
        r.id,
        r.name,
        r.entranceCoverage,
        r.versions.baseline.iou,
        r.versions.candidate.iou,
        r.versions.baseline.entrance.knownReferenceCoverage,
        r.versions.candidate.entrance.knownReferenceCoverage,
        r.versions.candidate.entrance.f1,
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n'),
)
console.log(JSON.stringify(summary))
