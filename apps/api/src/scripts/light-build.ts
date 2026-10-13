import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import { storageRoots } from '../app.ts'
import { loadConfig } from '../config/env.ts'
import { LIBRARY_DIR } from '../modules/assets/importer.ts'
import { lightPaths } from '../modules/assets/light-records.ts'
import type { LightKind } from '../modules/assets/light-records.ts'
import { sha256File } from '../lib/storage.ts'

interface LightBuild<R extends { sourceSha256: string }> {
  kind: LightKind
  /** Shown in the summary line, e.g. 白模轻量版. */
  title: string
  record: z.ZodType<R>
  build(source: string, target: string): Promise<R>
  /** One line per built model. */
  describe(id: string, record: R, seconds: number): string
}

/**
 * Builds a light model next to every web model listed in the library manifest (资源库/04_模型库),
 * skipping models whose record already matches the current model.glb unless they are named.
 * Arguments: [asset-id ...] (none = all).
 */
export async function runLightBuild<R extends { sourceSha256: string }>(
  options: LightBuild<R>,
): Promise<void> {
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
    const paths = lightPaths(dir, options.kind)
    const sourceSha = await sha256File(paths.source).catch(() => null)
    if (!sourceSha) continue
    const existing = await readFile(paths.record, 'utf8')
      .then((text) => options.record.parse(JSON.parse(text)))
      .catch(() => null)
    if (existing?.sourceSha256 === sourceSha && wanted.size === 0) {
      skipped++
      continue
    }
    try {
      const started = Date.now()
      const record = await options.build(paths.source, paths.glb)
      await writeFile(paths.record, `${JSON.stringify(record, null, 2)}\n`)
      built++
      console.log(options.describe(id, record, (Date.now() - started) / 1000))
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`${options.title}：新建 ${built}，已是最新 ${skipped}，失败 ${failures.length}`)
  for (const failure of failures) console.warn(`  - ${failure}`)
}
