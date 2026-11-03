// 只生成新版本证据包；不会覆盖原handoff、改名单或宣布BOM/几何已审核。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { isolatedOutput, checkedFile, sha256 } from './pilot-contract.mjs'
import { safePath, need } from './pilot-input.mjs'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export async function enrichInput({ bundle, dimensions, out }) {
  const bytes = await readFile(dimensions),
    rows = JSON.parse(bytes)
  need(
    Array.isArray(rows) && rows.length === 6 && new Set(rows.map((r) => r.store_id)).size === 6,
    '需固定首6逐店尺寸记录',
  )
  out = await isolatedOutput(out, [repo, bundle, path.dirname(path.resolve(dimensions))])
  await mkdir(out)
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const tool = await readFile(fileURLToPath(import.meta.url))
  for (const r of rows) {
    const root = await safePath(bundle, r.store_id),
      hb = await readFile(await safePath(root, 'handoff.json')),
      h = JSON.parse(hb)
    need(
      h.store_id === r.store_id &&
        h.sourceSha256 === r.sourceSha256 &&
        h.sourcePage === r.sourcePage &&
        r.humanReviewed === false,
      '尺寸不是该原页的代理记录',
    )
    need(
      Array.isArray(r.dimensions) &&
        r.dimensions.some((d) => d.role === 'calibration') &&
        r.dimensions.some((d) => d.role === 'independent-check'),
      '缺两类尺寸证据',
    )
    const dest = path.join(out, r.store_id)
    await mkdir(dest)
    for (const f of h.files) {
      const b = await checkedFile(root, f.path, f.sha256)
      await mkdir(path.dirname(path.join(dest, f.path)), { recursive: true })
      await writeFile(path.join(dest, f.path), b, { flag: 'wx' })
    }
    const additions = {
      'evidence/original-handoff.json': hb,
      'evidence/agent-dimensions.json': Buffer.from(JSON.stringify(r, null, 2)),
      'evidence/enrichment-tool.mjs': tool,
    }
    for (const [p, b] of Object.entries(additions)) {
      need(!h.files.some((f) => f.path === p), '不能重复补充覆盖：' + p)
      await writeFile(path.join(dest, p), b, { flag: 'wx' })
      h.files.push({ path: p, sha256: sha256(b) })
    }
    h.dimensions = r.dimensions
    h.missing = h.missing.filter(
      (s) => s !== '原页已提取，量尺端点与独立尺寸尚待逐店视觉核对，不准入C成品',
    )
    h.status = h.missing.length ? 'blocked' : 'draft'
    h.producer = {
      name: 'Codex/correction',
      tool: 'tools/recognition/pilot-enrich-input.mjs',
      codeRevision: revision,
      createdAt: new Date().toISOString(),
    }
    h.parentHandoffSha256 = sha256(hb)
    await writeFile(path.join(dest, 'handoff.json'), JSON.stringify(h, null, 2) + '\n', {
      flag: 'wx',
    })
  }
  await writeFile(
    path.join(out, 'enrichment.json'),
    JSON.stringify(
      {
        codeRevision: revision,
        toolSha256: sha256(tool),
        dimensionSourceSha256: sha256(bytes),
        scope: '仅补充代理尺寸，原BOM缺失及名单待核对项保留',
        humanReviewed: false,
        realCompleted: 0,
      },
      null,
      2,
    ),
  )
  return out
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].slice(2)
    need(
      process.argv[i].startsWith('--') &&
        ['bundle', 'dimensions', 'out'].includes(key) &&
        !args[key] &&
        process.argv[i + 1],
      '参数错误',
    )
    args[key] = process.argv[i + 1]
  }
  for (const k of ['bundle', 'dimensions', 'out']) need(args[k], '必须指定 --' + k)
  console.log(await enrichInput(args))
}
