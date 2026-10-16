import type { VectorContent } from '@store/shared'
import { boxKey } from './boxes.ts'
import {
  AXIS_TOLERANCE_PX,
  CLUSTER_PX,
  MAX_BOUNDARY_FRACTION,
  MIN_SIDE_FRACTION,
  OPEN_SIDE_COVERAGE,
  SIDE_COVERAGE,
  bucket,
  buildIndex,
  centre,
  closed,
  cluster,
  contains,
  sideCoverages,
} from './lines.ts'
import type { Box, Line, LineIndex } from './lines.ts'

/** A side this close to the page edge (as a fraction of the page) runs along the sheet frame. */
const PAGE_EDGE_FRACTION = 0.05
/** Side positions tried per axis, the most drawn first. */
const MAX_POSITIONS = 40
/** The stated shop area and a boundary's area agree within this factor. */
const AREA_FACTOR = 1.5

/** Words of the title block printed beside the drawing (client, scale, revision, …). */
const TITLE_BLOCK =
  /^(?:client|project(?: number| name)?|scale|revision|drawing (?:title|number)|drawn by|checked by|approved by|reviewed by|ref\.? number|designer)\b/i

/** A box lying wholly inside another, within the drawing tolerance. */
const inside = (outer: Box, inner: Box) =>
  inner.x >= outer.x - CLUSTER_PX &&
  inner.y >= outer.y - CLUSTER_PX &&
  inner.x + inner.w <= outer.x + outer.w + CLUSTER_PX &&
  inner.y + inner.h <= outer.y + outer.h + CLUSTER_PX

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

export interface BoundaryHints {
  /** Sides along a page edge belong to the sheet frame (off when the user cropped to the plan). */
  pageEdges?: boolean
  /** The shop area in px², from the stated area and a scale found without the boundary. */
  expectedArea?: number | null
}

/**
 * The boundary rectangle: four drawn sides, not the sheet frame, and — when prop labels are
 * known — the smallest one holding at least half of them (the shop holds the props, the sheet
 * frame holds the shop). Without props, the largest.
 *
 * The sheet frame is never the shop: no side may run along a page edge, and a rectangle holding
 * the title block is passed over. When the stated shop area is known, rectangles of about that
 * area come first; one far off it is taken only when nothing of that area fits.
 */
export function findBoundary(
  content: VectorContent,
  lines: Line[],
  boxes: Box[],
  hints: BoundaryHints = {},
): Box | null {
  // Each prop box once: two labels in one box are one prop.
  const anchors = [...new Map(boxes.map((b) => [boxKey(b), b])).values()]
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
    // The most drawn positions only: a dense drawing (tens of thousands of lines) would otherwise
    // try every combination of hundreds of positions.
    const strong = [...total.values()]
      .filter((e) => e.length >= minSide)
      .sort((p, q) => q.length - p.length)
      .slice(0, MAX_POSITIONS)
    return cluster(strong.map((e) => e.pos))
  }
  // A side along a page edge is the sheet frame's: the shop sits inside with its dimensions.
  const margin = (length: number) => (pos: number) =>
    !hints.pageEdges ||
    (pos > length * PAGE_EDGE_FRACTION && pos < length * (1 - PAGE_EDGE_FRACTION))
  const xs = positions(false).filter(margin(content.width))
  const ys = positions(true).filter(margin(content.height))
  const index = buildIndex(lines)
  const pageArea = content.width * content.height
  // Nor is a rectangle holding the title block the shop.
  const titleBlock = content.texts.filter((t) => TITLE_BLOCK.test(t.text.trim())).map(centre)
  const frame = (box: Box) => titleBlock.filter((p) => contains(box, p)).length >= 2
  const expected = hints.expectedArea ?? null
  const areaFits = (box: Box) =>
    expected === null ||
    (box.w * box.h <= expected * AREA_FACTOR && box.w * box.h * AREA_FACTOR >= expected)
  // A prop box counts as held only when it lies wholly inside a clearly bigger rectangle, so
  // a prop box never passes for the shop around it; most of the props must be held.
  const holds = (outer: Box, inner: Box) =>
    inside(outer, inner) && outer.w * outer.h >= inner.w * inner.h * 2
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
            if (!frame(box) && accept(box)) {
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
  // a wrong one. Rectangles of the stated area go before all others.
  const tiers = expected === null ? [() => true] : [areaFits, () => true]
  for (const fits of tiers) {
    const fourSided = search((box) => fits(box) && closed(index, box))
    if (fourSided.best && holdsProps(fourSided)) return fourSided.best
    const threeSided = search((box) => fits(box) && closedButFront(index, box, anchors))
    if (threeSided.best && holdsProps(threeSided)) return threeSided.best
  }
  return null
}
