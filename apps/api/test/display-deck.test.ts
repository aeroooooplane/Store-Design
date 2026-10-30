import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { planDisplay } from '@store/shared'
import type { DisplayRules, DisplayTable } from '@store/shared'
import { buildDisplayChecklist } from '../src/modules/displays/checklist.ts'
import { buildDisplayDeck, deckImage } from '../src/modules/displays/deck.ts'
import type { DeckImage } from '../src/modules/displays/deck.ts'
import { DISPLAY_WORKBOOK, parseDisplayWorkbook } from '../src/modules/displays/workbook.ts'
import { png } from './helpers.ts'

const RESOURCE = path.resolve(import.meta.dirname, '../../../资源库')
let rules: DisplayRules
let tables: DisplayTable[]
let picture: DeckImage

beforeAll(async () => {
  const parsed = await parseDisplayWorkbook(await readFile(path.join(RESOURCE, DISPLAY_WORKBOOK)))
  if (!parsed.rules) throw new Error(parsed.problems.join('\n'))
  rules = parsed.rules
  tables = planDisplay(rules, {
    tables: [
      { id: 'a', kind: 'island', cx: 2, cz: 6, w: 1, d: 1.8 },
      { id: 'b', kind: 'island', cx: 4.3, cz: 6, w: 1, d: 1.8 },
      { id: 'c', kind: 'island', cx: 4.3, cz: 3, w: 1, d: 1.8 },
      { id: 's', kind: 'side', cx: 0.4, cz: 4, w: 0.5, d: 1.8 },
    ],
    entrance: { point: [3, 8], inward: [0, -1] },
    market: 'domestic',
  })
  picture = await deckImage(png(64, 48))
})

/** Text runs of every slide, in slide order. */
function slideTexts(pptx: Buffer): string[] {
  const files = unzipSync(new Uint8Array(pptx))
  return Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)?.[1]) - Number(/(\d+)\.xml/.exec(b)?.[1]))
    .map((name) => {
      const file = files[name]
      const xml = file ? strFromU8(file) : ''
      return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('|')
    })
}

describe('展陈方案 PPT', () => {
  const base = () => ({
    title: '影石测试店',
    date: '2026-10-14',
    market: 'domestic' as const,
    subtitle: 'SI2.0 · 边厅店',
    rules,
    tables,
    plan: picture,
    planMarks: {
      A: { x: 0.3, y: 0.6 },
      B: { x: 0.6, y: 0.6 },
      C: { x: 0.6, y: 0.3 },
      D: { x: 0.1, y: 0.5 },
    },
    overview: { image: picture, marks: { A: { x: 0.2, y: 0.7 } } },
    tableViews: { A: { image: picture, mark: { x: 0.2, y: 0.7 } } },
    photos: { X6: picture },
    landscapeEnd: 'left' as const,
    pending: ['示例'],
  })

  it('has a cover, the overview, one slide per table and the counts, all as editable text', async () => {
    const pptx = await buildDisplayDeck({ ...base(), views: 'plan', tables3d: {} })
    const slides = slideTexts(pptx)
    expect(slides).toHaveLength(1 + 1 + 4 + 1 + 1)
    expect(slides[0]).toContain('影石测试店')
    expect(slides[0]).toContain('中岛桌展陈方案')
    expect(slides[1]).toContain('平面布局图总览')
    expect(slides[2]).toContain('A桌')
    expect(slides[2]).toContain('3-1 中岛桌（竖版）')
    expect(slides[2]).toContain('Luna Ultra + 创作者')
    expect(slides[2]).toContain('C3')
    expect(slides[5]).toContain('边桌（竖版）')
    expect(slides[6]).toContain('产品数量明细（运营用）')
    expect(slides[6]).toContain('|25|')
    expect(slides[6]).toContain('|24|')
    expect(slides[6]).toContain('待确认：示例')
  })

  it('adds a 3D page before the slot diagram, with the product names as editable text', async () => {
    const names = {
      L1: { x: 0.1, y: 0.5, w: 0.2, h: 0.05 },
      E: { x: 0.4, y: 0.8, w: 0.2, h: 0.05 },
    }
    const tables3d = { A: { image: picture, names } }
    const both = slideTexts(await buildDisplayDeck({ ...base(), views: 'both', tables3d }))
    // Table A gets two pages; B, C and D have no 3D view and keep their slot diagram.
    expect(both).toHaveLength(1 + 1 + 5 + 1 + 1)
    expect(both[2]).toContain('三维示意')
    expect(both[2]).toContain('Luna Ultra + 创作者')
    expect(both[2]).toContain('中间配件模块：C3、D8')
    expect(both[3]).toContain('平面布局图')
    const only3d = slideTexts(await buildDisplayDeck({ ...base(), views: '3d', tables3d }))
    expect(only3d).toHaveLength(1 + 1 + 4 + 1 + 1)
    expect(only3d[2]).toContain('三维示意')
    expect(only3d[3]).toContain('平面布局图')
  })
})

describe('展陈清单.xlsx', () => {
  it('lists every slot and the same totals as the PPT', async () => {
    const data = await buildDisplayChecklist({ title: '影石测试店', rules, tables })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(data as unknown as ArrayBuffer)
    expect(workbook.getWorksheet('逐桌逐位')?.rowCount).toBe(1 + 3 * 7 + 3)
    const last = (name: string) => {
      const sheet = workbook.getWorksheet(name)
      return sheet?.getRow(sheet.rowCount).values
    }
    expect(last('产品数量')).toEqual([undefined, '合计', '', 25])
    expect(last('托盘数量')).toEqual([undefined, '合计', 24])
    expect(workbook.getWorksheet('配件模块')?.getRow(2).values).toEqual([
      undefined,
      'A桌',
      '3-1',
      'C3、D8',
    ])
  })
})
