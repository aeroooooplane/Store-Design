import { z } from 'zod'
import { SiStyleSchema } from '../enums.ts'

/**
 * Display rules (展陈规则), transcribed from the Feishu guide 《影石专卖店中岛桌&边桌&配件柜展陈指引》
 * into 资源库/10_产品与陈列/展陈规则.xlsx and imported by `pnpm display:import`. The guide changes
 * with product launches, so the rules are data: nothing here names a product.
 *
 * Island tables have 7 tray slots. Portrait (竖版, long side across the customer flow): L1–L3 and
 * R1–R3 from far to near, E the end facing the entrance (hero). Landscape (横版, long side along
 * the flow): E the end, T1–T3 the far row left to right, B1–B3 the row on the flow side (B2 hero).
 * Side tables with trays (边桌) have S1–S3.
 */
export const DISPLAY_ORIENTATIONS = ['portrait', 'landscape'] as const
export const DisplayOrientationSchema = z.enum(DISPLAY_ORIENTATIONS)
export type DisplayOrientation = z.infer<typeof DisplayOrientationSchema>
export const DISPLAY_ORIENTATION_LABELS: Record<DisplayOrientation, string> = {
  portrait: '竖版',
  landscape: '横版',
}

export const ISLAND_SLOTS: Record<DisplayOrientation, readonly string[]> = {
  portrait: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'E'],
  landscape: ['E', 'T1', 'T2', 'T3', 'B1', 'B2', 'B3'],
}
export const HERO_SLOT: Record<DisplayOrientation, string> = { portrait: 'E', landscape: 'B2' }
export const SIDE_SLOTS: readonly string[] = ['S1', 'S2', 'S3']

/** Island-table counts the guide has layouts for; 'side' is the side table (边桌). */
export const RULE_TABLES = [2, 3, 4, 'side'] as const
export const RuleTablesSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal('side'),
])
export type RuleTables = z.infer<typeof RuleTablesSchema>
export const SIDE_SEAT = '边桌'

/** 'any' = the guide's 通用 (2 tables and side tables); 3 and 4 tables differ in 国内 / 海外. */
export const RuleMarketSchema = z.enum(['any', 'domestic', 'overseas'])
export type RuleMarket = z.infer<typeof RuleMarketSchema>

const Id = z.string().trim().min(1).max(60)
const Name = z.string().trim().min(1).max(120)

export const DisplayRulesSchema = z.object({
  /** 版本日期 of the guide, YYYY-MM-DD. */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().max(500),
  notes: z.array(z.object({ kind: Name, text: z.string().trim().min(1).max(1000) })),
  products: z.array(z.object({ id: Id, category: Name, name: Name })).min(1),
  trays: z.array(z.object({ id: Id, name: Name })).min(1),
  /** What one tray slot holds, e.g. “X5 + X4 Air” on the dual tray. */
  units: z
    .array(
      z.object({
        id: Id,
        label: Name,
        products: z.array(z.object({ product: Id, count: z.int().min(1).max(20) })).min(1),
        tray: Id,
      }),
    )
    .min(1),
  layouts: z.array(
    z.object({
      tables: RuleTablesSchema,
      market: RuleMarketSchema,
      orientation: DisplayOrientationSchema,
      /** 3-1, 3-2 … or 边桌. */
      seat: Name,
      slots: z.array(z.object({ slot: Id, unit: Id, hero: z.boolean() })),
    }),
  ),
  modules: z.array(z.object({ id: Id, series: Name, size: Name })),
  /** Accessory modules in the middle of each island table (guide section 三). */
  seatModules: z.array(
    z.object({
      tables: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      seat: Name,
      modules: z.array(Id),
    }),
  ),
  photos: z.array(
    z.object({
      unit: Id,
      si: SiStyleSchema,
      kind: z.enum(['photo', 'render']),
      /** Relative to 资源库/10_产品与陈列. */
      file: z.string().trim().min(1).max(300),
      /** Set by the importer once the file is registered. */
      fileId: z.uuid().nullable().default(null),
    }),
  ),
  /** The guide's own 产品数量明细 / 托盘数量明细, to check the layouts against. */
  expected: z.array(
    z.object({
      tables: RuleTablesSchema,
      market: RuleMarketSchema,
      kind: z.enum(['product', 'tray']),
      id: Id,
      count: z.int().min(0).max(100),
    }),
  ),
})
export type DisplayRules = z.output<typeof DisplayRulesSchema>
export type DisplayLayout = DisplayRules['layouts'][number]

export const ruleTablesLabel = (tables: RuleTables) =>
  tables === 'side' ? SIDE_SEAT : `${tables}桌`
const MARKET_LABELS: Record<RuleMarket, string> = {
  any: '通用',
  domestic: '国内',
  overseas: '海外',
}

/** Markets that have their own layouts for a table count ('any' when the guide has one set). */
export function ruleMarkets(rules: DisplayRules, tables: RuleTables): RuleMarket[] {
  const markets = new Set(rules.layouts.filter((l) => l.tables === tables).map((l) => l.market))
  return RuleMarketSchema.options.filter((m) => markets.has(m))
}

/** Layouts of one table count, market and orientation, by seat (falls back to 通用). */
export function layoutsFor(
  rules: DisplayRules,
  tables: RuleTables,
  market: 'domestic' | 'overseas',
  orientation: DisplayOrientation,
): DisplayLayout[] {
  const pick = (m: RuleMarket) =>
    rules.layouts.filter(
      (l) => l.tables === tables && l.market === m && l.orientation === orientation,
    )
  const exact = pick(market)
  return exact.length ? exact : pick('any')
}

export interface DisplayCounts {
  products: Map<string, number>
  trays: Map<string, number>
}

/** Products and trays needed for a list of slot contents (unit ids; null = empty slot). */
export function countUnits(rules: DisplayRules, units: readonly (string | null)[]): DisplayCounts {
  const byId = new Map(rules.units.map((u) => [u.id, u]))
  const products = new Map<string, number>()
  const trays = new Map<string, number>()
  for (const id of units) {
    const unit = id ? byId.get(id) : undefined
    if (!unit) continue
    trays.set(unit.tray, (trays.get(unit.tray) ?? 0) + 1)
    for (const p of unit.products) products.set(p.product, (products.get(p.product) ?? 0) + p.count)
  }
  return { products, trays }
}

function sameCounts(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = []
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? 0
    const y = b.get(id) ?? 0
    if (x !== y) out.push(`${id} 版式合计 ${x}，数量核对 ${y}`)
  }
  return out
}

/**
 * Consistency of a rule set; an empty list means it can be imported. Checks references, the slot
 * names and the hero of every table, that every table count has seats n-1 … n-n, and that each
 * layout adds up to the guide's own product and tray counts.
 */
export function checkRules(rules: DisplayRules): string[] {
  const problems: string[] = []
  const dupes = (what: string, ids: string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) problems.push(`${what}编号重复：${id}`)
      seen.add(id)
    }
  }
  dupes(
    '产品',
    rules.products.map((p) => p.id),
  )
  dupes(
    '托盘',
    rules.trays.map((t) => t.id),
  )
  dupes(
    '陈列组合',
    rules.units.map((u) => u.id),
  )
  dupes(
    '配件模块',
    rules.modules.map((m) => m.id),
  )
  const products = new Set(rules.products.map((p) => p.id))
  const trays = new Set(rules.trays.map((t) => t.id))
  const units = new Set(rules.units.map((u) => u.id))
  const modules = new Set(rules.modules.map((m) => m.id))
  for (const unit of rules.units) {
    if (!trays.has(unit.tray)) problems.push(`陈列组合 ${unit.id} 的托盘 ${unit.tray} 不存在`)
    for (const p of unit.products)
      if (!products.has(p.product)) problems.push(`陈列组合 ${unit.id} 的产品 ${p.product} 不存在`)
  }

  const groups = new Map<string, DisplayLayout[]>()
  for (const layout of rules.layouts) {
    const where = `${ruleTablesLabel(layout.tables)}${MARKET_LABELS[layout.market]}${DISPLAY_ORIENTATION_LABELS[layout.orientation]} ${layout.seat}`
    const expected = layout.tables === 'side' ? SIDE_SLOTS : ISLAND_SLOTS[layout.orientation]
    const slots = layout.slots.map((s) => s.slot)
    if (slots.length !== expected.length || expected.some((s) => !slots.includes(s)))
      problems.push(`${where}：位号应为 ${expected.join('、')}，实际为 ${slots.join('、')}`)
    for (const s of layout.slots)
      if (!units.has(s.unit)) problems.push(`${where} ${s.slot}：陈列组合 ${s.unit} 不存在`)
    const heroes = layout.slots.filter((s) => s.hero).map((s) => s.slot)
    if (layout.tables === 'side') {
      if (heroes.length) problems.push(`${where}：边桌没有明星位`)
    } else if (heroes.length !== 1 || heroes[0] !== HERO_SLOT[layout.orientation]) {
      problems.push(
        `${where}：明星位应为 ${HERO_SLOT[layout.orientation]}，实际为 ${heroes.join('、') || '无'}`,
      )
    }
    const key = `${layout.tables}|${layout.market}|${layout.orientation}`
    groups.set(key, [...(groups.get(key) ?? []), layout])
  }

  for (const tables of RULE_TABLES) {
    const markets = ruleMarkets(rules, tables)
    if (!markets.length) {
      problems.push(`缺少${ruleTablesLabel(tables)}的版式`)
      continue
    }
    if (markets.includes('any') && markets.length > 1)
      problems.push(`${ruleTablesLabel(tables)}的市场不能同时有“通用”和“国内/海外”`)
    if (!markets.includes('any') && markets.length !== 2)
      problems.push(`${ruleTablesLabel(tables)}分市场时须同时有“国内”和“海外”`)
    const seats =
      tables === 'side'
        ? [SIDE_SEAT]
        : Array.from({ length: tables }, (_, i) => `${tables}-${i + 1}`)
    for (const market of markets) {
      const expectedProducts = new Map<string, number>()
      const expectedTrays = new Map<string, number>()
      for (const row of rules.expected.filter((e) => e.tables === tables && e.market === market)) {
        const target = row.kind === 'product' ? expectedProducts : expectedTrays
        target.set(row.id, (target.get(row.id) ?? 0) + row.count)
      }
      if (!expectedProducts.size || !expectedTrays.size)
        problems.push(`${ruleTablesLabel(tables)}${MARKET_LABELS[market]}缺少数量核对`)
      for (const orientation of DISPLAY_ORIENTATIONS) {
        const list = groups.get(`${tables}|${market}|${orientation}`) ?? []
        const where = `${ruleTablesLabel(tables)}${MARKET_LABELS[market]}${DISPLAY_ORIENTATION_LABELS[orientation]}`
        const have = list.map((l) => l.seat).sort()
        if (have.join() !== [...seats].sort().join()) {
          problems.push(`${where}：桌号应为 ${seats.join('、')}，实际为 ${have.join('、') || '无'}`)
          continue
        }
        if (!expectedProducts.size || !expectedTrays.size) continue
        const counts = countUnits(
          rules,
          list.flatMap((l) => l.slots.map((s) => s.unit)),
        )
        for (const p of sameCounts(counts.products, expectedProducts))
          problems.push(`${where}产品：${p}`)
        for (const t of sameCounts(counts.trays, expectedTrays)) problems.push(`${where}托盘：${t}`)
      }
    }
  }
  for (const row of rules.expected) {
    const known = row.kind === 'product' ? products : trays
    if (!known.has(row.id))
      problems.push(`数量核对：${row.kind === 'product' ? '产品' : '托盘'} ${row.id} 不存在`)
  }
  for (const sm of rules.seatModules)
    for (const m of sm.modules)
      if (!modules.has(m)) problems.push(`桌号模块 ${sm.seat}：模块 ${m} 不存在`)
  for (const photo of rules.photos)
    if (!units.has(photo.unit)) problems.push(`照片 ${photo.file}：陈列组合 ${photo.unit} 不存在`)
  return problems
}

/** Human-readable changes between two rule sets, for the import report. */
export function diffRules(before: DisplayRules, after: DisplayRules): string[] {
  const out: string[] = []
  if (before.version !== after.version) out.push(`版本日期 ${before.version} → ${after.version}`)
  function listDiff<T extends { id: string }>(
    what: string,
    a: T[],
    b: T[],
    show: (x: T) => string,
  ) {
    const ai = new Map(a.map((x) => [x.id, x]))
    const bi = new Map(b.map((x) => [x.id, x]))
    for (const [id, x] of bi) {
      const old = ai.get(id)
      if (!old) out.push(`新增${what}：${show(x)}`)
      else if (JSON.stringify(old) !== JSON.stringify(x))
        out.push(`修改${what}：${show(old)} → ${show(x)}`)
    }
    for (const [id, x] of ai) if (!bi.has(id)) out.push(`删除${what}：${show(x)}`)
  }
  listDiff('产品', before.products, after.products, (p) => `${p.id}（${p.name}）`)
  listDiff('托盘', before.trays, after.trays, (t) => `${t.id}（${t.name}）`)
  listDiff(
    '陈列组合',
    before.units,
    after.units,
    (u) =>
      `${u.id}（${u.label}：${u.products.map((p) => `${p.product}×${p.count}`).join('、')}，${u.tray}）`,
  )
  const slotKey = (l: DisplayLayout, slot: string) =>
    `${ruleTablesLabel(l.tables)}${MARKET_LABELS[l.market]}${DISPLAY_ORIENTATION_LABELS[l.orientation]} ${l.seat} ${slot}`
  const slotMap = (rules: DisplayRules) =>
    new Map(
      rules.layouts.flatMap((l) =>
        l.slots.map((s) => [slotKey(l, s.slot), `${s.unit}${s.hero ? '（明星位）' : ''}`] as const),
      ),
    )
  const a = slotMap(before)
  const b = slotMap(after)
  for (const [key, value] of b) {
    const old = a.get(key)
    if (old === undefined) out.push(`新增位 ${key}：${value}`)
    else if (old !== value) out.push(`${key}：${old} → ${value}`)
  }
  for (const [key, value] of a) if (!b.has(key)) out.push(`删除位 ${key}（原为 ${value}）`)
  const modules = (rules: DisplayRules) =>
    new Map(rules.seatModules.map((s) => [s.seat, s.modules.join('、')]))
  const ma = modules(before)
  for (const [seat, list] of modules(after))
    if (ma.get(seat) !== list) out.push(`${seat} 配件模块：${ma.get(seat) ?? '无'} → ${list}`)
  return out
}
