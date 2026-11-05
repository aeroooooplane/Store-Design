import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { planDisplay } from '@store/shared'
import type { DisplayRules } from '@store/shared'
import { loadInnerTrayImages } from '../src/modules/displays/inner-trays.ts'
import { buildDisplayDeck, deckImage } from '../src/modules/displays/deck.ts'
import { parseDisplayWorkbook } from '../src/modules/displays/workbook.ts'
import { png } from './helpers.ts'

let dir: string
let rules: DisplayRules
const legacyImage = png(80, 60, 40)
const newImage = png(80, 60, 220)
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'inner-trays-'))
  const manifest = JSON.parse(
    await readFile(
      new URL('../../../docs/evidence/inner-ppt-release-20261105.json', import.meta.url),
      'utf8',
    ),
  ) as { files: { path: string; scheme: string }[] }
  for (const item of manifest.files) {
    const target = path.join(dir, item.path)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, item.scheme === 'legacy' ? legacyImage : newImage)
  }
  const parsed = await parseDisplayWorkbook(
    await readFile(new URL('./fixtures/display/展陈规则.xlsx', import.meta.url)),
  )
  if (!parsed.rules) throw new Error(parsed.problems.join('\n'))
  rules = parsed.rules
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

it('手填继承属性名仍显示缺图，超过四模块分页且不丢编号', async () => {
  const tables = planDisplay(rules, {
    market: 'domestic',
    entrance: { point: [0, 0], inward: [0, 1] },
    tables: [{ id: 'custom', kind: 'island', cx: 0, cz: 2, w: 1, d: 1.8 }],
  })
  tables[0]!.modules = ['A2', '__proto__', 'constructor', 'toString', 'UNKNOWN']
  const reference = await loadInnerTrayImages(
    { resource: dir, storage: dir },
    rules,
    'SI1.0',
    undefined,
    tables,
  )
  const ppt = await buildDisplayDeck({
    title: '手填核对',
    date: '2026-11-05',
    market: 'domestic',
    subtitle: 'SI1.0',
    rules,
    tables,
    innerTrays: reference,
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
  const pages = Object.entries(unzipSync(ppt))
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map(([, data]) => strFromU8(data))
    .filter((xml) => xml.includes('内嵌托盘配图'))
  expect(pages).toHaveLength(2)
  expect(pages.join('')).toContain('5. UNKNOWN')
  expect([...pages.join('').matchAll(/暂无对应配图，请核对/g)]).toHaveLength(4)
  expect([...pages.join('').matchAll(/<a:blip\s/g)]).toHaveLength(1)
})

it('按SI与保存的方案选图，覆盖2/3/4桌全部实际模块并嵌入PPT', async () => {
  for (const [si, scheme] of [
    ['SI1.0', 'standard'],
    ['SI1.0', 'draft-2026'],
    ['SI2.0', 'standard'],
    ['SI2.0', 'draft-2026'],
  ] as const) {
    for (const n of [2, 3, 4]) {
      const tables = planDisplay(rules, {
        market: 'domestic',
        siStyle: si,
        moduleScheme: scheme,
        entrance: { point: [0, 0], inward: [0, 1] },
        tables: Array.from({ length: n }, (_, i) => ({
          id: `t${i}`,
          kind: 'island',
          cx: i * 2,
          cz: 2,
          w: 1,
          d: 1.8,
        })),
      })
      const reference = await loadInnerTrayImages(
        { resource: dir, storage: dir },
        rules,
        si,
        scheme,
        tables,
      )
      const expected = await deckImage(
        si === 'SI2.0' && scheme === 'draft-2026' ? newImage : legacyImage,
      )
      for (const id of new Set(tables.flatMap((t) => t.modules)))
        expect(reference.images[id]?.data, `${si}/${scheme}/${n}/${id}`).toBe(expected.data)
      const ppt = await buildDisplayDeck({
        title: '配图核对',
        date: '2026-11-05',
        market: 'domestic',
        subtitle: si,
        rules,
        tables,
        innerTrays: reference,
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
      const slides = Object.entries(unzipSync(ppt))
        .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .map(([, bytes]) => strFromU8(bytes))
        .filter((xml) => xml.includes('内嵌托盘配图'))
      expect(slides).toHaveLength(n)
      for (const [i, xml] of slides.entries()) {
        // The native labels and actual embedded images must be on the same table's page.
        const label = tables.find((t) => xml.includes(`${t.label}桌`))!
        expect(label, `配图页${i}`).toBeDefined()
        expect([...xml.matchAll(/<a:blip\s/g)]).toHaveLength(label.modules.length)
        for (const id of label.modules) expect(xml).toContain(`. ${id}`)
      }
    }
  }
})

it('缺图和未知编号不跨版本借图；只加载中岛桌实际使用模块', async () => {
  const tables = planDisplay(rules, {
    market: 'domestic',
    entrance: { point: [0, 0], inward: [0, 1] },
    tables: [{ id: 'one', kind: 'island', cx: 0, cz: 2, w: 1, d: 1.8 }],
  })
  tables[0]!.modules = ['A1', '../../../outside', 'UNKNOWN']
  const selected = await loadInnerTrayImages(
    { resource: dir, storage: dir },
    rules,
    'SI2.0',
    'draft-2026',
    tables,
  )
  expect(selected.images).toEqual({}) // A1 exists only in the legacy picture archive.
  const legacy = await loadInnerTrayImages(
    { resource: dir, storage: dir },
    rules,
    'SI2.0',
    undefined,
    tables,
  )
  expect(Object.keys(legacy.images)).toEqual(['A1'])
  tables[0]!.modules = ['A2']
  await rm(path.join(dir, '10_产品与陈列/配件模块/PPT配图20261105/2026-A2.png'))
  expect(
    (
      await loadInnerTrayImages(
        { resource: dir, storage: dir },
        rules,
        'SI2.0',
        'draft-2026',
        tables,
      )
    ).images,
  ).toEqual({})
})
