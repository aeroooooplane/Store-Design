// 模型选用表的行：生成（build-selection-table.mjs）与回读（apply-selection-table.mjs）共用，
// 保证两边的行序、名称与键一致。
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { galleryOf } from './refresh-library.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const LIBRARY = path.join(ROOT, '资源库/04_模型库')
const CATEGORY_ORDER = ['软装道具', '信息化物料', '品牌标识', '非标陈列']
const MATCH = { exact: '同款效果图', approximate: '同类参考效果图' }
/** 无 SU 模型的品类行在“编号”列写这个前缀加图库文件名，回读时据此找到品类。 */
export const GALLERY_KEY = '品类图库:'

/** 手册名称（标准名称 · 变体），用户未改名时显示它。 */
export const manualName = (a) => (a.variant ? `${a.standard_name} · ${a.variant}` : a.standard_name)

/**
 * Gallery types: every picture / plan file not tied to one model, grouped by its shown name
 * (type_aliases rename files). `files` are the file stems that carry this name.
 */
export function galleryTypes(gallery, aliases) {
  const types = new Map()
  for (const [sub, re] of [
    ['01_道具图片PNG', /^(.+)\.png$/],
    ['03_平面图SVG', /^(.+?)(平面图)?\.svg$/],
  ]) {
    const dir = path.join(LIBRARY, gallery, sub)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      const match = re.exec(file)
      if (!match || match[1].endsWith('-背面') || /^asset-\d+$/.test(match[1])) continue
      const name = aliases[match[1]] ?? match[1]
      const type = types.get(name) ?? { name, files: new Set(), svg: null, png: null }
      type.files.add(match[1])
      if (sub === '03_平面图SVG') type.svg = match[1]
      else type.png = match[1]
      types.set(name, type)
    }
  }
  return [...types.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** Table rows in table order: models first (by category, SI, name), then gallery-only types. */
export function selectionRows(manifest) {
  const aliases = manifest.type_aliases ?? {}
  const models = manifest.assets
    .filter((a) => a.category !== '环境设施')
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        String(a.category_si).localeCompare(String(b.category_si)) ||
        a.standard_name.localeCompare(b.standard_name, 'zh') ||
        a.asset_id.localeCompare(b.asset_id),
    )
  const rows = models.map((a) => ({
    key: a.asset_id,
    asset: a,
    name: a.display_name ?? manualName(a),
    image: a.product_image ?? a.preview,
    imageNote: a.product_image
      ? MATCH[a.product_image_match]
      : a.preview
        ? 'SketchUp 预览（缺效果图）'
        : '无',
    plan: a.plan_symbol?.png ?? null,
    su: '有',
    keep: a.retired ? '删除' : '保留',
    note: a.user_note ?? '',
    reply: a.reply_note ?? '',
    id: a.asset_id,
    category: a.category,
    si: a.category_si ?? '',
    size: a.tight_face_bounds_xyz_mm.map((v) => Math.round(v)).join(' × '),
    folder: a.folder,
  }))

  const linked = new Set(manifest.assets.map((a) => `${galleryOf(a)}|${a.type_name}`))
  for (const gallery of [...new Set(models.map(galleryOf))]) {
    for (const type of galleryTypes(gallery, aliases)) {
      if (linked.has(`${gallery}|${type.name}`)) continue
      const image = type.png ? `${gallery}/01_道具图片PNG/${type.png}.png` : null
      const plan = type.svg ? `${gallery}/02_平面图PNG/${type.svg}平面图.png` : null
      const [category, si] = gallery.split('/')
      const note = manifest.gallery_notes?.[`${gallery}|${type.name}`] ?? {}
      rows.push({
        key: `${GALLERY_KEY}${gallery}|${[...type.files].sort()[0]}`,
        gallery,
        files: [...type.files],
        name: type.name,
        image: image && existsSync(path.join(LIBRARY, image)) ? image : null,
        imageNote: image && existsSync(path.join(LIBRARY, image)) ? '品类效果图' : '无',
        plan: plan && existsSync(path.join(LIBRARY, plan)) ? plan : null,
        su: '无',
        keep: note.retired ? '删除' : '保留',
        note: note.user_note ?? '',
        reply: note.reply_note ?? '',
        id: `${GALLERY_KEY}${[...type.files].sort()[0]}`,
        category,
        si: si === '品类图库' ? '' : si,
        size: '',
        folder: gallery,
      })
    }
  }
  return rows
}
