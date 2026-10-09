import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
export function sourcePdfRoot() {
  const configFile = path.join(repositoryRoot, 'resources.local.json')
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {}
  const configured = process.env.STORE_SOURCE_PDFS || config.sourcePdfRoot || '资源库/01_各门店原图纸'
  return path.resolve(repositoryRoot, configured)
}
export const sourcePdfPath = file => path.join(sourcePdfRoot(), path.basename(file))
