import { SpaceSchema, mmToM, mToMm, openingPieces } from '@store/shared'
import type { Obstacle, Point, Space, SpaceInput } from '@store/shared'

/** Forms work in millimetres; spaces are stored in metres. */
export type EntranceSide = 'front' | 'back' | 'left' | 'right' | 'none'

export const ENTRANCE_SIDE_LABELS: Record<EntranceSide, string> = {
  front: '前边（下）',
  back: '后边（上）',
  left: '左边',
  right: '右边',
  none: '暂不设置',
}

export interface RectangleForm {
  widthMm: number
  depthMm: number
  heightMm: number
  entranceSide: EntranceSide
  /** Opening width, centred on the side; 0 = the whole side. */
  entranceWidthMm: number
}

export interface VertexRow {
  xMm: number
  zMm: number
}

/** 店面: an entrance (main or side) or an open edge without a wall. */
export type OpeningKind = 'main' | 'side' | 'open'

export const OPENING_KIND_LABELS: Record<OpeningKind, string> = {
  main: '主入口',
  side: '次入口',
  open: '开放边',
}

/**
 * One entrance or open edge, as saved: it runs forwards round the boundary (in vertex order)
 * from `startMm` along edge `edge` to `endMm` along edge `toEdge`, so one row can follow several
 * edges (an arc storefront, or round a corner). Edge i runs from vertex i to vertex i + 1.
 */
export interface OpeningRow {
  /** Edge the opening starts on. */
  edge: number
  /** Start, measured along `edge` from its first vertex. */
  startMm: number
  /** Edge the opening ends on; the same as `edge` for an opening on one edge. */
  toEdge: number
  /** End, measured along `toEdge` from its first vertex. */
  endMm: number
  kind: OpeningKind
  /** The saved opening runs against the vertex order (b before a); saving keeps it that way. */
  reversed?: boolean
}

export type ObstacleKind = Obstacle['kind']

export const OBSTACLE_KIND_LABELS: Record<ObstacleKind, string> = {
  column: '柱子',
  shaft: '管井',
  stair: '楼梯',
  fixed: '固定物',
  other: '其他',
}

export interface ObstacleRow {
  kind: ObstacleKind
  label: string
  /** Null: full height. */
  heightMm: number | null
  xMm: number
  zMm: number
  wMm: number
  dMm: number
  /**
   * Outline of a non-rectangular obstacle in metres, kept exactly as loaded; such rows can only
   * be kept or deleted. Null for the editable axis-aligned rectangles.
   */
  polygon: [number, number][] | null
  /** A fixture added after the shell (counts as area, kept clear of props); see ObstacleSchema. */
  addedLater?: boolean
}

export interface PolygonForm {
  vertices: VertexRow[]
  heightMm: number
  openings: OpeningRow[]
  obstacles: ObstacleRow[]
}

/** Below this an edge is probably a drawing artefact (for example wall thickness). */
export const SHORT_EDGE_MM = 300
export const MAX_VERTICES = 200
export const MAX_ARC_SEGMENTS = 64
/** Openings shorter than this are dropped; also the tolerance for touching spans. */
const MIN_SPAN_MM = 1
/**
 * An opening is saved by its two ends and read back as the shorter way round between them
 * (shared `openingPieces`), so one longer than half the perimeter would be read as the other
 * side. Kept below half the perimeter by this much, rounding the ends to the millimetre is safe.
 */
const HALF_MARGIN_MM = 10

const point = (xMm: number, zMm: number): [number, number] => [mmToM(xMm), mmToM(zMm)]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mod = (i: number, n: number) => ((i % n) + n) % n
/** Rounds to `decimals` places; dividing keeps 0.1 steps from reading as 4123.1000000000004. */
const roundTo = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals

export function edgeLengthMm(vertices: readonly VertexRow[], edge: number): number {
  const a = vertices[edge]
  const b = vertices[(edge + 1) % vertices.length]
  return a && b ? Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm) : 0
}

function pointAlong(a: VertexRow, b: VertexRow, mm: number): VertexRow {
  const length = Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm)
  const t = length === 0 ? 0 : clamp(mm / length, 0, 1)
  return { xMm: a.xMm + (b.xMm - a.xMm) * t, zMm: a.zMm + (b.zMm - a.zMm) * t }
}

/** Positive when the ring runs clockwise on the plan (x right, z down). */
function signedAreaMm(vertices: readonly VertexRow[]): number {
  let sum = 0
  vertices.forEach((a, i) => {
    const b = vertices[(i + 1) % vertices.length] ?? a
    sum += a.xMm * b.zMm - b.xMm * a.zMm
  })
  return sum / 2
}

const sortOpenings = (rows: readonly OpeningRow[]) =>
  [...rows].sort((p, q) => p.edge - q.edge || p.startMm - q.startMm)

const toRows = (points: [number, number][]): VertexRow[] =>
  points.map(([xMm, zMm]) => ({ xMm, zMm }))

// ---------------------------------------------------------------------------------------------
// Rectangle and templates

/** Corners clockwise from the top-left, so edges are 0 top, 1 right, 2 bottom (front), 3 left. */
export function rectangleToPolygon(form: RectangleForm): PolygonForm {
  const { widthMm: w, depthMm: d } = form
  const vertices = [
    { xMm: 0, zMm: 0 },
    { xMm: w, zMm: 0 },
    { xMm: w, zMm: d },
    { xMm: 0, zMm: d },
  ]
  const edge = { back: 0, right: 1, front: 2, left: 3, none: -1 }[form.entranceSide]
  const sideLength = edge === 0 || edge === 2 ? w : d
  const opening = form.entranceWidthMm > 0 ? Math.min(form.entranceWidthMm, sideLength) : sideLength
  const start = (sideLength - opening) / 2
  return {
    vertices,
    heightMm: form.heightMm,
    openings:
      edge < 0
        ? []
        : [{ edge, startMm: start, toEdge: edge, endMm: start + opening, kind: 'main' }],
    obstacles: [],
  }
}

export type TemplateKind = 'l' | 'trapezoid' | 'chamfer' | 'bump'

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  l: 'L 形',
  trapezoid: '梯形（一侧斜墙）',
  chamfer: '缺角（切角）',
  bump: '后墙凸出或内凹',
}

/** Plan corners; 后 is the top of the plan (small z), 前 the entrance side. */
export type Corner = 'tl' | 'tr' | 'br' | 'bl'

export const CORNER_LABELS: Record<Corner, string> = {
  tl: '左后角',
  tr: '右后角',
  br: '右前角',
  bl: '左前角',
}

export interface TemplateForm {
  kind: TemplateKind
  /** Overall width; for the trapezoid the back (top) width, for the bump the main body. */
  widthMm: number
  /** Overall depth; for the bump the main body without the bump. */
  depthMm: number
  heightMm: number
  /** L notch, chamfer or bump size along x. */
  cutWidthMm: number
  /** L notch, chamfer or bump size along z. */
  cutDepthMm: number
  corner: Corner
  /** Trapezoid: front (bottom) width. */
  frontWidthMm: number
  /** Trapezoid: the slanted side; the other side stays square. */
  slant: 'left' | 'right'
  /** Bump: out of the back wall, or into the shop. */
  bump: 'out' | 'in'
  /** Bump: distance from the left wall. */
  offsetMm: number
}

const TEMPLATE_BASE: Omit<TemplateForm, 'kind'> = {
  widthMm: 10000,
  depthMm: 8000,
  heightMm: 3200,
  cutWidthMm: 2000,
  cutDepthMm: 2000,
  corner: 'tr',
  frontWidthMm: 10000,
  slant: 'right',
  bump: 'in',
  offsetMm: 3000,
}

export const DEFAULT_TEMPLATES: Record<TemplateKind, TemplateForm> = {
  l: { ...TEMPLATE_BASE, kind: 'l', cutWidthMm: 4000, cutDepthMm: 3000 },
  trapezoid: { ...TEMPLATE_BASE, kind: 'trapezoid', widthMm: 8000 },
  chamfer: { ...TEMPLATE_BASE, kind: 'chamfer' },
  bump: { ...TEMPLATE_BASE, kind: 'bump', depthMm: 7000, cutWidthMm: 4000 },
}

/** W × D rectangle clockwise from the top-left, with one corner replaced. */
function rectangleWithCorner(
  w: number,
  d: number,
  corner: Corner,
  replacement: Record<Corner, [number, number][]>,
): VertexRow[] {
  const corners: [Corner, [number, number]][] = [
    ['tl', [0, 0]],
    ['tr', [w, 0]],
    ['br', [w, d]],
    ['bl', [0, d]],
  ]
  return toRows(corners.flatMap(([name, p]) => (name === corner ? replacement[corner] : [p])))
}

function templateVertices(t: TemplateForm): VertexRow[] {
  const { widthMm: w, depthMm: d, cutWidthMm: a, cutDepthMm: b } = t
  switch (t.kind) {
    case 'l':
      return rectangleWithCorner(w, d, t.corner, {
        tl: [
          [0, b],
          [a, b],
          [a, 0],
        ],
        tr: [
          [w - a, 0],
          [w - a, b],
          [w, b],
        ],
        br: [
          [w, d - b],
          [w - a, d - b],
          [w - a, d],
        ],
        bl: [
          [a, d],
          [a, d - b],
          [0, d - b],
        ],
      })
    case 'chamfer':
      return rectangleWithCorner(w, d, t.corner, {
        tl: [
          [0, b],
          [a, 0],
        ],
        tr: [
          [w - a, 0],
          [w, b],
        ],
        br: [
          [w, d - b],
          [w - a, d],
        ],
        bl: [
          [a, d],
          [0, d - b],
        ],
      })
    case 'trapezoid': {
      const front = t.frontWidthMm
      const span = Math.max(w, front)
      // The square side stays at x = 0 (slant on the right) or at x = span (slant on the left).
      return toRows(
        t.slant === 'right'
          ? [
              [0, 0],
              [w, 0],
              [front, d],
              [0, d],
            ]
          : [
              [span - w, 0],
              [span, 0],
              [span, d],
              [span - front, d],
            ],
      )
    }
    case 'bump': {
      const x0 = t.offsetMm
      const x1 = t.offsetMm + a
      // Coordinates start at 0: an outward bump moves the main body down by its depth.
      const top = t.bump === 'out' ? b : 0
      const notch = t.bump === 'out' ? 0 : b
      return toRows([
        [0, top],
        [x0, top],
        [x0, notch],
        [x1, notch],
        [x1, top],
        [w, top],
        [w, top + d],
        [0, top + d],
      ])
    }
  }
}

/** Front edge: the longest horizontal edge with the largest z (the entrance side of templates). */
export function frontEdge(vertices: readonly VertexRow[]): number {
  let best = -1
  let bestZ = -Infinity
  let bestLength = 0
  vertices.forEach((a, i) => {
    const b = vertices[(i + 1) % vertices.length]
    if (!b || Math.abs(a.zMm - b.zMm) > 0.5) return
    const length = Math.abs(b.xMm - a.xMm)
    if (length < MIN_SPAN_MM) return
    if (a.zMm > bestZ + 0.5 || (Math.abs(a.zMm - bestZ) <= 0.5 && length > bestLength)) {
      best = i
      bestZ = a.zMm
      bestLength = length
    }
  })
  return best
}

/** A template shape with the whole front edge as the main entrance, like the rectangle. */
export function templateToPolygon(t: TemplateForm): PolygonForm {
  const vertices = templateVertices(t)
  const front = frontEdge(vertices)
  return {
    vertices,
    heightMm: t.heightMm,
    openings:
      front < 0
        ? []
        : [
            {
              edge: front,
              startMm: 0,
              toEdge: front,
              endMm: edgeLengthMm(vertices, front),
              kind: 'main',
            },
          ],
    obstacles: [],
  }
}

// ---------------------------------------------------------------------------------------------
// Edge-by-edge entry

/**
 * One boundary edge as length and turn. `turnDeg` of the first edge is its direction from the
 * +x axis; every other edge turns relative to the previous one. Positive is a right turn as
 * seen on the plan (clockwise, because z points down), negative a left turn.
 */
export interface EdgeRow {
  lengthMm: number
  turnDeg: number
}

const headingDeg = (a: VertexRow, b: VertexRow) =>
  (Math.atan2(b.zMm - a.zMm, b.xMm - a.xMm) * 180) / Math.PI

/** Folds an angle into (-180, 180]. */
export function normalizeTurn(deg: number): number {
  const r = mod(deg, 360)
  return r > 180 ? r - 360 : r
}

/** Lengths to 0.1 mm and turns to 0.01°, so that derived values read cleanly. */
export function verticesToEdges(vertices: readonly VertexRow[]): EdgeRow[] {
  const n = vertices.length
  const headings = vertices.map((a, i) => headingDeg(a, vertices[(i + 1) % n] ?? a))
  return vertices.map((_, i) => {
    const turn = i === 0 ? (headings[0] ?? 0) : (headings[i] ?? 0) - (headings[i - 1] ?? 0)
    return {
      lengthMm: roundTo(edgeLengthMm(vertices, i), 1),
      // `+ 0` folds -0 into 0: a straight edge reads as no turn.
      turnDeg: roundTo(normalizeTurn(turn), 2) + 0,
    }
  })
}

/**
 * Rebuilds the vertices after `from` from the edge rows. Vertices up to `from` stay where they
 * are and the direction of edge `from - 1` is taken from them, so earlier edges never drift.
 * The last edge closes the ring and is not used. Vertices are rounded to the millimetre.
 */
export function applyEdges(
  vertices: readonly VertexRow[],
  edges: readonly EdgeRow[],
  from = 0,
): VertexRow[] {
  const n = vertices.length
  const out = vertices.map((v) => ({ ...v }))
  const start = clamp(from, 0, n - 1)
  const a0 = out[start - 1]
  const b0 = out[start]
  let heading = start > 0 && a0 && b0 ? headingDeg(a0, b0) : 0
  for (let k = start; k < n - 1; k++) {
    const edge = edges[k]
    const a = out[k]
    if (!edge || !a) break
    heading = k === 0 ? edge.turnDeg : heading + edge.turnDeg
    const rad = (heading * Math.PI) / 180
    out[k + 1] = {
      xMm: Math.round(a.xMm + edge.lengthMm * Math.cos(rad)) + 0,
      zMm: Math.round(a.zMm + edge.lengthMm * Math.sin(rad)) + 0,
    }
  }
  return out
}

export interface Closure {
  /** The closing edge as drawn (from the last vertex back to the first). */
  lengthMm: number
  turnDeg: number
  /** How far the entered last edge ends from the first vertex. */
  errorMm: number
}

/** Compares the entered last edge with the edge that actually closes the ring. */
export function closure(vertices: readonly VertexRow[], edges: readonly EdgeRow[]): Closure {
  const n = vertices.length
  const actual = verticesToEdges(vertices)[n - 1] ?? { lengthMm: 0, turnDeg: 0 }
  const before = vertices[n - 2]
  const last = vertices[n - 1]
  const first = vertices[0]
  const entered = edges[n - 1]
  if (!before || !last || !first || !entered) return { ...actual, errorMm: 0 }
  const rad = ((headingDeg(before, last) + entered.turnDeg) * Math.PI) / 180
  const end = {
    xMm: last.xMm + entered.lengthMm * Math.cos(rad),
    zMm: last.zMm + entered.lengthMm * Math.sin(rad),
  }
  return { ...actual, errorMm: roundTo(Math.hypot(end.xMm - first.xMm, end.zMm - first.zMm), 1) }
}

// ---------------------------------------------------------------------------------------------
// Positions round the boundary

/**
 * The boundary unrolled onto a line: edge i covers `starts[i]` to `starts[i] + lengths[i]`
 * millimetres from vertex 0, the whole ring `perimeter`.
 */
interface Ring {
  starts: number[]
  lengths: number[]
  perimeter: number
}

/** A stretch of the boundary: from `start` (see Ring) forwards over `length` millimetres. */
interface Stretch {
  start: number
  length: number
}

/** One end of an opening: an edge and the distance along it from its first vertex. */
interface End {
  edge: number
  mm: number
}

/** Below this a position counts as on a vertex (floating-point noise, not a real distance). */
const SNAP_MM = 1e-6

function ringOf(vertices: readonly VertexRow[]): Ring {
  const lengths = vertices.map((_, i) => edgeLengthMm(vertices, i))
  const starts: number[] = []
  let perimeter = 0
  for (const length of lengths) {
    starts.push(perimeter)
    perimeter += length
  }
  return { starts, lengths, perimeter }
}

const validEdge = (ring: Ring, edge: number) =>
  Number.isInteger(edge) && edge >= 0 && edge < ring.lengths.length

const along = (ring: Ring, end: End) =>
  (ring.starts[end.edge] ?? 0) + clamp(end.mm, 0, ring.lengths[end.edge] ?? 0)

/** A row's two ends; on one edge the start is the nearer one to the edge's first vertex. */
function rowEnds(row: OpeningRow): { start: End; end: End } {
  const start = { edge: row.edge, mm: row.startMm }
  const end = { edge: row.toEdge, mm: row.endMm }
  return row.edge === row.toEdge && row.startMm > row.endMm
    ? { start: { ...start, mm: row.endMm }, end: { ...end, mm: row.startMm } }
    : { start, end }
}

/** The stretch a row covers; null when one of its edges does not exist. */
function rowStretch(ring: Ring, row: OpeningRow): Stretch | null {
  if (!validEdge(ring, row.edge) || !validEdge(ring, row.toEdge) || ring.perimeter <= 0) return null
  const { start, end } = rowEnds(row)
  const from = along(ring, start)
  const to = along(ring, end)
  return {
    start: from,
    length: row.edge === row.toEdge ? to - from : mod(to - from, ring.perimeter),
  }
}

/**
 * Edge and offset of a position round the ring. On a vertex a start goes on the edge that
 * begins there and an end on the edge that ends there, so neither gets an empty first piece.
 */
function locate(ring: Ring, position: number, role: 'start' | 'end'): End {
  const { starts, lengths, perimeter } = ring
  let p = mod(position, perimeter)
  for (const s of [...starts, perimeter]) if (Math.abs(p - s) <= SNAP_MM) p = s
  if (p === perimeter) p = 0
  if (role === 'end' && p === 0) p = perimeter
  for (let edge = 0; edge < lengths.length; edge++) {
    const lo = starts[edge] ?? 0
    const length = lengths[edge] ?? 0
    const hi = lo + length
    if (length <= 0) continue
    if (role === 'start' ? p >= lo && p < hi : p > lo && p <= hi)
      return { edge, mm: p === hi ? length : p === lo ? 0 : roundTo(p - lo, 3) }
  }
  return { edge: 0, mm: 0 }
}

/**
 * Splits a stretch longer than half the perimeter (less HALF_MARGIN_MM) into equal pieces that
 * are each read back the right way round; the cuts move to the nearest vertices when every
 * piece stays short enough.
 */
function shortPieces(ring: Ring, stretch: Stretch): Stretch[] {
  const half = ring.perimeter / 2 - HALF_MARGIN_MM
  if (stretch.length <= half || half <= 0) return [stretch]
  const count = Math.ceil(stretch.length / half)
  const end = stretch.start + stretch.length
  const exact = Array.from(
    { length: count - 1 },
    (_, k) => stretch.start + (stretch.length * (k + 1)) / count,
  )
  const toVertex = (cut: number) => {
    const p = mod(cut, ring.perimeter)
    const nearest = [...ring.starts, ring.perimeter].reduce((best, s) =>
      Math.abs(s - p) < Math.abs(best - p) ? s : best,
    )
    return cut + nearest - p
  }
  const fits = (cuts: number[]) =>
    [stretch.start, ...cuts, end].every((c, k, all) => {
      const piece = c - (all[k - 1] ?? c)
      return k === 0 || (piece >= MIN_SPAN_MM && piece <= half)
    })
  const snapped = exact.map(toVertex)
  const cuts = fits(snapped) ? snapped : exact
  return [stretch.start, ...cuts].map((s, k) => ({ start: s, length: (cuts[k] ?? end) - s }))
}

/** The rows for a stretch, more than one when it is longer than half the perimeter. */
function rowsFor(
  ring: Ring,
  stretch: Stretch,
  like: Pick<OpeningRow, 'kind' | 'reversed'>,
): OpeningRow[] {
  return shortPieces(ring, stretch).map((piece) => {
    const a = locate(ring, piece.start, 'start')
    const b = locate(ring, piece.start + piece.length, 'end')
    return {
      edge: a.edge,
      startMm: a.mm,
      toEdge: b.edge,
      endMm: b.mm,
      kind: like.kind,
      ...(like.reversed ? { reversed: true } : {}),
    }
  })
}

/** How much two stretches overlap, either way round the ring. */
function overlapMm(ring: Ring, p: Stretch, q: Stretch): number {
  let most = 0
  for (const shift of [-ring.perimeter, 0, ring.perimeter]) {
    const lo = Math.max(p.start, q.start + shift)
    const hi = Math.min(p.start + p.length, q.start + shift + q.length)
    most = Math.max(most, hi - lo)
  }
  return most
}

/** What is left of a row outside a stretch; the row itself when they do not overlap. */
function subtractStretch(ring: Ring, row: OpeningRow, cut: Stretch): OpeningRow[] {
  const own = rowStretch(ring, row)
  if (!own || overlapMm(ring, own, cut) <= 0) return [row]
  let left: [number, number][] = [[own.start, own.start + own.length]]
  // The row may run past vertex 0, so the cut is also tried a turn either way.
  for (const shift of [-ring.perimeter, 0, ring.perimeter]) {
    const lo = cut.start + shift
    const hi = lo + cut.length
    const next: [number, number][] = []
    for (const [s, e] of left) {
      if (hi <= s || lo >= e) next.push([s, e])
      else {
        if (lo - s >= MIN_SPAN_MM) next.push([s, lo])
        if (e - hi >= MIN_SPAN_MM) next.push([hi, e])
      }
    }
    left = next
  }
  return left.flatMap(([s, e]) => rowsFor(ring, { start: s, length: e - s }, row))
}

/** Where a row runs, for lists and messages: 第 3 条边, or 第 3 条边 → 第 6 条边. */
export function openingRange(row: OpeningRow): string {
  return row.edge === row.toEdge
    ? `第 ${row.edge + 1} 条边`
    : `第 ${row.edge + 1} 条边 → 第 ${row.toEdge + 1} 条边`
}

const withEnds = (row: OpeningRow, start: End, end: End): OpeningRow => ({
  ...row,
  edge: start.edge,
  startMm: start.mm,
  toEdge: end.edge,
  endMm: end.mm,
})

// ---------------------------------------------------------------------------------------------
// Vertex editing

/**
 * Inserts the midpoint of `edge`. Openings keep their ends: an end on the split edge moves to
 * whichever half it lies on, so an opening across the midpoint now runs over both halves.
 */
export function insertVertex(form: PolygonForm, edge: number): PolygonForm {
  const n = form.vertices.length
  const a = form.vertices[edge]
  const b = form.vertices[(edge + 1) % n]
  if (!a || !b || n >= MAX_VERTICES) return form
  const mid = { xMm: Math.round((a.xMm + b.xMm) / 2), zMm: Math.round((a.zMm + b.zMm) / 2) }
  const length = edgeLengthMm(form.vertices, edge)
  const first = Math.hypot(mid.xMm - a.xMm, mid.zMm - a.zMm)
  const vertices = [...form.vertices.slice(0, edge + 1), mid, ...form.vertices.slice(edge + 1)]
  const second = edgeLengthMm(vertices, edge + 1)
  const move = (end: End, role: 'start' | 'end'): End => {
    if (end.edge < edge) return end
    if (end.edge > edge) return { ...end, edge: end.edge + 1 }
    if (role === 'start' ? end.mm < first : end.mm <= first) return end
    // An end on the far vertex stays exactly on it, whatever the rounding of the midpoint.
    const mm = end.mm >= length - SNAP_MM ? second : Math.max(0, end.mm - first)
    return { edge: edge + 1, mm }
  }
  const openings = form.openings.map((row) => {
    const { start, end } = rowEnds(row)
    return withEnds(row, move(start, 'start'), move(end, 'end'))
  })
  return { ...form, vertices, openings: sortOpenings(openings) }
}

/**
 * Removes a vertex, joining its two edges into one. Openings keep their ends: an end on one of
 * the joined edges keeps its distance from the remaining vertex at that side, and an end on
 * the removed vertex moves to the nearer neighbouring vertex (the other one if the opening
 * would vanish). Openings that still vanish are dropped.
 */
export function deleteVertex(form: PolygonForm, index: number): PolygonForm {
  const n = form.vertices.length
  if (n <= 3 || index < 0 || index >= n) return form
  const before = mod(index - 1, n)
  const vertices = form.vertices.filter((_, i) => i !== index)
  const ring = ringOf(vertices)
  const merged = before > index ? before - 1 : before
  const l1 = edgeLengthMm(form.vertices, before)
  const l2 = edgeLengthMm(form.vertices, index)
  const joined = edgeLengthMm(vertices, merged)
  const reindex = (end: End): End => ({ ...end, edge: end.edge > index ? end.edge - 1 : end.edge })
  // Distance from vertex `before` along the two joined edges; null for an end elsewhere.
  const fromBefore = (end: End) =>
    end.edge === before
      ? clamp(end.mm, 0, l1)
      : end.edge === index
        ? l1 + clamp(end.mm, 0, l2)
        : null
  const keepDistance = (d: number) =>
    d < l1 ? Math.min(d, joined) : Math.max(0, joined - (l1 + l2 - d))
  const proportional = (d: number) => (l1 + l2 > 0 ? (d * joined) / (l1 + l2) : 0)
  const nearer = l1 <= l2 ? 0 : joined
  const attempts: [(d: number) => number, number][] = [
    [keepDistance, nearer],
    [keepDistance, joined - nearer],
    [proportional, nearer],
    [proportional, joined - nearer],
  ]

  const openings = form.openings.flatMap((row): OpeningRow[] => {
    const { start, end } = rowEnds(row)
    const ds = fromBefore(start)
    const de = fromBefore(end)
    if (ds === null && de === null)
      return [{ ...row, edge: reindex(start).edge, toEdge: reindex(end).edge }]
    const place = (d: number | null, e: End, map: (d: number) => number, vertex: number): End =>
      d === null
        ? reindex(e)
        : { edge: merged, mm: Math.abs(d - l1) <= MIN_SPAN_MM ? vertex : map(d) }
    for (const [map, vertex] of attempts) {
      const next = withEnds(row, place(ds, start, map, vertex), place(de, end, map, vertex))
      const stretch = rowStretch(ring, next)
      const forwards = next.edge !== next.toEdge || next.endMm - next.startMm >= MIN_SPAN_MM
      if (stretch && stretch.length >= MIN_SPAN_MM && forwards) return [next]
    }
    return []
  })
  return { ...form, vertices, openings: sortOpenings(openings) }
}

export interface ArcOptions {
  /** 拱高 (sagitta) or radius. */
  mode: 'sagitta' | 'radius'
  valueMm: number
  segments: number
  /** Bulge out of the shop or into it. */
  direction: 'out' | 'in'
}

export type ArcResult = { ok: true; form: PolygonForm } | { ok: false; message: string }

/**
 * Replaces `edge` by `segments` equal chords of a circular arc. An opening end on the edge moves
 * to the same share of the arc, so an opening on the edge now runs over the arc's segments.
 */
export function arcEdge(form: PolygonForm, edge: number, options: ArcOptions): ArcResult {
  const n = form.vertices.length
  const p = form.vertices[edge]
  const q = form.vertices[(edge + 1) % n]
  const segments = Math.round(options.segments)
  if (!p || !q) return { ok: false, message: '请先选择一条边' }
  if (!(segments >= 2 && segments <= MAX_ARC_SEGMENTS))
    return { ok: false, message: `段数须在 2–${MAX_ARC_SEGMENTS} 之间` }
  if (n + segments - 1 > MAX_VERTICES)
    return { ok: false, message: `顶点将超过 ${MAX_VERTICES} 个，请减少段数` }
  const chord = Math.hypot(q.xMm - p.xMm, q.zMm - p.zMm)
  if (chord < MIN_SPAN_MM) return { ok: false, message: '这条边长度为 0，无法改成弧线' }
  if (!(options.valueMm > 0)) return { ok: false, message: '拱高或半径须大于 0' }
  let radius: number
  let sagitta: number
  if (options.mode === 'radius') {
    radius = options.valueMm
    if (radius < chord / 2)
      return { ok: false, message: `半径不能小于弦长的一半（${Math.ceil(chord / 2)} mm）` }
    sagitta = radius - Math.sqrt(radius * radius - (chord * chord) / 4)
  } else {
    sagitta = options.valueMm
    radius = (sagitta * sagitta + (chord * chord) / 4) / (2 * sagitta)
  }
  const dx = (q.xMm - p.xMm) / chord
  const dz = (q.zMm - p.zMm) / chord
  // (dz, -dx) points out of a clockwise ring.
  const sign = (signedAreaMm(form.vertices) >= 0 ? 1 : -1) * (options.direction === 'out' ? 1 : -1)
  const nx = dz * sign
  const nz = -dx * sign
  const mx = (p.xMm + q.xMm) / 2
  const mz = (p.zMm + q.zMm) / 2
  const cx = mx - nx * (radius - sagitta)
  const cz = mz - nz * (radius - sagitta)
  const apex = [mx + nx * sagitta - cx, mz + nz * sagitta - cz] as const
  const start = Math.atan2(p.zMm - cz, p.xMm - cx)
  const half = Math.atan2(chord / 2, radius - sagitta)
  const way = (p.xMm - cx) * apex[1] - (p.zMm - cz) * apex[0] >= 0 ? 1 : -1
  const inner = Array.from({ length: segments - 1 }, (_, k) => {
    const angle = start + (2 * half * way * (k + 1)) / segments
    return {
      xMm: Math.round(cx + radius * Math.cos(angle)) + 0,
      zMm: Math.round(cz + radius * Math.sin(angle)) + 0,
    }
  })
  const vertices = [...form.vertices.slice(0, edge + 1), ...inner, ...form.vertices.slice(edge + 1)]
  const move = (end: End, role: 'start' | 'end'): End => {
    if (end.edge < edge) return end
    if (end.edge > edge) return { ...end, edge: end.edge + segments - 1 }
    const share = clamp(end.mm / chord, 0, 1) * segments
    // On a segment boundary a start goes on the next segment and an end on the previous one.
    const k =
      role === 'start'
        ? Math.min(segments - 1, Math.floor(share + SNAP_MM))
        : Math.max(0, Math.ceil(share - SNAP_MM) - 1)
    const length = edgeLengthMm(vertices, edge + k)
    const local = share - k
    const mm = local >= 1 - SNAP_MM ? length : local <= SNAP_MM ? 0 : roundTo(local * length, 1)
    return { edge: edge + k, mm }
  }
  const openings = form.openings.map((row) => {
    const { start: from, end: to } = rowEnds(row)
    return withEnds(row, move(from, 'start'), move(to, 'end'))
  })
  return { ok: true, form: { ...form, vertices, openings: sortOpenings(openings) } }
}

// ---------------------------------------------------------------------------------------------
// Storefront (entrances and open edges)

/**
 * Consecutive edges `from` → `to` (wrapping), starting `startMm` along the first edge and ending
 * `endMm` along the last one (null: at its far end).
 */
export interface EdgeSelection {
  from: number
  to: number
  startMm: number
  endMm: number | null
}

export function selectionEdges(selection: EdgeSelection, n: number): number[] {
  if (n === 0) return []
  const from = mod(selection.from, n)
  const count = mod(selection.to - from, n) + 1
  return Array.from({ length: count }, (_, k) => (from + k) % n)
}

/** The selected stretch of the boundary; null when the edges do not exist. */
function selectionStretch(ring: Ring, selection: EdgeSelection): Stretch | null {
  const edges = selectionEdges(selection, ring.lengths.length)
  const first = edges[0]
  const last = edges[edges.length - 1]
  if (first === undefined || last === undefined) return null
  const firstLength = ring.lengths[first] ?? 0
  const lastLength = ring.lengths[last] ?? 0
  const startMm = clamp(selection.startMm, 0, firstLength)
  const endMm = clamp(selection.endMm ?? lastLength, 0, lastLength)
  const start = (ring.starts[first] ?? 0) + startMm
  if (edges.length === 1) return { start, length: Math.max(0, endMm - startMm) }
  const middle = edges.slice(1, -1).reduce((sum, e) => sum + (ring.lengths[e] ?? 0), 0)
  return { start, length: firstLength - startMm + middle + endMm }
}

export interface StorefrontResult {
  form: PolygonForm
  /** Pieces of the earlier main entrance outside the selection that went back to wall. */
  replaced: number
  /**
   * Rows written for the selection: one, or more when it is longer than half the perimeter (an
   * opening is read back as the shorter way round between its ends). 0 for `wall`.
   */
  parts: number
}

/**
 * Makes the selected stretch one storefront, written as a single entrance or open edge from
 * the start of the selection to its end, however many edges it runs over; whatever was on the
 * stretch is replaced. A space has one main entrance, so a new one replaces the old (its
 * remaining pieces go back to wall; for example narrowing the default whole-front entrance).
 * `wall` clears the stretch.
 */
export function setStorefront(
  form: PolygonForm,
  selection: EdgeSelection,
  kind: OpeningKind | 'wall',
): StorefrontResult {
  const ring = ringOf(form.vertices)
  const cut = selectionStretch(ring, selection)
  if (!cut || cut.length < MIN_SPAN_MM) return { form, replaced: 0, parts: 0 }
  let rows = form.openings.flatMap((row) => subtractStretch(ring, row, cut))
  const replaced = kind === 'main' ? rows.filter((row) => row.kind === 'main').length : 0
  if (kind === 'main') rows = rows.filter((row) => row.kind !== 'main')
  const added = kind === 'wall' ? [] : rowsFor(ring, cut, { kind })
  return {
    form: { ...form, openings: sortOpenings([...rows, ...added]) },
    replaced,
    parts: added.length,
  }
}

/** Main-entrance rows in boundary order from the start of the storefront, and its pieces. */
function mainChain(form: PolygonForm): { chain: OpeningRow[]; lengths: number[]; pieces: number } {
  const ring = ringOf(form.vertices)
  const rows = form.openings
    .filter((row) => row.kind === 'main')
    .flatMap((row) => {
      const stretch = rowStretch(ring, row)
      return stretch && stretch.length >= MIN_SPAN_MM ? [{ row, stretch }] : []
    })
    .sort((p, q) => p.stretch.start - q.stretch.start)
  const gap = (prev: Stretch, next: Stretch) => {
    const d = mod(next.start - (prev.start + prev.length), ring.perimeter)
    return Math.min(d, ring.perimeter - d)
  }
  const starts = rows.flatMap((item, i) => {
    const prev = rows[mod(i - 1, rows.length)]
    return prev && prev !== item && gap(prev.stretch, item.stretch) <= MIN_SPAN_MM ? [] : [i]
  })
  const first = starts[0] ?? 0
  const ordered = [...rows.slice(first), ...rows.slice(0, first)]
  // A closed ring of main rows has no start but is one piece.
  const pieces = rows.length ? Math.max(1, starts.length) : 0
  return {
    chain: ordered.map((item) => item.row),
    lengths: ordered.map((item) => item.stretch.length),
    pieces,
  }
}

/** A space has at most one continuous main entrance. */
export function mainIsContinuous(form: PolygonForm): boolean {
  return mainChain(form).pieces <= 1
}

/**
 * Main rows with the one at the middle of the storefront first. Normally there is one; a main
 * entrance longer than half the perimeter is written in pieces, and downstream code
 * (mainEntrance, the planner, the plan's 主入口 label) takes the first `main` entrance.
 */
function orderedMain(form: PolygonForm): OpeningRow[] {
  const { chain, lengths } = mainChain(form)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let walked = 0
  const middle = lengths.findIndex((length) => {
    walked += length
    // The tolerance keeps the choice stable when the middle falls on a vertex.
    return walked >= total / 2 - MIN_SPAN_MM
  })
  const head = chain[middle]
  return middle <= 0 || !head ? chain : [head, ...chain.filter((_, i) => i !== middle)]
}

// ---------------------------------------------------------------------------------------------
// Form ⇄ space

type Segment = { a: [number, number]; b: [number, number] }

function endPoint(form: PolygonForm, ring: Ring, end: End): [number, number] {
  const a = form.vertices[end.edge] ?? { xMm: 0, zMm: 0 }
  const b = form.vertices[(end.edge + 1) % form.vertices.length] ?? a
  const p = pointAlong(a, b, clamp(end.mm, 0, ring.lengths[end.edge] ?? 0))
  return point(p.xMm, p.zMm)
}

/**
 * The saved entrances or open edges of a row: one segment from its start to its end (read back
 * as the stretch between them, see shared `openingPieces`), or several for a row longer than
 * half the perimeter. A reversed row is written from its end to its start.
 */
function rowSegments(form: PolygonForm, ring: Ring, row: OpeningRow): Segment[] {
  const stretch = rowStretch(ring, row)
  if (!stretch || stretch.length < MIN_SPAN_MM) return []
  const pieces = shortPieces(ring, stretch)
  const { start, end } = rowEnds(row)
  const segments =
    pieces.length === 1
      ? [{ a: endPoint(form, ring, start), b: endPoint(form, ring, end) }]
      : pieces.map((piece) => ({
          a: endPoint(form, ring, locate(ring, piece.start, 'start')),
          b: endPoint(form, ring, locate(ring, piece.start + piece.length, 'end')),
        }))
  return row.reversed ? segments.reverse().map(({ a, b }) => ({ a: b, b: a })) : segments
}

function obstacleToSpace(row: ObstacleRow) {
  const { xMm: x, zMm: z, wMm: w, dMm: d } = row
  return {
    kind: row.kind,
    label: row.label.trim() || null,
    height: row.heightMm === null ? null : mmToM(row.heightMm),
    polygon: row.polygon ?? [point(x, z), point(x + w, z), point(x + w, z + d), point(x, z + d)],
    ...(row.addedLater ? { addedLater: true } : {}),
  }
}

/**
 * Builds a space; schema errors (too few vertices, bad numbers) surface to the form. Each
 * storefront row becomes one entrance or open edge, also when it runs over several edges; the
 * main entrance comes first.
 */
export function polygonToSpace(form: PolygonForm): ReturnType<typeof SpaceSchema.safeParse> {
  const boundary = form.vertices.map((v) => point(v.xMm, v.zMm))
  const ring = ringOf(form.vertices)
  const of = (rows: readonly OpeningRow[]) => rows.flatMap((row) => rowSegments(form, ring, row))
  const side = sortOpenings(form.openings.filter((r) => r.kind === 'side'))
  const entrances = [
    ...of(orderedMain(form)).map((segment) => ({ ...segment, kind: 'main' as const })),
    ...of(side).map((segment) => ({ ...segment, kind: 'side' as const })),
  ]
  const openEdges = of(sortOpenings(form.openings.filter((r) => r.kind === 'open')))
  const input: SpaceInput = {
    schemaVersion: 1,
    boundary,
    height: mmToM(form.heightMm),
    entrances,
    openEdges,
    obstacles: form.obstacles.map(obstacleToSpace),
  }
  return SpaceSchema.safeParse(input)
}

/** Millimetres from vertex `edge` to the foot of `p` (metres) on that edge, to 0.1 mm. */
function offsetMm(vertices: readonly VertexRow[], edge: number, p: Point): number {
  const a = vertices[edge]
  const b = vertices[(edge + 1) % vertices.length]
  const length = edgeLengthMm(vertices, edge)
  if (!a || !b || length === 0) return 0
  const [x, z] = [p[0] * 1000, p[1] * 1000]
  const t = clamp(
    ((x - a.xMm) * (b.xMm - a.xMm) + (z - a.zMm) * (b.zMm - a.zMm)) / length,
    0,
    length,
  )
  // Ends on a vertex stay exactly on it.
  return length - t < 0.05 ? length : roundTo(t, 1)
}

/**
 * The row of a saved entrance or open edge: shared `openingPieces` gives the stretch it covers
 * (between its ends, the shorter way round), whose first and last piece give the two ends.
 * Null when it is off the boundary.
 */
function openingToRow(
  space: Space,
  vertices: readonly VertexRow[],
  opening: { a: Point; b: Point },
  kind: OpeningKind,
): OpeningRow | null {
  const pieces = openingPieces(space, opening)
  const first = pieces?.[0]
  const last = pieces?.[pieces.length - 1]
  if (!pieces || !first || !last) return null
  // The pieces run from a to b; a row runs in vertex order, so against it the row starts at b.
  const forwards =
    pieces.length === 1
      ? offsetMm(vertices, first.edge, first.a) <= offsetMm(vertices, first.edge, first.b)
      : pieces[1]?.edge === (first.edge + 1) % vertices.length
  const [from, to] = forwards
    ? [
        { edge: first.edge, p: first.a },
        { edge: last.edge, p: last.b },
      ]
    : [
        { edge: last.edge, p: last.b },
        { edge: first.edge, p: first.a },
      ]
  return {
    edge: from.edge,
    startMm: offsetMm(vertices, from.edge, from.p),
    toEdge: to.edge,
    endMm: offsetMm(vertices, to.edge, to.p),
    kind,
    ...(forwards ? {} : { reversed: true }),
  }
}

function isAxisRectangle(polygon: readonly Point[]): boolean {
  if (polygon.length !== 4) return false
  const xs = polygon.map((p) => p[0])
  const zs = polygon.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  if (x1 - x0 <= 0 || z1 - z0 <= 0) return false
  const near = (v: number, w: number) => Math.abs(v - w) < 1e-6
  const corners = polygon.every(
    (p) => (near(p[0], x0) || near(p[0], x1)) && (near(p[1], z0) || near(p[1], z1)),
  )
  // Each side moves along exactly one axis.
  const sides = polygon.every((p, i) => {
    const q = polygon[(i + 1) % 4] ?? p
    return near(p[0], q[0]) !== near(p[1], q[1])
  })
  return corners && sides
}

function obstacleToRow(o: Obstacle): ObstacleRow {
  const xs = o.polygon.map((p) => p[0])
  const zs = o.polygon.map((p) => p[1])
  const x = Math.min(...xs)
  const z = Math.min(...zs)
  return {
    kind: o.kind,
    label: o.label ?? '',
    heightMm: o.height === null ? null : mToMm(o.height),
    xMm: mToMm(x),
    zMm: mToMm(z),
    wMm: mToMm(Math.max(...xs) - x),
    dMm: mToMm(Math.max(...zs) - z),
    polygon: isAxisRectangle(o.polygon) ? null : o.polygon.map((p) => [p[0], p[1]]),
    ...(o.addedLater ? { addedLater: true } : {}),
  }
}

/** Entrances and open edges of a space that lie off its boundary and cannot be edited. */
export function unmappedOpenings(space: Space): number {
  return [...space.entrances, ...space.openEdges].filter((e) => !openingPieces(space, e)).length
}

/**
 * Opens an existing space for editing without losing anything the form can hold: each entrance
 * or open edge is one row, also when it runs over several edges, and keeps its direction;
 * obstacles keep their kind and height, and non-rectangular obstacles keep their outline.
 */
export function spaceToPolygonForm(space: Space): PolygonForm {
  const vertices = space.boundary.map(([x, z]) => ({ xMm: mToMm(x), zMm: mToMm(z) }))
  const rows = (opening: { a: Point; b: Point }, kind: OpeningKind): OpeningRow[] => {
    const row = openingToRow(space, vertices, opening, kind)
    return row ? [row] : []
  }
  const openings = [
    ...space.entrances.flatMap((e) => rows(e, e.kind)),
    ...space.openEdges.flatMap((e) => rows(e, 'open')),
  ]
  return {
    vertices,
    heightMm: mToMm(space.height),
    openings: sortOpenings(openings),
    obstacles: space.obstacles.map(obstacleToRow),
  }
}

// ---------------------------------------------------------------------------------------------
// Warnings that do not block saving

/** 边 2 上的次入口, or 边 3 → 边 6 的主入口, for warnings. */
function openingName(row: OpeningRow): string {
  const kind = OPENING_KIND_LABELS[row.kind]
  return row.edge === row.toEdge
    ? `边 ${row.edge + 1} 上的${kind}`
    : `边 ${row.edge + 1} → 边 ${row.toEdge + 1} 的${kind}`
}

/**
 * Short and zero-length edges, a broken main storefront, openings that do not fit or overlap,
 * and openings longer than half the perimeter (saved in pieces).
 */
export function formWarnings(form: PolygonForm): string[] {
  const n = form.vertices.length
  const ring = ringOf(form.vertices)
  const warnings: string[] = []
  form.vertices.forEach((_, i) => {
    const length = edgeLengthMm(form.vertices, i)
    if (length < MIN_SPAN_MM)
      warnings.push(`边 ${i + 1} 长度为 0（顶点 ${i + 1} 与顶点 ${((i + 1) % n) + 1} 重合）`)
    else if (length < SHORT_EDGE_MM)
      warnings.push(
        `边 ${i + 1} 只有 ${Math.round(length)} mm，短于 0.3 m，请确认不是墙厚造成的锯齿`,
      )
  })
  if (!mainIsContinuous(form))
    warnings.push('主入口不连续：一个空间只能有一段连续的主入口，请把其余段改为次入口')
  const placed: { name: string; stretch: Stretch }[] = []
  for (const row of sortOpenings(form.openings)) {
    const name = openingName(row)
    const missing = [row.edge, row.toEdge].find((edge) => !validEdge(ring, edge))
    const stretch = rowStretch(ring, row)
    if (missing !== undefined || !stretch) {
      warnings.push(`店面所在的边 ${(missing ?? row.edge) + 1} 已不存在，已忽略`)
      continue
    }
    if (stretch.length < MIN_SPAN_MM) {
      warnings.push(`${name}长度为 0，已忽略`)
      continue
    }
    const outside = (edge: number, mm: number) =>
      mm < 0 || mm > (ring.lengths[edge] ?? 0) + MIN_SPAN_MM
    if (outside(row.edge, row.startMm) || outside(row.toEdge, row.endMm))
      warnings.push(
        row.edge === row.toEdge
          ? `${name}超出这条边，已截到边内`
          : `${name}起点或终点超出所在的边，已截到边内`,
      )
    const parts = shortPieces(ring, stretch).length
    if (parts > 1)
      warnings.push(
        `${name}超过周长的一半，保存时拆成 ${parts} 段（一段店面只按两端之间较短的一侧理解）`,
      )
    for (const other of placed)
      if (overlapMm(ring, other.stretch, stretch) > MIN_SPAN_MM)
        warnings.push(`${other.name}与${name}互相重叠`)
    placed.push({ name, stretch })
  }
  return warnings
}
