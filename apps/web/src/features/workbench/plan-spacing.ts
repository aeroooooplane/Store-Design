import { distanceToSegment, edges, itemMount, mToMm, openingPieces } from '@store/shared'
import type { Asset, LayoutItem, Point, Space } from '@store/shared'
import { boxesOverlap, textBox } from './plan-drawing.ts'
import type { TextBox } from './plan-drawing.ts'

/**
 * Spacing marks on the plan (导出平面图的软装间距): from each side of every 软装 prop, the clear
 * distance straight out to the nearest 软装 prop, wall or obstacle. Gaps shorter than
 * SPACING_MIN_M or longer than SPACING_MAX_M are left out, and so is a side facing an entrance
 * or open edge. Sizes are the props' footprints (w × d), as everywhere else on the plan.
 */

/** Gaps below this are not marked (the user's rule: under 100 mm is not worth a number). */
export const SPACING_MIN_M = 0.1
/** Gaps beyond this are not marked, so long views across the shop do not clutter the plan. */
export const SPACING_MAX_M = 3

const EPS = 1e-6
/** A hit this close to an entrance or open edge is an opening, not a wall. */
const ON_OPENING_M = 0.02

export interface SpacingOptions {
  min?: number
  max?: number
}

export interface SpacingMark {
  /** On the prop's side, and where the gap ends. */
  a: Point
  b: Point
  /** Millimetres. */
  label: string
  /** Text angle in degrees: 0 along x, −90 along z. */
  angle: number
  /** Which side of the line the text sits on. */
  outward: Point
}

/** Props that get spacing marks: 软装 standing on the floor. */
export function spacingItems(
  items: readonly LayoutItem[],
  assets: ReadonlyMap<string, Pick<Asset, 'materialCategory'>> | undefined,
): LayoutItem[] {
  return items.filter(
    (item) =>
      itemMount(item) === 'floor' &&
      item.assetId !== null &&
      assets?.get(item.assetId)?.materialCategory === '软装物料',
  )
}

interface Direction {
  /** Plan point → (u ahead, v across). */
  toUV: (p: Point) => [number, number]
  fromUV: (u: number, v: number) => Point
  along: 'x' | 'z'
}

const DIRECTIONS: Direction[] = [
  { toUV: (p) => [p[0], p[1]], fromUV: (u, v) => [u, v], along: 'x' },
  { toUV: (p) => [-p[0], p[1]], fromUV: (u, v) => [-u, v], along: 'x' },
  { toUV: (p) => [p[1], p[0]], fromUV: (u, v) => [v, u], along: 'z' },
  { toUV: (p) => [-p[1], p[0]], fromUV: (u, v) => [v, -u], along: 'z' },
]

interface Segment {
  p: Point
  q: Point
  /** The prop it belongs to, or null for walls and obstacles. */
  itemId: string | null
}

const corners = (item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'>): Point[] => {
  const [x0, x1, z0, z1] = [
    item.cx - item.w / 2,
    item.cx + item.w / 2,
    item.cz - item.d / 2,
    item.cz + item.d / 2,
  ]
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
}

/**
 * The nearest point of a segment straight ahead of a side running from v0 to v1 at u0: its
 * distance and where across the side it is. A segment facing the side squarely is measured at
 * the middle of the stretch they share.
 */
function hit(
  seg: Segment,
  dir: Direction,
  u0: number,
  v0: number,
  v1: number,
): { dist: number; v: number } | null {
  const [pu, pv] = dir.toUV(seg.p)
  const [qu, qv] = dir.toUV(seg.q)
  if (Math.abs(qv - pv) < EPS) {
    // Running straight ahead: blocks only if it lies across the side.
    if (pv <= v0 + EPS || pv >= v1 - EPS) return null
    const u = Math.min(pu, qu)
    return u >= u0 - EPS ? { dist: u - u0, v: pv } : null
  }
  const ta = (v0 + EPS - pv) / (qv - pv)
  const tb = (v1 - EPS - pv) / (qv - pv)
  const t0 = Math.max(0, Math.min(ta, tb))
  const t1 = Math.min(1, Math.max(ta, tb))
  if (t0 > t1) return null
  const at = (t: number): [number, number] => [pu + (qu - pu) * t, pv + (qv - pv) * t]
  const ends = [at(t0), at(t1)]
  if (Math.abs(qu - pu) < EPS) {
    // Square on: the stretch the side and the segment share, measured at its middle.
    const u = ends[0]?.[0] ?? pu
    return u >= u0 - EPS
      ? { dist: u - u0, v: ((ends[0]?.[1] ?? 0) + (ends[1]?.[1] ?? 0)) / 2 }
      : null
  }
  // Slanted: nearest at an end of the shared stretch, or where it comes level with the side.
  const tCross = (u0 - pu) / (qu - pu)
  if (tCross > t0 && tCross < t1) ends.push(at(tCross))
  let best: { dist: number; v: number } | null = null
  for (const [u, v] of ends) {
    if (u < u0 - EPS) continue
    if (!best || u - u0 < best.dist) best = { dist: Math.max(0, u - u0), v }
  }
  return best
}

/** Spacing marks for the 软装 props among `items` (see spacingItems). */
export function spacingMarks(
  space: Space,
  items: readonly LayoutItem[],
  options: SpacingOptions = {},
): SpacingMark[] {
  const min = options.min ?? SPACING_MIN_M
  const max = options.max ?? SPACING_MAX_M
  const walls: Segment[] = [
    ...edges(space.boundary).map(([p, q]) => ({ p, q, itemId: null })),
    ...space.obstacles.flatMap((o) => edges(o.polygon).map(([p, q]) => ({ p, q, itemId: null }))),
  ]
  const openings = [...space.entrances, ...space.openEdges].flatMap<{ a: Point; b: Point }>(
    (o) => openingPieces(space, o) ?? [o],
  )
  const onOpening = (p: Point) =>
    openings.some((o) => distanceToSegment(p, o.a, o.b) <= ON_OPENING_M)
  const segments = (exceptId: string): Segment[] => [
    ...walls,
    ...items
      .filter((other) => other.id !== exceptId)
      .flatMap((other) => edges(corners(other)).map(([p, q]) => ({ p, q, itemId: other.id }))),
  ]
  const seen = new Set<string>()
  const marks: SpacingMark[] = []
  for (const item of items) {
    const others = segments(item.id)
    for (const dir of DIRECTIONS) {
      const uv = corners(item).map((c) => dir.toUV(c))
      const u0 = Math.max(...uv.map(([u]) => u))
      const v0 = Math.min(...uv.map(([, v]) => v))
      const v1 = Math.max(...uv.map(([, v]) => v))
      let best: { dist: number; v: number; itemId: string | null } | null = null
      for (const seg of others) {
        const h = hit(seg, dir, u0, v0, v1)
        if (h && (!best || h.dist < best.dist - EPS)) best = { ...h, itemId: seg.itemId }
      }
      if (!best || best.dist < min - EPS || best.dist > max + EPS) continue
      const b = dir.fromUV(u0 + best.dist, best.v)
      if (best.itemId === null && onOpening(b)) continue
      if (best.itemId !== null) {
        const key = [item.id, best.itemId].sort().join('|') + dir.along
        if (seen.has(key)) continue
        seen.add(key)
      }
      marks.push({
        a: dir.fromUV(u0, best.v),
        b,
        label: String(mToMm(best.dist)),
        angle: dir.along === 'x' ? 0 : -90,
        outward: dir.along === 'x' ? [0, -1] : [-1, 0],
      })
    }
  }
  return marks
}

export interface PlacedSpacing extends SpacingMark {
  text: TextBox
}

/**
 * Where each mark's number goes: beside the middle of its line, flipped to the other side when
 * it would cover an earlier number or one of `blocked` (prop names, numbers); a mark whose
 * number fits neither way is left out rather than drawn over something.
 */
export function placeSpacingLabels(
  marks: readonly SpacingMark[],
  fontSize: number,
  blocked: readonly TextBox[] = [],
): PlacedSpacing[] {
  const taken = [...blocked]
  const placed: PlacedSpacing[] = []
  for (const mark of marks) {
    const mid: Point = [(mark.a[0] + mark.b[0]) / 2, (mark.a[1] + mark.b[1]) / 2]
    for (const outward of [mark.outward, [-mark.outward[0], -mark.outward[1]] as Point]) {
      const text = textBox(mid, outward, mark.label, mark.angle, fontSize)
      if (taken.some((t) => boxesOverlap(text, t))) continue
      taken.push(text)
      placed.push({ ...mark, outward, text })
      break
    }
  }
  return placed
}
