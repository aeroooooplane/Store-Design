import { z } from 'zod'
import { roundM } from '@store/shared'
import type { Asset, DraftItem, RecognitionDraft, RecognizeRequest } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { matchCatalog, sizeInLabel } from './check.ts'

/**
 * Plan recognition by a vision model. The model reads the picture and answers in one JSON object
 * in relative coordinates (the picture is 1000 × 1000 whatever its size: Qwen3-VL's own
 * convention, and one any model can follow); the server turns them into pixels, works the scale
 * out from the dimensions the model read (the model only reads, it does not calculate), converts
 * to metres, matches names to the catalogue and checks the geometry like any other draft.
 */

/** Relative coordinates run 0 → 1000 across the picture. */
export const RELATIVE = 1000
const Px = z.number().finite()
const PointPx = z.tuple([Px, Px])

export const LlmAnswerSchema = z.object({
  /**
   * 'mm': geometry in millimetres worked out from the plan's dimensions (origin at the top left
   * of the shop), placed on the picture by `anchors`; 'relative': picture coordinates 0–1000.
   */
  units: z.enum(['mm', 'relative']).default('relative'),
  /** Points known both in millimetres and on the picture (relative), for the 'mm' answers. */
  anchors: z
    .array(z.object({ mm: PointPx, at: PointPx }))
    .max(10)
    .default([]),
  /** Dimension annotations the model read: the value and the two ends of its dimension line. */
  dimensions: z
    .array(z.object({ mm: z.number().positive(), a: PointPx, b: PointPx }))
    .max(50)
    .default([]),
  boundary: z.array(PointPx).min(3).max(100).nullable().default(null),
  entrances: z
    .array(z.object({ a: PointPx, b: PointPx, kind: z.enum(['main', 'side']).default('main') }))
    .max(10)
    .default([]),
  obstacles: z
    .array(
      z.object({
        polygon: z.array(PointPx).min(3).max(20),
        kind: z.enum(['column', 'shaft', 'stair', 'fixed', 'other']).default('other'),
        label: z.string().max(100).nullable().default(null),
      }),
    )
    .max(50)
    .default([]),
  items: z
    .array(
      z.object({
        label: z.string().max(100),
        /** Axis-aligned box in picture pixels. */
        x: Px,
        y: Px,
        w: z.number().positive(),
        h: z.number().positive(),
        source: z.enum(['existing', 'requested', 'outside']).default('existing'),
        /** A size written on the plan for this prop ("1800 × 500"), long side first, in mm. */
        size_mm: z.tuple([z.number().positive(), z.number().positive()]).nullable().default(null),
        catalog_name: z.string().max(100).nullable().default(null),
        confidence: z.number().min(0).max(1).default(0.5),
        note: z.string().max(300).nullable().default(null),
      }),
    )
    .max(200)
    .default([]),
  height_mm: z.number().positive().max(20000).nullable().default(null),
  pending: z.array(z.string().max(300)).max(50).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
})
export type LlmAnswer = z.infer<typeof LlmAnswerSchema>

/** The instructions a vision model gets, with the catalogue names it may use. */
export function buildPrompt(
  catalog: readonly Asset[],
  crop: RecognizeRequest['crop'],
): { system: string; user: string } {
  const names = [...new Set(catalog.filter((a) => !a.retired).map((a) => a.name))].slice(0, 120)
  const system = [
    '你是门店平面简图的识别助手。图片是一张门店的平面示意图，可能是手绘、CAD 截图或设计稿；可能只有轮廓、一两个尺寸、用方框代表的道具、红色标注的新增需求和文字指令。',
    '请把看到的内容整理成一个 JSON 对象（只输出 JSON，不要任何其他文字、不要代码围栏）。坐标有两种写法，用 units 说明：',
    '- units: "mm"（图上有尺寸标注时必须用）：所有坐标都是实际毫米，以门店边界外接矩形的左上角为 [0,0]，x 向右，y 向下；按图上的尺寸标注推算位置和大小，与标注数值一致（例如总宽标 3450，边界就宽 3450）。同时给 anchors：至少两个相距较远的点（如边界左上角和右下角），每个写出毫米坐标 mm 和它在图片上的相对位置 at（不论图片多大，把宽和高都看作 1000，左上角 [0,0]，右下角 [1000,1000]）。',
    '- units: "relative"（图上没有任何尺寸标注时）：坐标都用上面说的图片相对位置（0–1000），anchors 留空。',
    '道具外框的 x、y、w、h 与其他坐标用同一种写法。',
    '',
    '字段：',
    '- dimensions: 图上的尺寸标注 [{mm, a:[x,y], b:[x,y]}]：mm 为标注的数值（换算成毫米），a、b 为被标注的那段长度的两端（坐标写法同上）。总尺寸、分段尺寸都列出来；没有尺寸标注就给空数组。',
    '- boundary: 门店边界多边形的顶点列表，按顺序；只画门店本身，不含外部通道、楼梯、相邻店铺；无法确定填 null。',
    '- entrances: 入口线段 [{a:[x,y], b:[x,y], kind:"main"|"side"}]，必须落在边界上；有“主入口”“入口”文字、箭头或开口处才填。',
    '- obstacles: 边界内不能摆放的固定物 [{polygon, kind:"column"|"shaft"|"stair"|"fixed"|"other", label}]（柱子、配电间、消防、服务台、楼梯等）。',
    '- items: 道具 [{label, x, y, w, h, source, size_mm, catalog_name, confidence, note}]：label 为图上道具名称文字；x,y,w,h 为该道具图框的外框（左上角与宽高）；size_mm：图上为这件道具写明的尺寸（如“1800 × 500”），按 [长边, 短边] 毫米填写，没写填 null；source：现状道具填 "existing"，红色标注、红框或文字写明“新增/增加/放置”的填 "requested"，边界之外的填 "outside"；catalog_name 从下面的模型库名称里选最贴切的一个，选不出填 null；confidence 0–1。文字写“×2”“*2”且画了两个框时输出两条。',
    '- height_mm: 层高（毫米），图上没有填 null。',
    '- pending: 识别不到或拿不准、需要人工确认的事项（中文，逐条）。',
    '- confidence: 对整体结果的把握 0–1。',
    '',
    '规则：看不清或没有依据的内容填 null 或放进 pending，不要编造；不要把尺寸线、尺寸数字、文字说明当作道具或墙；灰色块、“楼梯”“边柜”“桌子”等若在边界外属于区域外环境。',
    '',
    `模型库名称：${names.join('、')}`,
  ].join('\n')
  const user = crop
    ? `请识别这张图中从 (${Math.round(crop.x)}, ${Math.round(crop.y)}) 开始、宽 ${Math.round(crop.w)}、高 ${Math.round(crop.h)} 的区域（相对坐标）内的门店平面，坐标仍按整张图片计算。`
    : '请识别这张门店平面简图。'
  return { system, user }
}

export interface Scale {
  mmPerPixel: number
  method: 'dimension' | 'item_label'
  reference: string
  verified: boolean
}

/** Millimetres per picture pixel and where the millimetre origin sits on the picture. */
interface Placement {
  mmPerPixel: number
  origin: [number, number]
  /** x and y agreed (the anchors are consistent). */
  consistent: boolean
}

/** Fits picture = origin + mm / scale through the anchors (pixels), axis by axis. */
function place(anchors: { mm: [number, number]; px: [number, number] }[]): Placement | null {
  const fit = (k: 0 | 1) => {
    const n = anchors.length
    const mm = anchors.map((p) => p.mm[k])
    const px = anchors.map((p) => p.px[k])
    const mmMean = mm.reduce((x, y) => x + y, 0) / n
    const pxMean = px.reduce((x, y) => x + y, 0) / n
    let cov = 0
    let variance = 0
    for (let i = 0; i < n; i++) {
      cov += ((mm[i] ?? 0) - mmMean) * ((px[i] ?? 0) - pxMean)
      variance += ((mm[i] ?? 0) - mmMean) ** 2
    }
    // Pixels per millimetre; meaningless when the anchors do not spread along this axis.
    return variance > 1e4 && cov > 0 ? { perMm: cov / variance, mmMean, pxMean } : null
  }
  const fx = fit(0)
  const fy = fit(1)
  const rates = [fx, fy].filter((f) => f !== null)
  if (!rates.length) return null
  const perMm = rates.reduce((x, f) => x + f.perMm, 0) / rates.length
  const origin = (f: typeof fx, k: 0 | 1): number =>
    f ? f.pxMean - f.mmMean * perMm : (anchors[0]?.px[k] ?? 0) - (anchors[0]?.mm[k] ?? 0) * perMm
  return {
    mmPerPixel: 1 / perMm,
    origin: [origin(fx, 0), origin(fy, 1)],
    consistent: Boolean(fx && fy && Math.abs(fx.perMm - fy.perMm) / perMm < 0.08),
  }
}

/**
 * The answer in picture pixels, and the scale when the answer itself fixes it. Millimetre
 * answers are placed on the picture by their anchors (without usable anchors they keep 1 px =
 * 1 mm: the plan is right, its overlay on the picture is not); relative ones are stretched over
 * the picture and their scale is worked out from what was read (scaleOf).
 */
export function toPixels(
  answer: LlmAnswer,
  width: number,
  height: number,
): { answer: LlmAnswer; scale: Scale | null } {
  const kx = width / RELATIVE
  const ky = height / RELATIVE
  const relative = (pt: [number, number]): [number, number] => [pt[0] * kx, pt[1] * ky]
  if (answer.units === 'relative') {
    const converted = convert(answer, relative, kx, ky)
    return { answer: converted, scale: scaleOf(converted) }
  }
  const placement = place(answer.anchors.map((x) => ({ mm: x.mm, px: relative(x.at) })))
  const k = placement ? 1 / placement.mmPerPixel : 1
  const [ox, oy] = placement?.origin ?? [0, 0]
  const fromMm = (pt: [number, number]): [number, number] => [ox + pt[0] * k, oy + pt[1] * k]
  // The dimensions read must match the geometry drawn from them.
  const agreeing = answer.dimensions.filter(
    (d) => Math.abs(Math.hypot(d.a[0] - d.b[0], d.a[1] - d.b[1]) - d.mm) <= d.mm * 0.03,
  ).length
  return {
    answer: convert(answer, fromMm, k, k),
    scale: {
      mmPerPixel: placement?.mmPerPixel ?? 1,
      method: 'dimension',
      reference: placement
        ? `按尺寸标注换算的毫米坐标，${answer.anchors.length} 个锚点对齐到图上`
        : '按尺寸标注换算的毫米坐标（没有可用的锚点，图上叠加位置不准）',
      verified: Boolean(placement?.consistent) && agreeing >= 2,
    },
  }
}

function convert(
  answer: LlmAnswer,
  p: (pt: [number, number]) => [number, number],
  kx: number,
  ky: number,
): LlmAnswer {
  return {
    ...answer,
    dimensions: answer.dimensions.map((d) => ({ ...d, a: p(d.a), b: p(d.b) })),
    boundary: answer.boundary?.map(p) ?? null,
    entrances: answer.entrances.map((e) => ({ ...e, a: p(e.a), b: p(e.b) })),
    obstacles: answer.obstacles.map((o) => ({ ...o, polygon: o.polygon.map(p) })),
    items: answer.items.map((i) => {
      const [x, y] = p([i.x, i.y])
      return { ...i, x, y, w: i.w * kx, h: i.h * ky }
    }),
  }
}

/** Readings that agree within 5 % with the most others; their mean, and how many agreed. */
function consensus(values: number[]): { value: number; agreeing: number } | null {
  let best: number[] = []
  for (const v of values) {
    const near = values.filter((w) => Math.abs(w - v) <= v * 0.05)
    if (near.length > best.length) best = near
  }
  if (!best.length) return null
  return { value: best.reduce((a, b) => a + b, 0) / best.length, agreeing: best.length }
}

/**
 * Millimetres per pixel from what the model read (answer in pixels): dimension lines first,
 * then sizes written beside props, then sizes in prop names ("1.2米配件柜").
 */
export function scaleOf(answer: LlmAnswer): Scale | null {
  const lines = answer.dimensions
    .map((d) => ({ mm: d.mm, px: Math.hypot(d.a[0] - d.b[0], d.a[1] - d.b[1]) }))
    .filter((d) => d.px >= 8)
  const fromLines = consensus(lines.map((d) => d.mm / d.px))
  if (fromLines) {
    return {
      mmPerPixel: fromLines.value,
      method: 'dimension',
      reference: `尺寸标注 ${lines.map((d) => d.mm).join('、')} mm 与其尺寸线长度（${fromLines.agreeing} 处一致）`,
      verified: fromLines.agreeing >= 2,
    }
  }
  const sized = answer.items.flatMap((item) => {
    const longPx = Math.max(item.w, item.h)
    const mm = item.size_mm ? Math.max(...item.size_mm) : (sizeInLabel(item.label) ?? 0) * 1000
    return longPx >= 8 && mm > 0 ? [{ label: item.label, ratio: mm / longPx }] : []
  })
  const fromItems = consensus(sized.map((s) => s.ratio))
  if (!fromItems) return null
  return {
    mmPerPixel: fromItems.value,
    method: 'item_label',
    reference: `带尺寸的道具 ${sized.map((s) => s.label).join('、')}（${fromItems.agreeing} 处一致）`,
    verified: fromItems.agreeing >= 2,
  }
}

/** How far a model's footprint is from what was drawn (either way round), in metres. */
function misfit(asset: Asset | null, drawn: { w: number; d: number }): number {
  if (!asset) return Infinity
  const { w, d } = asset.footprint
  return Math.min(
    Math.abs(w - drawn.w) + Math.abs(d - drawn.d),
    Math.abs(d - drawn.w) + Math.abs(w - drawn.d),
  )
}

/** Takes the JSON out of the model's text (it may wrap it in a code fence despite the rules). */
export function parseAnswer(text: string): LlmAnswer {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new AppError('UPSTREAM_FAILED', '模型没有返回 JSON 结果')
  }
  let raw: unknown
  try {
    raw = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    throw new AppError('UPSTREAM_FAILED', '模型返回的 JSON 无法解析')
  }
  const parsed = LlmAnswerSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError(
      'UPSTREAM_FAILED',
      '模型返回的结果不符合约定格式',
      parsed.error.issues.slice(0, 5),
    )
  }
  return parsed.data
}

/** Pixels to metres, catalogue matching, and the record of where the scale came from. */
export function answerToDraft(
  answer: LlmAnswer,
  catalog: readonly Asset[],
  calibration: RecognizeRequest['calibration'],
  siStyle?: string,
  /** The scale `toPixels` found; worked out from the answer when not given. */
  found?: Scale | null,
): RecognitionDraft {
  const notes: string[] = []
  const pending = [...answer.pending]
  const read = found === undefined ? scaleOf(answer) : found
  let mmPerPixel = read?.mmPerPixel ?? null
  let method: 'dimension' | 'item_label' | 'manual' | 'llm' = read?.method ?? 'llm'
  let reference = read?.reference ?? ''
  let verified = read?.verified ?? false
  if (calibration) {
    const px = Math.hypot(calibration.a[0] - calibration.b[0], calibration.a[1] - calibration.b[1])
    if (px > 0) {
      mmPerPixel = calibration.mm / px
      method = 'manual'
      reference = `用户指定 ${calibration.mm} mm 对应 ${px.toFixed(1)} px`
      verified = true
      notes.push('比例来自用户校准')
    }
  }
  if (!mmPerPixel) {
    return {
      space: null,
      items: [],
      scale: null,
      pending,
      confidence: 0,
      notes: ['模型未能标定比例'],
    }
  }
  const xs = answer.boundary?.map((p) => p[0]) ?? []
  const ys = answer.boundary?.map((p) => p[1]) ?? []
  const originPx: [number, number] = [
    xs.length ? Math.min(...xs) : 0,
    ys.length ? Math.min(...ys) : 0,
  ]
  const scaleM = mmPerPixel
  const toM = (px: number, axis: 0 | 1) => roundM(((px - originPx[axis]) * scaleM) / 1000)
  const lenM = (px: number) => roundM((px * scaleM) / 1000)
  const pt = (p: [number, number]): [number, number] => [toM(p[0], 0), toM(p[1], 1)]

  const items: DraftItem[] = answer.items.map((item, index) => {
    // A size written on the plan beats the box; it is turned the way the box is drawn.
    const written = item.size_mm
      ? [Math.max(...item.size_mm) / 1000, Math.min(...item.size_mm) / 1000]
      : null
    const drawn = written
      ? item.w >= item.h
        ? { w: written[0] ?? 0, d: written[1] ?? 0 }
        : { w: written[1] ?? 0, d: written[0] ?? 0 }
      : { w: lenM(item.w), d: lenM(item.h) }
    // The words on the plan first; the model's pick only when it fits the drawn size better.
    const byLabel = matchCatalog(item.label, catalog, drawn, siStyle)
    const byName = item.catalog_name
      ? matchCatalog(item.catalog_name, catalog, drawn, siStyle)
      : null
    const match =
      byName &&
      (!byLabel.asset || misfit(byName.asset, drawn) < misfit(byLabel.asset, drawn) - 0.05)
        ? byName
        : byLabel
    const footprint = match.asset?.footprint
    const rotation = footprint && item.w >= item.h !== footprint.w >= footprint.d ? 90 : 0
    return {
      ref: `m${index + 1}`,
      label: item.label,
      assetId: match.asset?.id ?? null,
      function: match.function,
      source: item.source,
      cx: toM(item.x + item.w / 2, 0),
      cz: toM(item.y + item.h / 2, 1),
      w: footprint ? (rotation ? footprint.d : footprint.w) : drawn.w,
      d: footprint ? (rotation ? footprint.w : footprint.d) : drawn.d,
      rotation,
      confidence: Math.min(item.confidence, match.confidence),
      note: [item.note, match.note].filter(Boolean).join('；') || null,
    }
  })

  const space: RecognitionDraft['space'] = answer.boundary
    ? {
        boundary: answer.boundary.map(pt),
        entrances: answer.entrances.map((e) => ({ a: pt(e.a), b: pt(e.b), kind: e.kind })),
        obstacles: answer.obstacles.map((o) => ({
          kind: o.kind,
          polygon: o.polygon.map(pt),
          height: null,
          label: o.label,
        })),
        height: answer.height_mm ? answer.height_mm / 1000 : null,
      }
    : null
  notes.push(`比例${reference ? `：${reference}` : '由模型给出'}（1 px = ${scaleM.toFixed(2)} mm）`)
  return {
    space,
    items,
    scale: { method, reference: reference || '模型给出', mmPerPixel: scaleM, originPx, verified },
    pending,
    confidence: answer.confidence,
    notes,
  }
}
