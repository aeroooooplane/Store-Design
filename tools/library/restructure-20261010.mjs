// 模型库重排（2026-10-10，用户选择“全面重排模型库”）。
//
// 资源库/04_软装道具模型（单件模型 + 网页模型 + 原始整包 …）→ 资源库/04_模型库：
//   软装道具/SI1.0、软装道具/SI2.0、信息化物料、品牌标识、非标陈列、环境设施，每件模型一个目录，
//   内含 SU 文件、预览、纯净平面图例和 网页模型/（GLB、白模轻量版、转换记录）；
//   用户补充的效果图与平面图放入各大类的 品类图库/（电子水牌归信息化物料）。
// manifest.json 保留原有全部字段，只改写路径（相对 04_模型库），并补充分类、目录、效果图与平面图。
// 另写 模型清单.csv、缺少效果图清单.csv、模型目录.html、目录迁移映射-20261010.json。
//
// 用法（仓库根目录）：node tools/library/restructure-20261010.mjs [--apply]
// 不带 --apply 只打印计划。移动用 fs.rename，随后由 git add -A 记录为重命名。
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OLD = '资源库/04_软装道具模型'
const NEW = '资源库/04_模型库'
const LIB = `${OLD}/单件模型`
const WEB = `${OLD}/网页模型`
const USER = {
  'SI1.0': '资源库/SI1.0软装道具',
  'SI2.0': '资源库/SI2.0软装道具',
  信息化物料: '资源库/其他信息化物料',
}
const apply = process.argv.includes('--apply')

// ---- classification (用户 2026-10-10：信息化物料 = 屏幕 + 灯箱；LOGO 另分组；非标陈列单独分组) ----

function categoryOf(a) {
  const name = a.standard_name
  if (/广告机|LED|电子水牌|KV灯箱|KV画面/.test(name)) return { category: '信息化物料', si: null }
  if (/LOGO|侧招|产品标识/.test(name)) return { category: '品牌标识', si: null }
  if (/消防栓|射灯/.test(name)) return { category: '环境设施', si: null }
  if ((a.si_family === 'SI1.0' || a.si_family === 'SI2.0') && !/橱窗/.test(name)) {
    return { category: '软装道具', si: a.si_family }
  }
  return { category: '非标陈列', si: null }
}

const CATEGORY_ORDER = ['软装道具', '信息化物料', '品牌标识', '非标陈列', '环境设施']

/**
 * 模型 ↔ 用户品类图库（效果图、平面图）。exact = 同一款；approximate = 同类参考
 * （亮脚与普通桌面相同、混合陈列、组合件），在清单中列为“需补充准确效果图”。
 */
const TYPES = {
  'asset-2595882': ['SI1.0', '1.2米配件柜', 'exact'],
  'asset-323015': ['SI1.0', '1.6米配件柜', 'exact'],
  'asset-24488377': ['SI1.0', '1.8米收银台', 'exact'],
  'asset-408124': ['SI1.0', '1.8米中岛桌', 'exact'],
  'asset-408125': ['SI1.0', '1.8米中岛桌', 'exact'],
  'asset-569180': ['SI1.0', '培训坐凳', 'exact'],
  'asset-34320268': ['SI1.0', '1.8米边桌+配件柜', 'exact'],
  'asset-752992': ['SI1.0', '1.8米边桌+储物柜', 'exact'],
  'asset-666964': ['SI1.0', '1.8米储物柜+开箱桌', 'exact'],
  'asset-1788391': ['SI1.0', '1.8米开箱桌', 'exact'],
  'asset-2587726': ['信息化物料', '电子水牌', 'exact'],
  'asset-958185': ['信息化物料', '电子水牌', 'exact'],
  'asset-24482600': ['SI2.0', '1.2米配件柜', 'exact'],
  'asset-34327615': ['SI2.0', '1.2米配件柜', 'exact'],
  'asset-36887885': ['SI2.0', '2.4米配件柜(AVBU)', 'exact'],
  'asset-36929122': ['SI2.0', '2.4米配件柜(AVBU)', 'approximate'],
  'asset-36890994': ['SI2.0', '2.4米配件柜(场景)', 'exact'],
  'asset-6799167': ['SI2.0', '2.4米配件柜(场景)', 'exact'],
  'asset-15903179': ['SI2.0', '3.6米配件柜', 'exact'],
  'asset-36857093': ['SI2.0', '3.6米配件柜', 'exact'],
  'asset-24432224': ['SI2.0', '1.8米收银桌(左)', 'exact'],
  'asset-33819654': ['SI2.0', '1.8米收银边柜', 'exact'],
  'asset-24312623': ['SI2.0', '1.8米中岛桌', 'exact'],
  'asset-34276510': ['SI2.0', '1.8米中岛桌', 'exact'],
  'asset-41053706': ['SI2.0', '1.8米中岛桌', 'approximate'],
  'asset-16469753': ['SI2.0', '1.8米开箱桌', 'exact'],
  'asset-41277543': ['SI2.0', '1.8米开箱桌', 'approximate'],
  'asset-15903874': ['SI2.0', '字母凳', 'exact'],
  'asset-28192911': ['SI2.0', '1.8米配件边柜(H1.3米)', 'exact'],
  'asset-33660153': ['SI2.0', '1.8米配件边柜(带托盘)', 'exact'],
  'asset-16510684': ['SI2.0', '试飞台', 'exact'],
  'asset-36929204': ['SI2.0', '1.99米徕卡墙', 'approximate'],
}
/** 同一品类的别名（用户使用说明：平面图按图纸 1200×500 命名）。 */
const TYPE_ALIASES = { '1.2米边桌收银柜': '1.0米边桌+收银' }
/** 电子水牌素材在用户的 SI1.0 文件夹里，按分类移到信息化物料。 */
const DIGITAL_FROM_SI1 = ['电子水牌']

// ---- helpers ----

const safe = (text) => text.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim()
const posix = (p) => p.split(path.sep).join('/')
const exists = (relative) => existsSync(path.join(ROOT, relative))
const moves = [] // [from, to] repo-relative
const plannedTargets = new Set()

function move(from, to) {
  if (!exists(from)) throw new Error(`缺少文件：${from}`)
  if (plannedTargets.has(to)) throw new Error(`目标重复：${to}`)
  plannedTargets.add(to)
  moves.push([from, to])
}

async function listFiles(dir) {
  const out = []
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await listFiles(child)))
    else out.push(child)
  }
  return out
}

const readJson = async (relative) =>
  JSON.parse((await readFile(path.join(ROOT, relative), 'utf8')).replace(/^﻿/, ''))

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
const html = (text) =>
  String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// ---- plan ----

if (!exists(OLD)) throw new Error(`${OLD} 不存在（是否已经重排过？）`)
if (exists(NEW)) throw new Error(`${NEW} 已存在，请先确认后再运行`)

const manifest = await readJson(`${LIB}/manifest.json`)
const legendTargets = new Map() // old library-relative legend path → new 04_模型库-relative path

/** Shared PDF crops and their page context stay together under _图例来源/. */
function sharedLegend(file) {
  if (!file) return file
  if (!legendTargets.has(file)) {
    const target = `_图例来源/${file.replace(/^平面图例\//, '')}`
    legendTargets.set(file, target)
    move(`${LIB}/${file}`, `${NEW}/${target}`)
  }
  return legendTargets.get(file)
}

const userImages = { 'SI1.0': [], 'SI2.0': [], 信息化物料: [] }
for (const [key, dir] of Object.entries(USER)) {
  if (!exists(dir)) continue
  userImages[key] = await listFiles(dir)
}

function galleryDir(group) {
  return group === '信息化物料' ? '信息化物料/品类图库' : `软装道具/${group}/品类图库`
}

// User galleries: SI folders go under 软装道具/<SI>/品类图库; 电子水牌 files go to 信息化物料.
for (const group of ['SI1.0', 'SI2.0', '信息化物料']) {
  for (const file of userImages[group]) {
    const relative = file.slice(USER[group].length + 1)
    const digital = group === 'SI1.0' && DIGITAL_FROM_SI1.some((n) => path.basename(relative).startsWith(n))
    move(file, `${NEW}/${galleryDir(digital ? '信息化物料' : group)}/${relative}`)
  }
}
const galleryHas = (relative) => plannedTargets.has(`${NEW}/${relative}`)

const assets = []
for (const a of manifest.assets) {
  const { category, si } = categoryOf(a)
  const folder = [category, si, safe(`${a.standard_name}_${a.variant}__${a.asset_id}`)]
    .filter(Boolean)
    .join('/')
  const entry = structuredClone(a)
  const from = {}

  from.named_skp = a.named_skp
  entry.named_skp = `${folder}/${path.basename(a.named_skp)}`
  move(`${LIB}/${a.named_skp}`, `${NEW}/${entry.named_skp}`)

  if (a.preview) {
    from.preview = a.preview
    entry.preview = `${folder}/预览${path.extname(a.preview)}`
    move(`${LIB}/${a.preview}`, `${NEW}/${entry.preview}`)
  }
  entry.additional_views = (a.additional_views ?? []).map((view, i) => {
    const target = `${folder}/预览-视角${i + 1}${path.extname(view)}`
    move(`${LIB}/${view}`, `${NEW}/${target}`)
    return target
  })

  if (a.plan_legend) {
    entry.plan_legend = { ...a.plan_legend }
    if (a.plan_legend.file) {
      entry.plan_legend.file = `${folder}/平面图例${path.extname(a.plan_legend.file)}`
      move(`${LIB}/${a.plan_legend.file}`, `${NEW}/${entry.plan_legend.file}`)
    }
    entry.plan_legend.context = sharedLegend(a.plan_legend.context)
    entry.plan_legend.raw_file = sharedLegend(a.plan_legend.raw_file)
  }
  if (a.original_plan_legend) {
    entry.original_plan_legend = {
      ...a.original_plan_legend,
      file: sharedLegend(a.original_plan_legend.file),
      context: sharedLegend(a.original_plan_legend.context),
    }
  }

  // Web model folder (GLB, white model, conversion record).
  entry.web_model = null
  if (exists(`${WEB}/${a.asset_id}`)) {
    entry.web_model = `${folder}/网页模型`
    for (const file of await listFiles(`${WEB}/${a.asset_id}`)) {
      move(file, `${NEW}/${entry.web_model}/${file.slice(`${WEB}/${a.asset_id}/`.length)}`)
    }
  }

  // Product image and plan symbol from the user's galleries.
  const type = TYPES[a.asset_id]
  entry.type_name = type?.[1] ?? null
  entry.product_image = null
  entry.product_image_match = null
  entry.plan_symbol = null
  if (type) {
    const [group, name, match] = type
    const gallery = galleryDir(group)
    const image = `${gallery}/01_道具图片PNG/${name}.png`
    const svg = `${gallery}/03_平面图SVG/${name}平面图.svg`
    const png = `${gallery}/02_平面图PNG/${name}平面图.png`
    if (galleryHas(image)) {
      entry.product_image = image
      entry.product_image_match = match
    }
    if (galleryHas(svg)) entry.plan_symbol = { svg, png: galleryHas(png) ? png : null }
  }

  entry.category = category
  entry.category_si = si
  entry.folder = folder
  entry.migrated_from_20261010 = from
  assets.push(entry)
}

// Everything else from the old library: unreferenced legend files join the shared crops.
for (const file of await listFiles(`${LIB}/平面图例`)) {
  if (!moves.some(([f]) => f === file)) sharedLegend(file.slice(LIB.length + 1))
}
const HISTORY = {
  [`${LIB}/manifest.json`]: '_历史记录/单件模型-manifest-20261009.json',
  [`${LIB}/命名对照.csv`]: '_历史记录/命名对照.csv',
  [`${LIB}/校验结果.json`]: '_历史记录/校验结果.json',
  [`${LIB}/分类与图例校验-20261002.json`]: '_历史记录/分类与图例校验-20261002.json',
  [`${LIB}/桌型命名更新-20261002.json`]: '_历史记录/桌型命名更新-20261002.json',
  [`${LIB}/使用指引.md`]: '_历史记录/单件模型使用指引-20261002.md',
  [`${LIB}/模型预览目录.html`]: '_历史记录/模型预览目录-20261009.html',
  [`${WEB}/README.md`]: '_历史记录/网页模型说明-20261009.md',
  [`${WEB}/facing.json`]: 'facing.json',
}
for (const [from, to] of Object.entries(HISTORY)) if (exists(from)) move(from, `${NEW}/${to}`)
for (const dir of ['原始整包', '原始模型预检']) {
  for (const file of await listFiles(`${OLD}/${dir}`)) {
    move(file, `${NEW}/_${dir}/${file.slice(`${OLD}/${dir}/`.length)}`)
  }
}

// Anything left behind would be lost track of: refuse.
const movedFrom = new Set(moves.map(([f]) => f))
const leftovers = (await listFiles(OLD)).filter((f) => !movedFrom.has(f))
if (leftovers.length) throw new Error(`以下文件未安排去向：\n${leftovers.join('\n')}`)

// ---- outputs ----

const counts = {}
for (const a of assets) {
  const key = a.category_si ? `${a.category}/${a.category_si}` : a.category
  counts[key] = (counts[key] ?? 0) + 1
}
const newManifest = {
  ...Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'assets')),
  restructured: '2026-10-10',
  library_root: NEW,
  path_note: '所有路径相对 资源库/04_模型库；migrated_from_20261010 记录原 单件模型/ 下的路径',
  categories: CATEGORY_ORDER,
  counts_by_category: counts,
  category_rule:
    '用户2026-10-10确认：软装道具按SI1.0/SI2.0分组；信息化物料=广告机、LED屏、电子水牌、KV灯箱与画面；LOGO、侧招、产品标识归品牌标识；沙发、组合陈列柜、橱窗道具等归非标陈列；消防栓与射灯归环境设施',
  assets,
}

const SORT = (a, b) =>
  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
  String(a.category_si).localeCompare(String(b.category_si)) ||
  a.standard_name.localeCompare(b.standard_name, 'zh') ||
  a.asset_id.localeCompare(b.asset_id)
const sorted = [...assets].sort(SORT)

const listRows = [
  ['大类', 'SI', '编号', '标准名称', '变体', '品类', '目录', 'SU文件', '网页模型', '效果图', '效果图对应', '平面图SVG', '平面图例', '尺寸XYZ毫米'],
  ...sorted.map((a) => [
    a.category,
    a.category_si ?? '',
    a.asset_id,
    a.standard_name,
    a.variant,
    a.type_name ?? '',
    a.folder,
    a.named_skp,
    a.web_model ? '有' : '',
    a.product_image ?? '',
    { exact: '同款', approximate: '同类参考' }[a.product_image_match] ?? '',
    a.plan_symbol?.svg ?? '',
    a.plan_legend?.file ?? '',
    a.tight_face_bounds_xyz_mm.join('×'),
  ]),
]

const assetTypes = new Set(Object.values(TYPES).map(([g, n]) => `${g}|${n}`))
const galleryOnly = []
for (const group of ['SI1.0', 'SI2.0', '信息化物料']) {
  const prefix = `${NEW}/${galleryDir(group)}/`
  const names = new Set()
  for (const target of plannedTargets) {
    if (!target.startsWith(prefix)) continue
    const rel = target.slice(prefix.length)
    const m = /^0[123]_[^/]+\/(.+?)(平面图)?\.(png|svg)$/.exec(rel)
    // Back views belong to their type; aliases name the same type.
    if (m && !m[1].endsWith('-背面')) names.add(TYPE_ALIASES[m[1]] ?? m[1])
  }
  for (const name of [...names].sort()) {
    if (!assetTypes.has(`${group}|${name}`)) galleryOnly.push([group, name])
  }
}
const missingRows = [
  ['类型', '大类', 'SI', '编号', '名称', '现状', '需要补充'],
  ...sorted
    .filter((a) => a.product_image_match !== 'exact' && a.category !== '环境设施')
    .map((a) => [
      '缺效果图',
      a.category,
      a.category_si ?? '',
      a.asset_id,
      `${a.standard_name} · ${a.variant}`,
      a.product_image ? `暂用同类参考：${a.type_name}` : a.preview ? '暂用SketchUp预览图' : '无图',
      `效果图PNG（透明背景），放入 ${a.category_si ? `软装道具/${a.category_si}` : a.category}/品类图库/01_道具图片PNG/`,
    ]),
  ...galleryOnly.map(([group, name]) => [
    '缺三维模型',
    group === '信息化物料' ? '信息化物料' : '软装道具',
    group === '信息化物料' ? '' : group,
    '',
    name,
    '已有效果图或平面图，没有对应的SU/网页模型',
    'SU模型（转换为网页模型后可在三维中摆放）',
  ]),
]

const migration = Object.fromEntries(moves.map(([f, t]) => [f, t]))

function card(a) {
  const image = a.product_image ?? a.preview
  return `<article><a href="${html(encodeURI(image ?? ''))}"><img loading="lazy" src="${html(encodeURI(image ?? ''))}" alt=""></a>
<h3>${html(a.standard_name)}</h3><p>${html(a.variant)}</p>
<p class="meta">${html(a.asset_id)} · ${html(a.tight_face_bounds_xyz_mm.join('×'))} mm${a.web_model ? ' · 网页模型' : ''}${a.product_image_match === 'approximate' ? ' · 效果图为同类参考' : ''}</p>
<p class="links"><a href="${html(encodeURI(a.named_skp))}">SU 文件</a>${a.plan_legend?.file ? ` <a href="${html(encodeURI(a.plan_legend.file))}">平面图例</a>` : ''}${a.plan_symbol ? ` <a href="${html(encodeURI(a.plan_symbol.svg))}">平面图</a>` : ''}</p></article>`
}
const sections = []
for (const category of CATEGORY_ORDER) {
  const groups = category === '软装道具' ? ['SI1.0', 'SI2.0'] : [null]
  for (const si of groups) {
    const items = sorted.filter((a) => a.category === category && a.category_si === si)
    if (!items.length) continue
    sections.push(`<section><h2>${html(si ? `${category} · ${si}` : category)}（${items.length}）</h2><div class="grid">${items.map(card).join('\n')}</div></section>`)
  }
}
const catalogue = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模型目录</title>
<style>body{margin:0;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:#111}header,section{padding:24px 32px}header{border-bottom:2px solid #111}h1{margin:0;font-size:24px}h2{font-size:18px;border-bottom:1px solid #111;padding-bottom:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}article{border:1px solid #d4d4d4;padding:12px}article img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#f5f5f5}h3{font-size:14px;margin:8px 0 0}p{margin:2px 0}.meta{color:#616161;font-size:12px}.links a{margin-right:8px;font-size:12px;color:#111}</style>
<header><h1>模型目录</h1><p>${assets.length} 件，按大类与 SI 分组；效果图优先，缺少时显示 SketchUp 预览。数据见 manifest.json 与 模型清单.csv。</p></header>
${sections.join('\n')}
</html>
`

const countsText = Object.entries(counts)
  .map(([k, v]) => `${k} ${v}`)
  .join('，')
const readme = `# 模型库

2026-10-10 由 \`资源库/04_软装道具模型\` 全面重排而来（用户确认）。共 ${assets.length} 件：${countsText}。

## 目录

\`\`\`text
04_模型库/
  manifest.json           全部模型的机器清单（路径相对本目录）；网站导入、旧版工作台与工具都读它
  模型清单.csv              同一清单的表格版（Excel 可直接打开）
  模型目录.html             浏览页：按大类与 SI 分组，显示效果图或预览
  缺少效果图清单.csv         待补充的效果图与缺少三维模型的品类
  facing.json             网页模型的正面方向
  目录迁移映射-20261010.json  每个文件的旧路径 → 新路径
  软装道具/SI1.0、软装道具/SI2.0、信息化物料、品牌标识、非标陈列、环境设施/
    <标准名称>_<变体>__<编号>/
      <原SU文件名>.skp       SketchUp 模型（与重排前逐字节相同）
      预览.jpg、预览-视角N.jpg  SketchUp 预览图
      平面图例.png           SketchUp 正投影生成的纯净平面图例（有的才有）
      网页模型/              model.glb（完整，材质渲染用）、white.glb（白模轻量版）、conversion.json、white.json
    品类图库/                用户提供的效果图（01_道具图片PNG）与平面图（02_平面图PNG、03_平面图SVG），按品类命名
  _图例来源/                  门店 PDF 裁片与整页上下文（平面图例的来源）
  _原始整包/、_原始模型预检/    原始 SketchUp 总模型与预检记录
  _历史记录/                  重排前的命名对照、校验结果、旧目录页与说明
\`\`\`

## 分类规则（用户 2026-10-10 确认）

- **软装道具**：桌、柜、凳、徕卡墙、展示台等，按 SI1.0 / SI2.0 分组。
- **信息化物料**：广告机、LED 屏、电子水牌、KV 灯箱与画面。
- **品牌标识**：墙面 / 吊挂 LOGO、侧招、产品标识。
- **非标陈列**：沙发、组合陈列柜、橱窗模特与场景道具等。
- **环境设施**：消防栓箱、射灯（不出现在网站的添加模型列表中）。

## 效果图与平面图

每件模型的 \`product_image\`、\`plan_symbol\` 指向品类图库中的文件；\`product_image_match\` 为 \`exact\`（同款）或 \`approximate\`（同类参考，如亮脚桌暂用普通桌效果图）。缺少的见 \`缺少效果图清单.csv\`，补充后按同名放入对应 \`品类图库/01_道具图片PNG/\`，再更新 manifest 并执行 \`pnpm catalog:import\`。

## 常用命令（仓库根目录）

\`\`\`powershell
pnpm catalog:white    # 网页模型更新后重新生成白模轻量版
pnpm catalog:import   # 刷新网站模型目录
\`\`\`
`

// ---- report / apply ----

const summary = {
  moves: moves.length,
  assets: assets.length,
  counts,
  productImages: { exact: assets.filter((a) => a.product_image_match === 'exact').length, approximate: assets.filter((a) => a.product_image_match === 'approximate').length },
  planSymbols: assets.filter((a) => a.plan_symbol).length,
  missingImages: missingRows.filter((r) => r[0] === '缺效果图').length,
  galleryOnly: galleryOnly.map(([g, n]) => `${g}/${n}`),
}
console.log(JSON.stringify(summary, null, 2))
if (!apply) {
  console.log('（试运行，未改动文件；确认后加 --apply）')
  process.exit(0)
}

for (const [from, to] of moves) {
  await mkdir(path.dirname(path.join(ROOT, to)), { recursive: true })
  await rename(path.join(ROOT, from), path.join(ROOT, to))
}
await mkdir(path.join(ROOT, NEW, '信息化物料/品类图库/01_道具图片PNG'), { recursive: true })
await writeFile(path.join(ROOT, NEW, 'manifest.json'), `${JSON.stringify(newManifest, null, 2)}\n`)
await writeFile(path.join(ROOT, NEW, '模型清单.csv'), csv(listRows))
await writeFile(path.join(ROOT, NEW, '缺少效果图清单.csv'), csv(missingRows))
await writeFile(path.join(ROOT, NEW, '模型目录.html'), catalogue)
await writeFile(path.join(ROOT, NEW, 'README.md'), readme)
await writeFile(path.join(ROOT, NEW, '目录迁移映射-20261010.json'), `${JSON.stringify({ created: '2026-10-10', from: OLD, to: NEW, files: migration }, null, 2)}\n`)

// Remove the now-empty old folders (and the user's emptied gallery folders).
async function prune(dir) {
  const full = path.join(ROOT, dir)
  if (!existsSync(full)) return
  for (const entry of await readdir(full, { withFileTypes: true })) {
    if (entry.isDirectory()) await prune(`${dir}/${entry.name}`)
  }
  if ((await readdir(full)).length === 0) await rmdir(full)
}
for (const dir of [OLD, ...Object.values(USER)]) await prune(dir)
const left = [OLD, ...Object.values(USER)].filter(exists)
console.log(left.length ? `仍有残留目录：${left.join('、')}` : '旧目录已清空并删除')
void stat
