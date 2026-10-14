import ExcelJS from 'exceljs'
import { DisplayRulesSchema } from '@store/shared'
import type { DisplayRules, RuleMarket, RuleTables } from '@store/shared'

/** Where the workbook lives inside 资源库; photo paths in it are relative to this folder. */
export const DISPLAY_RESOURCE_DIR = '10_产品与陈列'
export const DISPLAY_WORKBOOK = `${DISPLAY_RESOURCE_DIR}/展陈规则.xlsx`

export interface ParsedWorkbook {
  rules: DisplayRules | null
  problems: string[]
}

const MARKETS: Record<string, RuleMarket> = { 通用: 'any', 国内: 'domestic', 海外: 'overseas' }
const ORIENTATIONS: Record<string, 'portrait' | 'landscape'> = {
  竖版: 'portrait',
  横版: 'landscape',
}
const PHOTO_KINDS: Record<string, 'photo' | 'render'> = { 实景图: 'photo', 效果图: 'render' }
const COUNT_KINDS: Record<string, 'product' | 'tray'> = { 产品: 'product', 托盘: 'tray' }

/**
 * Reads 展陈规则.xlsx (sheets 说明, 产品型号, 托盘种类, 陈列组合, 版式, 配件模块, 桌号模块, 照片,
 * 数量核对; the first row of each is the header). Problems name the sheet and row so the person
 * maintaining the workbook can fix them; the result is null when any row could not be read.
 */
export async function parseDisplayWorkbook(data: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data as unknown as ArrayBuffer)
  const problems: string[] = []

  const rows = (name: string): { row: number; cells: string[] }[] => {
    const sheet = workbook.getWorksheet(name)
    if (!sheet) {
      problems.push(`缺少工作表“${name}”`)
      return []
    }
    const out: { row: number; cells: string[] }[] = []
    sheet.eachRow((row, index) => {
      if (index === 1) return
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cell.text.trim()
      })
      if (cells.some((c) => c)) out.push({ row: index, cells })
    })
    return out
  }
  const cell = (r: { cells: string[] }, i: number) => r.cells[i] ?? ''
  const pick = <T>(
    map: Record<string, T>,
    value: string,
    where: string,
    what: string,
  ): T | null => {
    const hit = map[value]
    if (hit === undefined)
      problems.push(`${where}：${what}“${value}”无法识别（可填 ${Object.keys(map).join('、')}）`)
    return hit ?? null
  }
  const tables = (value: string, where: string): RuleTables | null => {
    if (value === '边桌') return 'side'
    const n = Number(value)
    if (n === 2 || n === 3 || n === 4) return n
    problems.push(`${where}：桌数“${value}”应为 2、3、4 或 边桌`)
    return null
  }
  const count = (value: string, where: string): number | null => {
    const n = Number(value)
    if (Number.isInteger(n) && n >= 0) return n
    problems.push(`${where}：数量“${value}”不是整数`)
    return null
  }

  const info = rows('说明')
  const version = info.find((r) => cell(r, 0) === '版本日期')
  const source = info.find((r) => cell(r, 0) === '来源')
  const notes = info
    .filter((r) => ['陈列说明', '数量规则'].includes(cell(r, 0)))
    .map((r) => ({ kind: cell(r, 0), text: cell(r, 1) }))

  const products = rows('产品型号').map((r) => ({
    id: cell(r, 0),
    category: cell(r, 1),
    name: cell(r, 2),
  }))
  const trays = rows('托盘种类').map((r) => ({ id: cell(r, 0), name: cell(r, 1) }))
  const units = rows('陈列组合').map((r) => {
    const where = `陈列组合第 ${r.row} 行`
    const parts = cell(r, 2)
      .split(/[;；]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const m = /^(.+?)\s*[*×xX]\s*(\d+)$/.exec(p)
        if (!m) {
          problems.push(`${where}：构成“${p}”应写成“产品编号*数量”`)
          return null
        }
        return { product: (m[1] ?? '').trim(), count: Number(m[2]) }
      })
    return {
      id: cell(r, 0),
      label: cell(r, 1),
      products: parts.filter((p) => p !== null),
      tray: cell(r, 3),
    }
  })

  const grouped = new Map<string, DisplayRules['layouts'][number]>()
  for (const r of rows('版式')) {
    const where = `版式第 ${r.row} 行`
    const t = tables(cell(r, 0), where)
    const market = pick(MARKETS, cell(r, 1), where, '市场')
    const orientation = pick(ORIENTATIONS, cell(r, 2), where, '版本')
    if (t === null || !market || !orientation) continue
    const seat = cell(r, 3)
    const key = `${t}|${market}|${orientation}|${seat}`
    const layout = grouped.get(key) ?? { tables: t, market, orientation, seat, slots: [] }
    layout.slots.push({ slot: cell(r, 4), unit: cell(r, 5), hero: cell(r, 6) === '是' })
    grouped.set(key, layout)
  }

  const modules = rows('配件模块').map((r) => ({
    id: cell(r, 0),
    series: cell(r, 1),
    size: cell(r, 2),
  }))
  const seatModules = rows('桌号模块').flatMap((r) => {
    const t = tables(cell(r, 0), `桌号模块第 ${r.row} 行`)
    if (t === null || t === 'side') return []
    const list = cell(r, 2)
      .split(/[,，、\s]+/)
      .map((m) => m.trim())
      .filter(Boolean)
    return [{ tables: t, seat: cell(r, 1), modules: list }]
  })
  const photos = rows('照片').flatMap((r) => {
    const where = `照片第 ${r.row} 行`
    const kind = pick(PHOTO_KINDS, cell(r, 2), where, '类型')
    const si = cell(r, 1)
    if (si !== 'SI1.0' && si !== 'SI2.0') problems.push(`${where}：SI 应为 SI1.0 或 SI2.0`)
    if (!kind || (si !== 'SI1.0' && si !== 'SI2.0')) return []
    return [{ unit: cell(r, 0), si, kind, file: cell(r, 3), fileId: null }]
  })
  const expected = rows('数量核对').flatMap((r) => {
    const where = `数量核对第 ${r.row} 行`
    const t = tables(cell(r, 0), where)
    const market = pick(MARKETS, cell(r, 1), where, '市场')
    const kind = pick(COUNT_KINDS, cell(r, 2), where, '类别')
    const n = count(cell(r, 4), where)
    if (t === null || !market || !kind || n === null) return []
    return [{ tables: t, market, kind, id: cell(r, 3), count: n }]
  })

  const parsed = DisplayRulesSchema.safeParse({
    version: version ? cell(version, 1) : '',
    source: source ? cell(source, 1) : '',
    notes,
    products,
    trays,
    units,
    layouts: [...grouped.values()],
    modules,
    seatModules,
    photos,
    expected,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20))
      problems.push(`内容格式：${issue.path.join('.') || '（整体）'} ${issue.message}`)
  }
  return { rules: problems.length || !parsed.success ? null : parsed.data, problems }
}
