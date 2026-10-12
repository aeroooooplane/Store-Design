import { z } from 'zod'
import { roundM } from '@store/shared'
import type { Asset, DraftItem, RecognitionDraft, RecognizeRequest } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { matchCatalog } from './check.ts'

/**
 * Plan recognition by a vision model. The model reads pixels and text and answers in one JSON
 * object in picture pixels; the server converts to metres, matches names to the catalogue and
 * checks the geometry like any other draft.
 */

const Px = z.number().finite()
const PointPx = z.tuple([Px, Px])

export const LlmAnswerSchema = z.object({
  scale: z
    .object({
      mm_per_pixel: z.number().positive().nullable(),
      basis: z.enum(['dimension', 'item_label', 'none']),
      reference: z.string().max(300).default(''),
      /** More than one dimension agreed. */
      cross_checked: z.boolean().default(false),
    })
    .default({ mm_per_pixel: null, basis: 'none', reference: '', cross_checked: false }),
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
    '请把看到的内容整理成一个 JSON 对象（只输出 JSON，不要任何其他文字、不要代码围栏），坐标一律用图片像素，左上角为原点，x 向右，y 向下。',
    '',
    '字段：',
    '- scale: { mm_per_pixel: 数或 null, basis: "dimension"|"item_label"|"none", reference: 依据说明, cross_checked: 是否有两处以上尺寸互相印证 }。比例优先按图上的尺寸标注（总尺寸、分段尺寸，单位毫米或米）与其尺寸线的像素长度计算；没有尺寸时可按带尺寸的道具名称（如“1.2米配件柜”）和它的图框推算；都没有就填 null，不要猜。',
    '- boundary: 门店边界多边形的顶点列表（像素），按顺序；只画门店本身，不含外部通道、楼梯、相邻店铺；无法确定填 null。',
    '- entrances: 入口线段 [{a:[x,y], b:[x,y], kind:"main"|"side"}]，必须落在边界上；有“主入口”“入口”文字、箭头或开口处才填。',
    '- obstacles: 边界内不能摆放的固定物 [{polygon, kind:"column"|"shaft"|"stair"|"fixed"|"other", label}]（柱子、配电间、消防、服务台、楼梯等）。',
    '- items: 道具 [{label, x, y, w, h, source, catalog_name, confidence, note}]：label 为图上文字；x,y,w,h 为该道具图框的像素外框；source：现状道具填 "existing"，红色标注、红框或文字写明“新增/增加/放置”的填 "requested"，边界之外的填 "outside"；catalog_name 从下面的模型库名称里选最贴切的一个，选不出填 null；confidence 0–1。文字写“×2”“*2”且画了两个框时输出两条。',
    '- height_mm: 层高（毫米），图上没有填 null。',
    '- pending: 识别不到或拿不准、需要人工确认的事项（中文，逐条）。',
    '- confidence: 对整体结果的把握 0–1。',
    '',
    '规则：看不清或没有依据的内容填 null 或放进 pending，不要编造；不要把尺寸线、尺寸数字、文字说明当作道具或墙；灰色块、“楼梯”“边柜”“桌子”等若在边界外属于区域外环境。',
    '',
    `模型库名称：${names.join('、')}`,
  ].join('\n')
  const user = crop
    ? `请识别这张图中从 (${Math.round(crop.x)}, ${Math.round(crop.y)}) 开始、宽 ${Math.round(crop.w)}、高 ${Math.round(crop.h)} 像素的区域内的门店平面，坐标仍以整张图片的左上角为原点。`
    : '请识别这张门店平面简图。'
  return { system, user }
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
): RecognitionDraft {
  const notes: string[] = []
  const pending = [...answer.pending]
  let mmPerPixel = answer.scale.mm_per_pixel
  let method: 'dimension' | 'item_label' | 'manual' | 'llm' =
    answer.scale.basis === 'none' ? 'llm' : answer.scale.basis
  let reference = answer.scale.reference
  let verified = answer.scale.cross_checked
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
    const drawn = { w: lenM(item.w), d: lenM(item.h) }
    const match = matchCatalog(item.catalog_name ?? item.label, catalog, drawn, siStyle)
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
