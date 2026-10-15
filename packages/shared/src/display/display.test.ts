import { describe, expect, it } from 'vitest'
import {
  entranceFrame,
  orderTables,
  planDisplay,
  summarizeDisplay,
  tableOrientation,
  unitPhoto,
} from './engine.ts'
import type { DisplayTableInput } from './engine.ts'
import { HERO_SLOT, ISLAND_SLOTS, SIDE_SLOTS, checkRules, diffRules } from './rules.ts'
import type { DisplayRules } from './rules.ts'

/** A small, consistent rule set: every island slot holds 'a' except the hero ('b'); sides hold 'c'. */
function makeRules(): DisplayRules {
  const layouts: DisplayRules['layouts'] = []
  const expected: DisplayRules['expected'] = []
  for (const n of [2, 3, 4] as const) {
    for (const orientation of ['portrait', 'landscape'] as const)
      for (let k = 1; k <= n; k++)
        layouts.push({
          tables: n,
          market: 'any',
          orientation,
          seat: `${n}-${k}`,
          slots: ISLAND_SLOTS[orientation].map((slot) => {
            const hero = slot === HERO_SLOT[orientation]
            return { slot, unit: hero ? 'b' : 'a', hero }
          }),
        })
    expected.push(
      { tables: n, market: 'any', kind: 'product', id: 'pa', count: 6 * n },
      { tables: n, market: 'any', kind: 'product', id: 'pb', count: n },
      { tables: n, market: 'any', kind: 'tray', id: 'std', count: 7 * n },
    )
  }
  for (const orientation of ['portrait', 'landscape'] as const)
    layouts.push({
      tables: 'side',
      market: 'any',
      orientation,
      seat: '边桌',
      slots: SIDE_SLOTS.map((slot) => ({ slot, unit: 'c', hero: false })),
    })
  expected.push(
    { tables: 'side', market: 'any', kind: 'product', id: 'pc', count: 3 },
    { tables: 'side', market: 'any', kind: 'tray', id: 'std', count: 3 },
  )
  return {
    version: '2026-10-13',
    source: 'test',
    notes: [],
    products: [
      { id: 'pa', category: 'X', name: 'X5' },
      { id: 'pb', category: 'X', name: 'X6' },
      { id: 'pc', category: 'GO', name: 'GO Ultra' },
    ],
    trays: [{ id: 'std', name: '普通托盘' }],
    units: [
      { id: 'a', label: 'X5', products: [{ product: 'pa', count: 1 }], tray: 'std' },
      { id: 'b', label: 'X6', products: [{ product: 'pb', count: 1 }], tray: 'std' },
      { id: 'c', label: 'GO Ultra', products: [{ product: 'pc', count: 1 }], tray: 'std' },
    ],
    layouts,
    modules: [{ id: 'C3', series: '自拍杆', size: 'C' }],
    seatModules: [{ tables: 3, seat: '3-1', modules: ['C3'] }],
    photos: [
      { unit: 'a', si: 'SI2.0', kind: 'render', file: 'r.jpg', fileId: null },
      { unit: 'a', si: 'SI2.0', kind: 'photo', file: 'p.jpg', fileId: null },
    ],
    expected,
  }
}

const island = (id: string, cx: number, cz: number, w = 0.8, d = 1.8): DisplayTableInput => ({
  id,
  kind: 'island',
  cx,
  cz,
  w,
  d,
})
const bottom = { point: [4, 8] as const, inward: [0, -1] as const }

describe('checkRules', () => {
  it('accepts a consistent rule set', () => {
    expect(checkRules(makeRules())).toEqual([])
  })

  it('reports counts that do not match the guide, wrong slots, heroes and references', () => {
    const rules = makeRules()
    const first = rules.layouts[0]
    if (!first) throw new Error('fixture')
    first.slots[0] = { slot: 'L1', unit: 'b', hero: false }
    expect(checkRules(rules).some((p) => p.includes('2桌通用竖版产品') && p.includes('pa'))).toBe(
      true,
    )

    const slots = makeRules()
    slots.layouts[0]?.slots.pop()
    expect(checkRules(slots).some((p) => p.includes('位号应为'))).toBe(true)

    const hero = makeRules()
    hero.layouts[0]?.slots.forEach((s) => (s.hero = s.slot === 'L1'))
    expect(checkRules(hero).some((p) => p.includes('明星位应为 E'))).toBe(true)

    const unknown = makeRules()
    unknown.units[0] = {
      id: 'a',
      label: 'X5',
      products: [{ product: 'nope', count: 1 }],
      tray: 'std',
    }
    expect(checkRules(unknown)).toContain('陈列组合 a 的产品 nope 不存在')
  })

  it('requires both 国内 and 海外 when a table count is split by market', () => {
    const rules = makeRules()
    for (const l of rules.layouts) if (l.tables === 3) l.market = 'domestic'
    for (const e of rules.expected) if (e.tables === 3) e.market = 'domestic'
    expect(checkRules(rules)).toContain('3桌分市场时须同时有“国内”和“海外”')
  })
})

describe('diffRules', () => {
  it('lists changed slots, units and versions', () => {
    const before = makeRules()
    const after = makeRules()
    after.version = '2026-10-21'
    const slot = after.layouts[0]?.slots[0]
    if (slot) slot.unit = 'c'
    after.units.push({ id: 'd', label: 'X7', products: [{ product: 'pa', count: 1 }], tray: 'std' })
    expect(diffRules(before, after)).toEqual([
      '版本日期 2026-10-13 → 2026-10-21',
      '新增陈列组合：d（X7：pa×1，std）',
      '2桌通用竖版 2-1 L1：a → c',
    ])
  })
})

describe('numbering and orientation', () => {
  it('numbers the row nearest the entrance first, left to right', () => {
    const tables = [island('far', 3, 2), island('right', 5, 6), island('left', 2, 6.3)]
    expect(orderTables(tables, bottom).map((t) => t.id)).toEqual(['left', 'right', 'far'])
  })

  it('turns the plan so that an entrance on the right counts as the bottom', () => {
    // Entering from the east, facing west: the right hand points north (smaller z).
    const east = { point: [10, 5] as const, inward: [-1, 0] as const }
    const tables = [
      island('far', 4, 5, 1.8, 0.8),
      island('north', 8, 3, 1.8, 0.8),
      island('south', 8, 7, 1.8, 0.8),
    ]
    expect(orderTables(tables, east).map((t) => t.id)).toEqual(['south', 'north', 'far'])
  })

  it('is portrait when the long side runs towards the entrance', () => {
    expect(tableOrientation({ w: 0.8, d: 1.8 }, bottom)).toBe('portrait')
    expect(tableOrientation({ w: 1.8, d: 0.8 }, bottom)).toBe('landscape')
  })

  it('finds the inward side of the main entrance', () => {
    const space = {
      boundary: [
        [0, 0],
        [6, 0],
        [6, 8],
        [0, 8],
      ] as [number, number][],
      entrances: [
        { a: [0, 2] as [number, number], b: [0, 4] as [number, number], kind: 'side' as const },
        { a: [1, 8] as [number, number], b: [3, 8] as [number, number], kind: 'main' as const },
      ],
    }
    expect(entranceFrame(space)).toEqual({ point: [2, 8], inward: [0, -1] })
    expect(entranceFrame({ ...space, entrances: [] })).toBeNull()
  })
})

describe('planDisplay', () => {
  it('uses the nearest table’s orientation for the store and one end side on landscape tables', () => {
    const tables = [island('a', 2, 6, 1.8, 0.8), island('b', 5, 6, 1.8, 0.8)]
    const left = planDisplay(makeRules(), { tables, entrance: bottom, market: 'domestic' })
    expect(left.map((t) => [t.seat, t.orientation, t.endToward])).toEqual([
      ['2-1', 'landscape', [-1, 0]],
      ['2-2', 'landscape', [-1, 0]],
    ])
    expect(left[0]?.slots.find((s) => s.hero)?.slot).toBe('B2')
    const right = planDisplay(makeRules(), {
      tables,
      entrance: bottom,
      market: 'domestic',
      landscapeEnd: 'right',
    })
    expect(right[0]?.endToward).toEqual([1, 0])
  })

  it('marks non-standard counts 单店单议 and leaves tables beyond four empty', () => {
    const one = planDisplay(makeRules(), {
      tables: [island('a', 2, 6)],
      entrance: bottom,
      market: 'domestic',
    })
    expect(one[0]).toMatchObject({ seat: '2-1', ruleTables: 2, custom: true })
    const five = planDisplay(makeRules(), {
      tables: [1, 2, 3, 4, 5].map((i) => island(`t${i}`, i * 1.5, 6)),
      entrance: bottom,
      market: 'overseas',
    })
    expect(five.map((t) => t.seat)).toEqual(['4-1', '4-2', '4-3', '4-4', null])
    expect(five[4]?.slots.every((s) => s.unit === null)).toBe(true)
    expect(five.every((t) => t.custom)).toBe(true)
    expect(summarizeDisplay(makeRules(), five).emptySlots).toBe(7)
  })

  it('labels side tables after the islands and takes modules per seat', () => {
    const plan = planDisplay(makeRules(), {
      tables: [
        island('a', 1, 6),
        island('b', 3, 6),
        island('c', 5, 6),
        { id: 's', kind: 'side', cx: 0.3, cz: 3, w: 0.5, d: 1.8 },
      ],
      entrance: bottom,
      market: 'domestic',
    })
    expect(plan.map((t) => `${t.label}:${t.seat}`)).toEqual(['A:3-1', 'B:3-2', 'C:3-3', 'D:边桌'])
    expect(plan[0]?.modules).toEqual(['C3'])
    expect(plan[3]?.slots.map((s) => s.unit)).toEqual(['c', 'c', 'c'])
    const summary = summarizeDisplay(makeRules(), plan)
    expect(summary.products.map((p) => [p.name, p.count])).toEqual([
      ['X5', 18],
      ['X6', 3],
      ['GO Ultra', 3],
    ])
    expect(summary.trays).toEqual([{ id: 'std', name: '普通托盘', count: 24 }])
  })

  it("prefers the guide's renders, then real photos", () => {
    expect(unitPhoto(makeRules(), 'a', 'SI2.0')?.file).toBe('r.jpg')
    expect(unitPhoto(makeRules(), 'a', 'SI2.0', 'photo')?.file).toBe('p.jpg')
    expect(unitPhoto(makeRules(), 'a', 'SI1.0')).toBeNull()
  })
})
