import { isSimplePolygon } from '@store/shared'
import type { Box, Line } from './lines.ts'

/**
 * The shop's outline as any polygon (corners, slanted walls, arcs drawn as polylines), found on
 * a raster of the drawing's lines: the shop floor is a region of blank paper the walls close
 * in. The region that holds most prop boxes, smallest first, is the shop; its holes (the props)
 * are filled and props standing against a wall are taken back in, so the outline runs along the
 * walls rather than round the cabinets. Pixels in, pixels out.
 */

/** Pixels per raster cell. */
export const CELL_PX = 2
/** Regions larger than this share of the page are the sheet, not a shop. */
const MAX_PAGE_SHARE = 0.5
/** Douglas–Peucker tolerances tried in turn, in cells, until the outline is a simple polygon. */
const SIMPLIFY_CELLS = [2, 3, 5]
/** Corners whose removal changes the outline by less than this area (m²) are dropped. */
const MINOR_CORNER_M2 = 0.01
/** Pixels per metre assumed when no sized prop told the drawing's scale (about 1:50 at 2400 px). */
const DEFAULT_PX_PER_M = 200
/** Spikes and slivers thinner than about twice this (cells) are smoothed off the outline. */
const OPEN_CELLS = 2
/** Edges within this many degrees of an axis are made straight (as the planner does). */
const NEAR_AXIS_DEG = 3

export type PxPoint = [number, number]

export interface Grid {
  w: number
  h: number
  /** 1 where a line is drawn. */
  ink: Uint8Array
}

/**
 * Lines drawn on a raster, each grown by `grow` cells on every side: dashed lease lines and
 * walls drawn in short pieces close up, so the floor does not leak out through their gaps.
 */
export function rasterise(width: number, height: number, lines: readonly Line[], grow = 0): Grid {
  const w = Math.ceil(width / CELL_PX) + 2
  const h = Math.ceil(height / CELL_PX) + 2
  const ink = new Uint8Array(w * h)
  for (const l of lines) {
    const x1 = l.x1 / CELL_PX + 1
    const y1 = l.y1 / CELL_PX + 1
    const x2 = l.x2 / CELL_PX + 1
    const y2 = l.y2 / CELL_PX + 1
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2))
    for (let k = 0; k <= steps; k++) {
      const x = Math.floor(x1 + ((x2 - x1) * k) / steps)
      const y = Math.floor(y1 + ((y2 - y1) * k) / steps)
      if (x >= 0 && y >= 0 && x < w && y < h) ink[y * w + x] = 1
    }
  }
  if (grow > 0) {
    const grown = new Uint8Array(ink)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink[y * w + x]) continue
        for (let dy = -grow; dy <= grow; dy++) {
          for (let dx = -grow; dx <= grow; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = 1
          }
        }
      }
    }
    return { w, h, ink: grown }
  }
  return { w, h, ink }
}

export interface Component {
  id: number
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  border: boolean
}

/** Blank cells joined edge to edge, labelled 1, 2, …; ink cells stay 0. */
export function label(grid: Grid): { labels: Int32Array; components: Component[] } {
  const { w, h, ink } = grid
  const labels = new Int32Array(w * h)
  const components: Component[] = []
  const queue = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (ink[start] || labels[start]) continue
    const id = components.length + 1
    const c: Component = { id, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, border: false }
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = id
    while (head < tail) {
      const cell = queue[head++] ?? 0
      const x = cell % w
      const y = (cell - x) / w
      c.area++
      if (x < c.minX) c.minX = x
      if (y < c.minY) c.minY = y
      if (x > c.maxX) c.maxX = x
      if (y > c.maxY) c.maxY = y
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true
      for (const next of [cell - 1, cell + 1, cell - w, cell + w]) {
        if (next < 0 || next >= w * h) continue
        if (Math.abs((next % w) - x) > 1) continue
        if (ink[next] || labels[next]) continue
        labels[next] = id
        queue[tail++] = next
      }
    }
    components.push(c)
  }
  return { labels, components }
}

/**
 * Cells inside a set's outer outline, within the bounding box: everything a flood from the box's
 * edge cannot reach without crossing the set.
 */
function fillOutline(grid: Grid, member: (cell: number) => boolean, box: Component): Uint8Array {
  const { w, h } = grid
  const x0 = Math.max(0, box.minX - 1)
  const y0 = Math.max(0, box.minY - 1)
  const x1 = Math.min(w - 1, box.maxX + 1)
  const y1 = Math.min(h - 1, box.maxY + 1)
  const outside = new Uint8Array(w * h)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    const cell = y * w + x
    if (outside[cell] || member(cell)) return
    outside[cell] = 1
    queue.push(cell)
  }
  for (let x = x0; x <= x1; x++) {
    push(x, y0)
    push(x, y1)
  }
  for (let y = y0; y <= y1; y++) {
    push(x0, y)
    push(x1, y)
  }
  while (queue.length) {
    const cell = queue.pop() ?? 0
    const x = cell % w
    const y = (cell - x) / w
    if (x > x0) push(x - 1, y)
    if (x < x1) push(x + 1, y)
    if (y > y0) push(x, y - 1)
    if (y < y1) push(x, y + 1)
  }
  const inside = new Uint8Array(w * h)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (!outside[y * w + x]) inside[y * w + x] = 1
  return inside
}

/**
 * The outer outline of a filled set of cells, as cell-corner points: every cell side between a
 * filled and an empty cell becomes an edge with the filled cell on its right, the edges are
 * chained end to start, and the longest ring wins (the outer one).
 */
function traceOutline(grid: Grid, inside: Uint8Array): PxPoint[] {
  const { w, h } = grid
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x] === 1
  const key = (x: number, y: number) => y * (w + 1) + x
  const next = new Map<number, number[]>()
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay)
    const list = next.get(k)
    if (list) list.push(key(bx, by))
    else next.set(k, [key(bx, by)])
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue
      if (!filled(x, y - 1)) add(x, y, x + 1, y)
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!filled(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const point = (k: number): PxPoint => [k % (w + 1), Math.floor(k / (w + 1))]
  let best: PxPoint[] = []
  let bestArea = 0
  for (const [startKey, list] of next) {
    while (list.length) {
      const ring: PxPoint[] = [point(startKey)]
      let at = list.pop() as number
      let guard = 0
      while (at !== startKey && guard++ < w * h * 4) {
        ring.push(point(at))
        const outs = next.get(at)
        if (!outs?.length) break
        at = outs.pop() as number
      }
      const area = ringArea(ring)
      if (area > bestArea) {
        bestArea = area
        best = ring
      }
    }
  }
  return best
}

/** Douglas–Peucker on a closed ring. */
function simplify(points: PxPoint[], epsilon: number): PxPoint[] {
  if (points.length < 4) return points
  const dist = (p: PxPoint, a: PxPoint, b: PxPoint) => {
    const vx = b[0] - a[0]
    const vy = b[1] - a[1]
    const len = Math.hypot(vx, vy) || 1
    return Math.abs((p[0] - a[0]) * vy - (p[1] - a[1]) * vx) / len
  }
  const rec = (pts: PxPoint[]): PxPoint[] => {
    if (pts.length < 3) return pts
    const a = pts[0] as PxPoint
    const b = pts[pts.length - 1] as PxPoint
    let best = 0
    let index = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dist(pts[i] as PxPoint, a, b)
      if (d > best) {
        best = d
        index = i
      }
    }
    if (best <= epsilon) return [a, b]
    return [...rec(pts.slice(0, index + 1)).slice(0, -1), ...rec(pts.slice(index))]
  }
  // Split the ring at its farthest point from the first, simplify both halves.
  const first = points[0] as PxPoint
  let far = 0
  points.forEach((p, i) => {
    if (
      Math.hypot(p[0] - first[0], p[1] - first[1]) >
      Math.hypot(points[far]![0] - first[0], points[far]![1] - first[1])
    )
      far = i
  })
  const a = rec(points.slice(0, far + 1))
  const b = rec([...points.slice(far), first])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

/** How far (px) a traced corner moves onto the drawn lines it stands next to. */
const SNAP_PX = CELL_PX * 3

/**
 * A traced corner put back on the drawing: the raster leaves the outline a cell inside the wall
 * line, so each corner moves to where two nearby lines cross, else onto the nearest line.
 */
function snapToLines(p: PxPoint, lines: readonly Line[]): PxPoint {
  const near = lines.filter((l) => {
    if (Math.min(l.x1, l.x2) - SNAP_PX > p[0] || Math.max(l.x1, l.x2) + SNAP_PX < p[0]) return false
    if (Math.min(l.y1, l.y2) - SNAP_PX > p[1] || Math.max(l.y1, l.y2) + SNAP_PX < p[1]) return false
    return segmentDistance(p, l) <= SNAP_PX
  })
  let best: { q: PxPoint; d: number } | null = null
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const q = crossing(near[i] as Line, near[j] as Line)
      if (!q) continue
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d <= SNAP_PX && (!best || d < best.d)) best = { q, d }
    }
  }
  if (best) return best.q
  let onLine: { q: PxPoint; d: number } | null = null
  for (const l of near) {
    const q = nearestOn(p, l)
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (!onLine || d < onLine.d) onLine = { q, d }
  }
  return onLine?.q ?? p
}

function nearestOn(p: PxPoint, l: Line): PxPoint {
  const dx = l.x2 - l.x1
  const dy = l.y2 - l.y1
  const len = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - l.x1) * dx + (p[1] - l.y1) * dy) / len))
  return [l.x1 + dx * t, l.y1 + dy * t]
}

const segmentDistance = (p: PxPoint, l: Line) => {
  const q = nearestOn(p, l)
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

/** Where two lines (extended a little) cross, if they are not nearly parallel. */
function crossing(a: Line, b: Line): PxPoint | null {
  const rx = a.x2 - a.x1
  const ry = a.y2 - a.y1
  const sx = b.x2 - b.x1
  const sy = b.y2 - b.y1
  const denom = rx * sy - ry * sx
  const lens = Math.hypot(rx, ry) * Math.hypot(sx, sy)
  if (!lens || Math.abs(denom) / lens < Math.sin((10 * Math.PI) / 180)) return null
  const t = ((b.x1 - a.x1) * sy - (b.y1 - a.y1) * sx) / denom
  return [a.x1 + rx * t, a.y1 + ry * t]
}

/** Edges within NEAR_AXIS_DEG of an axis made exactly straight, by moving their ends. */
function straighten(points: PxPoint[]): PxPoint[] {
  const tan = Math.tan((NEAR_AXIS_DEG * Math.PI) / 180)
  const out = points.map((p) => [...p] as PxPoint)
  const n = out.length
  for (let i = 0; i < n; i++) {
    const a = out[i] as PxPoint
    const b = out[(i + 1) % n] as PxPoint
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    if (Math.abs(dy) <= Math.abs(dx) * tan) {
      const y = (a[1] + b[1]) / 2
      a[1] = y
      b[1] = y
    } else if (Math.abs(dx) <= Math.abs(dy) * tan) {
      const x = (a[0] + b[0]) / 2
      a[0] = x
      b[0] = x
    }
  }
  return out
}

/** Shoelace area of a ring, in the ring's units squared. */
export function ringArea(points: readonly PxPoint[]): number {
  let s = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as PxPoint
    s += p[0] * q[1] - q[0] * p[1]
  })
  return Math.abs(s) / 2
}

/** Whether a point lies inside a ring (even–odd). */
export function inRing(p: PxPoint, ring: readonly PxPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as PxPoint
    const b = ring[j] as PxPoint
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

export interface RegionHints {
  /** The shop area in px², when a scale was found without the boundary. */
  expectedArea?: number | null
  /** Pixels a 0.25 m thin wall strip is at most (to tell wall bodies from cabinets). */
  thinPx?: number | null
  /** Pixels per metre, roughly (from sized prop names), to judge which corners matter. */
  pxPerM?: number | null
  /** Points (the title block) a shop never holds. */
  avoid?: readonly PxPoint[]
}

/**
 * Cells the lines are grown by, closing dashed lines and walls drawn in pieces; more is tried
 * in turn when nothing closes (a storefront drawn with long dashes).
 */
const GROW_STEPS = [2, 4, 6]

/**
 * The shop outline as a polygon in pixels, or null when no closed region holds the props.
 *
 * The paper round the shop is one blank region (the background: the one touching the page edge,
 * or a region spread over most of the sheet inside its frame). The shop is the hole in it that
 * holds most prop boxes: its floor, rooms, cabinets and walls together, however the lines cut
 * them up. Thin strips on the hole's edge (dimension chains, a storefront band) are peeled off.
 */
export function findRegion(
  width: number,
  height: number,
  lines: readonly Line[],
  anchors: readonly Box[],
  hints: RegionHints = {},
): PxPoint[] | null {
  if (anchors.length < 2) return null
  for (const grow of GROW_STEPS) {
    const found = regionWithGrowth(width, height, lines, anchors, hints, grow)
    if (found) return found
  }
  return null
}

function regionWithGrowth(
  width: number,
  height: number,
  lines: readonly Line[],
  anchors: readonly Box[],
  hints: RegionHints,
  grow: number,
): PxPoint[] | null {
  const grid = rasterise(width, height, lines, grow)
  const { labels, components } = label(grid)
  const { w, h } = grid
  const pageCells = w * h
  const cellOf = (x: number, y: number) =>
    Math.floor(y / CELL_PX + 1) * w + Math.floor(x / CELL_PX + 1)
  const span = (c: Component) => (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1)
  // The background: blank paper reaching the page edge, or spread over most of the sheet.
  const background = new Set(
    components.filter((c) => c.border || span(c) >= pageCells * 0.6).map((c) => c.id),
  )
  if (!background.size) return null
  const outside = (cell: number) => background.has(labels[cell] ?? 0)
  // Holes: everything not background, joined edge to edge.
  const hole = new Int32Array(pageCells)
  const holes: { id: number; cells: number[] }[] = []
  for (let start = 0; start < pageCells; start++) {
    if (hole[start] || outside(start)) continue
    const id = holes.length + 1
    const cells: number[] = []
    const stack = [start]
    hole[start] = id
    while (stack.length) {
      const cell = stack.pop() as number
      cells.push(cell)
      const x = cell % w
      for (const next of [cell - 1, cell + 1, cell - w, cell + w]) {
        if (next < 0 || next >= pageCells || Math.abs((next % w) - x) > 1) continue
        if (hole[next] || outside(next)) continue
        hole[next] = id
        stack.push(next)
      }
    }
    holes.push({ id, cells })
  }
  const centres = anchors.map((b): PxPoint => [b.x + b.w / 2, b.y + b.h / 2])
  /**
   * A cell of a hole that holds a prop. A prop drawn as a closed box (a table symbol) has its
   * own blank inside, so the box's centre is in another hole; the floor round the box tells
   * instead.
   */
  const cellsAround = (b: Box): number[] => {
    const cells = [cellOf(b.x + b.w / 2, b.y + b.h / 2)]
    const step = CELL_PX * 2
    for (let x = b.x; x <= b.x + b.w; x += step) {
      cells.push(cellOf(x, b.y - CELL_PX), cellOf(x, b.y + b.h + CELL_PX))
    }
    for (let y = b.y; y <= b.y + b.h; y += step) {
      cells.push(cellOf(b.x - CELL_PX, y), cellOf(b.x + b.w + CELL_PX, y))
    }
    return cells
  }
  const heldCell = (id: number, b: Box): number | null => {
    const cells = cellsAround(b)
    const hits = cells.filter((cell) => hole[cell] === id)
    return hits.length >= cells.length * 0.3 ? (hits[0] ?? null) : null
  }
  const holds = (id: number, b: Box) => heldCell(id, b) !== null
  const needed = Math.max(2, Math.ceil(anchors.length * 0.6))
  const avoid = (hints.avoid ?? []).map(([x, y]) => cellOf(x, y))
  const expected = hints.expectedArea ?? null
  const thinCells = (hints.thinPx ?? Math.max(width, height) * 0.01) / CELL_PX
  let best: { id: number; cells: number[]; held: number; fits: boolean } | null = null
  // The stated area only ranks the candidates: the scale it comes from may itself be wrong.
  const fitsArea = (cells: number) =>
    expected === null ||
    (cells * CELL_PX * CELL_PX <= expected * 1.5 && cells * CELL_PX * CELL_PX * 1.5 >= expected)
  for (const candidate of holes) {
    if (candidate.cells.length >= pageCells * MAX_PAGE_SHARE) continue
    const heldBoxes = anchors.filter((b) => holds(candidate.id, b))
    const held = heldBoxes.length
    if (held < needed) continue
    // The props it holds fit in it: a region smaller than their boxes together is one of them
    // (or the band between dimension lines round them).
    const propsPx = heldBoxes.reduce((sum, b) => sum + b.w * b.h, 0)
    if (candidate.cells.length * CELL_PX * CELL_PX < propsPx) continue
    // Nor is a shop a strip (the band between two dimension lines): at least two walls' worth
    // thick on average (area over half the outline).
    let edge = 0
    for (const cell of candidate.cells) {
      if (
        hole[cell - 1] !== candidate.id ||
        hole[cell + 1] !== candidate.id ||
        hole[cell - w] !== candidate.id ||
        hole[cell + w] !== candidate.id
      )
        edge++
    }
    if (edge && (2 * candidate.cells.length) / edge < thinCells * 2) continue
    if (avoid.some((cell) => hole[cell] === candidate.id)) continue
    const fits = fitsArea(candidate.cells.length)
    if (
      !best ||
      held > best.held ||
      (held === best.held && fits && !best.fits) ||
      (held === best.held && fits === best.fits && candidate.cells.length < best.cells.length)
    )
      best = { ...candidate, held, fits }
  }
  if (!best) return null
  const inside = new Uint8Array(pageCells)
  for (const cell of best.cells) inside[cell] = 1
  // Cells of the region beside the props: a prop's box centre may lie in its own symbol.
  const propCells = anchors
    .map((b) => heldCell(best.id, b))
    .filter((cell): cell is number => cell !== null)
  // Thin strips on the edge of the shop (dimension chains, a storefront band): blank regions
  // touching the background whose mean thickness is below a wall's worth are left out.
  peelThinStrips(grid, labels, components, inside, outside, thinCells, propCells, grow)
  // Of the prop cells, those that survived the peeling (a peeled strip may have held the sample).
  const keptPropCells = anchors
    .map((b) => cellsAround(b).find((cell) => inside[cell]))
    .filter((cell): cell is number => cell !== undefined)
  keepPiece(grid, inside, keptPropCells.length ? keptPropCells : propCells)
  // The lines were grown by `grow`: shrink the region back so its edge is on them again,
  // and smooth off the stubs of dimension and extension lines.
  const eroded = erode(grid, inside, grow)
  const shape = dilate(grid, erode(grid, eroded, OPEN_CELLS), OPEN_CELLS)
  const ring = traceOutline(grid, shape)
  const round = (p: PxPoint): PxPoint => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
  for (const tolerance of SIMPLIFY_CELLS) {
    const simple = simplify(ring, tolerance)
    if (simple.length < 3) continue
    const pixels = simple.map(([x, y]): PxPoint => [(x - 1) * CELL_PX, (y - 1) * CELL_PX])
    // On the drawn lines when that keeps the polygon simple; else as traced.
    for (const outline of [
      straighten(pixels.map((p) => snapToLines(p, lines))),
      straighten(pixels),
    ]) {
      const pxPerM = hints.pxPerM ?? DEFAULT_PX_PER_M
      const rounded = dropRepeats(
        dropMinorCorners(outline, MINOR_CORNER_M2 * pxPerM * pxPerM).map(round),
      )
      if (rounded.length >= 3 && isSimplePolygon(rounded)) return rounded
    }
  }
  return null
}

/**
 * Takes thin blank regions on the edge of a hole out of it (in place): those touching the
 * background across the ink, with a mean thickness (area over half the perimeter) of at most
 * twice `thinCells` (a dimension band, a storefront band, the hatching of a wall). Regions
 * holding a prop stay. The ink that only bordered what was taken goes with it.
 */
function peelThinStrips(
  grid: Grid,
  labels: Int32Array,
  components: readonly Component[],
  inside: Uint8Array,
  outside: (cell: number) => boolean,
  thinCells: number,
  props: readonly number[],
  grow: number,
): void {
  const { w, h } = grid
  const reach = grow * 2 + 2
  const touching = new Set<number>()
  for (let cell = 0; cell < inside.length; cell++) {
    const id = labels[cell] ?? 0
    if (!inside[cell] || !id || touching.has(id)) continue
    const x = cell % w
    const y = (cell - x) / w
    // Background within a short reach across the ink.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (let k = 1; k <= reach; k++) {
        const nx = x + dx * k
        const ny = y + dy * k
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) break
        const n = ny * w + nx
        if (outside(n)) {
          touching.add(id)
          break
        }
        if (!grid.ink[n]) break
      }
    }
  }
  const strip = new Set<number>()
  const holding = new Set(props.map((cell) => labels[cell] ?? 0))
  let holeArea = 0
  for (let cell = 0; cell < inside.length; cell++) holeArea += inside[cell] ?? 0
  const ids = new Set<number>()
  for (let cell = 0; cell < inside.length; cell++)
    if (inside[cell] && labels[cell]) ids.add(labels[cell] as number)
  for (const id of ids) {
    const c = components[id - 1]
    // Only regions on the edge of the shop: thin regions inside it (gaps between parallel lines
    // across the floor) stay, or the floor would fall apart.
    if (!c || holding.has(id) || !touching.has(id)) continue
    let perimeter = 0
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const cell = y * w + x
        if (labels[cell] !== id) continue
        if (
          labels[cell - 1] !== id ||
          labels[cell + 1] !== id ||
          labels[cell - w] !== id ||
          labels[cell + w] !== id
        )
          perimeter++
      }
    }
    const thickness = perimeter ? (2 * c.area) / perimeter : Infinity
    // Twice the wall thickness only for small strips: a small shop's own floor pieces stay.
    if (thickness <= thinCells * (c.area < holeArea * 0.08 ? 2 : 1)) strip.add(id)
  }
  if (!strip.size) return
  for (let cell = 0; cell < inside.length; cell++) {
    if (inside[cell] && strip.has(labels[cell] ?? 0)) inside[cell] = 0
  }
  // Ink stays only beside the blank cells kept (walls, partitions); ink that only bordered a
  // peeled strip (the dimension line beyond it) goes with the strip. Diagonal steps too, or the
  // outer corners of the walls would go and the shop's corners be cut off.
  const inkReach = grow + 2
  const near = new Uint8Array(inside.length)
  let frontier: number[] = []
  for (let cell = 0; cell < inside.length; cell++) {
    if (inside[cell] && !grid.ink[cell]) {
      near[cell] = 1
      frontier.push(cell)
    }
  }
  for (let step = 0; step < inkReach; step++) {
    const next: number[] = []
    for (const cell of frontier) {
      const x = cell % w
      for (const n of [
        cell - 1,
        cell + 1,
        cell - w,
        cell + w,
        cell - w - 1,
        cell - w + 1,
        cell + w - 1,
        cell + w + 1,
      ]) {
        if (n < 0 || n >= inside.length || Math.abs((n % w) - x) > 1) continue
        if (near[n] || !inside[n] || !grid.ink[n]) continue
        near[n] = 1
        next.push(n)
      }
    }
    frontier = next
  }
  for (let cell = 0; cell < inside.length; cell++) if (!near[cell]) inside[cell] = 0
}

/**
 * Visvalingam–Whyatt on a closed ring: the corner spanning the smallest triangle with its
 * neighbours goes first, again and again, while that triangle is below `minArea` (px²). Stair
 * steps of the raster and nicks of dimension lines go; real corners, notches round a column and
 * the pieces of an arc wide enough to matter stay.
 */
function dropMinorCorners(points: PxPoint[], minArea: number): PxPoint[] {
  const ring = [...points]
  const triangle = (i: number) => {
    const n = ring.length
    const a = ring[(i + n - 1) % n] as PxPoint
    const b = ring[i] as PxPoint
    const c = ring[(i + 1) % n] as PxPoint
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  while (ring.length > 3) {
    let smallest = 0
    let area = Infinity
    for (let i = 0; i < ring.length; i++) {
      const t = triangle(i)
      if (t < area) {
        area = t
        smallest = i
      }
    }
    if (area >= minArea) break
    ring.splice(smallest, 1)
  }
  return ring
}

/** A ring without consecutive repeated points (and without the first repeated at the end). */
function dropRepeats(points: PxPoint[]): PxPoint[] {
  const out = points.filter((p, i) => {
    const q = points[(i + points.length - 1) % points.length] as PxPoint
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5
  })
  return out
}

/** Cells within the given radius (a square) of a set. */
function dilate(grid: Grid, inside: Uint8Array, radius: number): Uint8Array {
  const { w, h } = grid
  const rows = new Uint8Array(inside.length)
  for (let y = 0; y < h; y++) {
    // Two passes along the row: the nearest set cell to the left and to the right.
    let last = -Infinity
    for (let x = 0; x < w; x++) {
      if (inside[y * w + x]) last = x
      if (x - last <= radius) rows[y * w + x] = 1
    }
    last = Infinity
    for (let x = w - 1; x >= 0; x--) {
      if (inside[y * w + x]) last = x
      if (last - x <= radius) rows[y * w + x] = 1
    }
  }
  const out = new Uint8Array(inside.length)
  for (let x = 0; x < w; x++) {
    let last = -Infinity
    for (let y = 0; y < h; y++) {
      if (rows[y * w + x]) last = y
      if (y - last <= radius) out[y * w + x] = 1
    }
    last = Infinity
    for (let y = h - 1; y >= 0; y--) {
      if (rows[y * w + x]) last = y
      if (last - y <= radius) out[y * w + x] = 1
    }
  }
  return out
}

/** Cells of a set whose whole square of the given radius lies in the set. */
function erode(grid: Grid, inside: Uint8Array, radius: number): Uint8Array {
  const { w, h } = grid
  // Rows first, then columns: a square is the product of the two runs.
  const rows = new Uint8Array(inside.length)
  for (let y = 0; y < h; y++) {
    let run = 0
    for (let x = 0; x < w; x++) {
      run = inside[y * w + x] ? run + 1 : 0
      if (run >= 2 * radius + 1) rows[y * w + x - radius] = 1
    }
  }
  const out = new Uint8Array(inside.length)
  for (let x = 0; x < w; x++) {
    let run = 0
    for (let y = 0; y < h; y++) {
      run = rows[y * w + x] ? run + 1 : 0
      if (run >= 2 * radius + 1) out[(y - radius) * w + x] = 1
    }
  }
  return out
}

/** Keeps (in place) the piece of a set holding most of the given cells, with its holes filled. */
function keepPiece(grid: Grid, inside: Uint8Array, wanted: readonly number[]): void {
  const { w } = grid
  const piece = new Int32Array(inside.length)
  const sizes: number[] = [0]
  const boxes: Component[] = [{ id: 0, area: 0, minX: 0, minY: 0, maxX: 0, maxY: 0, border: false }]
  for (let start = 0; start < inside.length; start++) {
    if (!inside[start] || piece[start]) continue
    const id = sizes.length
    const box: Component = { id, area: 0, minX: w, minY: grid.h, maxX: 0, maxY: 0, border: false }
    const stack = [start]
    piece[start] = id
    while (stack.length) {
      const cell = stack.pop() as number
      const x = cell % w
      const y = (cell - x) / w
      box.area++
      box.minX = Math.min(box.minX, x)
      box.minY = Math.min(box.minY, y)
      box.maxX = Math.max(box.maxX, x)
      box.maxY = Math.max(box.maxY, y)
      for (const n of [cell - 1, cell + 1, cell - w, cell + w]) {
        if (n < 0 || n >= inside.length || Math.abs((n % w) - x) > 1) continue
        if (!inside[n] || piece[n]) continue
        piece[n] = id
        stack.push(n)
      }
    }
    sizes.push(box.area)
    boxes.push(box)
  }
  const votes = new Map<number, number>()
  for (const cell of wanted) {
    const id = piece[cell] ?? 0
    if (id) votes.set(id, (votes.get(id) ?? 0) + 1)
  }
  const keep = [...votes.entries()].sort(
    (p, q) => q[1] - p[1] || (sizes[q[0]] ?? 0) - (sizes[p[0]] ?? 0),
  )[0]?.[0]
  if (!keep) {
    inside.fill(0)
    return
  }
  const filled = fillOutline(grid, (cell) => piece[cell] === keep, boxes[keep] as Component)
  inside.set(filled)
}
