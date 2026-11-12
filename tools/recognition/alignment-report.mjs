import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { sha256, escape, shapePath, changeSummary, durationSummary } from './alignment-core.mjs'

export async function buildReport(input, output) {
  const read = async (n) => JSON.parse(await fs.readFile(path.join(input, n), 'utf8'))
  const [annotation, raw, frozen, events, metrics, changes, revisions] = await Promise.all(
    [
      '校正结果.json',
      '自动原始/raw.json',
      '自动结果冻结.json',
      '阶段记录.json',
      '贴线检查.json',
      '逐项改动.json',
      '复核修订.json',
    ].map(read),
  )
  for (const f of frozen.files)
    assert.equal(
      sha256(await fs.readFile(path.join(input, '自动原始', f.name))),
      f.sha256,
      '自动结果冻结后被改动',
    )
  assert.equal(raw.inputSha256, annotation.sourceSha256, '原图来源不匹配')
  assert.equal(raw.width, annotation.image.width)
  assert.equal(raw.height, annotation.image.height)
  const summary = changeSummary(raw, annotation),
    timing = durationSummary(events)
  const img = await fs.readFile(path.join(input, '自动原始/input.png'))
  const shapes = annotation.features
    .map(
      (f) =>
        `<path data-id="${escape(f.id)}" data-kind="${escape(f.kind)}" d="${shapePath(f.geometry)}" fill="none" fill-rule="evenodd" stroke="${f.kind === 'reference' ? '#777' : '#a87900'}" stroke-width="1.3" ${['boundary', 'reference'].includes(f.kind) ? 'stroke-dasharray="6 4"' : ''}><title>${escape(f.id + ' ' + f.label)}</title></path>`,
    )
    .join('')
  const automatic = raw.polygons
    .map(
      (p) =>
        `<path d="${shapePath({ type: 'polygon', points: p.points })}" fill="none" stroke="#a87900" stroke-width="2"/>`,
    )
    .join('')
  const prefix = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${annotation.viewBox.join(' ')}"><rect width="2200" height="1556" fill="white"/>`
  const under = `<image width="2200" height="1556" href="data:image/png;base64,${img.toString('base64')}" opacity=".65"/>`
  await fs.mkdir(output, { recursive: true })
  await fs.copyFile(path.join(input, '自动原始/input.png'), path.join(output, '原图.png'))
  await fs.writeFile(path.join(output, '二维叠图.svg'), prefix + under + shapes + '</svg>')
  await fs.writeFile(path.join(output, '二维线稿.svg'), prefix + shapes + '</svg>')
  const audit = {
    schemaVersion: 1,
    annotationSha256: sha256(JSON.stringify(annotation)),
    summary,
    timing,
    metrics,
    changes,
    revisions,
    events,
    frozen,
    source: await read('来源.json'),
  }
  await fs.writeFile(path.join(output, '校正结果.json'), JSON.stringify(annotation, null, 2))
  await fs.writeFile(path.join(output, '过程记录.json'), JSON.stringify(audit, null, 2))
  await fs.copyFile(path.join(input, '自动原始/raw.json'), path.join(output, '自动原始.json'))
  await fs.copyFile(path.join(input, '自动原始/reading.json'), path.join(output, '自动文字.json'))
  const template = await fs.readFile(new URL('./alignment-review.html', import.meta.url), 'utf8')
  const payload = JSON.stringify({ annotation, audit }).replace(/</g, '\\u003c')
  const html = template
    .replace('<!--DATA-->', `<script id="data" type="application/json">${payload}</script>`)
    .replace('<!--SHAPES-->', shapes)
    .replace('<!--AUTO-->', automatic)
    .replace('VIEWBOX', annotation.viewBox.join(' '))
    .replace(
      'CROPBOX',
      `x="${annotation.viewBox[0]}" y="${annotation.viewBox[1]}" width="${annotation.viewBox[2]}" height="${annotation.viewBox[3]}"`,
    )
  await fs.writeFile(path.join(output, '审核页.html'), html)
  return { summary, timing }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2] && process.argv[3], '用法：node alignment-report.mjs 输入目录 输出目录')
  console.log(
    JSON.stringify(
      await buildReport(path.resolve(process.argv[2]), path.resolve(process.argv[3])),
      null,
      2,
    ),
  )
}
