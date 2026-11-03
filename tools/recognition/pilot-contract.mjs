// 试点 A 项：只查交接身份与输入完整性，不运行识别或读取金标准标签。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat, lstat } from 'node:fs/promises'
import path from 'node:path'

const requireValue = (ok, message) => assert.ok(ok, message)
const text = (v) => typeof v === 'string' && v.trim().length > 0
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)
const strings = (v) => Array.isArray(v) && v.every(text)
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, sorted(value[k])]),
        )
      : value
// JSON 元数据按排序键的紧凑 JSON 哈希；避免 Windows 换行/格式化破坏跨机重放。
export const jsonSha256 = (value) => sha256(JSON.stringify(sorted(value)))
export const normalizeName = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '')
export const relativeFile = (p) =>
  text(p) &&
  !p.includes('\\') &&
  !/[:\x00-\x1f]/.test(p) &&
  !path.posix.isAbsolute(p) &&
  p.split('/').every((x) => x && x !== '.' && x !== '..')
const within = (root, file) => file === root || file.startsWith(root + path.sep)
const unique = (values, label) =>
  requireValue(new Set(values).size === values.length, label + ' 有重复')

function identity(s) {
  requireValue(id(s.store_id) && text(s.name) && normalizeName(s.name), '门店编号/名称缺失')
  for (const f of ['aliases', 'sameStoreKeys', 'sourceSha256s'])
    requireValue(strings(s[f]), s.store_id + ' 缺少 ' + f)
  requireValue(
    s.sameStoreKeys.length > 0 && s.sourceSha256s.length > 0 && s.sourceSha256s.every(hash),
    '同店关系/来源指纹缺失',
  )
  requireValue(
    [...s.aliases, ...s.sameStoreKeys].every((x) => normalizeName(x)),
    '别名/同店键不能仅含标点',
  )
  return [
    'id:' + s.store_id,
    ...[s.name, ...s.aliases].map((x) => 'name:' + normalizeName(x)),
    ...s.sameStoreKeys.map((x) => 'store:' + normalizeName(x)),
    ...s.sourceSha256s.map((x) => 'pdf:' + x),
  ]
}
function indexTokens(index, kind, count) {
  requireValue(index.schemaVersion === 1 && index.kind === kind, '排重索引类型/版本错误')
  requireValue(hash(index.sourceManifestSha256) && text(index.revision), '索引缺来源版本/指纹')
  requireValue(Array.isArray(index.stores) && index.stores.length === count, kind + ' 数量错误')
  unique(
    index.stores.map((s) => s.store_id),
    kind,
  )
  return index.stores.flatMap(identity)
}
export function validateManifest(m, acceptance, development) {
  requireValue(m.schemaVersion === 1 && m.contract === 'store-pilot/1', '不支持的交接版本')
  requireValue(id(m.pilotId) && m.status === 'frozen', '名单尚未冻结')
  requireValue(
    text(m.frozenAt) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(m.frozenAt) &&
      Number.isFinite(Date.parse(m.frozenAt)) &&
      text(m.selectedBy),
    '缺冻结时间/选样人',
  )
  requireValue(
    Array.isArray(m.samples) && m.samples.length === 24,
    '首版须冻结完整24家，前6家不能替代总名单',
  )
  requireValue(strings(m.coverageGaps), '必须声明缺层，无缺层用空数组')
  requireValue(
    m.selectionBasis === 'source-stratified-before-recognition',
    '必须按原资料分层，不按识别结果选样',
  )
  requireValue(hash(m.resourceLockSha256) && text(m.modelsVersion), '缺资源锁/模型版本')
  requireValue(
    m.exclusions?.acceptanceSha256 === jsonSha256(acceptance) &&
      m.exclusions?.developmentSha256 === jsonSha256(development),
    '排重索引指纹与冻结名单不符',
  )
  const excluded = new Set([
      ...indexTokens(acceptance, 'acceptance', 45),
      ...indexTokens(development, 'development', 48),
    ]),
    seen = new Set(),
    strata = {},
    rows = []
  unique(
    m.samples.map((s) => s.store_id),
    '试点门店',
  )
  requireValue(
    m.samples.filter((s) => s.batch === 1).length === 6 &&
      m.samples.filter((s) => s.batch === 2).length === 18,
    '批次必须先6后18',
  )
  for (const s of m.samples) {
    const tokens = identity(s)
    requireValue(
      !tokens.some((t) => excluded.has(t)),
      s.store_id + ' 与45/48集合存在已知同店或重复',
    )
    requireValue(!tokens.some((t) => seen.has(t)), s.store_id + ' 与本批其他门店重复')
    tokens.forEach((t) => seen.add(t))
    requireValue(
      text(s.selectionReason) && text(s.mallGroupKey) && strings(s.nearDuplicateGroupKeys),
      '缺选择理由/商场/近重复分组',
    )
    for (const [field, allowed] of Object.entries({
      si: ['SI1.0', 'SI2.0', 'unknown'],
      shopType: ['边厅', '中岛', '专区', 'unknown'],
      pageType: ['vector-text', 'vector-outline', 'raster', 'unknown'],
      geometry: ['regular', 'irregular', 'unknown'],
    }))
      requireValue(allowed.includes(s[field]), field + ' 值不符')
    requireValue(strings(s.missing), '缺项必须显式列出')
    const src = s.source
    requireValue(
      src &&
        relativeFile(src.path) &&
        src.path.startsWith('01_各门店原图纸/') &&
        path.posix.extname(src.path).toLowerCase() === '.pdf' &&
        hash(src.sha256) &&
        s.sourceSha256s.includes(src.sha256),
      '原始PDF路径/指纹不符',
    )
    requireValue(
      Number.isInteger(src.page) &&
        src.page >= 1 &&
        Number.isInteger(src.pageCount) &&
        src.page <= src.pageCount,
      '原页号必须从1开始且不超总页数',
    )
    const key = [s.si, s.shopType, s.pageType, s.geometry].join('/')
    strata[key] = (strata[key] ?? 0) + 1
    rows.push({
      store_id: s.store_id,
      batch: s.batch,
      inputStatus: 'not_checked',
      missing: s.missing,
    })
  }
  return {
    schemaVersion: 1,
    pilotId: m.pilotId,
    scope: 'A-manifest-only',
    manifestSha256: jsonSha256(m),
    sampleCount: 24,
    strata,
    coverageGaps: m.coverageGaps,
    rows,
    trainingEligible: false,
    limitations: [
      '仅核对已声明身份关系；未知别名/同店关系须双方独立复核',
      '未检查原页内容、量尺、成品、BOM或用户抽审；本结果不授权训练或自动升级审核状态',
    ],
  }
}

export async function checkedFile(root, relative, expected) {
  requireValue(relativeFile(relative), '文件必须为不含上溯的POSIX相对路径')
  const base = await realpath(root),
    actual = await realpath(path.join(base, relative))
  requireValue(within(base, actual), '文件经过链接后越出输入根')
  requireValue((await stat(actual)).isFile(), '输入不是普通文件')
  const bytes = await readFile(actual)
  requireValue(hash(expected) && sha256(bytes) === expected, relative + ' 的SHA256不符')
  return bytes
}

// 新输出目录 + 真实路径检查：既不能覆盖审核结果，也不能经 Junction 写入共享资源。
export async function isolatedOutput(out, protectedRoots) {
  const target = path.resolve(out)
  try {
    await lstat(target)
    throw Error('输出已存在；请指定新的 --out')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const parent = await realpath(path.dirname(target)),
    physical = path.join(parent, path.basename(target))
  for (const root of protectedRoots)
    requireValue(!within(await realpath(root), physical), '输出位于受保护输入/工作区内')
  for (let p = parent; ; p = path.dirname(p)) {
    try {
      await lstat(path.join(p, '.git'))
      throw Error('输出位于Git工作区内')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    if (path.dirname(p) === p) break
  }
  return physical
}
