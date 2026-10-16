import { z } from 'zod'
import type { Market, SiStyle } from '../enums.ts'
import { locatePoint } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type { Space } from '../schemas/space.ts'
import {
  DisplayOrientationSchema,
  ISLAND_SLOTS,
  HERO_SLOT,
  SIDE_SEAT,
  SIDE_SLOTS,
  countUnits,
  layoutsFor,
} from './rules.ts'
import type { DisplayOrientation, DisplayRules } from './rules.ts'

/** A table to lay out: a layout item (workflow 1) or a table found on an uploaded plan (workflow 2). */
export interface DisplayTableInput {
  /** Layout item id, or any id the caller uses to find the table again. */
  id: string
  kind: 'island' | 'side'
  /** Footprint centre and size on the plan in metres, x right and z down. */
  cx: number
  cz: number
  w: number
  d: number
  /** Library model of the table, when known (picks the real table body for the 3D view). */
  assetId?: string | null
}

/** The main entrance: a point on it and the unit vector pointing into the store. */
export interface EntranceFrame {
  point: Point
  inward: Point
}

export const DisplaySlotSchema = z.object({
  slot: z.string(),
  /** Unit id (陈列组合); null for an empty slot. */
  unit: z.string().nullable(),
  hero: z.boolean(),
})

export const DisplayTableSchema = z.object({
  /** A, B, C … in numbering order, islands first, then side tables. */
  label: z.string(),
  kind: z.enum(['island', 'side']),
  sourceId: z.string(),
  /** Library model of the table, when known. */
  assetId: z.string().nullable().default(null),
  plan: z.object({ cx: z.number(), cz: z.number(), w: z.number(), d: z.number() }),
  orientation: DisplayOrientationSchema,
  /** The guide's table count the layout was taken from (2, 3, 4 or side). */
  ruleTables: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal('side')]),
  /** 3-1, 3-2 … or 边桌; null when the store has more tables than the guide covers. */
  seat: z.string().nullable(),
  slots: z.array(DisplaySlotSchema),
  modules: z.array(z.string()),
  /** Plan direction (unit vector) of the table end E, for drawing; null for side tables. */
  endToward: z.tuple([z.number(), z.number()]).nullable(),
  /** Needs a person: non-standard table count (单店单议) or no layout in the rules. */
  custom: z.boolean(),
  notes: z.array(z.string()),
})
export type DisplayTable = z.output<typeof DisplayTableSchema>

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const unit = (v: Point): Point => {
  const len = Math.hypot(v[0], v[1])
  return len ? [v[0] / len, v[1] / len] : [0, -1]
}
/** Negation without -0, so that directions compare equal to their literal values. */
const neg = (v: Point): Point => [-v[0] || 0, -v[1] || 0]
/** Facing into the store, the right-hand direction on the plan (x right, z down). */
const rightOf = (inward: Point): Point => [-inward[1] || 0, inward[0]]
const longAxis = (t: Pick<DisplayTableInput, 'w' | 'd'>): Point => (t.w >= t.d ? [1, 0] : [0, 1])
/** A table whose footprint is known (one placed by hand or read without its outline has 0 × 0). */
const sized = (t: Pick<DisplayTableInput, 'w' | 'd'>) => t.w > 0 && t.d > 0 && t.w !== t.d

export const ENTRANCE_SIDES = ['bottom', 'top', 'left', 'right'] as const
export type EntranceSide = (typeof ENTRANCE_SIDES)[number]
export const ENTRANCE_SIDE_LABELS: Record<EntranceSide, string> = {
  bottom: '下方',
  top: '上方',
  left: '左侧',
  right: '右侧',
}

/**
 * An entrance on one side of a picture (uploaded plans: x right, y down in pixels), beyond the
 * tables, so that numbering and orientation work without a measured space.
 */
export function sideEntrance(
  side: EntranceSide,
  tables: readonly Pick<DisplayTableInput, 'cx' | 'cz'>[],
): EntranceFrame {
  const xs = tables.map((t) => t.cx)
  const zs = tables.map((t) => t.cz)
  const mid = (v: number[]) => (v.length ? (Math.min(...v) + Math.max(...v)) / 2 : 0)
  const far = 1e6
  switch (side) {
    case 'top':
      return { point: [mid(xs), -far], inward: [0, 1] }
    case 'left':
      return { point: [-far, mid(zs)], inward: [1, 0] }
    case 'right':
      return { point: [far, mid(zs)], inward: [-1, 0] }
    default:
      return { point: [mid(xs), far], inward: [0, -1] }
  }
}

/** The picture side nearest to an entrance direction (for showing a measured entrance). */
export function entranceSideOf(frame: EntranceFrame | null): EntranceSide {
  if (!frame) return 'bottom'
  const [x, z] = frame.inward
  if (Math.abs(z) >= Math.abs(x)) return z < 0 ? 'bottom' : 'top'
  return x > 0 ? 'left' : 'right'
}

/** The main entrance of a space (the first main one, else the first), with its inward normal. */
export function entranceFrame(space: Pick<Space, 'boundary' | 'entrances'>): EntranceFrame | null {
  const entrance = space.entrances.find((e) => e.kind === 'main') ?? space.entrances[0]
  if (!entrance) return null
  const mid: Point = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
  const along = unit(sub(entrance.b, entrance.a))
  const normal: Point = [-along[1] || 0, along[0]]
  const probe: Point = [mid[0] + normal[0] * 0.05, mid[1] + normal[1] * 0.05]
  const inward: Point = locatePoint(probe, space.boundary) === 'inside' ? normal : neg(normal)
  return { point: mid, inward }
}

/**
 * Numbering (指引“*-1 离门口更近”; rule of the colleague's PPT tool): turn the plan so the entrance
 * is at the bottom, take the row nearest the entrance first and number each row left to right.
 * Tables whose depth differs by less than half a table width share a row.
 */
export function orderTables<T extends DisplayTableInput>(
  tables: readonly T[],
  entrance: EntranceFrame | null,
): T[] {
  const frame = entrance ?? { point: [0, 1e6] as Point, inward: [0, -1] as Point }
  const right = rightOf(frame.inward)
  const depth = (t: T) => dot(sub([t.cx, t.cz], frame.point), frame.inward)
  const lateral = (t: T) => dot(sub([t.cx, t.cz], frame.point), right)
  // Tables of unknown size take the typical half width of the others.
  const halves = tables
    .filter(sized)
    .map((t) => Math.min(t.w, t.d) / 2)
    .sort((a, b) => a - b)
  const typical = halves[Math.floor(halves.length / 2)] ?? 0
  const tolerance = (t: T) => (sized(t) ? Math.min(t.w, t.d) / 2 : typical)
  const sorted = [...tables].sort((a, b) => depth(a) - depth(b))
  const rows: T[][] = []
  for (const t of sorted) {
    const row = rows.at(-1)
    const first = row?.[0]
    if (row && first && depth(t) - depth(first) < Math.max(tolerance(t), tolerance(first)))
      row.push(t)
    else rows.push([t])
  }
  return rows.flatMap((row) => row.sort((a, b) => lateral(a) - lateral(b)))
}

/** 竖版 when the table's long side runs across the customer flow (towards the entrance), else 横版. */
export function tableOrientation(
  table: Pick<DisplayTableInput, 'w' | 'd'>,
  entrance: EntranceFrame | null,
): DisplayOrientation {
  const inward = entrance?.inward ?? [0, -1]
  return Math.abs(dot(longAxis(table), inward)) >= Math.SQRT1_2 ? 'portrait' : 'landscape'
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `T${i + 1}`)

export interface PlanDisplayInput {
  tables: readonly DisplayTableInput[]
  entrance: EntranceFrame | null
  market: Market
  /** Side of the end slot on landscape tables, facing into the store; the guide draws it left. */
  landscapeEnd?: 'left' | 'right'
  /** Set by hand when the drawing is read wrongly; otherwise from the table nearest the entrance. */
  orientation?: DisplayOrientation | null
}

/**
 * Lays out the guide's display on a store's island and side tables: numbers them, picks portrait
 * or landscape from the island table nearest the entrance (the whole store uses one), assigns
 * the seats n-1 … n-n of the guide's n-table layout with their slot contents and accessory
 * modules. Counts the guide has no layout for are laid out with the nearest one and marked
 * 单店单议; tables beyond 4 stay empty.
 */
export function planDisplay(rules: DisplayRules, input: PlanDisplayInput): DisplayTable[] {
  const islands = orderTables(
    input.tables.filter((t) => t.kind === 'island'),
    input.entrance,
  )
  const sides = orderTables(
    input.tables.filter((t) => t.kind === 'side'),
    input.entrance,
  )
  // The island table nearest the entrance whose outline was found decides for the store.
  const first = islands.find(sized) ?? islands[0]
  const orientation =
    input.orientation ?? (first ? tableOrientation(first, input.entrance) : 'portrait')
  const n = islands.length
  const ruleTables: 2 | 3 | 4 = n <= 2 ? 2 : n >= 4 ? 4 : 3
  const nonStandard = n === 1 || n > 4
  const layouts = layoutsFor(rules, ruleTables, input.market, orientation)
  const inward = input.entrance?.inward ?? ([0, -1] as Point)
  const sideward: Point = input.landscapeEnd === 'right' ? rightOf(inward) : neg(rightOf(inward))

  const endToward = (t: DisplayTableInput): Point => {
    // Unknown size: the long side follows the store's orientation.
    const axis: Point = sized(t)
      ? longAxis(t)
      : orientation === 'portrait'
        ? [Math.abs(inward[0]), Math.abs(inward[1])]
        : [Math.abs(rightOf(inward)[0]), Math.abs(rightOf(inward)[1])]
    // Portrait: the end faces the entrance; landscape: every table's end on the same side.
    const target: Point = orientation === 'portrait' ? neg(inward) : sideward
    return dot(axis, target) >= 0 ? axis : neg(axis)
  }

  const out: DisplayTable[] = islands.map((t, i) => {
    const seat = i < ruleTables ? `${ruleTables}-${i + 1}` : null
    const layout = seat ? layouts.find((l) => l.seat === seat) : undefined
    const notes: string[] = []
    if (nonStandard) notes.push(`店内有 ${n} 张中岛桌，指引只有 2–4 张的版式：单店单议`)
    if (!layout) notes.push('没有对应版式，请逐位填写')
    const slots = ISLAND_SLOTS[orientation].map((slot) => {
      const s = layout?.slots.find((x) => x.slot === slot)
      return { slot, unit: s?.unit ?? null, hero: s ? s.hero : slot === HERO_SLOT[orientation] }
    })
    return {
      label: letter(i),
      kind: 'island',
      sourceId: t.id,
      assetId: t.assetId ?? null,
      plan: { cx: t.cx, cz: t.cz, w: t.w, d: t.d },
      orientation,
      ruleTables,
      seat,
      slots,
      modules: seat
        ? (rules.seatModules.find((m) => m.tables === ruleTables && m.seat === seat)?.modules ?? [])
        : [],
      endToward: [...endToward(t)],
      custom: nonStandard || !layout,
      notes,
    }
  })
  sides.forEach((t, i) => {
    const sideOrientation = tableOrientation(t, input.entrance)
    const layout = layoutsFor(rules, 'side', input.market, sideOrientation).find(
      (l) => l.seat === SIDE_SEAT,
    )
    out.push({
      label: letter(islands.length + i),
      kind: 'side',
      sourceId: t.id,
      assetId: t.assetId ?? null,
      plan: { cx: t.cx, cz: t.cz, w: t.w, d: t.d },
      orientation: sideOrientation,
      ruleTables: 'side',
      seat: SIDE_SEAT,
      slots: SIDE_SLOTS.map((slot) => ({
        slot,
        unit: layout?.slots.find((s) => s.slot === slot)?.unit ?? null,
        hero: false,
      })),
      modules: [],
      endToward: null,
      custom: !layout,
      notes: layout ? [] : ['没有边桌版式，请逐位填写'],
    })
  })
  return out
}

export interface DisplaySummaryLine {
  id: string
  name: string
  category?: string
  count: number
}

/** 产品数量明细（运营用）and 托盘数量明细（供应商用）of a planned store, in rule order. */
export function summarizeDisplay(
  rules: DisplayRules,
  tables: readonly Pick<DisplayTable, 'slots'>[],
): {
  products: DisplaySummaryLine[]
  trays: DisplaySummaryLine[]
  productTotal: number
  trayTotal: number
  emptySlots: number
} {
  const units = tables.flatMap((t) => t.slots.map((s) => s.unit))
  const counts = countUnits(rules, units)
  const products = rules.products
    .filter((p) => counts.products.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      count: counts.products.get(p.id) ?? 0,
    }))
  const trays = rules.trays
    .filter((t) => counts.trays.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, count: counts.trays.get(t.id) ?? 0 }))
  return {
    products,
    trays,
    productTotal: products.reduce((s, p) => s + p.count, 0),
    trayTotal: trays.reduce((s, t) => s + t.count, 0),
    emptySlots: units.filter((u) => u === null).length,
  }
}

/**
 * Picture of a slot's content, preferring the requested kind, then the other one. The guide's
 * renders (效果图) by default: the user wants one look across the page and the PPT (2026-10-15).
 */
export function unitPhoto(
  rules: DisplayRules,
  unitId: string,
  si: SiStyle,
  prefer: 'photo' | 'render' = 'render',
) {
  const list = rules.photos.filter((p) => p.unit === unitId && p.si === si)
  return list.find((p) => p.kind === prefer) ?? list[0] ?? null
}
