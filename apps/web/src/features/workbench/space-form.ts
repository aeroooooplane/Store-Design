import { SpaceSchema, distance, distanceToSegment, mmToM, mToMm } from '@store/shared'
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

export interface OpeningRow {
  /** Index of the boundary edge (from vertex i to vertex i + 1). */
  edge: number
  /** Opening start and end, measured along the edge from its first vertex. */
  startMm: number
  endMm: number
  kind: OpeningKind
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
/** How far an entrance end may lie from the boundary to still count as on it (schema: 0.02 m). */
const ON_EDGE_M = 0.02

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
    openings: edge < 0 ? [] : [{ edge, startMm: start, endMm: start + opening, kind: 'main' }],
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
        : [{ edge: front, startMm: 0, endMm: edgeLengthMm(vertices, front), kind: 'main' }],
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
// Vertex editing

/** Inserts the midpoint of `edge`; openings on it are split over the two halves. */
export function insertVertex(form: PolygonForm, edge: number): PolygonForm {
  const n = form.vertices.length
  const a = form.vertices[edge]
  const b = form.vertices[(edge + 1) % n]
  if (!a || !b || n >= MAX_VERTICES) return form
  const mid = { xMm: Math.round((a.xMm + b.xMm) / 2), zMm: Math.round((a.zMm + b.zMm) / 2) }
  const first = Math.hypot(mid.xMm - a.xMm, mid.zMm - a.zMm)
  const vertices = [...form.vertices.slice(0, edge + 1), mid, ...form.vertices.slice(edge + 1)]
  const openings = form.openings.flatMap((row): OpeningRow[] => {
    if (row.edge < edge) return [row]
    if (row.edge > edge) return [{ ...row, edge: row.edge + 1 }]
    const parts: OpeningRow[] = []
    if (row.startMm < first - MIN_SPAN_MM) parts.push({ ...row, endMm: Math.min(row.endMm, first) })
    if (row.endMm > first + MIN_SPAN_MM)
      parts.push({
        ...row,
        edge: edge + 1,
        startMm: Math.max(row.startMm, first) - first,
        endMm: row.endMm - first,
      })
    return parts
  })
  return { ...form, vertices, openings: sortOpenings(openings) }
}

/** Removes a vertex; only the openings on its two edges go, the others follow their edges. */
export function deleteVertex(form: PolygonForm, index: number): PolygonForm {
  const n = form.vertices.length
  if (n <= 3 || index < 0 || index >= n) return form
  const before = mod(index - 1, n)
  const openings = form.openings.flatMap((row) => {
    if (row.edge === before || row.edge === index) return []
    return [{ ...row, edge: row.edge > index ? row.edge - 1 : row.edge }]
  })
  return { ...form, vertices: form.vertices.filter((_, i) => i !== index), openings }
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
 * Replaces `edge` by `segments` equal chords of a circular arc. Openings on the edge are spread
 * over the new segments by their share of the chord.
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
  const openings = form.openings.flatMap((row): OpeningRow[] => {
    if (row.edge < edge) return [row]
    if (row.edge > edge) return [{ ...row, edge: row.edge + segments - 1 }]
    const from = clamp(row.startMm / chord, 0, 1)
    const to = clamp(row.endMm / chord, 0, 1)
    return Array.from({ length: segments }, (_, k): OpeningRow[] => {
      const lo = Math.max(from, k / segments)
      const hi = Math.min(to, (k + 1) / segments)
      const length = edgeLengthMm(vertices, edge + k)
      const startMm = Math.round((lo - k / segments) * segments * length)
      const endMm = Math.round((hi - k / segments) * segments * length)
      return endMm - startMm >= MIN_SPAN_MM ? [{ ...row, edge: edge + k, startMm, endMm }] : []
    }).flat()
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

export interface Span {
  edge: number
  startMm: number
  endMm: number
}

/** The selection as one span per edge; empty when it has no length. */
export function selectionSpans(vertices: readonly VertexRow[], selection: EdgeSelection): Span[] {
  const edges = selectionEdges(selection, vertices.length)
  return edges
    .map((edge, k) => {
      const length = edgeLengthMm(vertices, edge)
      const startMm = k === 0 ? clamp(selection.startMm, 0, length) : 0
      const endMm = k === edges.length - 1 ? clamp(selection.endMm ?? length, 0, length) : length
      return { edge, startMm, endMm }
    })
    .filter((s) => s.endMm - s.startMm >= MIN_SPAN_MM)
}

function subtractSpan(row: OpeningRow, span: Span): OpeningRow[] {
  if (row.edge !== span.edge || row.endMm <= span.startMm || row.startMm >= span.endMm) return [row]
  return [
    { ...row, endMm: span.startMm },
    { ...row, startMm: span.endMm },
  ].filter((r) => r.endMm - r.startMm >= MIN_SPAN_MM)
}

export interface StorefrontResult {
  form: PolygonForm
  /** Earlier main entrance segments outside the selection that went back to wall. */
  replaced: number
}

/**
 * Makes the selected stretch one storefront: whatever was on it is replaced, one row per edge.
 * A space has one continuous main entrance, so a new main entrance replaces the old one (its
 * remaining segments go back to wall; for example narrowing the default whole-front entrance).
 * `wall` clears the stretch.
 */
export function setStorefront(
  form: PolygonForm,
  selection: EdgeSelection,
  kind: OpeningKind | 'wall',
): StorefrontResult {
  const spans = selectionSpans(form.vertices, selection)
  if (!spans.length) return { form, replaced: 0 }
  let rows = form.openings
  for (const span of spans) rows = rows.flatMap((row) => subtractSpan(row, span))
  const replaced = kind === 'main' ? rows.filter((row) => row.kind === 'main').length : 0
  if (kind === 'main') rows = rows.filter((row) => row.kind !== 'main')
  const added = kind === 'wall' ? [] : spans.map((span) => ({ ...span, kind }))
  return { form: { ...form, openings: sortOpenings([...rows, ...added]) }, replaced }
}

/** True when `next` continues `prev` along the boundary without a gap. */
function joins(vertices: readonly VertexRow[], prev: OpeningRow, next: OpeningRow): boolean {
  if (prev === next) return false
  if (prev.edge === next.edge) return Math.abs(prev.endMm - next.startMm) <= MIN_SPAN_MM
  return (
    next.edge === (prev.edge + 1) % vertices.length &&
    prev.endMm >= edgeLengthMm(vertices, prev.edge) - MIN_SPAN_MM &&
    next.startMm <= MIN_SPAN_MM
  )
}

/** Main-entrance rows in boundary order from the start of the storefront, and its pieces. */
function mainChain(form: PolygonForm): { chain: OpeningRow[]; pieces: number } {
  const rows = sortOpenings(form.openings.filter((r) => r.kind === 'main'))
  const starts = rows.flatMap((row, i) =>
    joins(form.vertices, rows[mod(i - 1, rows.length)] ?? row, row) ? [] : [i],
  )
  const first = starts[0] ?? 0
  // A closed ring of main segments has no start but is one piece.
  const pieces = rows.length ? Math.max(1, starts.length) : 0
  return { chain: [...rows.slice(first), ...rows.slice(0, first)], pieces }
}

/** A space has at most one continuous main entrance. */
export function mainIsContinuous(form: PolygonForm): boolean {
  return mainChain(form).pieces <= 1
}

/**
 * Main segments with the one at the middle of the storefront first: downstream code
 * (mainEntrance, the planner, the plan's 主入口 label) takes the first `main` entrance for the
 * entrance position and direction, and the middle segment of a curved storefront faces the
 * right way.
 */
function orderedMain(form: PolygonForm): OpeningRow[] {
  const { chain } = mainChain(form)
  const total = chain.reduce((sum, r) => sum + (r.endMm - r.startMm), 0)
  let walked = 0
  const middle = chain.findIndex((r) => {
    walked += r.endMm - r.startMm
    // The tolerance keeps the choice stable when the middle falls on a vertex.
    return walked >= total / 2 - MIN_SPAN_MM
  })
  const head = chain[middle]
  return middle <= 0 || !head ? chain : [head, ...chain.filter((_, i) => i !== middle)]
}

// ---------------------------------------------------------------------------------------------
// Form ⇄ space

function openingSegment(
  form: PolygonForm,
  row: OpeningRow,
): { a: [number, number]; b: [number, number] } | null {
  const a = form.vertices[row.edge]
  const b = form.vertices[(row.edge + 1) % form.vertices.length]
  if (!a || !b) return null
  const length = edgeLengthMm(form.vertices, row.edge)
  const start = clamp(Math.min(row.startMm, row.endMm), 0, length)
  const end = clamp(Math.max(row.startMm, row.endMm), 0, length)
  if (end - start < MIN_SPAN_MM) return null
  const p = pointAlong(a, b, start)
  const q = pointAlong(a, b, end)
  return { a: point(p.xMm, p.zMm), b: point(q.xMm, q.zMm) }
}

function obstacleToSpace(row: ObstacleRow) {
  const { xMm: x, zMm: z, wMm: w, dMm: d } = row
  return {
    kind: row.kind,
    label: row.label.trim() || null,
    height: row.heightMm === null ? null : mmToM(row.heightMm),
    polygon: row.polygon ?? [point(x, z), point(x + w, z), point(x + w, z + d), point(x, z + d)],
  }
}

/**
 * Builds a space; schema errors (too few vertices, bad numbers) surface to the form. Each
 * storefront row becomes one entrance or open edge; every segment of the main storefront is
 * `main`, the middle one first (see orderedMain).
 */
export function polygonToSpace(form: PolygonForm): ReturnType<typeof SpaceSchema.safeParse> {
  const boundary = form.vertices.map((v) => point(v.xMm, v.zMm))
  const side = sortOpenings(form.openings.filter((r) => r.kind === 'side'))
  const entrances = [...orderedMain(form), ...side].flatMap((row) => {
    const segment = openingSegment(form, row)
    return segment ? [{ ...segment, kind: row.kind === 'main' ? 'main' : 'side' } as const] : []
  })
  const openEdges = sortOpenings(form.openings.filter((r) => r.kind === 'open')).flatMap((row) => {
    const segment = openingSegment(form, row)
    return segment ? [segment] : []
  })
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

/** Millimetres from `a` to the foot of `p` on segment a–b. */
function offsetMm(a: Point, b: Point, p: Point): number {
  const length = distance(a, b)
  if (length === 0) return 0
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length
  return mToMm(clamp(t, 0, length))
}

/** Nearest boundary edge within the on-boundary tolerance, and the position along it. */
function locateOnBoundary(boundary: readonly Point[], p: Point) {
  let best: { edge: number; mm: number; d: number } | null = null
  for (let edge = 0; edge < boundary.length; edge++) {
    const a = boundary[edge]
    const b = boundary[(edge + 1) % boundary.length]
    if (!a || !b) continue
    const d = distanceToSegment(p, a, b)
    if (d <= ON_EDGE_M && (!best || d < best.d - 1e-9)) best = { edge, mm: offsetMm(a, b, p), d }
  }
  return best
}

/**
 * Splits a boundary segment (an entrance or open edge) into one span per edge, following the
 * boundary the short way round from `a` to `b`. Null when an end is off the boundary.
 */
export function splitAlongBoundary(boundary: readonly Point[], a: Point, b: Point): Span[] | null {
  const n = boundary.length
  // Both ends on one edge: a single span, whatever the direction.
  for (let edge = 0; edge < n; edge++) {
    const p = boundary[edge]
    const q = boundary[(edge + 1) % n]
    if (!p || !q) continue
    if (distanceToSegment(a, p, q) <= ON_EDGE_M && distanceToSegment(b, p, q) <= ON_EDGE_M) {
      const s = offsetMm(p, q, a)
      const t = offsetMm(p, q, b)
      return [{ edge, startMm: Math.min(s, t), endMm: Math.max(s, t) }]
    }
  }
  const from = locateOnBoundary(boundary, a)
  const to = locateOnBoundary(boundary, b)
  if (!from || !to) return null
  const lengths = boundary.map((p, i) => mToMm(distance(p, boundary[(i + 1) % n] ?? p)))
  const walk = (s: { edge: number; mm: number }, e: { edge: number; mm: number }): Span[] => {
    const spans: Span[] = []
    for (let k = 0, edge = s.edge; k < n; k++, edge = (edge + 1) % n) {
      const startMm = edge === s.edge ? s.mm : 0
      const endMm = edge === e.edge ? e.mm : (lengths[edge] ?? 0)
      spans.push({ edge, startMm, endMm })
      if (edge === e.edge) break
    }
    return spans.filter((span) => span.endMm - span.startMm >= MIN_SPAN_MM)
  }
  const forward = walk(from, to)
  const backward = walk(to, from)
  const total = (spans: Span[]) => spans.reduce((sum, s) => sum + s.endMm - s.startMm, 0)
  return total(forward) <= total(backward) ? forward : backward
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
  }
}

/** Entrances and open edges of a space that lie off its boundary and cannot be edited. */
export function unmappedOpenings(space: Space): number {
  return [...space.entrances, ...space.openEdges].filter(
    (e) => !splitAlongBoundary(space.boundary, e.a, e.b),
  ).length
}

/**
 * Opens an existing space for editing without losing anything the form can hold: entrances
 * spanning several edges are split per edge, open edges are kept, obstacles keep their kind and
 * height, and non-rectangular obstacles keep their outline.
 */
export function spaceToPolygonForm(space: Space): PolygonForm {
  const vertices = space.boundary.map(([x, z]) => ({ xMm: mToMm(x), zMm: mToMm(z) }))
  const rows = (a: Point, b: Point, kind: OpeningKind): OpeningRow[] =>
    (splitAlongBoundary(space.boundary, a, b) ?? []).map((span) => ({ ...span, kind }))
  const openings = [
    ...space.entrances.flatMap((e) => rows(e.a, e.b, e.kind)),
    ...space.openEdges.flatMap((e) => rows(e.a, e.b, 'open')),
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

/** Short and zero-length edges, a broken main storefront, and openings that do not fit. */
export function formWarnings(form: PolygonForm): string[] {
  const n = form.vertices.length
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
  const rows = sortOpenings(form.openings)
  rows.forEach((row, i) => {
    const name = `边 ${row.edge + 1} 上的${OPENING_KIND_LABELS[row.kind]}`
    const length = edgeLengthMm(form.vertices, row.edge)
    if (row.edge >= n) warnings.push(`店面所在的边 ${row.edge + 1} 已不存在，已忽略`)
    else if (Math.min(row.endMm, length) - Math.max(row.startMm, 0) < MIN_SPAN_MM)
      warnings.push(`${name}长度为 0，已忽略`)
    else if (row.endMm > length + MIN_SPAN_MM || row.startMm < 0)
      warnings.push(`${name}超出这条边，已截到边内`)
    const next = rows[i + 1]
    if (next && next.edge === row.edge && next.startMm < row.endMm - MIN_SPAN_MM)
      warnings.push(`边 ${row.edge + 1} 上的店面互相重叠`)
  })
  return warnings
}
