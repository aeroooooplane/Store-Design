// 代理对图参照的开发复评。禁止把未签核草稿包装成人工金标准或整店合格率。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { isSimplePolygon } from '../../packages/shared/src/index.ts'
import { iou, entranceMatches } from './development-metrics.mjs'
const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    return i < 0 ? null : process.argv[i + 1]
  },
  json = async (p) => JSON.parse(await readFile(p, 'utf8'))
for (const k of ['references', 'dataset', 'baseline', 'candidate', 'out'])
  if (!arg(k)) throw new Error('缺少 --' + k)
const data = await json(arg('dataset')),
  refs = await json(arg('references')),
  base = await json(path.join(arg('baseline'), 'results.json')),
  cand = await json(path.join(arg('candidate'), 'results.json'))
if (refs.referenceKind !== 'agent_visual_draft' || refs.humanReviewed !== false)
  throw new Error('本工具仅支持明确标记的代理参照草稿')
if (
  [refs.datasetFingerprint, base.datasetFingerprint, cand.datasetFingerprint].some(
    (f) => f !== data.fingerprint,
  ) ||
  base.inputsIndexSha256 !== cand.inputsIndexSha256
)
  throw new Error('固定数据或运行输入版本不同')
if (
  refs.samples.length !== data.samples.length ||
  new Set(refs.samples.map((r) => r.id)).size !== data.samples.length
)
  throw new Error('参照清单遗漏或重复')
const out = path.resolve(arg('out'))
for (const k of ['references', 'dataset', 'baseline', 'candidate']) {
  const p = path.resolve(arg(k))
  if (
    out === p ||
    (k !== 'references' && out.startsWith((k === 'dataset' ? path.dirname(p) : p) + path.sep))
  )
    throw new Error('复评输出不得覆盖输入目录')
}
const rows = []
for (const sample of data.samples) {
  const ref = refs.samples.find((r) => r.id === sample.id)
  if (!ref || ref.imageSha256 !== sample.image.sha256 || ref.sourceSha256 !== sample.sourceSha256)
    throw new Error(sample.id + ' 参照不是当前固定原图')
  if (!isSimplePolygon(ref.boundary)) throw new Error(sample.id + ' 参照多边形无效')
  const scale =
    ref.lengthMm /
    Math.hypot(
      ref.calibration[1][0] - ref.calibration[0][0],
      ref.calibration[1][1] - ref.calibration[0][1],
    )
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(sample.id + ' 参照比例无效')
  const xs = ref.boundary.map((p) => p[0]),
    ys = ref.boundary.map((p) => p[1]),
    tolerance = Math.max(
      12,
      0.03 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    )
  const eligibility = {
    boundary: ref.componentReview.boundary,
    scale: ref.componentReview.scale,
    entrance: ref.componentReview.boundary && ref.componentReview.entrance,
  }
  const result = {
    id: sample.id,
    name: sample.name,
    page: sample.page,
    referenceMmPerPixel: scale,
    eligibility,
    question: ref.question,
    referenceNotes: ref.notes,
  }
  for (const version of ['baseline', 'candidate']) {
    const draft = await json(path.join(arg(version), sample.id + '.json'))
    const validScale = Number.isFinite(draft?.scale?.mmPerPixel) && draft.scale.mmPerPixel > 0
    const px = (p) => [
      draft.scale.originPx[0] + (p[0] * 1000) / draft.scale.mmPerPixel,
      draft.scale.originPx[1] + (p[1] * 1000) / draft.scale.mmPerPixel,
    ]
    const boundary = validScale && draft.space ? draft.space.boundary.map(px) : []
    const closed = boundary.length >= 3 && isSimplePolygon(boundary),
      overlap = eligibility.boundary ? (closed ? iou(ref.boundary, boundary) : 0) : null
    const scaleError =
      eligibility.scale && validScale ? Math.abs(draft.scale.mmPerPixel / scale - 1) : null
    const entrance = eligibility.entrance
      ? Boolean(
          closed &&
          entranceMatches(
            ref.boundary,
            ref.acceptedEntranceEdges,
            (draft.space.entrances ?? [])
              .filter((e) => e.kind === 'main')
              .map((e) => [px(e.a), px(e.b)]),
            tolerance,
          ),
        )
      : null
    const boundaryPass = eligibility.boundary ? overlap >= 0.9 : null,
      scalePass = eligibility.scale ? scaleError !== null && scaleError <= 0.02 : null
    const complete = Object.values(eligibility).every(Boolean)
    result[version] = {
      closed,
      iou: overlap,
      scaleError,
      entrance,
      boundaryPass,
      scalePass,
      allThree: complete ? boundaryPass && scalePass && entrance : null,
      nearThreshold:
        (overlap !== null && overlap >= 0.88 && overlap <= 0.92) ||
        (scaleError !== null && scaleError >= 0.01 && scaleError <= 0.03),
    }
  }
  rows.push(result)
}
const count = (version, key, pass) => ({
  eligible: rows.filter((r) => r[version][key] !== null).length,
  passed: rows.filter((r) => r[version][key] === pass).length,
})
const summary = {
  scope: '代理独立对图参照复评（待用户抽审），非45家验收、非整店合格率',
  humanReviewed: 0,
  datasetFingerprint: data.fingerprint,
  referenceSha256: createHash('sha256')
    .update(await readFile(arg('references')))
    .digest('hex'),
  inputsIndexSha256: base.inputsIndexSha256,
  baselineRevision: base.revision,
  candidateRevision: cand.revision,
  samples: rows.length,
  questions: rows.filter((r) => r.question).length,
  criteria: {
    boundaryIoU: 0.9,
    relativeScaleError: 0.02,
    entrance:
      '主入口中心最近的原图边属于允许主通道边，距离不超过外接框对角线3%且至少12px；仅边侧、不评价门宽',
    nearThreshold: 'IoU 0.88–0.92 或比例误差 1%–3% 标为抽审优先；预览描点位置约 ±6 原图像素',
    missingResult: '在可判定样本内按失败计入；有歧义的项目按项目列为不可判定，不从48家总数移除',
  },
  versions: {},
}
for (const v of ['baseline', 'candidate'])
  summary.versions[v] = {
    closed: rows.filter((r) => r[v].closed).length,
    boundary: count(v, 'boundaryPass', true),
    scale: count(v, 'scalePass', true),
    entrance: count(v, 'entrance', true),
    allThree: count(v, 'allThree', true),
  }
await mkdir(out, { recursive: true })
await writeFile(path.join(out, '复评结果.json'), JSON.stringify({ ...summary, rows }, null, 2))
const csv = (v) => '"' + String(v ?? '待确认').replaceAll('"', '""') + '"'
await writeFile(
  path.join(out, '逐店复评.csv'),
  '\uFEFF' +
    [
      [
        '编号',
        '名称',
        '边界可判定',
        '比例可判定',
        '入口可判定',
        '基线IoU',
        '候选IoU',
        '基线比例误差',
        '候选比例误差',
        '基线入口',
        '候选入口',
        '候选三项均通过',
        '歧义',
      ],
      ...rows.map((r) => [
        r.id,
        r.name,
        r.eligibility.boundary,
        r.eligibility.scale,
        r.eligibility.entrance,
        r.baseline.iou,
        r.candidate.iou,
        r.baseline.scaleError,
        r.candidate.scaleError,
        r.baseline.entrance,
        r.candidate.entrance,
        r.candidate.allThree,
        r.question ?? '无',
      ]),
    ]
      .map((r) => r.map(csv).join(','))
      .join('\r\n'),
)
console.log(JSON.stringify(summary))
