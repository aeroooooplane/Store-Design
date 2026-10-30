import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import {
  checkRules,
  countUnits,
  displayChoices,
  planTaskTables,
  summarizeDisplayModules,
} from '@store/shared'
import type { DisplayRules, DisplayTaskState, SiStyle } from '@store/shared'
import { parseDisplayWorkbook } from '../src/modules/displays/workbook.ts'
import { buildDisplayChecklist } from '../src/modules/displays/checklist.ts'
import { buildDisplayDeck } from '../src/modules/displays/deck.ts'

let rules: DisplayRules
let audit: { catalog: { si: SiStyle; row: number; units: string[]; name: string }[] }
beforeAll(async () => {
  const parsed = await parseDisplayWorkbook(
    await readFile(new URL('./fixtures/display/展陈规则.xlsx', import.meta.url)),
  )
  expect(parsed.problems).toEqual([])
  if (!parsed.rules) throw new Error('未读到规则')
  rules = parsed.rules
  audit = JSON.parse(
    await readFile(new URL('./fixtures/display/tray-source-audit.json', import.meta.url), 'utf8'),
  )
})

function planned(n: number, siStyle?: SiStyle, scheme?: 'standard' | 'draft-2026') {
  const state: DisplayTaskState = {
    entrance: 'bottom',
    tables: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      kind: 'island',
      x: (i + 1) / (n + 1),
      y: 0.5,
      w: 0.05,
      h: 0.15,
      render: null,
      label: null,
    })),
    edits: {
      orientation: 'portrait',
      landscapeEnd: 'left',
      modules: {},
      slots: {},
      ...(scheme ? { moduleScheme: scheme } : {}),
    },
    detection: null,
    recognition: null,
  }
  return planTaskTables(rules, {
    market: 'domestic',
    siStyle,
    plan: { width: 1000, height: 1000 },
    state,
  })
}

describe('权威指引 rev4095 逐行托盘核对', () => {
  it('完整保留52行来源规格，每行可选且一选只算一个托盘，不因没有图片被丢弃', () => {
    expect(checkRules(rules)).toEqual([])
    expect(
      checkRules({ ...rules, catalog: [...rules.catalog!, rules.catalog![0]!] }).some((p) =>
        p.includes('托盘选项编号重复'),
      ),
    ).toBe(true)
    expect(rules.catalog).toHaveLength(52)
    for (const row of audit.catalog) {
      const source = rules.catalog?.find((c) => c.si === row.si && c.row === row.row)
      expect(source?.units, `${row.si} 第${row.row}行`).toEqual(row.units)
      for (const id of row.units) {
        expect(displayChoices({ ...rules, photos: [] }, row.si).some((u) => u.id === id)).toBe(true)
        expect([...countUnits(rules, [id]).trays.values()].reduce((s, n) => s + n, 0)).toBe(1)
      }
    }
    for (const [si, rows, choices] of [
      ['SI1.0', 29, 32],
      ['SI2.0', 23, 26],
    ] as const) {
      expect(rules.catalog?.filter((c) => c.si === si)).toHaveLength(rows)
      const ids = displayChoices(rules, si).map((c) => c.id)
      expect(ids).toHaveLength(choices)
      expect(new Set(ids).size).toBe(choices)
    }
  })
  it('旧规则、缺SI和SI1.0不会静默套用SI2.0讨论稿', () => {
    const old = planned(3)
    expect(old[0]?.modules).toEqual(['C3', 'D8'])
    expect(planned(3, 'SI1.0', 'draft-2026').map((t) => t.modules)).toEqual(
      old.map((t) => t.modules),
    )
    expect(planned(3, 'SI2.0').map((t) => t.modules)).toEqual(old.map((t) => t.modules))
  })
  it('SI2.0主动选择新版后2/3/4桌数量、模块与状态一致，保存结构可重放', () => {
    for (const [n, expected, sizes] of [
      [2, 7, [4, 1, 2]],
      [3, 10, [4, 1, 5]],
      [4, 12, [4, 2, 6]],
    ] as const) {
      const tables = planned(n, 'SI2.0', 'draft-2026')
      const summary = summarizeDisplayModules(rules, tables)
      expect(summary.innerTotal).toBe(expected)
      expect(['A', 'C', 'D'].map((s) => summary.counts.get(s))).toEqual(sizes)
      expect(summary.frameTotal).toBe(n)
      expect(summary.total).toBe(expected + n)
      expect(
        tables.every((t) =>
          t.notes.some((note) => note.includes('讨论稿') && note.includes('未确认')),
        ),
      ).toBe(true)
      expect(JSON.parse(JSON.stringify(tables))).toEqual(tables)
    }
    expect(planned(3, 'SI2.0', 'draft-2026').map((t) => t.modules)).toEqual([
      ['D16', 'D13', 'D12'],
      ['A7', 'C4', 'A8'],
      ['A2', 'D4', 'D7', 'A4'],
    ])
  })
  it('PPT与清单独立列内盘/外框，不与主机位重复相加，并保留讨论稿说明', async () => {
    const tables = planned(3, 'SI2.0', 'draft-2026')
    const data = await buildDisplayChecklist({ title: '数量核对', rules, tables })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(data as unknown as ArrayBuffer)
    const inner = workbook.getWorksheet('内嵌托盘数量')
    expect(inner?.getRow(inner.rowCount).values).toEqual([undefined, '含外框合计', 13])
    const trays = workbook.getWorksheet('托盘数量')
    expect(trays?.getRow(trays.rowCount).values).toEqual([undefined, '合计', 21])
    const ppt = await buildDisplayDeck({
      title: '数量核对',
      subtitle: 'SI2.0',
      date: '2026-10-30',
      market: 'domestic',
      rules,
      tables,
      plan: null,
      planMarks: {},
      overview: null,
      tableViews: {},
      photos: {},
      landscapeEnd: 'left',
      views: 'plan',
      tables3d: {},
      pending: [],
    })
    const entries = unzipSync(ppt)
    const text = Object.entries(entries)
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(([, bytes]) => strFromU8(bytes))
      .join('')
    expect(text).toContain('内盘合计：10 个；外框：3 个；含外框合计：13 个')
    expect(text).toContain('未确认实物可放性')
  })
})
