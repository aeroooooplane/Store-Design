import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const argument = process.argv[2]
if (!argument) throw new Error('用法：node tools/boldsite/package.mjs <新建发布目录>')
const output = path.resolve(argument)
const repository = fileURLToPath(new URL('../../', import.meta.url))

const buildOptions = {
  cwd: repository,
  env: { ...process.env, VITE_BOLDSITE_PROJECT_PILOT: '1' },
  stdio: 'inherit',
}
const result =
  process.platform === 'win32'
    ? spawnSync('pnpm --filter @store/web build --mode boldsite', { ...buildOptions, shell: true })
    : spawnSync('pnpm', ['--filter', '@store/web', 'build', '--mode', 'boldsite'], buildOptions)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

await mkdir(output)
await cp(path.join(repository, 'apps/web/dist'), output, { recursive: true })
for (const file of [
  'app.py',
  'catalog.py',
  'contract.py',
  'drawings.py',
  'projects.py',
  'storage.py',
  'storage_gate.py',
  'requirements.txt',
  'boldsite.json',
]) {
  await cp(path.join(repository, 'apps/boldsite', file), path.join(output, file), {
    force: false,
    errorOnExist: true,
  })
}
const catalog = process.argv[3]
if (catalog) {
  const source = path.resolve(catalog)
  await cp(path.join(source, 'index.json'), path.join(output, 'catalog', 'index.json'))
  const display = path.join(source, 'display.json')
  if (existsSync(display)) await cp(display, path.join(output, 'catalog', 'display.json'))
  await cp(path.join(source, 'files'), path.join(output, 'catalog', 'files'), {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
}
console.log(output)
