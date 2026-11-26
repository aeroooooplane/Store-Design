import { fromVector } from './detect-vector.ts'
export { fromVector, tableOutlines } from './detect-vector.ts'
import sharp from 'sharp'
import { z } from 'zod'
import type { Database } from '@store/database'
import { orderTables, sideEntrance } from '@store/shared'
import type {
  DisplayRules,
  EntranceSide,
  Market,
  RecognitionDraft,
  SiStyle,
  TaskTable,
  VectorContent,
} from '@store/shared'
import { chat } from '../../ai/chat.ts'
import { LOCAL_MODEL_ID, findModel, isAvailable } from '../../ai/models.ts'
import { readSettings } from '../../ai/settings.ts'
import type { AppConfig } from '../../config/env.ts'
import { catalogAssets } from '../assets/service.ts'
import { recognizeVector } from '../recognition/local.ts'

/** Labels that name a table we do not lay out even when a reader calls it a 中岛桌. */
const NOT_DISPLAY = /开箱|收银|储物柜(?!.*托盘)|配件柜|吧台|休息/
const ISLAND = /中岛(桌|台)/
const SIDE = /边桌|边柜/

export interface Detection {
  tables: TaskTable[]
  entrance: EntranceSide
  method: 'local' | 'model' | 'manual'
  notes: string[]
  recognition: RecognitionDraft | null
}

interface Picture {
  data: Buffer
  width: number
  height: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** A remote vision model the site may use for plans (recognition model, then its fallback). */
async function visionModel(db: Database, config: AppConfig): Promise<string | null> {
  const settings = await readSettings(db, config.ai)
  for (const id of [settings.recognitionModel, settings.recognitionFallback]) {
    if (!id || id === LOCAL_MODEL_ID) continue
    const spec = findModel(id)
    if (spec?.vision && isAvailable(spec, config.ai)) return id
  }
  return null
}

const jpeg = async (data: Buffer, side = 2000) =>
  (
    await sharp(data)
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()
  ).toString('base64')

/** The model's JSON, tolerant of a code fence around it. */
function parseJson(text: string): unknown {
  const body = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
}

const Box = z.tuple([z.number(), z.number(), z.number(), z.number()])
const PlanAnswer = z.object({
  entrance: z.enum(['上', '下', '左', '右']).nullable().optional(),
  items: z.array(
    z.object({
      type: z.string(),
      label: z.string().default(''),
      bbox_2d: Box,
    }),
  ),
})
const RenderAnswer = z.object({
  /** The shop's entrance (glass doors, shop front, the mall outside) is seen far away. */
  entranceVisible: z.boolean().optional(),
  items: z.array(z.object({ type: z.string().default('中岛桌'), bbox_2d: Box })),
})
const SIDE_OF: Record<string, EntranceSide> = { 上: 'top', 下: 'bottom', 左: 'left', 右: 'right' }

async function fromModel(
  db: Database,
  config: AppConfig,
  model: string,
  plan: Picture,
  ref: string,
): Promise<{ tables: TaskTable[]; entrance: EntranceSide | null }> {
  const result = await chat(db, config, {
    purpose: 'recognition',
    modelId: model,
    json: true,
    ref: { type: 'display_task', id: ref },
    messages: [
      {
        role: 'user',
        images: [{ mediaType: 'image/jpeg', base64: await jpeg(plan.data) }],
        content: `这是门店平面布置图（CAD 导出）。请找出店内所有“中岛桌”（含 X系列/GO系列/ACE系列 等标注）和“边桌/边柜”（靠墙、带托盘的低柜），不要把开箱桌、收银台、配件柜、储物柜算进去。读出每张桌旁边的文字标注，并判断主入口或主人流方向在图的哪一侧。
只输出 JSON：{"entrance":"上|下|左|右","items":[{"type":"中岛桌|边桌","label":"图上文字","bbox_2d":[x1,y1,x2,y2]}]}，坐标为 0-1000 相对坐标。`,
      },
    ],
  })
  const answer = PlanAnswer.parse(parseJson(result.text))
  const tables: TaskTable[] = []
  for (const item of answer.items) {
    if (NOT_DISPLAY.test(item.label)) continue
    const island = item.type.includes('中岛') || ISLAND.test(item.label)
    const side = !island && (item.type.includes('边') || SIDE.test(item.label))
    if (!island && !side) continue
    const [x1, y1, x2, y2] = item.bbox_2d.map((v) => clamp01(v / 1000)) as [
      number,
      number,
      number,
      number,
    ]
    tables.push({
      id: `t${tables.length + 1}`,
      kind: island ? 'island' : 'side',
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      render: null,
      label: item.label || null,
    })
  }
  return { tables, entrance: answer.entrance ? (SIDE_OF[answer.entrance] ?? null) : null }
}

/** Groups items into rows along one coordinate (a gap wider than `gap` starts a new row). */
function rows<T>(items: T[], key: (t: T) => number, gap: number): T[][] {
  const out: T[][] = []
  for (const t of [...items].sort((a, b) => key(a) - key(b))) {
    const row = out.at(-1)
    const last = row?.at(-1)
    if (row && last !== undefined && key(t) - key(last) <= gap) row.push(t)
    else out.push([t])
  }
  return out
}

/**
 * The render: the model only boxes the island and side tables and says whether the shop's
 * entrance is seen far away; the program matches them to the plan. Seen from the entrance
 * side, the table nearest the camera is the one nearest the entrance and left stays left;
 * looking towards the entrance, both turn round. (2026-10-14: asked to match tables itself,
 * the model mixed them up and counted the unboxing table as an island table.)
 */
async function renderMarks(
  db: Database,
  config: AppConfig,
  model: string,
  render: Picture,
  plan: { id: string; kind: 'island' | 'side'; x: number; y: number }[],
  entrance: EntranceSide,
  ref: string,
): Promise<{ marks: Map<string, { x: number; y: number }>; facing: string | null }> {
  const result = await chat(db, config, {
    purpose: 'recognition',
    modelId: model,
    json: true,
    ref: { type: 'display_task', id: ref },
    messages: [
      {
        role: 'user',
        images: [{ mediaType: 'image/jpeg', base64: await jpeg(render.data, 1600) }],
        content: `这是一张手机/相机品牌门店的室内效果图。
1. 画面远处（消失点附近）能否看到店铺门口：玻璃门、门头、店外的商场过道或别家店铺？能看到回答 true，看不到回答 false。
2. 框出所有“中岛桌”（店中间、台面摆着产品和支架的展示台）和“边桌”（靠墙、台面带产品托盘的低柜）。不要框开箱桌（台面空、旁边有高脚凳）、收银台（带电脑）、靠墙的高配件柜。被挡住一部分的也要框。
只输出 JSON：{"entranceVisible":true,"items":[{"type":"中岛桌|边桌","bbox_2d":[x1,y1,x2,y2]}]}，坐标为 0-1000 相对坐标。`,
      },
    ],
  })
  const answer = RenderAnswer.parse(parseJson(result.text))
  const towardsEntrance = answer.entranceVisible === true
  // Plan: distance from the entrance and left/right as seen walking in (0–1 of the picture).
  const depthOf = (t: { x: number; y: number }) =>
    entrance === 'bottom' ? 1 - t.y : entrance === 'top' ? t.y : entrance === 'left' ? t.x : 1 - t.x
  const lateralOf = (t: { x: number; y: number }) =>
    entrance === 'bottom' ? t.x : entrance === 'top' ? 1 - t.x : entrance === 'left' ? t.y : 1 - t.y
  const boxes = answer.items.map((item) => {
    const [x1, y1, x2, y2] = item.bbox_2d.map((v) => clamp01(v / 1000)) as [
      number,
      number,
      number,
      number,
    ]
    return {
      kind: item.type.includes('边') ? 'side' : 'island',
      x: (x1 + x2) / 2,
      // Lower edge on the picture: the larger, the nearer the camera.
      near: Math.max(y1, y2),
      mark: { x: (x1 + x2) / 2, y: Math.min(y1, y2) + Math.abs(y2 - y1) * 0.3 },
    }
  })
  const marks = new Map<string, { x: number; y: number }>()
  for (const kind of ['island', 'side'] as const) {
    // Plan tables in the order the camera meets them: nearest row first, left to right.
    const planRows = rows(
      plan.filter((t) => t.kind === kind),
      (t) => (towardsEntrance ? -depthOf(t) : depthOf(t)),
      0.04,
    ).map((row) =>
      row.sort((a, b) =>
        towardsEntrance ? lateralOf(b) - lateralOf(a) : lateralOf(a) - lateralOf(b),
      ),
    )
    const planOrder = planRows.flat()
    const seen = boxes.filter((b) => b.kind === kind).sort((a, b) => b.near - a.near)
    // Perspective tilts a row on the picture: when every table was boxed, cut the boxes into the
    // plan's rows by count (nearest first), else by the gaps between their lower edges.
    const renderRows =
      seen.length === planOrder.length
        ? planRows.map((row, i) => {
            const start = planRows.slice(0, i).reduce((n, r) => n + r.length, 0)
            return seen.slice(start, start + row.length)
          })
        : rows(seen, (b) => -b.near, 0.08)
    const renderOrder = renderRows.map((row) => [...row].sort((a, b) => a.x - b.x)).flat()
    planOrder.forEach((t, i) => {
      const box = renderOrder[i]
      if (box) marks.set(t.id, box.mark)
    })
  }
  return {
    marks,
    facing: answer.entranceVisible === undefined ? null : towardsEntrance ? '朝入口' : '朝店内',
  }
}

/** Labels spread along the middle of the render, for the user to drag onto the tables. */
function spreadMarks(tables: TaskTable[]): TaskTable[] {
  return tables.map((t, i) => ({
    ...t,
    render: t.render ?? { x: (i + 1) / (tables.length + 1), y: 0.62 },
  }))
}

/**
 * Finds the tables of a display task: locally from a vector PDF page, else with the vision
 * model; then their places on the render. Every step can fail without losing the others; the
 * notes say what to check by hand.
 */
export async function detectTables(
  db: Database,
  config: AppConfig,
  input: {
    taskId: string
    rules: DisplayRules
    market: Market
    siStyle: SiStyle
    plan: Picture
    render: Picture | null
    vector: VectorContent | undefined
    useModel: boolean
  },
): Promise<Detection> {
  const notes: string[] = []
  let tables: TaskTable[] = []
  let entrance: EntranceSide | null = null
  let method: Detection['method'] = 'manual'
  let recognition: RecognitionDraft | null = null

  if (input.vector) {
    const draft = recognizeVector(
      input.vector,
      {},
      [...(await catalogAssets(db)).values()],
      input.siStyle,
    )
    recognition = draft
    ;({ tables, entrance } = fromVector(draft, input.vector, input.plan))
    if (tables.length) {
      method = 'local'
      notes.push(
        `本地识别找到中岛桌 ${tables.filter((t) => t.kind === 'island').length} 张、边桌 ${tables.filter((t) => t.kind === 'side').length} 张`,
      )
    } else {
      notes.push(draft.scale ? '本地识别没有找到中岛桌' : '本地识别没有读出比例，无法定位桌子')
    }
  }
  const model = input.useModel ? await visionModel(db, config) : null
  if (!tables.length && model) {
    try {
      ;({ tables, entrance } = await fromModel(db, config, model, input.plan, input.taskId))
      method = 'model'
      notes.push(
        `视觉模型找到中岛桌 ${tables.filter((t) => t.kind === 'island').length} 张、边桌 ${tables.filter((t) => t.kind === 'side').length} 张，请核对`,
      )
    } catch (error) {
      notes.push(
        `视觉模型识别平面图失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } else if (!tables.length && input.useModel) {
    notes.push('没有可用的视觉模型（设置页配置密钥后可用），请在平面图上点击添加桌子')
  }
  if (!entrance) notes.push('没有读出主入口方向，暂按“下方”处理，请核对')
  const side = entrance ?? 'bottom'

  if (input.render && tables.length) {
    let marked = false
    if (model) {
      try {
        const { marks, facing } = await renderMarks(
          db,
          config,
          model,
          input.render,
          tables.map((t) => ({ id: t.id, kind: t.kind, x: t.x, y: t.y })),
          side,
          input.taskId,
        )
        tables = tables.map((t) => {
          const mark = marks.get(t.id)
          return mark ? { ...t, render: mark } : t
        })
        marked = tables.some((t) => t.render)
        if (facing) notes.push(`视觉模型判断效果图镜头${facing}拍摄`)
        notes.push(
          `效果图上由视觉模型标出 ${tables.filter((t) => t.render).length} 张桌，对应关系常有错，请拖动标签核对`,
        )
      } catch (error) {
        notes.push(
          `视觉模型标注效果图失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (!marked) notes.push('效果图上的标签先排成一行，请拖到对应的桌子上')
    tables = spreadMarks(tables)
  }
  // Keep the guide's numbering order (A first) in the stored list.
  const byId = new Map(tables.map((t) => [t.id, t]))
  const ordered = orderTables(
    tables.map((t) => ({
      id: t.id,
      kind: t.kind,
      cx: t.x * input.plan.width,
      cz: t.y * input.plan.height,
      w: t.w * input.plan.width,
      d: t.h * input.plan.height,
    })),
    sideEntrance(
      side,
      tables.map((t) => ({ cx: t.x * input.plan.width, cz: t.y * input.plan.height })),
    ),
  )
  return {
    tables: ordered.flatMap((o) => {
      const t = byId.get(o.id)
      return t ? [t] : []
    }),
    entrance: side,
    method,
    notes,
    recognition,
  }
}
