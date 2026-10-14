import ExcelJS from 'exceljs'
import { DISPLAY_ORIENTATION_LABELS, summarizeDisplay } from '@store/shared'
import type { DisplayRules, DisplayTable } from '@store/shared'

/**
 * 展陈清单.xlsx for the store team and suppliers: every slot of every table, the product and tray
 * counts (the same numbers as the PPT, from summarizeDisplay) and the accessory modules.
 */
export async function buildDisplayChecklist(input: {
  title: string
  rules: DisplayRules
  tables: DisplayTable[]
}): Promise<Buffer> {
  const { rules, tables } = input
  const units = new Map(rules.units.map((u) => [u.id, u]))
  const trays = new Map(rules.trays.map((t) => [t.id, t.name]))
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '影石Insta360 门店空间设计'
  const sheet = (name: string, header: string[], rows: (string | number)[][], widths: number[]) => {
    const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.addRow(header).font = { bold: true }
    for (const row of rows) ws.addRow(row)
    ws.columns.forEach((col, i) => (col.width = widths[i] ?? 12))
    return ws
  }

  sheet(
    '逐桌逐位',
    ['桌', '类型', '桌号', '版本', '位号', '陈列内容', '明星位', '托盘'],
    tables.flatMap((t) =>
      t.slots.map((s) => {
        const unit = s.unit ? units.get(s.unit) : undefined
        return [
          `${t.label}桌`,
          t.kind === 'side' ? '边桌' : '中岛桌',
          t.seat ?? '加桌',
          DISPLAY_ORIENTATION_LABELS[t.orientation],
          s.slot,
          unit?.label ?? '待定',
          s.hero ? '是' : '',
          unit ? (trays.get(unit.tray) ?? unit.tray) : '',
        ]
      }),
    ),
    [8, 8, 8, 8, 8, 24, 8, 28],
  )
  const summary = summarizeDisplay(rules, tables)
  const products = sheet(
    '产品数量',
    ['类目', '型号', '数量'],
    summary.products.map((p) => [p.category ?? '', p.name, p.count]),
    [12, 26, 8],
  )
  products.addRow(['合计', '', summary.productTotal]).font = { bold: true }
  const trayRows = sheet(
    '托盘数量',
    ['托盘种类', '托盘位数量'],
    summary.trays.map((t) => [t.name, t.count]),
    [30, 12],
  )
  trayRows.addRow(['合计', summary.trayTotal]).font = { bold: true }
  sheet(
    '配件模块',
    ['桌', '桌号', '模块'],
    tables
      .filter((t) => t.kind === 'island')
      .map((t) => [`${t.label}桌`, t.seat ?? '加桌', t.modules.join('、')]),
    [8, 8, 30],
  )
  workbook.title = `${input.title}展陈清单`
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
