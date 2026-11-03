import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsonSha256, validateManifest, checkedFile, isolatedOutput } from './pilot-contract.mjs'

const names = ['manifest', 'acceptance-index', 'development-index', 'repo', 'resources', 'out'],
  args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  if (
    !process.argv[i].startsWith('--') ||
    !names.includes(key) ||
    args[key] ||
    !process.argv[i + 1] ||
    process.argv[i + 1].startsWith('--')
  )
    throw Error('参数错误/重复：' + process.argv[i])
  args[key] = process.argv[i + 1]
}
for (const key of names) if (!args[key]) throw Error('必须指定 --' + key)
const read = async (p) => JSON.parse(await readFile(p, 'utf8'))
const manifest = await read(args.manifest),
  acceptance = await read(args['acceptance-index']),
  development = await read(args['development-index'])
const out = await isolatedOutput(args.out, [
  args.repo,
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  args.resources,
  ...names
    .filter((k) => k.endsWith('index') || k === 'manifest')
    .map((k) => path.dirname(path.resolve(args[k]))),
])
const report = validateManifest(manifest, acceptance, development),
  lock = await read(path.join(args.repo, 'resources.lock.json'))
if (
  jsonSha256(lock) !== manifest.resourceLockSha256 ||
  lock.releaseVersions?.models !== manifest.modelsVersion
)
  throw Error('资源锁/模型版本与冻结名单不符')
await checkedFile(
  args.resources,
  '04_模型库/manifest.json',
  lock.requiredFiles['04_模型库/manifest.json'].toLowerCase(),
)
report.inputErrorCount = 0
for (const [i, s] of manifest.samples.entries()) {
  try {
    await checkedFile(args.resources, s.source.path, s.source.sha256)
    report.rows[i].inputStatus = 'source_hash_checked'
  } catch (e) {
    report.rows[i].inputStatus = 'invalid'
    report.rows[i].reason = e.message
    report.inputErrorCount++
  }
}
report.limitations.push(
  'page/pageCount来自生产者声明，本工具只核验源文件哈希，不解析PDF核对页数或图纸内容；B项须独立对原页检查',
)
await mkdir(out)
await writeFile(path.join(out, 'manifest-check.json'), JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
})
console.log(
  JSON.stringify({
    scope: report.scope,
    sampleCount: 24,
    invalid: report.inputErrorCount,
    trainingEligible: false,
  }),
)
if (report.inputErrorCount) process.exitCode = 1
