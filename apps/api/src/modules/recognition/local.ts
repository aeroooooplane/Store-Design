import { roundM } from '@store/shared'
import type {
  Asset,
  DraftItem,
  Obstacle,
  Point,
  RecognitionDraft,
  RecognitionScale,
  RecognizeRequest,
  VectorContent,
} from '@store/shared'
import { countInLabel, matchCatalog, sizeInLabel } from './check.ts'

/**
 * Reads a plan from the text and lines of a vector PDF page (no OCR, no model): the largest
 * closed rectangle is the boundary, dimension texts next to their lines give the scale, labels
 * inside boxes give the props. Anything it cannot settle it leaves to the user.
 */

type Text = VectorContent['texts'][number]
type Line = VectorContent['lines'][number]

interface Box {
  x: number
  y: number
  w: number
  h: number
  color?: string | undefined
}

const AXIS_TOLERANCE_PX = 1.5
const CLUSTER_PX = 2.5
/** A side counts as drawn when this much of it is covered by lines. */
const SIDE_COVERAGE = 0.85
/** The front of a shop may be entirely entrance and open edge (a dashed lease line). */
const OPEN_SIDE_COVERAGE = 0
/** Boundary candidates need sides at least this fraction of the page's short side. */
const MIN_SIDE_FRACTION = 0.12
/** Dimension ratios within this of each other agree. */
const RATIO_TOLERANCE = 0.05
/** The sheet frame is nearly the whole page; the shop never is. */
const MAX_BOUNDARY_FRACTION = 0.8
/** A prop box is a small part of the page; anything bigger is a room or the sheet. */
const MAX_PROP_FRACTION = 0.2
const DEFAULT_ENTRANCE_M = 1.5

const isRed = (color?: string) => {
  if (!color) return false
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return r > 150 && g < 110 && b < 110
}

const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2]
const contains = (b: Box, p: [number, number], slack = 0) =>
  p[0] >= b.x - slack &&
  p[0] <= b.x + b.w + slack &&
  p[1] >= b.y - slack &&
  p[1] <= b.y + b.h + slack

/** Dimension text: "5400", "5400 mm", "6.5米", "3450 长墙净尺寸" → millimetres. */
export function dimensionMm(text: string): number | null {
  const t = text.trim()
  const metres = /^(\d+(?:\.\d+)?)\s*(?:米|m)$/i.exec(t)
  if (metres?.[1]) return Number(metres[1]) * 1000
  const mm = /^(\d{3,5})(\s*mm)?(?:\s+\S{1,12})?$/i.exec(t)
  if (mm?.[1]) {
    const value = Number(mm[1])
    // "500mm" with its unit is a logo or lintel height; plan dimension chains are bare numbers.
    return mm[2] && value < 1000 ? null : value
  }
  return null
}

function cropContent(content: VectorContent, crop: RecognizeRequest['crop']): VectorContent {
  if (!crop) return content
  const inside = (x: number, y: number) =>
    x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h
  return {
    width: crop.w,
    height: crop.h,
    texts: content.texts
      .filter((t) => inside(t.x + t.w / 2, t.y + t.h / 2))
      .map((t) => ({ ...t, x: t.x - crop.x, y: t.y - crop.y })),
    lines: content.lines
      .filter((l) => inside(l.x1, l.y1) || inside(l.x2, l.y2))
      .map((l) => ({
        ...l,
        x1: l.x1 - crop.x,
        y1: l.y1 - crop.y,
        x2: l.x2 - crop.x,
        y2: l.y2 - crop.y,
      })),
    rects: content.rects
      .filter((r) => inside(r.x + r.w / 2, r.y + r.h / 2))
      .map((r) => ({ ...r, x: r.x - crop.x, y: r.y - crop.y })),
  }
}

/** Axis-aligned lines, rectangles unfolded into their four sides. */
function axisLines(content: VectorContent): Line[] {
  const lines: Line[] = []
  for (const l of content.lines) {
    if (Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX || Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX) {
      lines.push(l)
    }
  }
  for (const r of content.rects) {
    const { x, y, w, h, color } = r
    lines.push(
      { x1: x, y1: y, x2: x + w, y2: y, color },
      { x1: x, y1: y + h, x2: x + w, y2: y + h, color },
      { x1: x, y1: y, x2: x, y2: y + h, color },
      { x1: x + w, y1: y, x2: x + w, y2: y + h, color },
    )
  }
  return lines
}

/** Axis-aligned lines bucketed by their position, so a side check only looks at its neighbours. */
interface LineIndex {
  h: Map<number, Line[]>
  v: Map<number, Line[]>
}

const bucket = (pos: number) => Math.round(pos / CLUSTER_PX)

function buildIndex(lines: Line[]): LineIndex {
  const index: LineIndex = { h: new Map(), v: new Map() }
  for (const l of lines) {
    const horizontal = Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
    const vertical = Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
    if (!horizontal && !vertical) continue
    const map = horizontal ? index.h : index.v
    const at = bucket(horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2)
    for (const k of [at - 1, at, at + 1]) {
      const list = map.get(k) ?? []
      list.push(l)
      map.set(k, list)
    }
  }
  return index
}

/** How much of the segment [a, b] at position `at` (on the other axis) the lines cover. */
function coverage(index: LineIndex, horizontal: boolean, at: number, a: number, b: number): number {
  const spans: [number, number][] = []
  for (const l of (horizontal ? index.h : index.v).get(bucket(at)) ?? []) {
    const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
    if (Math.abs(pos - at) > CLUSTER_PX) continue
    const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
    const lo = Math.max(a, Math.min(s, e))
    const hi = Math.min(b, Math.max(s, e))
    if (hi > lo) spans.push([lo, hi])
  }
  spans.sort((p, q) => p[0] - q[0])
  let covered = 0
  let cursor = a
  for (const [lo, hi] of spans) {
    if (hi <= cursor) continue
    covered += hi - Math.max(lo, cursor)
    cursor = hi
  }
  return covered / (b - a)
}

const sideCoverages = (index: LineIndex, box: Box) => [
  coverage(index, true, box.y, box.x, box.x + box.w),
  coverage(index, true, box.y + box.h, box.x, box.x + box.w),
  coverage(index, false, box.x, box.y, box.y + box.h),
  coverage(index, false, box.x + box.w, box.y, box.y + box.h),
]

/** All four sides drawn. */
const closed = (index: LineIndex, box: Box) =>
  sideCoverages(index, box).every((c) => c >= SIDE_COVERAGE)

/**
 * Three sides drawn and the fourth at least started: a shop whose front is mostly open. The
 * open side may not run along a prop box, or a box edge would pass for the front wall.
 */
const closedButFront = (index: LineIndex, box: Box, props: Box[]) => {
  const coverages = sideCoverages(index, box)
  const open = coverages.indexOf(Math.min(...coverages))
  if ((coverages[open] ?? 0) < OPEN_SIDE_COVERAGE) return false
  if (coverages.some((c, i) => i !== open && c < SIDE_COVERAGE)) return false
  const horizontal = open < 2
  const at = open === 0 ? box.y : open === 1 ? box.y + box.h : open === 2 ? box.x : box.x + box.w
  const [lo, hi] = horizontal ? [box.x, box.x + box.w] : [box.y, box.y + box.h]
  return !props.some((prop) => {
    const edges = horizontal ? [prop.y, prop.y + prop.h] : [prop.x, prop.x + prop.w]
    const [plo, phi] = horizontal ? [prop.x, prop.x + prop.w] : [prop.y, prop.y + prop.h]
    return edges.some((e) => Math.abs(e - at) <= CLUSTER_PX) && phi > lo && plo < hi
  })
}

function cluster(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last === undefined || v - last > CLUSTER_PX) out.push(v)
  }
  return out
}

/**
 * The boundary rectangle: four drawn sides, not the sheet frame, and — when prop labels are
 * known — the smallest one holding at least half of them (the shop holds the props, the sheet
 * frame holds the shop). Without props, the largest.
 */
function findBoundary(content: VectorContent, lines: Line[], anchors: Box[]): Box | null {
  const minSide = Math.min(content.width, content.height) * MIN_SIDE_FRACTION
  // Candidate side positions: where the drawn length adds up to at least a short side, so a
  // dashed lease line or a few wall stubs count as much as one long line.
  const positions = (horizontal: boolean) => {
    const total = new Map<number, { length: number; pos: number }>()
    for (const l of lines) {
      const isDir = horizontal
        ? Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
        : Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
      if (!isDir) continue
      const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
      const key = bucket(pos)
      const entry = total.get(key) ?? { length: 0, pos }
      entry.length += Math.hypot(l.x1 - l.x2, l.y1 - l.y2)
      total.set(key, entry)
    }
    return cluster([...total.values()].filter((e) => e.length >= minSide).map((e) => e.pos))
  }
  const xs = positions(false)
  const ys = positions(true)
  const index = buildIndex(lines)
  const pageArea = content.width * content.height
  // A prop box counts as held only when it lies wholly inside a clearly bigger rectangle, so
  // a prop box never passes for the shop around it; most of the props must be held.
  const holds = (outer: Box, inner: Box) =>
    inner.x >= outer.x - CLUSTER_PX &&
    inner.y >= outer.y - CLUSTER_PX &&
    inner.x + inner.w <= outer.x + outer.w + CLUSTER_PX &&
    inner.y + inner.h <= outer.y + outer.h + CLUSTER_PX &&
    outer.w * outer.h >= inner.w * inner.h * 2
  const needed = anchors.length >= 2 ? Math.max(2, Math.ceil(anchors.length * 0.6)) : anchors.length
  const search = (accept: (box: Box) => boolean) => {
    let best: Box | null = null
    let bestScore = -Infinity
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const [x1, x2] = [xs[i] ?? 0, xs[j] ?? 0]
        if (x2 - x1 < minSide) continue
        for (let k = 0; k < ys.length; k++) {
          for (let m = k + 1; m < ys.length; m++) {
            const [y1, y2] = [ys[k] ?? 0, ys[m] ?? 0]
            if (y2 - y1 < minSide) continue
            const box: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
            const area = box.w * box.h
            if (area >= pageArea * MAX_BOUNDARY_FRACTION) continue
            const held = anchors.filter((a) => holds(box, a)).length
            // Holding the props outranks size; among holders the smallest wins, else the largest.
            const score = anchors.length && held >= needed ? held * 1e12 - area : area
            if (score <= bestScore) continue
            if (accept(box)) {
              best = box
              bestScore = score
            }
          }
        }
      }
    }
    return { best, bestScore }
  }
  const holdsProps = (found: { bestScore: number }) => anchors.length < 2 || found.bestScore >= 1e12
  // Four drawn sides first; a shop whose front is mostly open only when no closed rectangle
  // holds the props. Props that nothing holds mean an irregular shop: better no boundary than
  // a wrong one.
  const fourSided = search((box) => closed(index, box))
  if (fourSided.best && holdsProps(fourSided)) return fourSided.best
  const threeSided = search((box) => closedButFront(index, box, anchors))
  if (threeSided.best && holdsProps(threeSided)) return threeSided.best
  return null
}

/**
 * The dimension line a dimension text labels: the nearest line parallel to the text that runs
 * past it and is longer than it (the text sits on or right beside its line; other parallel
 * lines, like prop boxes, are farther away).
 */
function dimensionLine(text: Text, lines: Line[]): Line | null {
  const horizontal = text.w >= text.h
  const [cx, cy] = centre(text)
  const reach = Math.max(text.h, text.w) * 3
  const textLength = Math.max(text.w, text.h)
  let best: { line: Line; gap: number } | null = null
  for (const l of lines) {
    const isDir = horizontal
      ? Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
      : Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
    if (!isDir) continue
    const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
    const gap = Math.abs(pos - (horizontal ? cy : cx))
    const along = horizontal ? cx : cy
    const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
    const length = Math.abs(e - s)
    if (gap > reach || length < textLength * 1.5) continue
    if (along < Math.min(s, e) - text.h || along > Math.max(s, e) + text.h) continue
    if (!best || gap < best.gap) best = { line: l, gap }
  }
  return best?.line ?? null
}

const lineLength = (l: Line) => Math.hypot(l.x1 - l.x2, l.y1 - l.y2)

/** Pixel length a dimension text measures: its dimension line, else the boundary side beside it. */
function dimensionPixels(text: Text, line: Line | null, boundary: Box | null): number | null {
  if (line) return lineLength(line)
  if (!boundary) return null
  const horizontal = text.w >= text.h
  const [cx, cy] = centre(text)
  const near = Math.max(boundary.w, boundary.h) * 0.15
  if (
    horizontal &&
    Math.min(Math.abs(cy - boundary.y), Math.abs(cy - boundary.y - boundary.h)) < near
  ) {
    return boundary.w
  }
  if (
    !horizontal &&
    Math.min(Math.abs(cx - boundary.x), Math.abs(cx - boundary.x - boundary.w)) < near
  ) {
    return boundary.h
  }
  return null
}

interface ScaleResult {
  scale: RecognitionScale | null
  notes: string[]
}

function findScale(
  dimensions: { text: Text; mm: number; line: Line | null }[],
  areas: { text: string; m2: number }[],
  boundary: Box | null,
  calibration: RecognizeRequest['calibration'],
  labelled: { text: Text; box: Box | null; sizeM: number | null; knownM: number | null }[],
): ScaleResult {
  const originPx: [number, number] = boundary ? [boundary.x, boundary.y] : [0, 0]
  if (calibration) {
    const px = Math.hypot(calibration.a[0] - calibration.b[0], calibration.a[1] - calibration.b[1])
    if (px > 0) {
      return {
        scale: {
          method: 'manual',
          reference: `用户指定 ${calibration.mm} mm 对应 ${px.toFixed(1)} px`,
          mmPerPixel: calibration.mm / px,
          originPx,
          verified: true,
        },
        notes: ['比例来自用户校准'],
      }
    }
  }
  const ratios: { ratio: number; text: string; kind: 'dimension' | 'item' | 'area' }[] = []
  for (const d of dimensions) {
    const px = dimensionPixels(d.text, d.line, boundary)
    if (px && px > 0) ratios.push({ ratio: d.mm / px, text: d.text.text.trim(), kind: 'dimension' })
  }
  // Prop names that carry a size ("1.8米开箱桌") measure their own box.
  for (const l of labelled) {
    if (!l.box) continue
    // A name without a size still measures its box when the catalogue knows one size for it.
    const sizeM = l.sizeM ?? l.knownM
    if (sizeM === null) continue
    const longPx = Math.max(l.box.w, l.box.h)
    if (longPx > 0) {
      ratios.push({ ratio: (sizeM * 1000) / longPx, text: l.text.text.trim(), kind: 'item' })
    }
  }
  // "店铺实测面积：31.5m²" against the boundary's area gives (or checks) the scale too.
  if (boundary) {
    for (const a of areas) {
      ratios.push({
        ratio: Math.sqrt((a.m2 * 1e6) / (boundary.w * boundary.h)),
        text: a.text,
        kind: 'area',
      })
    }
  }
  if (!ratios.length) {
    return { scale: null, notes: ['图上没有尺寸标注、面积，也没有带尺寸的道具名称'] }
  }
  // The value most of the readings agree on; a lone odd one (a "200mm" logo height) is outvoted,
  // and so is any reading that would make the shop absurdly small or large.
  const cluster = (r: number) => ratios.filter((o) => Math.abs(o.ratio - r) / r <= RATIO_TOLERANCE)
  const plausible = (r: number) => {
    if (!boundary) return 0.5
    const m2 = (boundary.w * boundary.h * r * r) / 1e6
    return m2 >= 3 && m2 <= 2000 ? 0.5 : 0
  }
  const agreeing =
    ratios
      .map((r) => ({
        members: cluster(r.ratio),
        score: cluster(r.ratio).length + plausible(r.ratio),
      }))
      .sort((a, b) => b.score - a.score)[0]?.members ?? []
  const ratio = agreeing.reduce((sum, r) => sum + r.ratio, 0) / agreeing.length
  const verified = agreeing.length >= 2
  const dims = agreeing.filter((r) => r.kind === 'dimension')
  const items = agreeing.filter((r) => r.kind === 'item')
  const areasUsed = agreeing.filter((r) => r.kind === 'area')
  const reference = [
    dims.length ? `尺寸标注 ${dims.map((r) => r.text).join('、')}` : '',
    items.length ? `道具名称 ${items.map((r) => r.text).join('、')} 与其图框` : '',
    areasUsed.length ? `${areasUsed.map((r) => r.text).join('、')} 与边界` : '',
  ]
    .filter(Boolean)
    .join('；')
  return {
    scale: {
      method: dims.length ? 'dimension' : items.length ? 'item_label' : 'area',
      reference,
      mmPerPixel: ratio,
      originPx,
      verified,
    },
    notes: [
      `比例按 ${agreeing.length} 处依据${verified ? '交叉核对' : ''}得出（1 px = ${ratio.toFixed(2)} mm）` +
        (ratios.length > agreeing.length
          ? `，另有 ${ratios.length - agreeing.length} 处不一致已忽略`
          : ''),
    ],
  }
}

const OBSTACLE_WORDS: [RegExp, Obstacle['kind']][] = [
  [/柱/, 'column'],
  [/楼梯|台阶|扶梯/, 'stair'],
  [/配电|消防|管井|井道/, 'shaft'],
  [/服务台|层板|底柜|结构/, 'fixed'],
]

/** Smallest drawn box holding the point, that is not the boundary and not tiny. */
function boxAround(
  point: [number, number],
  boxes: Box[],
  boundary: Box | null,
  minArea: number,
): Box | null {
  let best: Box | null = null
  for (const b of boxes) {
    if (
      boundary &&
      b.x === boundary.x &&
      b.y === boundary.y &&
      b.w === boundary.w &&
      b.h === boundary.h
    )
      continue
    if (b.w * b.h < minArea) continue
    if (boundary && b.w * b.h > boundary.w * boundary.h * 0.6) continue
    if (!contains(b, point)) continue
    if (!best || b.w * b.h < best.w * best.h) best = b
  }
  return best
}

/** Lines on one side of a point whose span covers it, nearest first (at most four positions). */
function nearestSides(lines: Line[], cx: number, cy: number) {
  const lefts: number[] = []
  const rights: number[] = []
  const tops: number[] = []
  const bottoms: number[] = []
  for (const l of lines) {
    if (Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX) {
      if (cy < Math.min(l.y1, l.y2) - CLUSTER_PX || cy > Math.max(l.y1, l.y2) + CLUSTER_PX) continue
      const x = (l.x1 + l.x2) / 2
      if (x < cx - CLUSTER_PX) lefts.push(x)
      else if (x > cx + CLUSTER_PX) rights.push(x)
    } else if (Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX) {
      if (cx < Math.min(l.x1, l.x2) - CLUSTER_PX || cx > Math.max(l.x1, l.x2) + CLUSTER_PX) continue
      const y = (l.y1 + l.y2) / 2
      if (y < cy - CLUSTER_PX) tops.push(y)
      else if (y > cy + CLUSTER_PX) bottoms.push(y)
    }
  }
  const nearest = (values: number[], descending: boolean) =>
    cluster(values)
      .sort((a, b) => (descending ? b - a : a - b))
      .slice(0, 8)
  return {
    lefts: nearest(lefts, true),
    rights: nearest(rights, false),
    tops: nearest(tops, true),
    bottoms: nearest(bottoms, false),
  }
}

/**
 * The smallest closed rectangle of drawn lines around a text (CAD exports draw boxes as four
 * lines): rays from the text centre find the nearest lines on each side; when the nearest ones
 * do not close (details inside a prop) the next ones out are tried. A label just above or
 * below its box is probed from inside the box as well.
 */
function boxFromLines(
  text: Text,
  lines: Line[],
  index: LineIndex,
  within: Box | null,
  pageArea: number,
): Box | null {
  const [cx, cy] = centre(text)
  const minLong = text.w * 0.8
  const minArea = text.w * text.h * 3
  const maxArea = Math.min(
    pageArea * MAX_PROP_FRACTION,
    within ? within.w * within.h * 0.6 : Infinity,
  )
  const candidates = new Map<string, Box>()
  for (const step of [0, 2.5, -2.5, 5, -5]) {
    const sides = nearestSides(lines, cx, cy + text.h * step)
    for (const x1 of sides.lefts) {
      for (const x2 of sides.rights) {
        for (const y1 of sides.tops) {
          for (const y2 of sides.bottoms) {
            const box: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
            const area = box.w * box.h
            if (Math.max(box.w, box.h) < minLong || area < minArea || area > maxArea) continue
            if (within && sameBox(box, within)) continue
            candidates.set(boxKey(box), box)
          }
        }
      }
    }
  }
  // Smallest first: the prop's own box closes before anything around it does.
  return (
    [...candidates.values()]
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .find((box) => closed(index, box)) ?? null
  )
}

const boxKey = (b: Box) =>
  `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
const sameBox = (a: Box, b: Box) => boxKey(a) === boxKey(b)

export function recognizeVector(
  raw: VectorContent,
  request: Pick<RecognizeRequest, 'crop' | 'calibration'>,
  catalog: readonly Asset[],
  siStyle?: string,
): RecognitionDraft {
  const content = cropContent(raw, request.crop)
  const lines = axisLines(content)
  const boxes: Box[] = content.rects.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    color: r.color,
  }))
  // Dimension texts and their lines first: dimension lines must not pass as walls.
  const dimensions = content.texts.flatMap((text) => {
    const mm = dimensionMm(text.text)
    // Plan dimensions start around 300 mm; smaller ones are logo or lintel heights.
    return mm !== null && mm >= 300 ? [{ text, mm, line: dimensionLine(text, lines) }] : []
  })
  // The shop area: a text saying 面积 with a number, else the largest bare "NN m²".
  const areaOf = (t: Text) => /(\d+(?:\.\d+)?)\s*(?:m²|㎡|平方米?)/.exec(t.text)?.[1] ?? null
  // CAD exports often split "店铺实测面积：31.5m²" into pieces on one row.
  const sameRow = (a: Text, b: Text) =>
    Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.h, b.h)
  const numberAfter = (t: Text) =>
    content.texts
      .filter(
        (o) =>
          o !== t &&
          sameRow(t, o) &&
          o.x > t.x &&
          /^\d+(?:\.\d+)?\s*(?:m|㎡|m²)?$/.test(o.text.trim()),
      )
      .sort((p, q) => p.x - q.x)[0]
  const named = content.texts.flatMap((t) => {
    if (!/面积/.test(t.text)) return []
    const own = areaOf(t)
    if (own) return [{ text: t.text.trim(), m2: Number(own) }]
    const next = numberAfter(t)
    const value = next ? /(\d+(?:\.\d+)?)/.exec(next.text)?.[1] : undefined
    return value && next ? [{ text: `${t.text.trim()}${next.text.trim()}`, m2: Number(value) }] : []
  })
  const bare = content.texts
    .filter((t) => /^\d+(?:\.\d+)?\s*(?:m²|㎡)$/.test(t.text.trim()))
    .sort((a, b) => Number(areaOf(b)) - Number(areaOf(a)))
  const areas = named.length
    ? named
    : bare.slice(0, 1).map((t) => ({ text: t.text.trim(), m2: Number(areaOf(t)) }))
  const dimensionLines = new Set(dimensions.flatMap((d) => (d.line ? [d.line] : [])))
  const wallLines = lines.filter((l) => !dimensionLines.has(l))
  const index = buildIndex(wallLines)
  const notes: string[] = []
  const pending: string[] = []

  // Labels: texts that are not dimensions, with the box they sit in.
  const pageArea = content.width * content.height
  const label = (within: Box | null) =>
    content.texts
      .filter((t) => dimensionMm(t.text) === null && t.text.trim().length >= 2)
      .map((text) => {
        // Product tags and notes ("X5", "go3s 黑") are not props: no box search for them.
        const match = matchCatalog(text.text, catalog, undefined, siStyle)
        const relevant =
          sizeInLabel(text.text) !== null ||
          match.function !== 'other' ||
          OBSTACLE_WORDS.some(([re]) => re.test(text.text))
        return {
          text,
          box: relevant
            ? (boxAround(centre(text), boxes, within, text.w * text.h * 1.5) ??
              boxFromLines(text, wallLines, index, within, pageArea))
            : null,
          sizeM: sizeInLabel(text.text),
          // The one size the catalogue has for this name (null when several sizes exist).
          knownM: match.asset ? Math.max(match.asset.footprint.w, match.asset.footprint.d) : null,
        }
      })
  // Prop labels sitting in a box anchor the boundary; boxes are looked up again once it is known.
  const anchors = label(null).flatMap((l) =>
    l.box && matchCatalog(l.text.text, catalog, undefined, siStyle).function !== 'other'
      ? [l.box]
      : [],
  )
  const boundary = findBoundary(content, wallLines, anchors)
  if (boundary) {
    notes.push(
      `边界取${anchors.length ? '包含道具的最小' : '图中最大的'}闭合矩形（${Math.round(boundary.w)} × ${Math.round(boundary.h)} px）；异形门店请在校对时调整`,
    )
  }
  const labelled = label(boundary)

  const { scale, notes: scaleNotes } = findScale(
    dimensions,
    areas,
    boundary,
    request.calibration,
    labelled,
  )
  notes.push(...scaleNotes)
  if (!scale) {
    return { space: null, items: [], scale: null, pending, confidence: 0, notes }
  }
  const toM = (px: number, axis: 0 | 1) =>
    roundM(((px - scale.originPx[axis]) * scale.mmPerPixel) / 1000)
  const lenM = (px: number) => roundM((px * scale.mmPerPixel) / 1000)

  const items: DraftItem[] = []
  const obstacles: Obstacle[] = []
  const entrances: NonNullable<RecognitionDraft['space']>['entrances'] = []
  const usedBoxes = new Set<string>()
  let ref = 0

  for (const { text, box } of labelled) {
    const label = text.text.trim()
    const obstacleKind = OBSTACLE_WORDS.find(([re]) => re.test(label))?.[1]
    if (obstacleKind && box && boundary && contains(boundary, centre(box))) {
      obstacles.push({
        kind: obstacleKind,
        polygon: [
          [toM(box.x, 0), toM(box.y, 1)],
          [toM(box.x + box.w, 0), toM(box.y, 1)],
          [toM(box.x + box.w, 0), toM(box.y + box.h, 1)],
          [toM(box.x, 0), toM(box.y + box.h, 1)],
        ],
        height: null,
        label,
      })
      usedBoxes.add(boxKey(box))
      continue
    }
    if (/入口|人流通道/.test(label)) continue
    // A second label in a box already placed ("收银" inside the 收银台) adds nothing.
    if (box && usedBoxes.has(boxKey(box))) continue

    const drawn = box ? { w: lenM(box.w), d: lenM(box.h) } : undefined
    const match = matchCatalog(label, catalog, drawn, siStyle)
    if (match.function === 'other' && !match.asset) continue
    const count = countInLabel(label)
    const red = isRed(text.color) || (box ? isRed(box.color) : false)
    // Red boxes without their own text belong to the nearest red label (e.g. "边桌配件柜*2").
    const ownBoxes: Box[] = box ? [box] : []
    if (count > 1 || !box) {
      const [tx, ty] = centre(text)
      const reach = Math.max(content.width, content.height) * 0.15
      const nearby = boxes
        .filter(
          (b) =>
            !usedBoxes.has(boxKey(b)) &&
            !(box && sameBox(b, box)) &&
            isRed(b.color) &&
            !labelled.some((l) => l.box && sameBox(l.box, b)),
        )
        .map((b) => ({ b, dist: Math.hypot(centre(b)[0] - tx, centre(b)[1] - ty) }))
        .filter((e) => e.dist < reach)
        .sort((p, q) => p.dist - q.dist)
        .slice(0, Math.max(0, count - ownBoxes.length))
      ownBoxes.push(...nearby.map((e) => e.b))
    }
    const place = (b: Box | null, index: number): DraftItem => {
      const footprint = match.asset?.footprint
      const w = b ? lenM(b.w) : (footprint?.w ?? 1)
      const d = b ? lenM(b.h) : (footprint?.d ?? 1)
      const [px, py] = b ? centre(b) : centre(text)
      // A box longer the other way than the model turns the model by 90°.
      const rotation = footprint && b && b.w >= b.h !== footprint.w >= footprint.d ? 90 : 0
      const source = red
        ? 'requested'
        : boundary && !contains(boundary, [px, py])
          ? 'outside'
          : 'existing'
      return {
        ref: `r${++ref}`,
        label: count > 1 ? `${label}（第 ${index + 1} 件）` : label,
        assetId: match.asset?.id ?? null,
        function: match.function,
        source,
        cx: toM(px, 0),
        cz: toM(py, 1),
        w: footprint ? (rotation ? footprint.d : footprint.w) : w,
        d: footprint ? (rotation ? footprint.w : footprint.d) : d,
        rotation,
        confidence: Math.min(match.confidence, b ? 0.95 : 0.55),
        note:
          [match.note, b ? null : '图上没有对应的图框，位置按文字中心']
            .filter(Boolean)
            .join('；') || null,
      }
    }
    if (ownBoxes.length) {
      ownBoxes.forEach((b, position) => {
        usedBoxes.add(boxKey(b))
        items.push(place(b, position))
      })
      if (count > ownBoxes.length) {
        pending.push(
          `「${label}」标注 ${count} 件，图上只找到 ${ownBoxes.length} 个图框，请补充其余的`,
        )
      }
    } else {
      items.push(place(null, 0))
    }
  }

  let space: RecognitionDraft['space'] = null
  if (boundary) {
    const b = boundary
    const polygon: [number, number][] = [
      [toM(b.x, 0), toM(b.y, 1)],
      [toM(b.x + b.w, 0), toM(b.y, 1)],
      [toM(b.x + b.w, 0), toM(b.y + b.h, 1)],
      [toM(b.x, 0), toM(b.y + b.h, 1)],
    ]
    const entranceText =
      content.texts.find((t) => /主入口|主人流通道/.test(t.text)) ??
      content.texts.find((t) => /入口|人流通道/.test(t.text))
    if (entranceText) {
      const [tx, ty] = centre(entranceText)
      const sides: { a: Point; b: Point; dist: number }[] = polygon.map((p, i) => {
        const q = polygon[(i + 1) % polygon.length] ?? p
        const px = [toM(tx, 0), toM(ty, 1)] as const
        const horizontal = p[1] === q[1]
        const dist = horizontal ? Math.abs(px[1] - p[1]) : Math.abs(px[0] - p[0])
        return { a: p, b: q, dist }
      })
      const side = sides.sort((p, q) => p.dist - q.dist)[0]
      if (side) {
        const horizontal = side.a[1] === side.b[1]
        const along = horizontal ? toM(tx, 0) : toM(ty, 1)
        const lo = Math.min(horizontal ? side.a[0] : side.a[1], horizontal ? side.b[0] : side.b[1])
        const hi = Math.max(horizontal ? side.a[0] : side.a[1], horizontal ? side.b[0] : side.b[1])
        const start = Math.max(
          lo,
          Math.min(hi - DEFAULT_ENTRANCE_M, along - DEFAULT_ENTRANCE_M / 2),
        )
        const end = Math.min(hi, start + DEFAULT_ENTRANCE_M)
        entrances.push(
          horizontal
            ? { a: [roundM(start), side.a[1]], b: [roundM(end), side.a[1]], kind: 'main' }
            : { a: [side.a[0], roundM(start)], b: [side.a[0], roundM(end)], kind: 'main' },
        )
        notes.push(
          `入口按「${entranceText.text.trim()}」文字所靠的边界边放置，宽度默认 ${DEFAULT_ENTRANCE_M} m`,
        )
        pending.push('入口宽度按默认 1.5 m，请核对')
      }
    }
    space = { boundary: polygon, entrances, obstacles, height: null }
  }

  const confidence = boundary ? (scale.verified ? 0.9 : 0.7) : 0.3
  return { space, items, scale, pending, confidence, notes }
}
