import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { storageRoots } from '../app.ts'
import { loadConfig } from '../config/env.ts'
import { LIBRARY_DIR } from '../modules/assets/importer.ts'
import { WhiteRecordSchema, buildWhiteModel, whitePaths } from '../modules/assets/white-models.ts'
import { sha256File } from '../lib/storage.ts'

// Builds the light white-model GLB next to every web model listed in the library manifest
// (资源库/04_模型库). Skips models whose white.json already matches the current model.glb.
// Usage: [asset-id ...] (none = all).
const config = loadConfig()
const root = path.join(storageRoots(config).resource, LIBRARY_DIR)
const wanted = new Set(process.argv.slice(2))
const text = await readFile(path.join(root, 'manifest.json'), 'utf8')
const manifest = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as {
  assets: { asset_id: string; web_model?: string | null }[]
}
const models = manifest.assets
  .filter((a) => a.web_model && (wanted.size === 0 || wanted.has(a.asset_id)))
  .map((a) => ({ id: a.asset_id, dir: path.join(root, a.web_model ?? '') }))
  .sort((a, b) => a.id.localeCompare(b.id))

let built = 0
let skipped = 0
const failures: string[] = []
for (const { id, dir } of models) {
  const paths = whitePaths(dir)
  const sourceSha = await sha256File(paths.source).catch(() => null)
  if (!sourceSha) continue
  const existing = await readFile(paths.record, 'utf8')
    .then((text) => WhiteRecordSchema.parse(JSON.parse(text)))
    .catch(() => null)
  if (existing?.sourceSha256 === sourceSha && wanted.size === 0) {
    skipped++
    continue
  }
  try {
    const record = await buildWhiteModel(paths.source, paths.glb)
    await writeFile(paths.record, `${JSON.stringify(record, null, 2)}\n`)
    built++
    console.log(
      `${id}: ${record.trianglesBefore} → ${record.trianglesAfter} 面，` +
        `${Math.round(record.sourceBytes / 1024)} → ${Math.round(record.bytes / 1024)} KB，` +
        `外形偏差 ${(record.driftM * 1000).toFixed(1)} mm`,
    )
  } catch (error) {
    failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
console.log(`白模轻量版：新建 ${built}，已是最新 ${skipped}，失败 ${failures.length}`)
for (const failure of failures) console.warn(`  - ${failure}`)
