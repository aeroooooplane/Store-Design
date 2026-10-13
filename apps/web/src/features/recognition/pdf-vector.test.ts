/**
 * Characterization tests: they pin the current behaviour of pdf-vector.ts before refactoring.
 * Pages are fakes with the shape pdf.js 5.7 hands out: operator codes are the real pdf.js
 * `OPS` values, colours arrive as ['#rrggbb'], and paths are packed into constructPath as
 * [paint op, [Float32Array of DrawOPS codes and coordinates], minMax].
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { extractPageVector, pageScale } from './pdf-vector.ts'

/** The subset of pdfjs-dist 5.7 `OPS` that pdf-vector reads. */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  setStrokeColor: 52,
  setFillColor: 54,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  constructPath: 91,
}

/** pdfjs-dist 5.7 `DrawOPS`: the codes inside a packed constructPath. */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 }

type Op = [number, unknown]

/** A page of W × H points; the viewport flips y like pdf.js does for an unrotated page. */
function fakePage(W: number, H: number, ops: Op[] = [], items: unknown[] = []): PDFPageProxy {
  return {
    getViewport: ({ scale }: { scale: number }) => {
      const transform = [scale, 0, 0, -scale, 0, H * scale]
      return {
        width: W * scale,
        height: H * scale,
        transform,
        convertToViewportPoint: (x: number, y: number) => [scale * x, H * scale - scale * y],
      }
    },
    getTextContent: async () => ({ items }),
    getOperatorList: async () => ({
      fnArray: ops.map(([fn]) => fn),
      argsArray: ops.map(([, args]) => args),
    }),
  } as unknown as PDFPageProxy
}

/** A pdf.js 5 packed path. */
const path = (paint: number, data: number[]): Op => [
  OPS.constructPath,
  [paint, [new Float32Array(data)], null],
]
/** A rectangle the way pdf.js 5.7 packs `re`: moveTo, three lineTo, closePath. */
const packedRect = (x: number, y: number, w: number, h: number) => [
  DRAW.moveTo,
  x,
  y,
  DRAW.lineTo,
  x + w,
  y,
  DRAW.lineTo,
  x + w,
  y + h,
  DRAW.lineTo,
  x,
  y + h,
  DRAW.closePath,
]

const extract = (ops: Op[], scale = 1, W = 100, H = 100) =>
  extractPageVector(fakePage(W, H, ops), scale, OPS)

describe('pageScale', () => {
  it('fits the long side of the page to the given pixels', () => {
    expect(pageScale(fakePage(842, 595), 2000)).toBeCloseTo(2.3753, 4)
    expect(pageScale(fakePage(595, 842), 1000)).toBeCloseTo(1.1876, 4)
    expect(pageScale(fakePage(500, 500), 1000)).toBe(2)
  })
})

describe('extractPageVector: page and text', () => {
  it('rounds the page size in pixels', async () => {
    const content = await extractPageVector(fakePage(200.4, 100.3), 2, OPS)
    expect([content.width, content.height]).toEqual([401, 201])
  })

  it('keeps trimmed text runs in viewport pixels, top-left based', async () => {
    const items = [
      { str: ' 主入口 ', transform: [12, 0, 0, 12, 50, 20], width: 36, height: 12 },
      { str: '   ', transform: [12, 0, 0, 12, 0, 0], width: 5, height: 12 },
      { type: 'beginMarkedContent' },
      { str: '6000', transform: [0, 10, -10, 0, 100, 40], width: 20, height: 10 },
    ]
    const content = await extractPageVector(fakePage(200, 100, [], items), 2, OPS)
    expect(content.texts).toEqual([
      // Baseline at y = 200 − 2 × 20 = 160; the box sits above it.
      { text: '主入口', x: 100, y: 136, w: 72, h: 24 },
      // Rotated 90°: width and height swap and the box extends left of and above the origin.
      { text: '6000', x: 180, y: 80, w: 20, h: 40 },
    ])
  })
})

describe('extractPageVector: pdf.js 5 packed paths', () => {
  it('keeps stroked segments with the stroke colour, lower-cased', async () => {
    const content = await extractPageVector(
      fakePage(200, 100, [
        [OPS.setStrokeRGBColor, ['#FF0000']],
        path(OPS.stroke, [DRAW.moveTo, 10, 10, DRAW.lineTo, 60, 10, DRAW.lineTo, 60, 40]),
      ]),
      2,
      OPS,
    )
    expect(content.lines).toEqual([
      { x1: 20, y1: 180, x2: 120, y2: 180, color: '#ff0000' },
      { x1: 120, y1: 180, x2: 120, y2: 120, color: '#ff0000' },
    ])
    expect(content.rects).toEqual([])
  })

  it('reads packed rectangles as four edges each: code 4 is closePath in pdf.js 5', async () => {
    const content = await extract([
      [OPS.setStrokeRGBColor, ['#000000']],
      // Two rectangles in one path: the path goes on after the first closePath.
      path(OPS.stroke, [...packedRect(10, 10, 50, 30), ...packedRect(70, 10, 20, 20)]),
    ])
    expect(content.lines).toEqual([
      { x1: 10, y1: 90, x2: 60, y2: 90, color: '#000000' },
      { x1: 60, y1: 90, x2: 60, y2: 60, color: '#000000' },
      { x1: 60, y1: 60, x2: 10, y2: 60, color: '#000000' },
      { x1: 10, y1: 60, x2: 10, y2: 90, color: '#000000' },
      { x1: 70, y1: 90, x2: 90, y2: 90, color: '#000000' },
      { x1: 90, y1: 90, x2: 90, y2: 70, color: '#000000' },
      { x1: 90, y1: 70, x2: 70, y2: 70, color: '#000000' },
      { x1: 70, y1: 70, x2: 70, y2: 90, color: '#000000' },
    ])
    expect(content.rects).toEqual([])
  })

  it('closes the path for closeStroke (pdf.js also appends code 4)', async () => {
    const content = await extract([
      path(OPS.closeStroke, [
        DRAW.moveTo,
        10,
        10,
        DRAW.lineTo,
        40,
        10,
        DRAW.lineTo,
        40,
        40,
        DRAW.closePath,
      ]),
    ])
    expect(content.lines).toEqual([
      { x1: 10, y1: 90, x2: 40, y2: 90 },
      { x1: 40, y1: 90, x2: 40, y2: 60 },
      { x1: 40, y1: 60, x2: 10, y2: 90 },
    ])
  })

  it('skips quadratic curves (code 3, four numbers) like cubic ones', async () => {
    const content = await extract([
      path(OPS.stroke, [
        DRAW.moveTo,
        0,
        60,
        DRAW.lineTo,
        10,
        60,
        DRAW.quadraticCurveTo,
        15,
        65,
        20,
        60,
        DRAW.lineTo,
        30,
        60,
        DRAW.moveTo,
        0,
        70,
        DRAW.lineTo,
        10,
        70,
      ]),
    ])
    expect(content.lines).toEqual([
      { x1: 0, y1: 40, x2: 10, y2: 40 },
      { x1: 0, y1: 30, x2: 10, y2: 30 },
    ])
  })

  it('skips curves, and the segment right after a curve', async () => {
    const content = await extract([
      path(OPS.stroke, [
        DRAW.moveTo,
        0,
        50,
        DRAW.curveTo,
        1,
        1,
        2,
        2,
        30,
        50,
        DRAW.lineTo,
        60,
        50,
        DRAW.lineTo,
        90,
        50,
      ]),
    ])
    expect(content.lines).toEqual([{ x1: 60, y1: 50, x2: 90, y2: 50 }])
  })

  it('colours filled paths with the fill colour, else the stroke colour', async () => {
    const triangle = [DRAW.moveTo, 10, 10, DRAW.lineTo, 50, 10, DRAW.lineTo, 50, 50]
    const strokeOnly = await extract([
      [OPS.setStrokeRGBColor, ['#123456']],
      path(OPS.fill, triangle),
    ])
    expect(strokeOnly.lines.map((l) => l.color)).toEqual(['#123456', '#123456'])

    const both = await extract([
      [OPS.setStrokeRGBColor, ['#123456']],
      [OPS.setFillRGBColor, ['#00ff00']],
      path(OPS.eoFill, triangle),
      path(OPS.fillStroke, triangle),
      path(OPS.stroke, triangle),
    ])
    expect(both.lines.map((l) => l.color)).toEqual([
      '#00ff00',
      '#00ff00',
      '#00ff00',
      '#00ff00',
      '#123456',
      '#123456',
    ])
  })

  it('drops clipping paths (endPath) and empty paths', async () => {
    const content = await extract([
      path(OPS.endPath, [DRAW.moveTo, 0, 0, DRAW.lineTo, 100, 100]),
      [OPS.constructPath, [OPS.stroke, [null], null]],
    ])
    expect(content.lines).toEqual([])
  })

  it('drops segments shorter than 3 px (after scaling)', async () => {
    const short = [DRAW.moveTo, 0, 0, DRAW.lineTo, 1.4, 0]
    expect((await extract([path(OPS.stroke, short)], 2)).lines).toEqual([])
    expect((await extract([path(OPS.stroke, short)], 3)).lines).toHaveLength(1)
  })

  it('applies transforms inside save/restore, which also restores the colours', async () => {
    const content = await extract([
      [OPS.setStrokeRGBColor, ['#ff0000']],
      [OPS.save, null],
      [OPS.transform, [1, 0, 0, 1, 20, 0]],
      [OPS.setStrokeRGBColor, [[0, 0, 255]]],
      path(OPS.stroke, [DRAW.moveTo, 0, 0, DRAW.lineTo, 10, 0]),
      [OPS.restore, null],
      path(OPS.stroke, [DRAW.moveTo, 0, 90, DRAW.lineTo, 30, 90]),
      [OPS.restore, null],
      path(OPS.stroke, [DRAW.moveTo, 0, 80, DRAW.lineTo, 30, 80]),
    ])
    expect(content.lines).toEqual([
      { x1: 20, y1: 100, x2: 30, y2: 100, color: '#0000ff' },
      { x1: 0, y1: 10, x2: 30, y2: 10, color: '#ff0000' },
      // A restore with nothing saved keeps the current state.
      { x1: 0, y1: 20, x2: 30, y2: 20, color: '#ff0000' },
    ])
  })
})

describe('extractPageVector: colours', () => {
  const strokeAfter = async (op: number, args: unknown) => {
    const content = await extract([
      [OPS.setStrokeRGBColor, ['#abcdef']],
      [op, args],
      path(OPS.stroke, [DRAW.moveTo, 0, 0, DRAW.lineTo, 50, 0]),
    ])
    return content.lines[0]?.color
  }

  it('reads hex strings, 0–255 triples (rounded, clamped) and typed arrays', async () => {
    expect(await strokeAfter(OPS.setStrokeColor, ['#A0B0C0'])).toBe('#a0b0c0')
    expect(await strokeAfter(OPS.setStrokeRGBColor, [300, -5, 0.5])).toBe('#ff0001')
    expect(await strokeAfter(OPS.setStrokeRGBColor, [[16, 32, 48]])).toBe('#102030')
    expect(await strokeAfter(OPS.setStrokeColor, Uint8ClampedArray.from([1, 2, 3]))).toBe('#010203')
  })

  it('reads the first three CMYK values as if they were RGB', async () => {
    expect(await strokeAfter(OPS.setStrokeCMYKColor, [0, 0, 0, 1])).toBe('#000000')
    expect(await strokeAfter(OPS.setStrokeCMYKColor, [0.2, 0.4, 0.6, 0])).toBe('#000001')
  })

  it('keeps the previous colour for values it cannot read (gray levels, names, short hex)', async () => {
    expect(await strokeAfter(OPS.setStrokeGray, [0.5])).toBe('#abcdef')
    expect(await strokeAfter(OPS.setStrokeGray, [128])).toBe('#abcdef')
    expect(await strokeAfter(OPS.setStrokeColor, ['red'])).toBe('#abcdef')
    expect(await strokeAfter(OPS.setStrokeColor, ['#fff'])).toBe('#abcdef')
  })

  it('leaves lines uncoloured when no colour was ever set', async () => {
    const content = await extract([path(OPS.stroke, [DRAW.moveTo, 0, 0, DRAW.lineTo, 50, 0])])
    expect(content.lines).toEqual([{ x1: 0, y1: 100, x2: 50, y2: 100 }])
    expect('color' in (content.lines[0] ?? {})).toBe(false)
  })
})

describe('extractPageVector: pdf.js 4 paths and loose operators', () => {
  it('reads [operators, coordinates] paths painted by a later operator, with rectangles', async () => {
    const content = await extract([
      [OPS.setFillRGBColor, ['#ff0001']],
      [
        OPS.constructPath,
        [
          [OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.lineTo, OPS.closePath],
          [0, 0, 10, 0, 1, 1, 2, 2, 3, 3, 3, 20],
          null,
        ],
      ],
      [OPS.stroke, null],
      [OPS.constructPath, [[OPS.rectangle, OPS.rectangle], [0, 0, 1, 1, 50, 50, 10, 10], null]],
      [OPS.fill, null],
    ])
    expect(content.lines).toEqual([
      { x1: 0, y1: 100, x2: 10, y2: 100 },
      // The curve breaks the chain; closePath still joins the last point to the start.
      { x1: 3, y1: 80, x2: 0, y2: 100 },
    ])
    // The 1 × 1 rectangle is too small; the other is kept in pixels, top-left based.
    expect(content.rects).toEqual([{ x: 50, y: 40, w: 10, h: 10, color: '#ff0001' }])
  })

  it('skips four coordinates for curveTo2 and curveTo3', async () => {
    const content = await extract([
      [
        OPS.constructPath,
        [
          [OPS.moveTo, OPS.curveTo2, OPS.moveTo, OPS.curveTo3, OPS.moveTo, OPS.lineTo],
          [0, 0, 1, 1, 2, 2, 5, 5, 1, 1, 2, 2, 10, 10, 40, 10],
          null,
        ],
      ],
      [OPS.stroke, null],
    ])
    expect(content.lines).toEqual([{ x1: 10, y1: 90, x2: 40, y2: 90 }])
  })

  it('follows separate moveTo / lineTo / rectangle operators', async () => {
    const content = await extract([
      [OPS.setStrokeRGBColor, ['#010203']],
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [10, 0]],
      [OPS.lineTo, [10, 10]],
      [OPS.closeStroke, null],
      [OPS.rectangle, [0, 0, 5, 5]],
      [OPS.eoFill, null],
      [OPS.rectangle, [0, 0, 50, 50]],
      [OPS.endPath, null],
      [OPS.rectangle, [5, 5, 0, 10]],
      [OPS.stroke, null],
    ])
    expect(content.lines).toEqual([
      { x1: 0, y1: 100, x2: 10, y2: 100, color: '#010203' },
      { x1: 10, y1: 100, x2: 10, y2: 90, color: '#010203' },
      { x1: 10, y1: 90, x2: 0, y2: 100, color: '#010203' },
    ])
    // Rectangles are dropped only when both sides are under 3 px: a zero-width one stays.
    expect(content.rects).toEqual([
      { x: 0, y: 95, w: 5, h: 5, color: '#010203' },
      { x: 5, y: 85, w: 0, h: 10, color: '#010203' },
    ])
  })

  it('applies the transform to rectangles', async () => {
    const content = await extract([
      [OPS.transform, [2, 0, 0, 2, 10, 10]],
      [OPS.rectangle, [0, 0, 10, 5]],
      [OPS.stroke, null],
    ])
    // User (0, 0)–(10, 5) → page (10, 10)–(30, 20) → pixels y 90 and 80.
    expect(content.rects).toEqual([{ x: 10, y: 80, w: 20, h: 10 }])
  })
})
