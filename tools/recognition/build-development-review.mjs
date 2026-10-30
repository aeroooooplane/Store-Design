// 将固定输入、两个版本的结果与独立对图修正组织为审核包。机器结果始终不是已审核真值。
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? null : process.argv[i + 1]
}
for (const key of ['dataset', 'inputs', 'baseline', 'candidate', 'out'])
  if (!arg(key)) throw new Error(`必须指定 --${key}`)
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex')
const data = await json(arg('dataset')),
  index = await json(path.join(arg('inputs'), 'inputs.json')),
  baseline = await json(path.join(arg('baseline'), 'results.json')),
  candidate = await json(path.join(arg('candidate'), 'results.json'))
const inputHash = hash(await readFile(path.join(arg('inputs'), 'inputs.json')))
if (
  [index.datasetFingerprint, baseline.datasetFingerprint, candidate.datasetFingerprint].some(
    (v) => v !== data.fingerprint,
  ) ||
  [baseline.inputsIndexSha256, candidate.inputsIndexSha256].some((v) => v !== inputHash)
)
  throw new Error('对比版本未使用相同固定输入')
if (
  [baseline, candidate].some(
    (run) =>
      JSON.stringify(run.rows.map((s) => s.id)) !== JSON.stringify(data.samples.map((s) => s.id)),
  )
)
  throw new Error('对比结果遗漏或替换样本')
const out = path.resolve(arg('out'))
for (const source of ['dataset', 'inputs', 'baseline', 'candidate']) {
  const root =
    source === 'dataset' ? path.dirname(path.resolve(arg(source))) : path.resolve(arg(source))
  if (out === root || out.startsWith(root + path.sep))
    throw new Error('审核输出不能覆盖输入或运行证据')
}
const corrections = arg('corrections') ? await json(arg('corrections')) : { samples: [] }
if (corrections.samples.length && corrections.datasetFingerprint !== data.fingerprint)
  throw new Error('对图修正版本不符')
const edits = new Map(corrections.samples.map((s) => [s.id, s]))
if (
  edits.size !== corrections.samples.length ||
  [...edits.keys()].some((id) => !data.samples.some((s) => s.id === id))
)
  throw new Error('修正清单有重复或未知门店')
const sharp = createRequire(path.resolve(import.meta.dirname, '../../package.json'))('sharp')
await mkdir(path.join(out, 'images'), { recursive: true })
await mkdir(path.join(out, 'overlays'), { recursive: true })
const annotations = [],
  rows = []
for (const s of data.samples) {
  const input = await json(path.join(arg('inputs'), `${s.id}.json`)),
    draft = await json(path.join(arg('candidate'), `${s.id}.json`))
  const before = baseline.rows.find((r) => r.id === s.id),
    after = candidate.rows.find((r) => r.id === s.id)
  const pixel = ([x, y]) => [
    draft.scale.originPx[0] + (x * 1000) / draft.scale.mmPerPixel,
    draft.scale.originPx[1] + (y * 1000) / draft.scale.mmPerPixel,
  ]
  const boundary = draft?.space && draft.scale ? draft.space.boundary.map(pixel) : []
  const entrance =
    draft?.space?.entrances[0] && draft.scale
      ? [pixel(draft.space.entrances[0].a), pixel(draft.space.entrances[0].b)]
      : []
  const chain = [...input.chains]
    .filter((c) => Number.isFinite(c.mm) && c.mm > 0)
    .sort((a, b) => Math.abs(b.b - b.a) - Math.abs(a.b - a.a))[0]
  const record = {
    boundary,
    calibration: chain
      ? chain.horizontal
        ? [
            [chain.a, chain.at],
            [chain.b, chain.at],
          ]
        : [
            [chain.at, chain.a],
            [chain.at, chain.b],
          ]
      : [],
    lengthMm: chain?.mm ?? 0,
    entrance,
    geometry: '',
    openEdge: s.shopType === '中岛店',
    pageType: s.preliminaryType,
    reviewer: '',
    notes: '自动草稿，尚未对图校正；量尺为 OCR 候选，入口可能采用默认宽度。',
    status: 'pending',
    origin: 'recognizer',
    agentStatus: 'unreviewed',
    evidence: [
      `候选代码 ${candidate.revision}`,
      `固定输入 ${after.inputSha256}`,
      `运行结果：${after.failure ?? '内部检查通过（不等于边界正确）'}`,
    ],
  }
  const edit = edits.get(s.id)
  if (edit) {
    if (edit.imageSha256 !== s.image.sha256) throw new Error(`${s.id} 对图依据不是当前原图`)
    for (const k of [
      'boundary',
      'calibration',
      'lengthMm',
      'entrance',
      'geometry',
      'openEdge',
      'pageType',
      'notes',
      'agentStatus',
    ])
      if (edit[k] !== undefined) record[k] = edit[k]
    record.origin = edit.boundary || edit.calibration ? 'visual-correction' : 'recognizer'
    record.status = edit.agentStatus === 'needs_decision' ? 'ambiguous' : 'pending'
    record.evidence.push(...(edit.evidence ?? []))
  }
  for (const k of ['boundary', 'calibration', 'entrance']) {
    if (
      record[k].some(
        (p) =>
          p.length !== 2 ||
          p.some((v) => !Number.isFinite(v)) ||
          p[0] < 0 ||
          p[1] < 0 ||
          p[0] > s.image.width ||
          p[1] > s.image.height,
      )
    ) {
      record[k] = []
      record.evidence.push(`${k} 草稿超出原图，已留空等待校正`)
      record.agentStatus = 'needs_decision'
      record.status = 'ambiguous'
    }
  }
  const picture = await readFile(path.join(arg('inputs'), `${s.id}.png`))
  if (hash(picture) !== s.image.sha256) throw new Error(`${s.id} 图片指纹不符`)
  await writeFile(path.join(out, s.image.path), picture)
  await sharp(picture)
    .resize({ width: 600 })
    .webp({ quality: 75 })
    .toFile(path.join(out, `images/${s.id}-thumb.webp`))
  const polygon = (points, color) =>
    points.length >= 3
      ? `<polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="${color}18" stroke="${color}" stroke-width="4"/>`
      : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s.image.width}" height="${s.image.height}">${polygon(boundary, '#007aff')}${record.origin === 'visual-correction' ? polygon(record.boundary, '#169447') : ''}</svg>`
  await sharp(picture)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(path.join(out, `overlays/${s.id}.png`))
  s.annotationDraft = record
  annotations.push({
    store_id: s.id,
    sourceSha256: s.sourceSha256,
    image: s.image,
    page: s.page,
    ...record,
  })
  rows.push({
    id: s.id,
    baselineClosed: before.closed ?? false,
    candidateClosed: after.closed ?? false,
    baselineFailure: before.failure ?? before.executionError ?? null,
    candidateFailure: after.failure ?? after.executionError ?? null,
    baselineVertices: before.vertices ?? 0,
    candidateVertices: after.vertices ?? 0,
    baselineAreaM2: before.areaM2 ?? null,
    candidateAreaM2: after.areaM2 ?? null,
    agentStatus: record.agentStatus,
    annotationStatus: record.status,
    notes: record.notes,
  })
}
data.reviewVersion = arg('corrections')
  ? 'visual-' + hash(await readFile(arg('corrections'))).slice(0, 12)
  : 'drafts-20261030-v1'
const pack = {
  schemaVersion: 1,
  datasetId: data.id,
  fingerprint: data.fingerprint,
  reviewVersion: data.reviewVersion,
  acceptanceListSha256: data.acceptanceListSha256,
  annotationScope: data.annotationScope,
  fullStoreQualificationAvailable: false,
  annotations,
}
const report = {
  scope: '固定输入运行诊断；非正式准确率',
  datasetFingerprint: data.fingerprint,
  inputsIndexSha256: inputHash,
  baselineRevision: baseline.revision,
  candidateRevision: candidate.revision,
  samples: rows.length,
  baselineClosed: rows.filter((r) => r.baselineClosed).length,
  candidateClosed: rows.filter((r) => r.candidateClosed).length,
  executionErrors: [...baseline.rows, ...candidate.rows].filter((r) => r.executionError).length,
  humanReviewed: 0,
  agentChecked: rows.filter((r) => r.agentStatus === 'checked').length,
  needsDecision: rows.filter((r) => r.agentStatus === 'needs_decision').length,
  rows,
}
await writeFile(path.join(out, '标注草稿.json'), JSON.stringify(pack, null, 2))
await writeFile(path.join(out, '运行对比.json'), JSON.stringify(report, null, 2))
await writeFile(path.join(out, 'candidates.json'), JSON.stringify(data, null, 2))
const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
await writeFile(
  path.join(out, '运行与审核清单.csv'),
  '\uFEFF' +
    [
      [
        '编号',
        '基线闭合',
        '候选闭合',
        '基线失败原因',
        '候选失败原因',
        '对图状态',
        '人工审核状态',
        '说明',
      ],
      ...rows.map((r) => [
        r.id,
        r.baselineClosed,
        r.candidateClosed,
        r.baselineFailure,
        r.candidateFailure,
        r.agentStatus,
        r.annotationStatus,
        r.notes,
      ]),
    ]
      .map((r) => r.map(csv).join(','))
      .join('\r\n'),
)
const template = await readFile(new URL('./review-template.html', import.meta.url), 'utf8')
await writeFile(
  path.join(out, '开发集审核.html'),
  template.replace(/\/\*DATASET\*\/\s*null/, JSON.stringify(data).replaceAll('<', '\\u003c')),
)
if (arg('corrections')) await copyFile(arg('corrections'), path.join(out, '对图修正记录.json'))
console.log(JSON.stringify({ ...report, rows: undefined }))
