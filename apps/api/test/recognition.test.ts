import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { schema } from '@store/database'
import type {
  Asset,
  NodeCreated,
  NodeTree,
  PlanUpload,
  RecognitionRun,
  RecognizeResponse,
  VectorContent,
} from '@store/shared'
import {
  checkDraft,
  countInLabel,
  failureReason,
  matchCatalog,
  sizeInLabel,
} from '../src/modules/recognition/check.ts'
import {
  LlmAnswerSchema,
  answerToDraft,
  parseAnswer,
  toPixels,
} from '../src/modules/recognition/llm.ts'
import { dimensionMm, recognizeVector } from '../src/modules/recognition/local.ts'
import { createProject, failUpdateOf } from './fixtures.ts'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

const asset = (id: string, name: string, fn: Asset['function'], w: number, d: number): Asset => ({
  id,
  name,
  standardName: name,
  variant: '',
  materialCategory: '软装物料',
  siFamily: 'SI1.0',
  category: '软装道具',
  function: fn,
  installation: 'floor',
  footprint: { w, d, h: 0.9 },
  footprintSource: 'glb',
  extent: null,
  front: '+Z',
  staffSide: null,
  facingConfidence: 'high',
  placeable: true,
  retired: false,
  judgment: null,
  glb: null,
  whiteGlb: null,
  finishGlb: null,
  preview: null,
  productImage: null,
  productImageMatch: null,
  planSymbol: null,
})

const CATALOG: Asset[] = [
  asset('asset-1', '1.8米普通中岛桌', 'island_table', 1, 1.8),
  asset('asset-2', '1.2米配件柜', 'accessory_cabinet', 1.2, 0.45),
  asset('asset-3', '1.6米配件柜', 'accessory_cabinet', 1.6, 0.45),
  asset('asset-4', '1.8米边桌配件柜', 'side_cabinet', 0.5, 1.8),
  asset('asset-6', '1.8米配件边柜(H1.3米)', 'side_cabinet', 1.8, 0.721),
  { ...asset('asset-5', '1.8米亮脚中岛桌', 'island_table', 0.8, 1.8), siFamily: 'SI2.0' },
]

/**
 * A hand-drawn style sketch as vector content: a 600 × 450 px boundary with "6000" and "4500"
 * dimension texts beside their dimension lines (10 mm per px), a red island table (a request),
 * a cabinet in place, a side cabinet drawn outside the shop, and the entrance word at the front.
 */
const SKETCH: VectorContent = {
  width: 1000,
  height: 800,
  rects: [
    { x: 100, y: 100, w: 600, h: 450, color: '#000000' },
    { x: 200, y: 250, w: 180, h: 100, color: '#ff3b30' },
    { x: 450, y: 120, w: 120, h: 45, color: '#000000' },
    { x: 760, y: 200, w: 50, h: 180, color: '#e5e5e5' },
  ],
  lines: [
    { x1: 100, y1: 80, x2: 700, y2: 80 },
    { x1: 70, y1: 100, x2: 70, y2: 550 },
  ],
  texts: [
    { text: '6000', x: 370, y: 62, w: 60, h: 16 },
    { text: '4500', x: 52, y: 295, w: 16, h: 60 },
    { text: '中岛桌', x: 260, y: 290, w: 60, h: 20, color: '#ff3b30' },
    { text: '配件柜', x: 480, y: 132, w: 60, h: 20 },
    { text: '边桌配件柜', x: 740, y: 280, w: 90, h: 20 },
    { text: '主入口', x: 370, y: 560, w: 60, h: 20 },
  ],
}

describe('label reading', () => {
  it('reads dimensions, sizes and counts out of plan texts', () => {
    expect(dimensionMm('5400')).toBe(5400)
    expect(dimensionMm('5400 mm')).toBe(5400)
    expect(dimensionMm('6.5米')).toBe(6500)
    expect(dimensionMm('3450 长墙净尺寸')).toBe(3450)
    expect(dimensionMm('中岛桌')).toBeNull()
    expect(dimensionMm('500mm')).toBeNull()
    expect(dimensionMm('1200mm')).toBe(1200)
    expect(dimensionMm('500')).toBe(500)
    expect(sizeInLabel('1.2米配件柜')).toBe(1.2)
    expect(sizeInLabel('1.8m中岛桌')).toBe(1.8)
    expect(sizeInLabel('2*1.2配件柜')).toBe(1.2)
    expect(sizeInLabel('1700W980H内嵌灯箱')).toBe(1.7)
    expect(sizeInLabel('W1700*H3000mm')).toBe(1.7)
    expect(sizeInLabel('75寸广告机')).toBeNull()
    expect(sizeInLabel('H:900mm')).toBeNull()
    expect(sizeInLabel('店铺天花高度：3494mm')).toBeNull()
    expect(sizeInLabel('1.74m²')).toBeNull()
    expect(countInLabel('边桌配件柜*2')).toBe(2)
    expect(countInLabel('2*1.2配件柜')).toBe(2)
    expect(countInLabel('中岛桌')).toBe(1)
  })

  it('matches catalogue models by name, by size, or names the family', () => {
    expect(matchCatalog('1.2米配件柜', CATALOG)).toMatchObject({
      asset: { id: 'asset-2' },
      confidence: 0.95,
    })
    expect(matchCatalog('1.6m配件柜', CATALOG)).toMatchObject({ asset: { id: 'asset-3' } })
    // No size in the name: the drawn box decides.
    expect(matchCatalog('配件柜', CATALOG, { w: 1.55, d: 0.5 })).toMatchObject({
      asset: { id: 'asset-3' },
    })
    // Several sizes and nothing to tell them apart: ask.
    const open = matchCatalog('配件柜', CATALOG)
    expect(open.asset).toBeNull()
    expect(open.note).toContain('多种尺寸')
    // One model in the family: taken, but flagged for confirmation.
    expect(matchCatalog('中岛桌', CATALOG)).toMatchObject({
      asset: { id: 'asset-1' },
      confidence: 0.65,
    })
    expect(matchCatalog('楼梯', CATALOG)).toMatchObject({ asset: null, function: 'other' })
    // Same size in both families: the project's own SI wins.
    expect(matchCatalog('中岛桌', CATALOG, { w: 1.8, d: 1 }, 'SI1.0')).toMatchObject({
      asset: { id: 'asset-1' },
    })
    expect(matchCatalog('中岛桌', CATALOG, { w: 1.8, d: 1 }, 'SI2.0')).toMatchObject({
      asset: { id: 'asset-5' },
    })
  })
})

describe('recognizeVector', () => {
  it('reads boundary, cross-checked scale, requested and outside props, and the entrance', () => {
    const draft = recognizeVector(SKETCH, {}, CATALOG)
    expect(draft.scale).toMatchObject({ method: 'dimension', verified: true, originPx: [100, 100] })
    expect(draft.scale?.mmPerPixel).toBeCloseTo(10, 5)
    expect(draft.space?.boundary).toEqual([
      [0, 0],
      [6, 0],
      [6, 4.5],
      [0, 4.5],
    ])
    expect(draft.space?.height).toBeNull()
    expect(draft.space?.entrances).toHaveLength(1)
    expect(draft.space?.entrances[0]?.a[1]).toBe(4.5)

    const island = draft.items.find((i) => i.label === '中岛桌')
    expect(island).toMatchObject({ source: 'requested', assetId: 'asset-1', cx: 1.9, cz: 2 })
    // Drawn 180 × 100 px lies the other way than the 1 × 1.8 model: turned by 90°.
    expect(island).toMatchObject({ rotation: 90, w: 1.8, d: 1 })
    const cabinet = draft.items.find((i) => i.label === '配件柜')
    expect(cabinet).toMatchObject({ source: 'existing', assetId: 'asset-2' })
    const side = draft.items.find((i) => i.label === '边桌配件柜')
    expect(side).toMatchObject({ source: 'outside', assetId: 'asset-4' })
    expect(draft.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('gives up on the scale without dimensions and takes the user calibration instead', () => {
    // 配件柜 comes in several sizes, so its name gives no scale either.
    const bare: VectorContent = {
      ...SKETCH,
      lines: [],
      texts: SKETCH.texts.slice(2).filter((t) => t.text === '配件柜' || t.text === '主入口'),
    }
    const none = recognizeVector(bare, {}, CATALOG)
    expect(none.scale).toBeNull()
    expect(none.space).toBeNull()
    const calibrated = recognizeVector(
      bare,
      { calibration: { a: [100, 100], b: [700, 100], mm: 6000 } },
      CATALOG,
    )
    expect(calibrated.scale).toMatchObject({ method: 'manual', verified: true })
    expect(calibrated.space?.boundary[2]).toEqual([6, 4.5])
  })

  it('recognises within a crop and keeps the crop origin', () => {
    const shifted: VectorContent = {
      width: 2000,
      height: 1600,
      rects: SKETCH.rects.map((r) => ({ ...r, x: r.x + 1000, y: r.y + 800 })),
      lines: SKETCH.lines.map((l) => ({
        ...l,
        x1: l.x1 + 1000,
        y1: l.y1 + 800,
        x2: l.x2 + 1000,
        y2: l.y2 + 800,
      })),
      texts: SKETCH.texts.map((t) => ({ ...t, x: t.x + 1000, y: t.y + 800 })),
    }
    const draft = recognizeVector(shifted, { crop: { x: 1000, y: 800, w: 1000, h: 800 } }, CATALOG)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
    expect(draft.scale?.originPx).toEqual([100, 100])
  })

  it('takes the scale from sized prop names when the sheet has no dimension texts', () => {
    // 1.8 m over 180 px and 1.6 m over 160 px agree on 10 mm/px; a stray "200mm" (a logo
    // height) with its own little line would say 2.5 and is outvoted.
    const content: VectorContent = {
      width: 1000,
      height: 800,
      rects: [
        { x: 100, y: 100, w: 600, h: 450 },
        { x: 200, y: 250, w: 180, h: 100 },
        { x: 450, y: 120, w: 160, h: 45 },
      ],
      lines: [{ x1: 600, y1: 700, x2: 680, y2: 700 }],
      texts: [
        { text: '1.8米开箱桌', x: 230, y: 290, w: 90, h: 16 },
        { text: '1.6米配件柜', x: 470, y: 132, w: 90, h: 16 },
        { text: '200mm', x: 600, y: 684, w: 40, h: 14 },
      ],
    }
    const draft = recognizeVector(content, {}, CATALOG)
    expect(draft.scale).toMatchObject({ method: 'item_label', verified: true })
    expect(draft.scale?.mmPerPixel).toBeCloseTo(10, 5)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
    expect(draft.items.map((i) => i.assetId)).toEqual([null, 'asset-3'])
  })

  it('prefers the rectangle holding the props over the sheet frame around it', () => {
    const framed: VectorContent = {
      ...SKETCH,
      rects: [{ x: 20, y: 20, w: 960, h: 760 }, ...SKETCH.rects],
    }
    const draft = recognizeVector(framed, {}, CATALOG)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
    expect(draft.scale?.originPx).toEqual([100, 100])
  })

  it('finds prop boxes drawn as four lines, as CAD exports do, even with the label above', () => {
    const sides = (r: { x: number; y: number; w: number; h: number; color?: string }) => [
      { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y, color: r.color },
      { x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h, color: r.color },
      { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h, color: r.color },
      { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h, color: r.color },
    ]
    const lines: VectorContent['lines'] = [
      ...SKETCH.lines,
      ...SKETCH.rects.flatMap(sides),
      // A tray drawn inside the island table must not pass for the table.
      ...sides({ x: 220, y: 300, w: 40, h: 20 }),
    ]
    const drawn: VectorContent = {
      ...SKETCH,
      rects: [],
      lines,
      texts: SKETCH.texts.map((t) =>
        // The cabinet label sits just above its box instead of inside it.
        t.text === '配件柜' ? { ...t, y: 96 } : t,
      ),
    }
    const draft = recognizeVector(drawn, {}, CATALOG)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
    expect(draft.items.find((i) => i.label === '中岛桌')).toMatchObject({
      source: 'requested',
      assetId: 'asset-1',
      cx: 1.9,
      cz: 2,
    })
    expect(draft.items.find((i) => i.label === '配件柜')).toMatchObject({
      assetId: 'asset-2',
      cz: 0.425,
    })
  })

  it('gives no boundary for an irregular shop whose props no rectangle holds', () => {
    const open: VectorContent = {
      ...SKETCH,
      // The shop outline is gone; only the sheet-like frame and the prop boxes remain.
      rects: [{ x: 20, y: 20, w: 400, h: 500 }, ...SKETCH.rects.slice(1)],
    }
    const draft = recognizeVector(open, {}, CATALOG)
    expect(draft.space).toBeNull()
  })

  it('reads the scale from the stated shop area when nothing else gives it', () => {
    const content: VectorContent = {
      ...SKETCH,
      lines: [],
      // The area label and its number come as two pieces of one row, as CAD exports do.
      texts: [
        { text: '店铺实测面积：', x: 100, y: 600, w: 120, h: 16 },
        { text: '27m²', x: 230, y: 600, w: 40, h: 16 },
        { text: '1.74m²', x: 400, y: 600, w: 40, h: 14 },
        // 配件柜 (several sizes) anchors the boundary but gives no scale of its own.
        { text: '配件柜', x: 260, y: 290, w: 60, h: 20 },
        { text: '主入口', x: 370, y: 560, w: 60, h: 20 },
      ],
    }
    const draft = recognizeVector(content, {}, CATALOG)
    // 27 m² over 600 × 450 px → 10 mm per px; the little room's area is ignored.
    expect(draft.scale).toMatchObject({ method: 'area', verified: false })
    expect(draft.scale?.mmPerPixel).toBeCloseTo(10, 5)
    expect(draft.scale?.reference).toContain('27m²')
  })

  it('measures a prop name without a size by the one size the catalogue has for it', () => {
    // 中岛桌 (all 1.8 m) in a 180 px box and 边桌配件柜 (1.8 m) in a 180 px box agree on 10 mm/px.
    const content: VectorContent = {
      ...SKETCH,
      lines: [],
      texts: SKETCH.texts.slice(2).filter((t) => t.text !== '配件柜'),
    }
    const draft = recognizeVector(content, {}, CATALOG)
    expect(draft.scale).toMatchObject({ method: 'item_label', verified: true })
    expect(draft.scale?.mmPerPixel).toBeCloseTo(10, 5)
  })

  it('accepts a boundary whose front is mostly open, but only when no closed one holds the props', () => {
    const sides = (r: { x: number; y: number; w: number; h: number }) => [
      { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },
      { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },
      { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h },
    ]
    const openFront: VectorContent = {
      ...SKETCH,
      rects: SKETCH.rects.slice(1),
      lines: [
        ...SKETCH.lines,
        ...sides({ x: 100, y: 100, w: 600, h: 450 }),
        // Only the corners of the front are walls; the rest is entrance and open edge.
        { x1: 100, y1: 550, x2: 160, y2: 550 },
        { x1: 640, y1: 550, x2: 700, y2: 550 },
      ],
    }
    const draft = recognizeVector(openFront, {}, CATALOG)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
  })

  it('fails a drawing whose boundary could not be a shop', () => {
    // A detail drawing: the "boundary" is 1 × 0.6 m.
    const detail: VectorContent = {
      width: 1000,
      height: 800,
      rects: [
        { x: 100, y: 100, w: 500, h: 300 },
        { x: 150, y: 150, w: 180, h: 100 },
      ],
      lines: [{ x1: 100, y1: 80, x2: 600, y2: 80 }],
      texts: [
        { text: '1000', x: 320, y: 62, w: 60, h: 16 },
        { text: '配件柜', x: 180, y: 190, w: 60, h: 16 },
      ],
    }
    const draft = checkDraft(recognizeVector(detail, {}, CATALOG))
    expect(failureReason(draft)).toMatch(/比例不合理/)
  })

  it('takes the shop, not the sheet frame or a frame holding the title block', () => {
    // A 500 × 350 px shop with its dimensions (10 mm per px) on a framed sheet. A prop drawn
    // beside the shop puts all three props inside the frame but only two inside the shop.
    const sheet = (frames: VectorContent['rects']): VectorContent => ({
      width: 1000,
      height: 800,
      rects: [
        ...frames,
        { x: 150, y: 150, w: 500, h: 350 },
        { x: 200, y: 250, w: 180, h: 100 },
        { x: 450, y: 170, w: 120, h: 45 },
        { x: 700, y: 250, w: 50, h: 180 },
      ],
      lines: [
        { x1: 150, y1: 130, x2: 650, y2: 130 },
        { x1: 130, y1: 150, x2: 130, y2: 500 },
      ],
      texts: [
        { text: '5000', x: 370, y: 112, w: 60, h: 16 },
        { text: '3500', x: 112, y: 295, w: 16, h: 60 },
        { text: '中岛桌', x: 260, y: 290, w: 60, h: 20 },
        { text: '配件柜', x: 480, y: 182, w: 60, h: 20 },
        { text: '边桌配件柜', x: 680, y: 330, w: 90, h: 20 },
        { text: 'Client', x: 850, y: 100, w: 40, h: 10 },
        { text: 'Scale', x: 850, y: 600, w: 40, h: 10 },
        { text: 'Project Number', x: 850, y: 650, w: 80, h: 10 },
      ],
    })
    const sheets = [
      // The page border and a drawing frame along the page edges, short of the title block.
      sheet([
        { x: 5, y: 5, w: 990, h: 790 },
        { x: 20, y: 20, w: 800, h: 760 },
      ]),
      // A frame well inside the page, around the drawing and the title block.
      sheet([{ x: 100, y: 60, w: 820, h: 680 }]),
    ]
    for (const content of sheets) {
      const draft = recognizeVector(content, {}, CATALOG)
      expect(draft.scale).toMatchObject({
        method: 'dimension',
        verified: true,
        originPx: [150, 150],
      })
      expect(draft.space?.boundary).toEqual([
        [0, 0],
        [5, 0],
        [5, 3.5],
        [0, 3.5],
      ])
      expect(draft.items.find((i) => i.label === '边桌配件柜')).toMatchObject({ source: 'outside' })
    }
  })

  it('keeps a boundary at the edges of a crop the user drew around the shop', () => {
    // The shop's left and top sides lie 10 px inside the crop: along its edges, yet the shop.
    const cropped = recognizeVector(
      SKETCH,
      {
        crop: { x: 90, y: 90, w: 700, h: 560 },
        calibration: { a: [10, 10], b: [610, 10], mm: 6000 },
      },
      CATALOG,
    )
    expect(cropped.space?.boundary[2]).toEqual([6, 4.5])
  })

  it('prefers the rectangle of the stated shop area over a closed room inside it', () => {
    // The shop's front is open, so a closed room around the props would win on its own; the
    // stated 27 m² (600 × 450 px at the 10 mm per px the sized prop names give) picks the shop.
    const content: VectorContent = {
      width: 1000,
      height: 800,
      rects: [
        { x: 150, y: 130, w: 420, h: 250 },
        { x: 200, y: 250, w: 180, h: 100 },
        { x: 400, y: 140, w: 160, h: 45 },
      ],
      lines: [
        { x1: 100, y1: 100, x2: 700, y2: 100 },
        { x1: 100, y1: 100, x2: 100, y2: 550 },
        { x1: 700, y1: 100, x2: 700, y2: 550 },
        { x1: 100, y1: 550, x2: 160, y2: 550 },
        { x1: 640, y1: 550, x2: 700, y2: 550 },
      ],
      texts: [
        { text: '1.8米开箱桌', x: 230, y: 290, w: 90, h: 16 },
        { text: '1.6米配件柜', x: 440, y: 155, w: 90, h: 16 },
        { text: '店铺实测面积：27m²', x: 100, y: 650, w: 160, h: 16 },
      ],
    }
    const draft = recognizeVector(content, {}, CATALOG)
    expect(draft.scale?.mmPerPixel).toBeCloseTo(10, 5)
    expect(draft.space?.boundary[2]).toEqual([6, 4.5])
    expect(draft.scale?.originPx).toEqual([100, 100])
  })
})

describe('answers of a vision model', () => {
  it('places millimetre answers on the picture by their anchors', () => {
    // A 400 × 300 px picture of an 8000 × 6000 mm shop drawn edge to edge.
    const { answer, scale } = toPixels(
      LlmAnswerSchema.parse({
        units: 'mm',
        anchors: [
          { mm: [0, 0], at: [0, 0] },
          { mm: [8000, 6000], at: [1000, 1000] },
        ],
        dimensions: [
          { mm: 8000, a: [0, 0], b: [8000, 0] },
          { mm: 6000, a: [0, 0], b: [0, 6000] },
        ],
        boundary: [
          [0, 0],
          [8000, 0],
          [8000, 6000],
          [0, 6000],
        ],
        items: [{ label: '中岛桌', x: 2000, y: 2000, w: 1800, h: 1000 }],
      }),
      400,
      300,
    )
    expect(scale).toMatchObject({ mmPerPixel: 20, method: 'dimension', verified: true })
    expect(answer.boundary?.[2]).toEqual([400, 300])
    expect(answer.items[0]).toMatchObject({ x: 100, y: 100, w: 90, h: 50 })
    const draft = answerToDraft(answer, CATALOG, undefined, undefined, scale)
    expect(draft.space?.boundary[2]).toEqual([8, 6])
    expect(draft.items[0]).toMatchObject({ cx: 2.9, cz: 2.5 })
  })

  it('works the scale of relative answers out from what was read', () => {
    expect(toPixels(LlmAnswerSchema.parse(LLM_ANSWER), 400, 300).scale).toMatchObject({
      mmPerPixel: 20,
      method: 'dimension',
      verified: true,
    })
    // Without dimensions: sizes written beside props.
    const sized = toPixels(
      LlmAnswerSchema.parse({
        items: [{ label: '边桌配件柜 01', x: 100, y: 100, w: 450, h: 125, size_mm: [1800, 500] }],
      }),
      400,
      400,
    )
    expect(sized.scale).toMatchObject({ mmPerPixel: 10, method: 'item_label', verified: false })
    expect(toPixels(LlmAnswerSchema.parse({}), 400, 400).scale).toBeNull()
  })

  it('matches the words on the plan with the written size before the pick of the model', () => {
    const { answer, scale } = toPixels(
      LlmAnswerSchema.parse({
        units: 'mm',
        anchors: [
          { mm: [0, 0], at: [0, 0] },
          { mm: [3600, 3600], at: [1000, 1000] },
        ],
        boundary: [
          [0, 0],
          [3600, 0],
          [3600, 3600],
          [0, 3600],
        ],
        items: [
          {
            label: '边桌配件柜 01',
            x: 0,
            y: 0,
            w: 1800,
            h: 500,
            size_mm: [1800, 500],
            catalog_name: '1.2米配件柜',
          },
        ],
      }),
      360,
      360,
    )
    const draft = answerToDraft(answer, CATALOG, undefined, undefined, scale)
    expect(draft.items[0]).toMatchObject({ assetId: 'asset-4', rotation: 90, w: 1.8, d: 0.5 })
  })
})

describe('parseAnswer', () => {
  it('takes JSON out of fences and prose, and refuses anything else', () => {
    const answer = parseAnswer(
      '好的，结果如下：\n```json\n{"boundary": null, "items": [], "confidence": 0.4}\n```\n',
    )
    expect(answer).toMatchObject({ boundary: null, confidence: 0.4, dimensions: [] })
    expect(() => parseAnswer('看不清这张图')).toThrow('没有返回 JSON')
    expect(() => parseAnswer('{"items": "x"}')).toThrow('不符合约定格式')
  })
})

/** A model's answer for a 400 × 300 px picture, in relative coordinates (1000 = full side). */
const LLM_ANSWER = {
  dimensions: [
    { mm: 8000, a: [0, 0], b: [1000, 0] },
    { mm: 6000, a: [0, 0], b: [0, 1000] },
  ],
  boundary: [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ],
  entrances: [{ a: [375, 1000], b: [625, 1000], kind: 'main' }],
  obstacles: [
    {
      polygon: [
        [0, 0],
        [75, 0],
        [75, 100],
        [0, 100],
      ],
      kind: 'column',
      label: '柱',
    },
  ],
  items: [
    {
      label: '中岛桌',
      x: 250,
      y: 1000 / 3,
      w: 225,
      h: 500 / 3,
      source: 'existing',
      catalog_name: '1.8米普通中岛桌',
      confidence: 0.9,
    },
    {
      label: '新增电子水牌',
      x: 875,
      y: 2500 / 3,
      w: 50,
      h: 100 / 3,
      source: 'requested',
      catalog_name: null,
      confidence: 0.6,
    },
  ],
  height_mm: 3200,
  pending: ['右侧是否开放不确定'],
  confidence: 0.8,
}

const newProject = (t: TestApp) => createProject(t, { name: '识别测试', shopType: 'side_hall' })

async function upload(t: TestApp, projectId: string, body: Buffer, contentType = 'image/png') {
  return t.app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/uploads?originalName=${encodeURIComponent('简图.png')}&page=2`,
    headers: { 'content-type': contentType },
    payload: body,
  })
}

describe('recognition API without a model', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(async () => {
    await t.close()
  })

  it('stores an uploaded picture and refuses anything else', async () => {
    const { id } = await newProject(t)
    const ok = await upload(t, id, png(400, 300))
    expect(ok.statusCode).toBe(201)
    expect(ok.json<PlanUpload>()).toMatchObject({
      projectId: id,
      page: 2,
      width: 400,
      height: 300,
      originalName: '简图.png',
    })
    const list = await t.app.inject({ method: 'GET', url: `/api/v1/projects/${id}/uploads` })
    expect(list.json<PlanUpload[]>()).toHaveLength(1)

    const text = await upload(t, id, Buffer.from('not an image'), 'text/plain')
    expect(text.statusCode).toBe(400)
    const fake = await upload(t, id, Buffer.from('not a png'))
    expect(fake.statusCode).toBe(400)
    expect(fake.json().error.message).toContain('不是有效的图片')
    const jpegLabelledPng = await upload(t, id, png(50, 50), 'image/jpeg')
    expect(jpegLabelledPng.statusCode).toBe(400)
  })

  it('reads vector content locally, fails honestly without it, and confirms a space', async () => {
    const { id } = await newProject(t)
    const uploaded = (await upload(t, id, png(400, 300))).json<PlanUpload>()

    const noVector = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${uploaded.id}/recognize`,
      payload: {},
    })
    expect(noVector.statusCode).toBe(200)
    expect(noVector.json<RecognizeResponse>()).toMatchObject({
      run: { method: 'local', status: 'failed', error: expect.stringContaining('矢量') },
      attempted: null,
    })

    const local = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${uploaded.id}/recognize`,
      payload: { vector: SKETCH },
    })
    expect(local.statusCode).toBe(200)
    const { run } = local.json<RecognizeResponse>()
    expect(run).toMatchObject({ method: 'local', status: 'succeeded', error: null })
    // The test database has no catalogue, so every prop is left for the user to pick.
    expect(run.draft?.items.every((i) => i.assetId === null)).toBe(true)
    expect(run.draft?.pending.some((p) => p.includes('层高'))).toBe(true)
    expect(run.draft?.space?.boundary).toHaveLength(4)

    const runs = await t.app.inject({ method: 'GET', url: `/api/v1/uploads/${uploaded.id}/runs` })
    expect(runs.json<RecognitionRun[]>().map((r) => r.status)).toEqual(['succeeded', 'failed'])

    const confirmed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/recognition-runs/${run.id}/confirm`,
      payload: {
        name: '识别的空间',
        space: {
          schemaVersion: 1,
          boundary: run.draft?.space?.boundary,
          height: 3.2,
          entrances: run.draft?.space?.entrances,
        },
      },
    })
    expect(confirmed.statusCode).toBe(201)
    expect(confirmed.json<NodeCreated>().node).toMatchObject({
      kind: 'space',
      origin: 'recognition',
      name: '识别的空间',
    })
    const again = await t.app.inject({
      method: 'POST',
      url: `/api/v1/recognition-runs/${run.id}/confirm`,
      payload: {
        name: '再来',
        space: { schemaVersion: 1, boundary: run.draft?.space?.boundary, height: 3.2 },
      },
    })
    expect(again.statusCode).toBe(409)
    const detail = await t.app.inject({ method: 'GET', url: `/api/v1/recognition-runs/${run.id}` })
    expect(detail.json<RecognitionRun>().confirmedNodeId).toBe(
      confirmed.json<NodeCreated>().node.id,
    )
  })

  it('confirms in one transaction: a failure after the node is made leaves nothing behind', async () => {
    const { id } = await newProject(t)
    const uploaded = (await upload(t, id, png(400, 300))).json<PlanUpload>()
    const { run } = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/uploads/${uploaded.id}/recognize`,
        payload: { vector: SKETCH },
      })
    ).json<RecognizeResponse>()
    const confirm = (name: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/recognition-runs/${run.id}/confirm`,
        payload: {
          name,
          space: { schemaVersion: 1, boundary: run.draft?.space?.boundary, height: 3.2 },
        },
      })
    const nodeCount = async () =>
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/v1/projects/${id}/nodes?includeHidden=true`,
        })
      ).json<NodeTree>().nodes.length
    const confirmedNodeId = async () =>
      (
        await t.app.inject({ method: 'GET', url: `/api/v1/recognition-runs/${run.id}` })
      ).json<RecognitionRun>().confirmedNodeId

    // Step 1 (the space node) succeeds, step 2 (marking the run confirmed) fails.
    const failing = failUpdateOf(t, schema.recognitionRuns)
    try {
      expect((await confirm('半成品')).statusCode).toBe(500)
    } finally {
      failing.mockRestore()
    }
    expect(await nodeCount()).toBe(0)
    expect(await confirmedNodeId()).toBeNull()

    // The run can still be confirmed once, and only once.
    const confirmed = await confirm('识别的空间')
    expect(confirmed.statusCode).toBe(201)
    expect(await nodeCount()).toBe(1)
    expect(await confirmedNodeId()).toBe(confirmed.json<NodeCreated>().node.id)
    const again = await confirm('再来')
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({
      code: 'INVALID_STATE',
      message: '这次识别已经确认过，生成了空间节点',
    })
    expect(await nodeCount()).toBe(1)
  })
})

describe('recognition API with a fallback model', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp({ DASHSCOPE_API_KEY: 'sk-test', AI_DAILY_BUDGET_CNY: '50' })
  })
  afterAll(async () => {
    await t.close()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands a picture without vector content to the model, books the call and keeps both runs', async () => {
    const { id } = await newProject(t)
    const uploaded = (await upload(t, id, png(400, 300))).json<PlanUpload>()
    const sent: { model: string; images: number }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { model: string; messages: { content: unknown }[] }
        const last = body.messages[body.messages.length - 1]?.content
        sent.push({
          model: body.model,
          images: Array.isArray(last)
            ? last.filter((c: { type: string }) => c.type === 'image_url').length
            : 0,
        })
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: `\`\`\`json\n${JSON.stringify(LLM_ANSWER)}\n\`\`\`` } },
            ],
            usage: { prompt_tokens: 3000, completion_tokens: 600 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${uploaded.id}/recognize`,
      payload: {},
    })
    expect(response.statusCode).toBe(200)
    const { run, attempted } = response.json<RecognizeResponse>()
    expect(sent).toEqual([{ model: 'qwen3-vl-plus', images: 1 }])
    expect(attempted).toMatchObject({ method: 'local', status: 'failed' })
    expect(run).toMatchObject({
      method: 'llm',
      model: 'qwen3-vl-plus',
      status: 'succeeded',
      fallbackOf: attempted?.id,
    })
    const draft = run.draft
    expect(draft?.scale).toMatchObject({ method: 'dimension', verified: true, mmPerPixel: 20 })
    expect(draft?.space).toMatchObject({ height: 3.2 })
    expect(draft?.space?.boundary).toEqual([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    expect(draft?.space?.obstacles[0]).toMatchObject({ kind: 'column', label: '柱' })
    expect(draft?.items[0]).toMatchObject({ label: '中岛桌', source: 'existing', cx: 2.9, cz: 2.5 })
    expect(draft?.items[1]).toMatchObject({ source: 'requested', assetId: null })
    expect(draft?.pending).toContain('右侧是否开放不确定')
    expect(draft?.notes.some((n) => n.includes('本地识别未通过'))).toBe(true)

    const budget = await t.app.inject({ method: 'GET', url: '/api/v1/ai/budget' })
    expect(budget.json().spentCny).toBeGreaterThan(0)
  })
})
