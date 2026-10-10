// 刷新模型库的效果图 / 平面图对应关系，并重新生成清单与目录页（资源库/04_模型库）。
//
// 对应规则：
//   1. 品类图库/01_道具图片PNG/<编号>.png      —— 这一件模型自己的效果图（同款）
//   2. 品类对照.csv 中该编号的品类名 → 品类图库/01_道具图片PNG/<品类名>.png（同款或同类参考）
//   平面图同理：03_平面图SVG/<编号>.svg 或 <品类名>平面图.svg；02_平面图PNG 为同名 PNG。
//   品类图库按大类：软装道具/<SI>/品类图库、信息化物料/品类图库、品牌标识/品类图库、非标陈列/品类图库。
//   品类图库是原件；对应上的图另复制一份到每件模型目录：效果图.png（同类参考为 效果图-同类参考.png）、
//   平面图.svg、平面图.png。manifest 指向模型目录里的副本，*_source 记录原件。
//
// 用法（仓库根目录）：pnpm library:refresh      补充效果图后运行，然后 pnpm catalog:import
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIBRARY = path.join(ROOT, '资源库/04_模型库')
const CATEGORY_ORDER = ['软装道具', '信息化物料', '品牌标识', '非标陈列', '环境设施']
const MATCH = { 同款: 'exact', 同类参考: 'approximate' }
const MATCH_LABEL = { exact: '同款', approximate: '同类参考' }

const readText = async (file) => (await readFile(file, 'utf8')).replace(/^﻿/, '')
const has = (relative) => existsSync(path.join(LIBRARY, relative))

/** Minimal CSV reader for the files this tool writes (quoted cells, commas, CRLF). */
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
const html = (text) =>
  String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const href = (relative) => html(encodeURI(relative ?? ''))

export function galleryOf(asset) {
  if (asset.category === '软装道具') return `软装道具/${asset.category_si}/品类图库`
  return `${asset.category}/品类图库`
}

/** Sets product_image / plan_symbol of every asset from the galleries and the type table. */
export function linkImages(manifest, types, exists = has) {
  for (const a of manifest.assets) {
    const gallery = galleryOf(a)
    const type = types.get(a.asset_id)
    a.type_name = type?.name ?? null
    const own = `${gallery}/01_道具图片PNG/${a.asset_id}.png`
    const byType = type ? `${gallery}/01_道具图片PNG/${type.name}.png` : null
    let source = null
    if (exists(own)) {
      source = own
      a.product_image_match = 'exact'
    } else if (byType && exists(byType)) {
      source = byType
      a.product_image_match = type.match
    } else {
      a.product_image_match = null
    }
    a.product_image_source = source
    a.product_image = source
      ? `${a.folder}/${a.product_image_match === 'approximate' ? '效果图-同类参考' : '效果图'}.png`
      : null
    const symbol = [a.asset_id, type ? `${type.name}平面图` : null]
      .filter(Boolean)
      .map((name) => ({
        svg: `${gallery}/03_平面图SVG/${name}.svg`,
        png: `${gallery}/02_平面图PNG/${name}.png`,
      }))
      .find((s) => exists(s.svg))
    a.plan_symbol_source = symbol
      ? { svg: symbol.svg, png: exists(symbol.png) ? symbol.png : null }
      : null
    a.plan_symbol = a.plan_symbol_source
      ? {
          svg: `${a.folder}/平面图.svg`,
          png: a.plan_symbol_source.png ? `${a.folder}/平面图.png` : null,
        }
      : null
  }
}

/** Copies the matched gallery pictures into each model folder and removes stale copies. */
export async function syncCopies(manifest, root = LIBRARY) {
  let copied = 0
  for (const a of manifest.assets) {
    const wanted = new Map()
    if (a.product_image) wanted.set(a.product_image, a.product_image_source)
    if (a.plan_symbol) {
      wanted.set(a.plan_symbol.svg, a.plan_symbol_source.svg)
      if (a.plan_symbol.png) wanted.set(a.plan_symbol.png, a.plan_symbol_source.png)
    }
    for (const name of ['效果图.png', '效果图-同类参考.png', '平面图.svg', '平面图.png']) {
      const target = `${a.folder}/${name}`
      const full = path.join(root, target)
      const from = wanted.get(target)
      if (from) {
        const source = await readFile(path.join(root, from))
        const current = existsSync(full) ? await readFile(full) : null
        if (!current || !current.equals(source)) {
          await copyFile(path.join(root, from), full)
          copied++
        }
      } else if (existsSync(full)) {
        await rm(full)
      }
    }
  }
  return copied
}

const SORT = (a, b) =>
  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
  String(a.category_si).localeCompare(String(b.category_si)) ||
  a.standard_name.localeCompare(b.standard_name, 'zh') ||
  a.asset_id.localeCompare(b.asset_id)

function listCsv(assets) {
  return csv([
    ['大类', 'SI', '编号', '标准名称', '变体', '品类', '目录', 'SU文件', '网页模型', '效果图', '效果图对应', '平面图SVG', '尺寸XYZ毫米'],
    ...assets.map((a) => [
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
      MATCH_LABEL[a.product_image_match] ?? '',
      a.plan_symbol?.svg ?? '',
      a.tight_face_bounds_xyz_mm.join('×'),
    ]),
  ])
}

/** Types that have a gallery picture or drawing but no model yet. */
function galleryOnly(assets, types, listGallery) {
  const known = new Set([...types.values()].map((t) => `${t.gallery}|${t.name}`))
  const out = []
  for (const gallery of new Set(assets.filter((a) => a.category !== '环境设施').map(galleryOf))) {
    for (const name of listGallery(gallery)) {
      if (!known.has(`${gallery}|${name}`) && !/^asset-\d+$/.test(name)) out.push([gallery, name])
    }
  }
  return out
}

function missingCsv(assets, types, listGallery) {
  return csv([
    ['类型', '大类', 'SI', '编号', '名称', '现状', '补充方式'],
    ...assets
      .filter((a) => a.product_image_match !== 'exact' && a.category !== '环境设施')
      .map((a) => [
        '缺效果图',
        a.category,
        a.category_si ?? '',
        a.asset_id,
        `${a.standard_name} · ${a.variant}`,
        a.product_image ? `暂用同类参考：${a.type_name}` : '暂用SketchUp预览图',
        `透明背景PNG，命名为 ${a.asset_id}.png 放入 ${galleryOf(a)}/01_道具图片PNG/，再运行 pnpm library:refresh`,
      ]),
    ...galleryOnly(assets, types, listGallery).map(([gallery, name]) => [
      '缺三维模型',
      gallery.split('/')[0],
      gallery.split('/')[1] === '品类图库' ? '' : gallery.split('/')[1],
      '',
      name,
      `${gallery} 已有效果图或平面图，没有对应的SU/网页模型`,
      'SU模型（转换为网页模型后可在三维中摆放）；加入后在 品类对照.csv 填写编号与品类名',
    ]),
  ])
}

function cataloguePage(assets) {
  const counts = (filter) => assets.filter(filter).length
  const buttons = [
    `<button type="button" data-filter="" aria-pressed="true">全部 · ${assets.length}</button>`,
    ...CATEGORY_ORDER.map(
      (c) => `<button type="button" data-filter="${html(c)}">${html(c)} · ${counts((a) => a.category === c)}</button>`,
    ),
  ].join('')
  const card = (a) => {
    const image = a.product_image ?? a.preview
    const plan = a.plan_symbol?.png ?? a.plan_symbol?.svg
    return `<article data-category="${html(a.category)}" data-si="${html(a.category_si ?? '')}" data-plan="${plan ? 1 : 0}" data-search="${html([a.asset_id, a.standard_name, a.variant, a.type_name].join(' '))}" id="${html(a.asset_id)}">
<img loading="lazy" src="${href(image)}" alt="">
<h3>${html(a.standard_name)}</h3><p>${html(a.variant)}</p>
<p class="meta">${html(a.asset_id)} · ${html(a.tight_face_bounds_xyz_mm.join('×'))} mm${a.web_model ? ' · 网页模型' : ''}${a.product_image_match === 'approximate' ? ' · 效果图为同类参考' : a.product_image ? '' : ' · SketchUp 预览'}</p>
${plan ? `<img class="plan-image" loading="lazy" src="${href(plan)}" alt="平面图">` : ''}
<p class="links"><a class="file" href="${href(a.named_skp)}">SU 文件</a>${a.plan_symbol ? ` <a href="${href(a.plan_symbol.svg)}">平面图</a>` : ''}</p></article>`
  }
  const sections = []
  for (const category of CATEGORY_ORDER) {
    for (const si of category === '软装道具' ? ['SI1.0', 'SI2.0'] : [null]) {
      const items = assets.filter((a) => a.category === category && (a.category_si ?? null) === si)
      if (items.length) {
        sections.push(`<section data-category="${html(category)}"><h2>${html(si ? `${category} · ${si}` : category)}（${items.length}）</h2><div class="grid">${items.map(card).join('\n')}</div></section>`)
      }
    }
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模型目录</title>
<style>body{margin:0;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:#111}header,section{padding:16px 32px}header{border-bottom:2px solid #111}h1{margin:0;font-size:24px}h2{font-size:18px;border-bottom:1px solid #111;padding-bottom:8px}.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}button,select,input{font:inherit;border:1px solid #d4d4d4;background:#fff;padding:6px 10px}button[aria-pressed=true]{border-color:#111;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}article{border:1px solid #d4d4d4;padding:12px}article img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#f5f5f5}article img.plan-image{aspect-ratio:3/2;background:#fff;border-top:1px solid #e8e8e8;margin-top:8px}h3{font-size:14px;margin:8px 0 0}p{margin:2px 0}.meta{color:#616161;font-size:12px}.links a{margin-right:8px;font-size:12px;color:#111}[hidden]{display:none!important}@media(max-width:600px){header,section{padding:12px}}</style>
<header><h1>模型目录</h1><p>${assets.length} 件，按大类与 SI 分组；有效果图时显示效果图，否则显示 SketchUp 预览。</p>
<p class="links"><a href="模型清单.csv">模型清单</a><a href="缺少效果图清单.csv">缺少效果图清单</a><a href="README.md">使用说明</a><a href="../05_店铺形象设计标准/历史阅读记录/标准阅读索引.html">两套标准 · 360页</a><a href="../../docs/si-standards-review-20261001.md">阅读与判断记录</a></p>
<div class="tools"><span role="group" aria-label="大类">${buttons}</span>
<label>软装 SI <select aria-label="软装SI版本"><option value="">全部</option><option>SI1.0</option><option>SI2.0</option></select></label>
<label><input type="checkbox" aria-label="仅看有平面图"> 仅看有平面图</label>
<input type="search" aria-label="搜索模型" placeholder="搜索编号或名称"></div></header>
${sections.join('\n')}
<script>
const state={category:'',si:'',plan:false,q:''}
function apply(){for(const a of document.querySelectorAll('article')){const d=a.dataset;a.hidden=!((!state.category||d.category===state.category)&&(!state.si||d.si===state.si)&&(!state.plan||d.plan==='1')&&(!state.q||d.search.includes(state.q)))}for(const s of document.querySelectorAll('section'))s.hidden=!s.querySelector('article:not([hidden])')}
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{state.category=b.dataset.filter;for(const o of document.querySelectorAll('[data-filter]'))o.setAttribute('aria-pressed',String(o===b));apply()}
document.querySelector('select').onchange=e=>{state.si=e.target.value;apply()}
document.querySelector('input[type=checkbox]').onchange=e=>{state.plan=e.target.checked;apply()}
document.querySelector('input[type=search]').oninput=e=>{state.q=e.target.value.trim();apply()}
</script>
</html>
`
}

export async function refreshLibrary() {
  const manifestPath = path.join(LIBRARY, 'manifest.json')
  const manifest = JSON.parse(await readText(manifestPath))
  const typeRows = parseCsv(await readText(path.join(LIBRARY, '品类对照.csv'))).slice(1)
  const types = new Map()
  for (const [id, name, match] of typeRows) {
    const asset = manifest.assets.find((a) => a.asset_id === id)
    if (!asset || !name) continue
    types.set(id, { name, match: MATCH[match] ?? 'exact', gallery: galleryOf(asset) })
  }
  linkImages(manifest, types)
  const copied = await syncCopies(manifest)

  const { readdirSync } = await import('node:fs')
  const listGallery = (gallery) => {
    const names = new Set()
    for (const [sub, suffix] of [['01_道具图片PNG', '.png'], ['03_平面图SVG', '平面图.svg']]) {
      const dir = path.join(LIBRARY, gallery, sub)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(suffix === '.png' ? '.png' : '.svg')) continue
        const name = file.replace(/平面图\.svg$|\.svg$|\.png$/, '')
        if (!name.endsWith('-背面')) names.add(manifest.type_aliases?.[name] ?? name)
      }
    }
    return [...names].sort()
  }

  for (const gallery of new Set(manifest.assets.filter((a) => a.category !== '环境设施').map(galleryOf))) {
    for (const sub of ['01_道具图片PNG', '02_平面图PNG', '03_平面图SVG']) {
      await mkdir(path.join(LIBRARY, gallery, sub), { recursive: true })
    }
  }
  const sorted = [...manifest.assets].sort(SORT)
  manifest.images_refreshed = new Date().toISOString().slice(0, 10)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(LIBRARY, '模型清单.csv'), listCsv(sorted))
  await writeFile(path.join(LIBRARY, '缺少效果图清单.csv'), missingCsv(sorted, types, listGallery))
  await writeFile(path.join(LIBRARY, '模型目录.html'), cataloguePage(sorted))
  const exact = manifest.assets.filter((a) => a.product_image_match === 'exact').length
  const approximate = manifest.assets.filter((a) => a.product_image_match === 'approximate').length
  const symbols = manifest.assets.filter((a) => a.plan_symbol).length
  return { assets: manifest.assets.length, exact, approximate, symbols, copied }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await refreshLibrary()
  console.log(`模型 ${r.assets} 件：同款效果图 ${r.exact}，同类参考 ${r.approximate}，平面图 ${r.symbols}；复制到模型目录 ${r.copied} 个文件；已更新清单、缺少清单与目录页`)
}
