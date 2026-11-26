import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [argument, ...options] = process.argv.slice(2)
const fullWorkbench = options.includes('--workbench')
const catalogs = options.filter((value) => value !== '--workbench')
if (!argument || options.length > 2 || catalogs.length > 1 || catalogs[0]?.startsWith('--')) {
  throw new Error('用法：node tools/boldsite/package.mjs <新建发布目录> [正式库目录] [--workbench]')
}
const output = path.resolve(argument)
const repository = fileURLToPath(new URL('../../', import.meta.url))

const buildOptions = {
  cwd: repository,
  env: {
    ...process.env,
    VITE_BOLDSITE_PROJECT_PILOT: fullWorkbench ? '0' : '1',
    VITE_BOLDSITE_FULL_WORKBENCH: fullWorkbench ? '1' : '0',
  },
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
await cp(
  path.join(repository, 'apps/api/assets/fonts/OFL.txt'),
  path.join(output, 'static', 'NotoSansSC-OFL.txt'),
)
for (const file of [
  'app.py',
  'catalog.py',
  'contract.py',
  'drawings.py',
  'projects.py',
  'storage.py',
  'storage_gate.py',
  'workbench.py',
  'rules.py',
  'requirements.txt',
  'boldsite.json',
]) {
  await cp(path.join(repository, 'apps/boldsite', file), path.join(output, file), {
    force: false,
    errorOnExist: true,
  })
}
if (fullWorkbench) {
  const args = [
    path.join(repository, 'apps/web/node_modules/vite/bin/vite.js'), 'build',
    '--config', '../../tools/boldsite/rules.vite.config.mts',
    '--outDir', output,
    '--emptyOutDir=false',
  ]
  const rules = spawnSync(process.execPath, args, {
    ...buildOptions,
    cwd: path.join(repository, 'apps/web'),
  })
  if (rules.error) throw rules.error
  if (rules.status !== 0) process.exit(rules.status ?? 1)
  await writeFile(path.join(output, 'workbench-mode.txt'), 'workbench\n')
  await cp(path.join(repository, 'apps/boldsite/requirements-workbench.txt'), path.join(output, 'requirements-workbench.txt'))
}

const [catalog] = catalogs
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
