import {
  DisplayRulesViewSchema,
  checkRules,
  displayChoices,
  planTaskTables,
  summarizeDisplay,
  summarizeDisplayModules,
} from '@store/shared'
import type { SiStyle } from '@store/shared'

// Read-only release acceptance: GET rules and HEAD pictures, compute synthetic plans in memory.
// Does not open PGlite, create a project/task, save a plan or generate any server-side files.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3001')
const checks: { name: string; expected: unknown; actual: unknown; ok: boolean }[] = []
const check = (name: string, actual: unknown, expected: unknown) =>
  checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) })

try {
  const response = await fetch(new URL('/api/v1/display-rules/current', base), {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`读取展陈规则失败：HTTP ${response.status}`)
  const view = DisplayRulesViewSchema.parse(await response.json())
  const rules = view.rules
  check('规则版本', view.version, '2026-10-30')
  check('规则一致性', checkRules(rules), [])
  check('来源规格总行数', rules.catalog?.length ?? 0, 52)
  check('已登记图片链接数', view.photos.length, 111)
  const urls = [...new Set(view.photos.map((p) => p.url))]
  check('不同图片文件数', urls.length, 99)
  check(
    '不同效果图文件数',
    new Set(view.photos.filter((p) => p.kind === 'render').map((p) => p.url)).size,
    47,
  )
  check(
    '不同实景图文件数',
    new Set(view.photos.filter((p) => p.kind === 'photo').map((p) => p.url)).size,
    52,
  )
  const moduleRows: Record<string, string[]> = {
    '2-1': ['A4', 'D13', 'D12', 'A2'],
    '2-2': ['A7', 'C4', 'A8'],
    '3-1': ['D16', 'D13', 'D12'],
    '3-2': ['A7', 'C4', 'A8'],
    '3-3': ['A2', 'D4', 'D7', 'A4'],
    '4-1': ['D9', 'D16', 'D13'],
    '4-2': ['A7', 'C4', 'A8'],
    '4-3': ['D11', 'D7', 'D12'],
    '4-4': ['A3', 'C1', 'A2'],
  }
  for (const [si, rows, choices] of [
    ['SI1.0', 29, 32],
    ['SI2.0', 23, 26],
  ] as const) {
    check(`${si} 来源规格`, rules.catalog?.filter((c) => c.si === si).length ?? 0, rows)
    check(`${si} 选择项`, displayChoices(rules, si).length, choices)
  }
  for (const si of ['SI1.0', 'SI2.0'] as const) {
    for (const n of [2, 3, 4] as const) {
      const plan = (siStyle?: SiStyle, moduleScheme?: 'standard' | 'draft-2026') =>
        planTaskTables(rules, {
          market: 'domestic',
          siStyle,
          plan: { width: 1000, height: 700 },
          state: {
            entrance: 'bottom',
            tables: Array.from({ length: n }, (_, i) => ({
              id: `verify-${i}`,
              kind: 'island',
              x: (i + 1) / (n + 1),
              y: 0.5,
              w: 0.1,
              h: 0.3,
              render: null,
              label: null,
            })),
            edits: {
              orientation: 'portrait',
              landscapeEnd: 'left',
              slots: {},
              modules: {},
              moduleScheme,
            },
          },
        })
      const existing = plan(si)
      check(`${si} ${n}桌主机托盘位`, summarizeDisplay(rules, existing).trayTotal, n * 7)
      check(
        `${si} ${n}桌既有内盘`,
        summarizeDisplayModules(rules, existing).innerTotal,
        { 2: 7, 3: 8, 4: 11 }[n],
      )
      check(
        `${si} ${n}桌缺SI兼容`,
        plan().map((t) => t.modules),
        existing.map((t) => t.modules),
      )
      const proposed = plan(si, 'draft-2026')
      const counts = summarizeDisplayModules(rules, proposed)
      check(
        `${si} ${n}桌新版内盘`,
        counts.innerTotal,
        si === 'SI2.0' ? { 2: 7, 3: 10, 4: 12 }[n] : { 2: 7, 3: 8, 4: 11 }[n],
      )
      check(`${si} ${n}桌外框`, counts.frameTotal, n)
      if (si === 'SI2.0') {
        check(
          `${si} ${n}桌逐桌模块`,
          proposed.map((t) => t.modules),
          Array.from({ length: n }, (_, i) => moduleRows[`${n}-${i + 1}`]),
        )
        check(
          `${si} ${n}桌新版A/C/D`,
          ['A', 'C', 'D'].map((s) => counts.counts.get(s) ?? 0),
          { 2: [4, 1, 2], 3: [4, 1, 5], 4: [4, 2, 6] }[n],
        )
        check(
          `${si} ${n}桌试摆提示`,
          proposed.every((t) =>
            t.notes.some((note) => note.includes('讨论稿') && note.includes('未确认')),
          ),
          true,
        )
      }
    }
  }
  const unavailable: string[] = []
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(
      urls.slice(i, i + 4).map(async (url) => {
        const target = new URL(url, base)
        if (target.origin !== base.origin) {
          unavailable.push(`${url}（拒绝跨站读取）`)
          return
        }
        try {
          const result = await fetch(target, {
            method: 'HEAD',
            signal: AbortSignal.timeout(30_000),
          })
          if (!result.ok) unavailable.push(`${url}（HTTP ${result.status}）`)
        } catch {
          unavailable.push(`${url}（读取失败）`)
        }
      }),
    )
  }
  check('图片实体只读检查', unavailable, [])
  const passed = checks.every((c) => c.ok)
  console.log(
    JSON.stringify(
      {
        api: base.origin,
        readOnly: true,
        version: view.version,
        importedAt: view.importedAt,
        passed,
        checks,
      },
      null,
      2,
    ),
  )
  if (!passed) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
