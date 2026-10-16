import type { PDFPageProxy } from 'pdfjs-dist'
import type { VectorContent } from '@store/shared'

/**
 * Text runs, straight lines and rectangles of a PDF page, in pixels of the page rendered at
 * the given scale, each with its drawn colour when known. No DOM, no worker: this runs in the
 * browser (pdf-extract.ts) and in Node for regression runs over many drawings. Nothing here
 * is OCR — scanned pages yield no text and no lines.
 */

/** The operator codes of pdf.js (`pdfjs.OPS`), handed in by whichever build is loaded. */
export type PdfOps = Record<string, number>

type Matrix = [number, number, number, number, number, number]

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ]
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

/** pdf.js hands colours as ['#rrggbb'] (v5), [r, g, b] 0–255, or a bare string. */
function colourOf(args: unknown): string | undefined {
  if (Array.isArray(args) && args.length === 1) return colourOf(args[0])
  if (typeof args === 'string' && /^#[0-9a-f]{6}$/i.test(args)) return args.toLowerCase()
  if (
    Array.isArray(args) &&
    args.length >= 3 &&
    args.slice(0, 3).every((v) => typeof v === 'number')
  ) {
    const hex = (v: number) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    const [r, g, b] = args as [number, number, number]
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  if (typeof args === 'object' && args !== null && 'length' in args) {
    const arr = Array.from(args as ArrayLike<number>)
    if (arr.length >= 3) return colourOf(arr)
  }
  return undefined
}

const MIN_LINE_PX = 3
/** Pieces a Bézier curve (an arc wall, a door swing) is cut into. */
const CURVE_PIECES = 8
/** A filled shape smaller than this (pixels, both ways) is lettering: its curves are dropped. */
const GLYPH_PX = 24

/** Coordinates and widths are kept to a tenth of a pixel (smaller requests, same drawing). */
const tenth = (v: number) => Math.round(v * 10) / 10

/** Points along a cubic Bézier after `p0`, its end included. */
function cubicPoints(
  p0: [number, number],
  c1: [number, number],
  c2: [number, number],
  p3: [number, number],
): [number, number][] {
  const points: [number, number][] = []
  for (let k = 1; k <= CURVE_PIECES; k++) {
    const t = k / CURVE_PIECES
    const u = 1 - t
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ])
  }
  return points
}

/** Scale that renders the page with this many pixels on its long side. */
export function pageScale(page: PDFPageProxy, longSidePx: number): number {
  const { width, height } = page.getViewport({ scale: 1 })
  return longSidePx / Math.max(width, height)
}

export async function extractPageVector(
  page: PDFPageProxy,
  scale: number,
  OPS: PdfOps,
): Promise<VectorContent> {
  const viewport = page.getViewport({ scale })
  const content: VectorContent = {
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    texts: [],
    lines: [],
    rects: [],
  }

  const text = await page.getTextContent()
  for (const item of text.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const transform = item.transform as number[]
    const e = Number(transform[4])
    const f = Number(transform[5])
    const [x, baseline] = viewport.convertToViewportPoint(e, f) as [number, number]
    const w = item.width * scale
    const h = item.height * scale
    // Vertical text (rotated 90°) has its height along x in the transform.
    const vertical = Math.abs(Number(transform[0])) < 1e-6 && Math.abs(Number(transform[1])) > 1e-6
    content.texts.push(
      vertical
        ? { text: item.str.trim(), x: x - h, y: baseline - w, w: h, h: w }
        : { text: item.str.trim(), x, y: baseline - h, w, h },
    )
  }

  // Drawing operators: track the transform and colours, keep straight segments and rectangles.
  const ops = await page.getOperatorList()
  const base = viewport.transform as Matrix
  interface GState {
    ctm: Matrix
    stroke: string | undefined
    fill: string | undefined
    /** Line width in user space, and whether a dash pattern is set. */
    lineWidth: number
    dash: boolean
  }
  const stack: GState[] = []
  let state: GState = { ctm: base, stroke: undefined, fill: undefined, lineWidth: 1, dash: false }
  /** Pixels per user-space unit of the current transform. */
  const ctmScale = () =>
    Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2]))
  const pushLine = (
    a: [number, number],
    b: [number, number],
    color: string | undefined,
    stroked: boolean,
  ) => {
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_LINE_PX) return
    const width = stroked ? tenth(state.lineWidth * ctmScale()) : 0
    content.lines.push({
      x1: tenth(a[0]),
      y1: tenth(a[1]),
      x2: tenth(b[0]),
      y2: tenth(b[1]),
      ...(color ? { color } : {}),
      ...(width > 0 ? { w: width } : {}),
      ...(stroked && state.dash ? { dash: true } : {}),
    })
  }
  const pushRect = (x: number, y: number, w: number, h: number, color?: string) => {
    const [ax, ay] = apply(state.ctm, x, y)
    const [bx, by] = apply(state.ctm, x + w, y + h)
    const left = Math.min(ax, bx)
    const top = Math.min(ay, by)
    const width = Math.abs(bx - ax)
    const height = Math.abs(by - ay)
    if (width < MIN_LINE_PX && height < MIN_LINE_PX) return
    content.rects.push({ x: left, y: top, w: width, h: height, ...(color ? { color } : {}) })
  }

  /** A path being built, in user space, until it is stroked or filled. */
  let path: {
    segments: [[number, number], [number, number]][]
    /** Pieces of Bézier curves, kept apart: a small filled shape of them is lettering. */
    curves: [[number, number], [number, number]][]
    rects: [number, number, number, number][]
  } = { segments: [], curves: [], rects: [] }
  let current: [number, number] | null = null
  let subpathStart: [number, number] | null = null
  const flush = (color: string | undefined, stroked: boolean) => {
    for (const [a, b] of path.segments) {
      pushLine(apply(state.ctm, ...a), apply(state.ctm, ...b), color, stroked)
    }
    if (path.curves.length) {
      const pixels = path.curves.flatMap(([a, b]) => [
        apply(state.ctm, ...a),
        apply(state.ctm, ...b),
      ])
      const xs = pixels.map((p) => p[0])
      const ys = pixels.map((p) => p[1])
      const glyph =
        !stroked &&
        Math.max(...xs) - Math.min(...xs) < GLYPH_PX &&
        Math.max(...ys) - Math.min(...ys) < GLYPH_PX
      if (!glyph) {
        for (const [a, b] of path.curves) {
          pushLine(apply(state.ctm, ...a), apply(state.ctm, ...b), color, stroked)
        }
      }
    }
    for (const [x, y, w, h] of path.rects) pushRect(x, y, w, h, color)
    path = { segments: [], curves: [], rects: [] }
    current = null
    subpathStart = null
  }
  const moveTo = (x: number, y: number) => {
    current = [x, y]
    subpathStart = current
  }
  const lineTo = (x: number, y: number) => {
    if (current) path.segments.push([current, [x, y]])
    current = [x, y]
  }
  const closePath = () => {
    if (current && subpathStart) path.segments.push([current, subpathStart])
    current = subpathStart
  }
  /** A cubic Bézier from the current point, kept as straight pieces. */
  const curveTo = (c1: [number, number], c2: [number, number], end: [number, number]) => {
    if (current) {
      let from = current
      for (const p of cubicPoints(current, c1, c2, end)) {
        path.curves.push([from, p])
        from = p
      }
    }
    current = end
  }
  /** A quadratic Bézier from the current point, raised to a cubic. */
  const quadTo = (c: [number, number], end: [number, number]) => {
    const p0 = current
    if (!p0) {
      current = end
      return
    }
    curveTo(
      [p0[0] + ((c[0] - p0[0]) * 2) / 3, p0[1] + ((c[1] - p0[1]) * 2) / 3],
      [end[0] + ((c[0] - end[0]) * 2) / 3, end[1] + ((c[1] - end[1]) * 2) / 3],
      end,
    )
  }
  /** Strokes or fills the path built so far (or drops it: endPath is a clip, not a drawing). */
  const paintPath = (op: number) => {
    if (op === OPS['stroke'] || op === OPS['closeStroke']) {
      if (op === OPS['closeStroke']) closePath()
      flush(state.stroke, true)
    } else if (
      op === OPS['fill'] ||
      op === OPS['eoFill'] ||
      op === OPS['fillStroke'] ||
      op === OPS['eoFillStroke'] ||
      op === OPS['closeFillStroke'] ||
      op === OPS['closeEOFillStroke']
    ) {
      flush(state.fill ?? state.stroke, false)
    } else if (op === OPS['endPath']) {
      path = { segments: [], curves: [], rects: [] }
      current = null
      subpathStart = null
    }
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i] ?? -1
    const args = ops.argsArray[i] as unknown
    switch (fn) {
      case OPS['save']:
        stack.push({ ...state })
        break
      case OPS['restore']:
        state = stack.pop() ?? state
        break
      case OPS['transform']:
        state.ctm = multiply(args as Matrix, state.ctm)
        break
      case OPS['setStrokeRGBColor']:
      case OPS['setStrokeColor']:
      case OPS['setStrokeGray']:
      case OPS['setStrokeCMYKColor']:
        state.stroke = colourOf(args) ?? state.stroke
        break
      case OPS['setFillRGBColor']:
      case OPS['setFillColor']:
      case OPS['setFillGray']:
      case OPS['setFillCMYKColor']:
        state.fill = colourOf(args) ?? state.fill
        break
      case OPS['setLineWidth']: {
        const [width] = args as [number]
        if (typeof width === 'number' && Number.isFinite(width)) state.lineWidth = width
        break
      }
      case OPS['setDash']: {
        const [pattern] = args as [ArrayLike<number> | undefined]
        state.dash = Boolean(pattern && Array.from(pattern).some((v) => v > 0))
        break
      }
      case OPS['moveTo']: {
        const [x, y] = args as [number, number]
        moveTo(x, y)
        break
      }
      case OPS['lineTo']: {
        const [x, y] = args as [number, number]
        lineTo(x, y)
        break
      }
      case OPS['closePath']:
        closePath()
        break
      case OPS['rectangle']: {
        const [x, y, w, h] = args as [number, number, number, number]
        path.rects.push([x, y, w, h])
        break
      }
      case OPS['constructPath']: {
        const packed = args as unknown[]
        const paint = packed[0]
        if (typeof paint === 'number') {
          // pdf.js 5: [paint operator, [flat path data], minMax]; the data is op, coords, op,
          // coords… with pdf.js DrawOPS codes: 0 moveTo (x y), 1 lineTo (x y), 2 curveTo
          // (6 numbers), 3 quadraticCurveTo (4 numbers), 4 closePath. A `re` rectangle arrives
          // as moveTo, three lineTo and closePath.
          const data = Array.from((packed[1] as ArrayLike<number>[] | undefined)?.[0] ?? [])
          let k = 0
          while (k < data.length) {
            const op = data[k++]
            if (op === 0) moveTo(data[k++] ?? 0, data[k++] ?? 0)
            else if (op === 1) lineTo(data[k++] ?? 0, data[k++] ?? 0)
            else if (op === 2) {
              const n = (i: number) => data[k + i] ?? 0
              curveTo([n(0), n(1)], [n(2), n(3)], [n(4), n(5)])
              k += 6
            } else if (op === 3) {
              const n = (i: number) => data[k + i] ?? 0
              quadTo([n(0), n(1)], [n(2), n(3)])
              k += 4
            } else if (op === 4) closePath()
            else break
          }
          paintPath(paint)
        } else {
          // pdf.js 4: [operators, coordinates, minMax] with OPS codes; painted by a later op.
          const [subOps, coords] = packed as [ArrayLike<number>, ArrayLike<number>, unknown]
          let k = 0
          for (const op of Array.from(subOps)) {
            if (op === OPS['moveTo']) moveTo(coords[k++] ?? 0, coords[k++] ?? 0)
            else if (op === OPS['lineTo']) lineTo(coords[k++] ?? 0, coords[k++] ?? 0)
            else if (op === OPS['closePath']) closePath()
            else if (op === OPS['rectangle']) {
              path.rects.push([
                coords[k++] ?? 0,
                coords[k++] ?? 0,
                coords[k++] ?? 0,
                coords[k++] ?? 0,
              ])
            } else if (op === OPS['curveTo']) {
              const n = (i: number) => coords[k + i] ?? 0
              curveTo([n(0), n(1)], [n(2), n(3)], [n(4), n(5)])
              k += 6
            } else if (op === OPS['curveTo2']) {
              // The first control point is the current point.
              const n = (i: number) => coords[k + i] ?? 0
              curveTo(current ?? [n(0), n(1)], [n(0), n(1)], [n(2), n(3)])
              k += 4
            } else if (op === OPS['curveTo3']) {
              // The second control point is the end point.
              const n = (i: number) => coords[k + i] ?? 0
              curveTo([n(0), n(1)], [n(2), n(3)], [n(2), n(3)])
              k += 4
            }
          }
        }
        break
      }
      case OPS['stroke']:
      case OPS['closeStroke']:
      case OPS['fill']:
      case OPS['eoFill']:
      case OPS['fillStroke']:
      case OPS['eoFillStroke']:
      case OPS['closeFillStroke']:
      case OPS['closeEOFillStroke']:
      case OPS['endPath']:
        paintPath(fn)
        break
      default:
        break
    }
  }
  return content
}
