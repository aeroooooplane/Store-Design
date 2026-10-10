// 生成 资源库/模型选用表.xlsx：所有可选模型（不含环境设施）及品类图库中尚无 SU 模型的品类，
// 带效果图与平面图缩略图，供用户改名称、勾选“是否保留”和填写修改意见；改完用
// pnpm library:apply-table 回读到 manifest.json。“处理说明”列是对修改意见的答复。
// 用法（仓库根目录）：pnpm library:table
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { LIBRARY, ROOT, selectionRows } from './selection-rows.mjs'

const OUTPUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '资源库/模型选用表.xlsx')
const THUMB = { width: 200, height: 140 }

const readText = async (file) => (await readFile(file, 'utf8')).replace(/^﻿/, '')

/** Small JPEG (pictures) or PNG (drawings) on white, so the workbook stays light. */
async function thumbnail(file, kind) {
  const image = sharp(file).resize({
    width: THUMB.width,
    height: THUMB.height,
    fit: 'inside',
    background: '#ffffff',
  })
  const flat = image.flatten({ background: '#ffffff' })
  const buffer = kind === 'jpeg' ? await flat.jpeg({ quality: 82 }).toBuffer() : await flat.png().toBuffer()
  const { width = THUMB.width, height = THUMB.height } = await sharp(buffer).metadata()
  return { buffer, width, height }
}

const manifest = JSON.parse(await readText(path.join(LIBRARY, 'manifest.json')))
const rows = selectionRows(manifest)

const workbook = new ExcelJS.Workbook()
workbook.creator = 'store-design'
const sheet = workbook.addWorksheet('模型选用', { views: [{ state: 'frozen', ySplit: 1 }] })
sheet.columns = [
  { header: '序号', key: 'n', width: 6 },
  { header: '模型名称', key: 'name', width: 30 },
  { header: '模型效果图', key: 'image', width: 30 },
  { header: '效果图说明', key: 'imageNote', width: 16 },
  { header: '模型平面图', key: 'plan', width: 30 },
  { header: '是否有SU', key: 'su', width: 10 },
  { header: '是否保留', key: 'keep', width: 10 },
  { header: '修改意见', key: 'note', width: 30 },
  { header: '处理说明', key: 'reply', width: 40 },
  { header: '编号', key: 'id', width: 16 },
  { header: '大类', key: 'category', width: 12 },
  { header: 'SI', key: 'si', width: 8 },
  { header: '尺寸（毫米，宽×深×高）', key: 'size', width: 22 },
  { header: '所在目录', key: 'folder', width: 50 },
]
const header = sheet.getRow(1)
header.font = { bold: true }
header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
header.height = 28
header.eachCell((cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
})

for (const [i, row] of rows.entries()) {
  const { key: _key, asset: _asset, gallery: _gallery, files: _files, ...cells } = row
  const r = sheet.addRow({ n: i + 1, ...cells, image: '', plan: '' })
  r.height = 112
  r.alignment = { vertical: 'middle', wrapText: true }
  r.getCell('n').alignment = { vertical: 'middle', horizontal: 'center' }
  for (const key of ['su', 'keep']) r.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' }
  // Retired models stay listed (greyed) so the decision can be reversed.
  if (row.keep === '删除') r.font = { color: { argb: 'FF999999' } }
  r.getCell('keep').dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: ['"保留,删除"'],
    showErrorMessage: true,
    errorTitle: '是否保留',
    error: '请选择 保留 或 删除',
  }
  for (const [key, file, kind] of [
    ['image', row.image, 'jpeg'],
    ['plan', row.plan, 'png'],
  ]) {
    if (!file || !existsSync(path.join(LIBRARY, file))) continue
    const thumb = await thumbnail(path.join(LIBRARY, file), kind)
    const id = workbook.addImage({ buffer: thumb.buffer, extension: kind })
    const col = sheet.getColumn(key).number - 1
    sheet.addImage(id, {
      tl: { col: col + 0.04, row: r.number - 1 + 0.06 },
      ext: { width: thumb.width, height: thumb.height },
      editAs: 'oneCell',
    })
  }
}
sheet.autoFilter = { from: 'A1', to: 'N1' }

await workbook.xlsx.writeFile(OUTPUT)
const withSu = rows.filter((r) => r.su === '有').length
const retired = rows.filter((r) => r.keep === '删除').length
console.log(
  `模型选用表：${rows.length} 行（有 SU ${withSu}，无 SU ${rows.length - withSu}，标为删除 ${retired}）→ ${path.relative(ROOT, OUTPUT)}`,
)
