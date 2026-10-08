import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
export function sourcePdfRoot() {
  const configFile = path.join(repositoryRoot, 'resources.local.json')
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {}
  const configured = process.env.STORE_SOURCE_PDFS || config.sourcePdfRoot
  if (!configured) throw Error('请设置 STORE_SOURCE_PDFS，或在 resources.local.json 中填写 sourcePdfRoot。原PDF已移出仓库。')
  return path.resolve(configured)
}
export const sourcePdfPath = file => path.join(sourcePdfRoot(), path.basename(file))
