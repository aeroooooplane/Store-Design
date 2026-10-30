import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkRules, countUnits, layoutsFor, planDisplay, summarizeDisplay } from '@store/shared'
import type { DisplayRules } from '@store/shared'
import { currentDisplayRules, importDisplayRules } from '../src/modules/displays/importer.ts'
import { DISPLAY_WORKBOOK, parseDisplayWorkbook } from '../src/modules/displays/workbook.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

// Versioned test copy keeps CI independent from each developer's OneDrive directory.
const RESOURCE = path.resolve(import.meta.dirname, 'fixtures')
let rules: DisplayRules

beforeAll(async () => {
  const parsed = await parseDisplayWorkbook(await readFile(path.join(RESOURCE, DISPLAY_WORKBOOK)))
  expect(parsed.problems).toEqual([])
  if (!parsed.rules) throw new Error('workbook not parsed')
  rules = parsed.rules
})

describe('展陈规则.xlsx', () => {
  it('passes every consistency check, including the guide’s own counts', () => {
    expect(checkRules(rules)).toEqual([])
    expect(rules.version).toBe('2026-10-13')
  })

  it('adds up to the guide’s totals for every table count, market and orientation', () => {
    const totals = (tables: 2 | 3 | 4 | 'side', market: 'domestic' | 'overseas') =>
      (['portrait', 'landscape'] as const).map((orientation) => {
        const counts = countUnits(
          rules,
          layoutsFor(rules, tables, market, orientation).flatMap((l) => l.slots.map((s) => s.unit)),
        )
        const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
        return [sum(counts.products), sum(counts.trays)]
      })
    for (const market of ['domestic', 'overseas'] as const) {
      expect(totals(2, market)).toEqual([
        [16, 14],
        [16, 14],
      ])
      expect(totals(3, market)).toEqual([
        [22, 21],
        [22, 21],
      ])
      expect(totals(4, market)).toEqual([
        [29, 28],
        [29, 28],
      ])
      expect(totals('side', market)).toEqual([
        [3, 3],
        [3, 3],
      ])
    }
  })

  it('differs between 国内 and 海外 only in the AG Pac trays', () => {
    const units = (market: 'domestic' | 'overseas') =>
      layoutsFor(rules, 4, market, 'portrait')
        .find((l) => l.seat === '4-3')
        ?.slots.map((s) => s.unit)
    expect(units('domestic')).toEqual([
      'GO Ultra',
      'GO Ultra HK',
      'AG',
      'GO Ultra',
      'GO Ultra',
      'AG',
      'AG',
    ])
    expect(units('overseas')).toEqual([
      'GO Ultra',
      'GO Ultra HK',
      'AG Pac Air',
      'GO Ultra',
      'GO Ultra',
      'AG Pac Neo',
      'AG',
    ])
  })

  it('lays out a three-table store: seats from the entrance, hero, modules and counts', () => {
    // Entrance along the bottom edge (z = 8); a row of two tables near it and one further in.
    const tables = [
      { id: 'far', kind: 'island' as const, cx: 3, cz: 3, w: 0.8, d: 1.8 },
      { id: 'right', kind: 'island' as const, cx: 5, cz: 6, w: 0.8, d: 1.8 },
      { id: 'left', kind: 'island' as const, cx: 2, cz: 6, w: 0.8, d: 1.8 },
      { id: 'side', kind: 'side' as const, cx: 0.3, cz: 4, w: 0.5, d: 1.8 },
    ]
    const plan = planDisplay(rules, {
      tables,
      entrance: { point: [4, 8], inward: [0, -1] },
      market: 'domestic',
    })
    expect(plan.map((t) => [t.label, t.sourceId, t.seat, t.orientation])).toEqual([
      ['A', 'left', '3-1', 'portrait'],
      ['B', 'right', '3-2', 'portrait'],
      ['C', 'far', '3-3', 'portrait'],
      ['D', 'side', '边桌', 'portrait'],
    ])
    expect(plan[0]?.slots.find((s) => s.hero)).toEqual({ slot: 'E', unit: 'Luna B', hero: true })
    expect(plan[0]?.modules).toEqual(['C3', 'D8'])
    expect(plan[0]?.endToward).toEqual([0, 1])
    const summary = summarizeDisplay(rules, plan)
    expect([summary.productTotal, summary.trayTotal, summary.emptySlots]).toEqual([25, 24, 0])
  })
})

describe('pnpm display:import', () => {
  let t: TestApp
  let storage: string
  beforeAll(async () => {
    t = await createTestApp()
    storage = await mkdtemp(path.join(tmpdir(), 'display-import-'))
  })
  afterAll(async () => {
    await t.close()
    await rm(storage, { recursive: true, force: true })
  })

  it('imports the workbook with its photos and does nothing the second time', async () => {
    const roots = { storage, resource: RESOURCE }
    const first = await importDisplayRules(t.database.db, roots)
    expect(first).toMatchObject({
      status: 'imported',
      version: '2026-10-13',
      problems: [],
      missingPhotos: [],
    })
    expect(first.photos).toBe(rules.photos.length)
    const current = await currentDisplayRules(t.database.db)
    expect(current?.rules.photos.every((p) => p.fileId)).toBe(true)
    const second = await importDisplayRules(t.database.db, roots)
    expect(second.status).toBe('unchanged')
  })
})
