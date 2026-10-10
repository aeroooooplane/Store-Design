// 回读用户改过的 资源库/模型选用表.xlsx 到 资源库/04_模型库/manifest.json：
//   模型行：模型名称 → display_name（项目里显示的名称，手册名称 standard_name/variant 保留不动）；
//           是否保留=删除 → retired（停用：不再出现在添加模型列表和自动排布里，已有方案照常显示）；
//           修改意见 → user_note。
//   无 SU 的品类行：改名记入 type_aliases（图库文件不改名），删除与意见记入 gallery_notes。
// 行按“编号”列找回；第一版表格的品类行没有编号，按序号对应当时生成的行（须先确认表格未增删行）。
// 用法（仓库根目录）：pnpm library:apply-table [表格.xlsx]，然后 pnpm library:table 重新生成表格、
// pnpm catalog:import 更新数据库。
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { GALLERY_KEY, LIBRARY, ROOT, manualName, selectionRows } from './selection-rows.mjs'

const INPUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '资源库/模型选用表.xlsx')
const manifestPath = path.join(LIBRARY, 'manifest.json')
const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^﻿/, ''))
const rows = selectionRows(manifest)
const byKey = new Map(rows.map((r) => [r.key, r]))
const today = new Date().toISOString().slice(0, 10)

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(INPUT)
const sheet = workbook.worksheets[0]
if (!sheet) throw new Error('表格没有工作表')
const columns = new Map()
sheet.getRow(1).eachCell((cell, col) => columns.set(String(cell.value).trim(), col))
for (const name of ['序号', '模型名称', '是否保留', '修改意见', '编号', '所在目录']) {
  if (!columns.has(name)) throw new Error(`表格缺少“${name}”列`)
}
const text = (row, name) => {
  const value = row.getCell(columns.get(name)).value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((r) => r.text).join('').trim()
  return String(value).trim()
}

const report = { renamed: 0, retired: 0, restored: 0, notes: 0, aliases: 0, unmatched: [] }
sheet.eachRow((row, number) => {
  if (number === 1) return
  const id = text(row, '编号')
  const n = Number(text(row, '序号'))
  let target = id.startsWith('asset-')
    ? byKey.get(id)
    : id.startsWith(GALLERY_KEY)
      ? rows.find((r) => r.id === id && r.gallery === text(row, '所在目录'))
      : rows[n - 1]
  // A row without a key must still describe the same kind of row as in the generated table.
  if (target && !id && (target.asset || target.gallery !== text(row, '所在目录'))) target = undefined
  if (!target) {
    report.unmatched.push(`第 ${number} 行（${text(row, '模型名称')}）`)
    return
  }
  const name = text(row, '模型名称')
  const retire = text(row, '是否保留') === '删除'
  const note = text(row, '修改意见') || null

  if (target.asset) {
    const a = target.asset
    const shown = a.display_name ?? manualName(a)
    if (name && name !== shown) {
      a.display_name = name === manualName(a) ? null : name
      report.renamed++
    }
    if (retire && !a.retired) {
      a.retired = { date: today, reason: note ?? '模型选用表中标为删除' }
      report.retired++
    } else if (!retire && a.retired) {
      a.retired = null
      report.restored++
    }
    if ((a.user_note ?? null) !== note) {
      a.user_note = note
      report.notes++
    }
    return
  }

  // Gallery-only type: rename every file that carries the shown name.
  if (name && name !== target.name) {
    manifest.type_aliases = manifest.type_aliases ?? {}
    for (const file of target.files) manifest.type_aliases[file] = name
    report.aliases++
  }
  const key = `${target.gallery}|${name || target.name}`
  manifest.gallery_notes = manifest.gallery_notes ?? {}
  const previous = manifest.gallery_notes[`${target.gallery}|${target.name}`] ?? {}
  delete manifest.gallery_notes[`${target.gallery}|${target.name}`]
  const entry = { ...previous, retired: retire ? (previous.retired ?? today) : null, user_note: note }
  if (entry.retired || entry.user_note || entry.reply_note) manifest.gallery_notes[key] = entry
})

manifest.selection_table_applied = today
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  `回读 ${path.relative(ROOT, INPUT)}：改名 ${report.renamed}，停用 ${report.retired}，恢复 ${report.restored}，意见 ${report.notes}，品类改名 ${report.aliases}`,
)
if (report.unmatched.length) console.warn(`未能对应：${report.unmatched.join('，')}`)
