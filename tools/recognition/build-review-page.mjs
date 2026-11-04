// 离线审核页构建：旧资料只读，输出必须是新目录；不运行识别引擎。
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadReview } from './check-review-template.mjs'
const arg = (k) => {
  const i = process.argv.indexOf('--' + k)
  return i < 0 ? null : process.argv[i + 1]
}
for (const k of ['dataset', 'out']) if (!arg(k)) throw Error('缺少 --' + k)
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = (b) => createHash('sha256').update(b).digest('hex')
const data = await json(arg('dataset')),
  root = path.dirname(path.resolve(arg('dataset'))),
  out = path.resolve(arg('out'))
if (out === root || out.startsWith(root + path.sep)) throw Error('输出不得位于旧资料包内')
if (arg('reviewed')) data.reviewedPack = await json(arg('reviewed'))
const { api } = await loadReview(data)
const report = {
  schemaVersion: 2,
  samples: data.samples.length,
  userReviewed: 0,
  validationProblems: [],
  sourceHashes: [],
  scope: '轮廓、量尺、多入口；家具和整店验收未完成',
}
if (data.reviewedPack) {
  if (data.reviewedPack.annotations.length !== data.samples.length)
    throw Error('本次迁移必须提供完整审核包')
  report.reviewedInputSha256 = hash(await readFile(arg('reviewed')))
}
// 先校验全部来源与导入，再创建输出，避免把部分资料误认为完整包。
for (const s of data.samples) {
  if (!/^[A-Z]+-\d+$/.test(s.id)) throw Error('门店编号无效')
  const p = path.resolve(root, s.image.path)
  if (!p.startsWith(root + path.sep)) throw Error('图像路径越界')
  const sha = hash(await readFile(p))
  if (sha !== s.image.sha256) throw Error(s.id + ' 原图指纹不符')
  const r = api.getRecords()[s.id]
  if (r) {
    const errors = api.validate(r, s)
    if (errors.length) report.validationProblems.push({ id: s.id, errors })
    if (r.status === 'reviewed' && !errors.length) report.userReviewed++
  }
  report.sourceHashes.push({ id: s.id, sha256: sha })
}
await mkdir(out)
await mkdir(path.join(out, 'images'))
for (const s of data.samples) {
  await copyFile(path.resolve(root, s.image.path), path.join(out, 'images', s.id + '.png'))
  await copyFile(
    path.join(root, 'images', s.id + '-thumb.webp'),
    path.join(out, 'images', s.id + '-thumb.webp'),
  )
  s.image.path = 'images/' + s.id + '.png'
}
const template = await readFile(new URL('./review-template.html', import.meta.url), 'utf8')
await writeFile(
  path.join(out, '审核.html'),
  template.replace(/\/\*DATASET\*\/\s*null/, () => JSON.stringify(data).replaceAll('<', '\\u003c')),
)
await writeFile(path.join(out, 'candidates.json'), JSON.stringify(data, null, 2))
if (arg('reviewed')) await copyFile(arg('reviewed'), path.join(out, '原始用户审核包.json'))
await writeFile(path.join(out, '迁移核验.json'), JSON.stringify(report, null, 2))
await writeFile(path.join(out, '审核-v2.json'), JSON.stringify(api.exportPack(), null, 2))
console.log(JSON.stringify({ ...report, sourceHashes: report.sourceHashes.length }))
