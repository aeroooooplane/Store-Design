import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DisplayBodyIndexSchema } from '@store/shared'
import type { DisplayBody } from '@store/shared'
import { storageRoots } from '../app.ts'
import { loadConfig } from '../config/env.ts'
import { LIBRARY_DIR } from '../modules/assets/importer.ts'
import { lightPaths } from '../modules/assets/light-records.ts'
import { sha256File } from '../lib/storage.ts'
import {
  DISPLAY_BODY_DIR,
  DISPLAY_BODY_SOURCES,
  buildDisplayBody,
} from '../modules/displays/bodies.ts'

// Cuts the bare display tables out of the library models (资源库/04_模型库) into
// 资源库/10_产品与陈列/展陈桌体 with index.json. Skips tables whose model has not changed.
// Usage: [asset-id ...] (none = all; named ones are rebuilt).
const TOOL = 'build-display-bodies 1'
const config = loadConfig()
const resource = storageRoots(config).resource
const library = path.join(resource, LIBRARY_DIR)
const out = path.join(resource, DISPLAY_BODY_DIR)
const wanted = new Set(process.argv.slice(2))

const text = await readFile(path.join(library, 'manifest.json'), 'utf8')
const manifest = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as {
  assets: { asset_id: string; web_model?: string | null }[]
}
const previous = await readFile(path.join(out, 'index.json'), 'utf8')
  .then((t) => DisplayBodyIndexSchema.parse(JSON.parse(t)).bodies)
  .catch(() => [] as DisplayBody[])

const bodies: DisplayBody[] = []
const failures: string[] = []
for (const source of DISPLAY_BODY_SOURCES) {
  const entry = manifest.assets.find((a) => a.asset_id === source.asset)
  if (!entry?.web_model) {
    failures.push(`${source.asset} ${source.name}：模型库里没有网页模型`)
    continue
  }
  const model = lightPaths(path.join(library, entry.web_model), 'white').source
  const sha = await sha256File(model).catch(() => null)
  const old = previous.find((b) => b.asset === source.asset)
  if (old && old.sourceSha256 === sha && !wanted.has(source.asset)) {
    bodies.push(old)
    console.log(`${source.asset} ${source.name}：已是最新`)
    continue
  }
  try {
    const started = Date.now()
    const body = await buildDisplayBody(source, model, path.join(out, `${source.asset}.glb`))
    bodies.push(body)
    console.log(
      `${source.asset} ${source.name}：桌面 ${body.top} m，凹槽 ${body.recesses.length} 个，` +
        `${body.triangles} 面，${Math.round(body.bytes / 1024)} KB，` +
        `${Math.round((Date.now() - started) / 1000)} 秒`,
    )
  } catch (error) {
    failures.push(`${source.asset} ${source.name}：${(error as Error).message}`)
    if (old) bodies.push(old)
  }
}
await writeFile(
  path.join(out, 'index.json'),
  `${JSON.stringify({ schemaVersion: 1, tool: TOOL, bodies }, null, 2)}\n`,
)
console.log(`展陈桌体：${bodies.length} 款${failures.length ? `，失败 ${failures.length}` : ''}`)
for (const f of failures) console.log(`  - ${f}`)
if (failures.length) process.exitCode = 1
