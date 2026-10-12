import { z } from 'zod'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  ITEM_FUNCTIONS,
  ITEM_FUNCTION_LABELS,
  SHOP_TYPE_LABELS,
  RotationSchema,
  polygonArea,
  rectangleSpace,
  rotatedFootprint,
  rotationFacing,
  roundM,
  sceneFrame,
  validateLayout,
} from '@store/shared'
import type {
  Asset,
  DesignNode,
  Entrance,
  FrontAxis,
  Layout,
  LayoutItem,
  NodeCamera,
  NodeKind,
  Point,
  Project,
  Rotation,
  Space,
} from '@store/shared'
import type { ToolSpec } from '../../ai/chat.ts'
import type { AppConfig } from '../../config/env.ts'
import type { RequestContext } from '../../context/actor.ts'
import { AppError } from '../../lib/app-error.ts'
import { catalogAssets } from '../assets/service.ts'
import { addCamera, listCameras, setCameraDeleted } from '../cameras/service.ts'
import { generateLayouts } from '../layouts/service.ts'
import { createNode, getNode, resolveSpace } from '../nodes/service.ts'
import { updateProject } from '../projects/service.ts'
import { asc, eq } from 'drizzle-orm'

const { designNodes } = schema

/** What every tool sees: the project, the node on screen (if any) and its space. */
export interface ToolContext {
  db: Database
  ctx: RequestContext
  config: AppConfig
  project: Project
  node: DesignNode | null
  space: Space | null
  /** The space node above `node` (or `node` itself). */
  spaceNodeId: string | null
  selectedItemIds: string[]
  catalog: Map<string, Asset>
}

export interface ToolOutcome {
  /** Shown to the model (and kept in the record). */
  result: Record<string, unknown>
  /** A node the tool created; the conversation continues from it. */
  nodeId?: string
}

export interface AgentTool<T extends z.ZodType = z.ZodType> {
  name: string
  description: string
  schema: T
  run(tools: ToolContext, input: z.output<T>): Promise<ToolOutcome>
}

/** Keeps the input type of `run` tied to the tool's schema. */
function tool<T extends z.ZodType>(spec: AgentTool<T>): AgentTool {
  return spec
}

const mm = (m: number) => Math.round(m * 1000)
const STAGE_LABELS: Record<NodeKind, string> = {
  space: '空间',
  plan: '方案',
  edit: '方案',
  white: '白模',
  render: '渲染',
}
const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }
const WALL_GAP_M = 0.02

/** "方案 · Agent" → "方案 · Agent（2）" when the first name is taken (same rule as the web). */
export function freshName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}（${n}）`
    if (!taken.includes(candidate)) return candidate
  }
  return `${base}（${Date.now()}）`
}

async function namesUnder(db: Database, projectId: string, parentId: string | null) {
  const rows = await db
    .select({ name: designNodes.name, parentId: designNodes.parentId })
    .from(designNodes)
    .where(eq(designNodes.projectId, projectId))
    .orderBy(asc(designNodes.seq))
  return rows.filter((r) => r.parentId === parentId).map((r) => r.name)
}

/** The space node at or above a node. */
export async function spaceNodeOf(db: Database, nodeId: string): Promise<string | null> {
  let current: string | null = nodeId
  for (let depth = 0; current && depth < 500; depth++) {
    const [row] = await db
      .select({ id: designNodes.id, kind: designNodes.kind, parentId: designNodes.parentId })
      .from(designNodes)
      .where(eq(designNodes.id, current))
    if (!row) return null
    if (row.kind === 'space') return row.id
    current = row.parentId
  }
  return null
}

function describeItem(item: LayoutItem) {
  return {
    id: item.id,
    name: item.name,
    function: ITEM_FUNCTION_LABELS[item.function],
    modelId: item.assetId,
    cx_mm: mm(item.cx),
    cz_mm: mm(item.cz),
    width_mm: mm(item.w),
    depth_mm: mm(item.d),
    height_mm: mm(item.h),
    rotation: item.rotation,
    placeholder: item.placeholder,
  }
}

function describeSpace(space: Space) {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  return {
    boundary_mm: space.boundary.map((p) => [mm(p[0]), mm(p[1])]),
    size_mm: [mm(Math.max(...xs) - Math.min(...xs)), mm(Math.max(...zs) - Math.min(...zs))],
    area_m2: Math.round(polygonArea(space.boundary) * 10) / 10,
    height_mm: mm(space.height),
    entrances: space.entrances.map((e) => ({
      kind: e.kind,
      a_mm: [mm(e.a[0]), mm(e.a[1])],
      b_mm: [mm(e.b[0]), mm(e.b[1])],
    })),
    obstacles: space.obstacles.map((o) => ({
      kind: o.kind,
      label: o.label,
      polygon_mm: o.polygon.map((p) => [mm(p[0]), mm(p[1])]),
    })),
  }
}

/** What the model is told about the project before it answers (also the get_state tool). */
export function stateSummary(tools: ToolContext): Record<string, unknown> {
  const layout = tools.node?.layout ?? null
  const issues = tools.space && layout ? validateLayout(tools.space, layout) : []
  return {
    project: {
      name: tools.project.name,
      shopType: SHOP_TYPE_LABELS[tools.project.shopType],
      market: tools.project.market,
      siStyle: tools.project.siStyle,
    },
    currentNode: tools.node
      ? {
          id: tools.node.id,
          kind: tools.node.kind,
          stage: STAGE_LABELS[tools.node.kind],
          name: tools.node.name,
        }
      : null,
    space: tools.space ? describeSpace(tools.space) : null,
    items: layout ? layout.items.map(describeItem) : [],
    selectedItemIds: tools.selectedItemIds,
    issues: issues.map((i) => ({
      severity: i.severity,
      message: i.message,
      itemIds: i.itemIds ?? [],
    })),
  }
}

const SIDES = ['back', 'front', 'left', 'right'] as const
type Side = (typeof SIDES)[number]

/** Four axis-aligned corners: the only shape whose sides and entrance the tools can rewrite. */
function isRectangle(space: Space): boolean {
  const b = space.boundary
  return (
    b.length === 4 &&
    b.every((p, i) => {
      const q = b[(i + 1) % 4] ?? p
      return p[0] === q[0] || p[1] === q[1]
    })
  )
}

/** The main entrance centred on one side of a rectangle; the whole side when width is 0. */
function entranceOn(space: Space, side: Side, widthM: number): Entrance {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const horizontal = side === 'back' || side === 'front'
  const length = horizontal ? x1 - x0 : z1 - z0
  const w = widthM > 0 ? Math.min(widthM, length) : length
  const from = roundM((horizontal ? x0 : z0) + (length - w) / 2)
  const to = roundM(from + w)
  const fixed = side === 'back' ? z0 : side === 'front' ? z1 : side === 'left' ? x0 : x1
  return horizontal
    ? { kind: 'main', a: [from, fixed], b: [to, fixed] }
    : { kind: 'main', a: [fixed, from], b: [fixed, to] }
}

function describeCamera(c: NodeCamera) {
  return {
    id: c.id,
    name: c.camera.name,
    position_mm: c.camera.position.map(mm),
    target_mm: c.camera.target.map(mm),
    fovDeg: c.camera.fovDeg,
    source: c.camera.source,
  }
}

function requireViewNode(tools: ToolContext): DesignNode {
  const node = tools.node
  if (!node || (node.kind !== 'white' && node.kind !== 'render')) {
    throw new AppError('INVALID_STATE', '只有白模或渲染节点有视角，请先确认白模')
  }
  return node
}

function requireSpace(tools: ToolContext): Space {
  if (!tools.space) throw new AppError('INVALID_STATE', '项目还没有空间，请先录入或识别空间')
  return tools.space
}

/** Where a changed layout goes: a plan under the space, or a copy beside the current step. */
async function saveLayout(tools: ToolContext, layout: Layout, what: string): Promise<ToolOutcome> {
  const node = tools.node
  if (!node) throw new AppError('INVALID_STATE', '没有当前节点，无法修改布局')
  if (node.kind === 'render') {
    throw new AppError('INVALID_STATE', '渲染节点不能修改，请先回到它的白模')
  }
  let parentId: string
  let kind: 'plan' | 'white'
  let base: string
  if (node.kind === 'space') {
    parentId = node.id
    kind = 'plan'
    base = '方案 · Agent'
  } else if (node.kind === 'white') {
    parentId = node.parentId ?? node.id
    kind = 'white'
    base = `${node.name.replace(/（\d+）$/, '')} · Agent`
  } else {
    parentId = node.parentId ?? node.id
    kind = 'plan'
    base = `${node.name.replace(/（\d+）$/, '')} · Agent`
  }
  const name = freshName(base, await namesUnder(tools.db, tools.project.id, parentId))
  const created = await createNode(
    tools.db,
    tools.ctx,
    tools.project.id,
    { parentId, kind, name, layout, sourceNodeId: node.id },
    { origin: 'agent' },
  )
  const errors = created.issues.filter((i) => i.severity === 'error')
  return {
    nodeId: created.node.id,
    result: {
      done: what,
      nodeId: created.node.id,
      nodeName: name,
      items: layout.items.length,
      issues: created.issues.map((i) => i.message),
      ...(errors.length ? { warning: `有 ${errors.length} 个问题需要处理，确认白模前须解决` } : {}),
    },
  }
}

const ALONG = ['back', 'front', 'left', 'right', 'center'] as const
type Along = (typeof ALONG)[number]

interface Placeable {
  footprint: { w: number; d: number; h: number }
  front: FrontAxis | null
}

interface Placed {
  cx: number
  cz: number
  rotation: Rotation
  w: number
  d: number
}

const flip = (v: Point): Point => [-v[0] + 0, -v[1] + 0]

/**
 * Centre, rotation and size of a prop set against a wall (or in the middle): the program
 * works out the coordinates so the model never has to. `position` runs 0 → 1 along the wall
 * (left to right seen from the entrance, back to front on the side walls); the prop's front
 * faces into the shop, or its long side lies along the wall when it has no front.
 */
function placeAlong(
  space: Space,
  asset: Placeable,
  along: Along,
  position: number,
  rotationOverride?: Rotation,
): Placed {
  const f = sceneFrame(space)
  const side = along === 'left' || along === 'right'
  // Inward normal of the wall and the direction along it.
  const n: Point =
    along === 'back' || along === 'center'
      ? f.front
      : along === 'front'
        ? flip(f.front)
        : along === 'left'
          ? f.right
          : flip(f.right)
  const t: Point = side ? f.front : f.right
  const longAlongWall = Math.abs(t[0]) > 0 === asset.footprint.w >= asset.footprint.d ? 0 : 90
  const rotation = rotationOverride ?? rotationFacing(asset.front, n) ?? longAlongWall
  const size = rotatedFootprint(asset, rotation)
  const across = Math.abs(t[0]) * size.w + Math.abs(t[1]) * size.d
  const deep = Math.abs(n[0]) * size.w + Math.abs(n[1]) * size.d
  const length = side ? f.depth : f.width
  const half = side ? f.width / 2 : f.depth / 2
  const wanted = (Math.max(0, Math.min(1, position)) - 0.5) * length
  const u = Math.max(-length / 2 + across / 2, Math.min(length / 2 - across / 2, wanted))
  // The wall lies `half` from the centre against the normal; the prop sits just inside it.
  const off = along === 'center' ? 0 : half - deep / 2 - WALL_GAP_M
  return {
    cx: roundM(f.center[0] - n[0] * off + t[0] * u),
    cz: roundM(f.center[1] - n[1] * off + t[1] * u),
    rotation,
    w: size.w,
    d: size.d,
  }
}

/** An item's footprint before its rotation (a quarter turn swaps the sides back). */
const unrotated = (item: Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation'>) =>
  rotatedFootprint({ footprint: item }, item.rotation)

export const TOOLS: AgentTool[] = [
  tool({
    name: 'get_state',
    description:
      '查看项目当前状态：空间尺寸、入口、障碍物、当前节点、布局中的道具（位置与尺寸为毫米）和检查问题。',
    schema: z.object({}),
    run: async (tools) => ({ result: stateSummary(tools) }),
  }),
  tool({
    name: 'list_models',
    description:
      '列出可以放入的模型（按项目的 SI 风格）；可按用途筛选。返回模型编号、名称、用途、尺寸（毫米）。',
    schema: z.object({
      function: z
        .enum(ITEM_FUNCTIONS)
        .optional()
        .describe('用途，例如 island_table 中岛桌、cashier 收银、accessory_cabinet 配件柜'),
    }),
    run: async (tools, input) => {
      const si = tools.project.siStyle
      const models = [...tools.catalog.values()]
        .filter((a) => !a.retired && a.category !== '环境设施')
        .filter((a) => a.category !== '软装道具' || a.siFamily === si)
        .filter((a) => !input.function || a.function === input.function)
        .map((a) => ({
          modelId: a.id,
          name: a.name,
          function: ITEM_FUNCTION_LABELS[a.function],
          size_mm: [mm(a.footprint.w), mm(a.footprint.d), mm(a.footprint.h)],
          siFamily: a.siFamily,
          placeable: a.placeable,
        }))
      return { result: { models } }
    },
  }),
  tool({
    name: 'generate_plans',
    description:
      '在当前空间下自动生成三个排布方案（尽量多放、按面积推荐、尽量少放），保存到历史的方案层，并返回它们的节点编号。',
    schema: z.object({}),
    run: async (tools) => {
      const space = requireSpace(tools)
      if (!tools.spaceNodeId) throw new AppError('INVALID_STATE', '没有空间节点')
      const result = await generateLayouts(tools.db, tools.ctx, {
        space,
        shopType: tools.project.shopType,
        siStyle: tools.project.siStyle,
        strategies: ['max', 'area', 'min'],
      })
      const taken = await namesUnder(tools.db, tools.project.id, tools.spaceNodeId)
      const plans: Record<string, unknown>[] = []
      let last: string | undefined
      for (const candidate of result.candidates) {
        const label =
          candidate.strategy === 'max'
            ? '尽量多放'
            : candidate.strategy === 'area'
              ? '按面积推荐'
              : '尽量少放'
        const name = freshName(`方案 · ${label}`, taken)
        taken.push(name)
        const created = await createNode(
          tools.db,
          tools.ctx,
          tools.project.id,
          {
            parentId: tools.spaceNodeId,
            kind: 'plan',
            name,
            strategy: candidate.strategy,
            siStyle: tools.project.siStyle,
            layout: candidate.layout,
          },
          { origin: 'agent' },
        )
        last = created.node.id
        plans.push({
          nodeId: created.node.id,
          name,
          items: candidate.layout.items.length,
          issues: candidate.issues.filter((i) => i.severity === 'error').length,
          notes: candidate.notes,
        })
      }
      return {
        result: { plans, nodeIds: plans.map((p) => p.nodeId) },
        ...(last ? { nodeId: last } : {}),
      }
    },
  }),
  tool({
    name: 'place_item',
    description:
      '把一个模型放进当前布局：靠后墙 back、前边 front、左墙 left、右墙 right 或中央 center，position 为沿墙 0–1 的位置（0.5 居中）。程序计算坐标并让道具正面朝向店内；结果保存为新节点。',
    schema: z.object({
      modelId: z.string().describe('list_models 返回的模型编号'),
      along: z.enum(ALONG),
      position: z.number().min(0).max(1).optional(),
      rotation: RotationSchema.optional().describe('覆盖默认朝向'),
    }),
    run: async (tools, input) => {
      const space = requireSpace(tools)
      const asset = tools.catalog.get(input.modelId)
      if (!asset || asset.retired)
        throw new AppError('VALIDATION_FAILED', `没有模型 ${input.modelId}`)
      const base = tools.node?.layout ?? EMPTY_LAYOUT
      const placed = placeAlong(space, asset, input.along, input.position ?? 0.5, input.rotation)
      const item: LayoutItem = {
        id: `${asset.function}-${Date.now().toString(36)}`,
        assetId: asset.id,
        function: asset.function,
        name: asset.name,
        ...placed,
        h: asset.footprint.h,
        placeholder: !asset.placeable,
        locked: false,
      }
      const outcome = await saveLayout(
        tools,
        { ...base, items: [...base.items, item] },
        `已放入「${asset.name}」`,
      )
      return { ...outcome, result: { ...outcome.result, item: describeItem(item) } }
    },
  }),
  tool({
    name: 'move_item',
    description:
      '移动布局中的一件道具：按 along/position 贴墙放，或按 dx_mm/dz_mm 相对移动（x 向右，z 向下）。结果保存为新节点。',
    schema: z.object({
      itemId: z.string(),
      along: z.enum(ALONG).optional(),
      position: z.number().min(0).max(1).optional(),
      dx_mm: z.number().optional(),
      dz_mm: z.number().optional(),
    }),
    run: async (tools, input) => {
      const space = requireSpace(tools)
      const base = tools.node?.layout ?? EMPTY_LAYOUT
      const item = base.items.find((i) => i.id === input.itemId)
      if (!item) throw new AppError('VALIDATION_FAILED', `布局中没有道具 ${input.itemId}`)
      let next: LayoutItem
      if (input.along) {
        const front = item.assetId ? (tools.catalog.get(item.assetId)?.front ?? null) : null
        const placed = placeAlong(
          space,
          { footprint: unrotated(item), front },
          input.along,
          input.position ?? 0.5,
        )
        next = { ...item, ...placed }
      } else {
        next = {
          ...item,
          cx: roundM(item.cx + (input.dx_mm ?? 0) / 1000),
          cz: roundM(item.cz + (input.dz_mm ?? 0) / 1000),
        }
      }
      const outcome = await saveLayout(
        tools,
        { ...base, items: base.items.map((i) => (i.id === item.id ? next : i)) },
        `已移动「${item.name}」`,
      )
      return { ...outcome, result: { ...outcome.result, item: describeItem(next) } }
    },
  }),
  tool({
    name: 'rotate_item',
    description: '把一件道具转到指定角度（0、90、180、270）。结果保存为新节点。',
    schema: z.object({ itemId: z.string(), rotation: RotationSchema }),
    run: async (tools, input) => {
      const base = tools.node?.layout ?? EMPTY_LAYOUT
      const item = base.items.find((i) => i.id === input.itemId)
      if (!item) throw new AppError('VALIDATION_FAILED', `布局中没有道具 ${input.itemId}`)
      const size = rotatedFootprint({ footprint: unrotated(item) }, input.rotation)
      const next: LayoutItem = { ...item, rotation: input.rotation, w: size.w, d: size.d }
      const outcome = await saveLayout(
        tools,
        { ...base, items: base.items.map((i) => (i.id === item.id ? next : i)) },
        `已旋转「${item.name}」`,
      )
      return { ...outcome, result: { ...outcome.result, item: describeItem(next) } }
    },
  }),
  tool({
    name: 'remove_item',
    description: '从当前布局删除一件道具。结果保存为新节点。',
    schema: z.object({ itemId: z.string() }),
    run: async (tools, input) => {
      const base = tools.node?.layout ?? EMPTY_LAYOUT
      const item = base.items.find((i) => i.id === input.itemId)
      if (!item) throw new AppError('VALIDATION_FAILED', `布局中没有道具 ${input.itemId}`)
      return saveLayout(
        tools,
        { ...base, items: base.items.filter((i) => i.id !== item.id) },
        `已删除「${item.name}」`,
      )
    },
  }),
  tool({
    name: 'validate',
    description: '检查当前布局：越界、重叠、压障碍物或入口、通道等问题。',
    schema: z.object({}),
    run: async (tools) => {
      const space = requireSpace(tools)
      const layout = tools.node?.layout ?? EMPTY_LAYOUT
      const issues = validateLayout(space, layout)
      return {
        result: {
          issues: issues.map((i) => ({
            severity: i.severity,
            message: i.message,
            itemIds: i.itemIds ?? [],
          })),
        },
      }
    },
  }),
  tool({
    name: 'set_style',
    description: '切换项目的 SI 风格（SI1.0 / SI2.0）或市场（domestic 国内 / overseas 海外）。',
    schema: z.object({
      siStyle: z.enum(['SI1.0', 'SI2.0']).optional(),
      market: z.enum(['domestic', 'overseas']).optional(),
    }),
    run: async (tools, input) => {
      if (!input.siStyle && !input.market)
        throw new AppError('VALIDATION_FAILED', '请指定要切换的风格或市场')
      const updated = await updateProject(
        tools.db,
        tools.ctx,
        tools.project.id,
        tools.project.revision,
        {
          ...(input.siStyle ? { siStyle: input.siStyle } : {}),
          ...(input.market ? { market: input.market } : {}),
        },
      )
      tools.project = updated
      return { result: { siStyle: updated.siStyle, market: updated.market } }
    },
  }),
  tool({
    name: 'confirm_white',
    description: '把当前方案确认为白模（下一阶段）。布局不能有越界、重叠等错误。',
    schema: z.object({}),
    run: async (tools) => {
      const node = tools.node
      if (!node || (node.kind !== 'plan' && node.kind !== 'edit')) {
        throw new AppError('INVALID_STATE', '只能从方案节点确认白模')
      }
      const name = freshName('白模', await namesUnder(tools.db, tools.project.id, node.id))
      const created = await createNode(
        tools.db,
        tools.ctx,
        tools.project.id,
        { parentId: node.id, kind: 'white', name, layout: node.layout ?? EMPTY_LAYOUT },
        { origin: 'agent' },
      )
      return {
        nodeId: created.node.id,
        result: { done: '已确认白模', nodeId: created.node.id, nodeName: name },
      }
    },
  }),
  tool({
    name: 'start_render',
    description: '从当前白模创建渲染节点；渲染图在打开该节点时由浏览器生成。',
    schema: z.object({}),
    run: async (tools) => {
      const node = tools.node
      if (!node || node.kind !== 'white')
        throw new AppError('INVALID_STATE', '只能从白模节点开始渲染')
      const name = freshName('渲染', await namesUnder(tools.db, tools.project.id, node.id))
      const created = await createNode(
        tools.db,
        tools.ctx,
        tools.project.id,
        {
          parentId: node.id,
          kind: 'render',
          name,
          layout: node.layout ?? EMPTY_LAYOUT,
          siStyle: tools.project.siStyle,
        },
        { origin: 'agent' },
      )
      return {
        nodeId: created.node.id,
        result: { done: '已创建渲染节点，打开它即可渲染', nodeId: created.node.id, nodeName: name },
      }
    },
  }),
  tool({
    name: 'edit_space',
    description:
      '修改当前空间：层高 height_mm；矩形空间的宽 width_mm / 深 depth_mm（改尺寸会重建矩形，柱子清空、入口重置为前边整边，除非同时指定 entrance）；主入口 entrance（所在边与宽度，0 为整边）；add_column 添加一根方柱（中心与边长，毫米）。结果保存为新的空间节点，原空间与方案不变。',
    schema: z.object({
      height_mm: z.number().min(1500).max(20000).optional(),
      width_mm: z.number().min(1000).max(100000).optional(),
      depth_mm: z.number().min(1000).max(100000).optional(),
      entrance: z
        .object({ side: z.enum(SIDES), width_mm: z.number().min(0).max(100000).optional() })
        .optional(),
      add_column: z
        .object({
          cx_mm: z.number(),
          cz_mm: z.number(),
          size_mm: z.number().min(100).max(3000).optional(),
        })
        .optional(),
    }),
    run: async (tools, input) => {
      const current = requireSpace(tools)
      if (!tools.spaceNodeId) throw new AppError('INVALID_STATE', '没有空间节点')
      if (
        !input.height_mm &&
        !input.width_mm &&
        !input.depth_mm &&
        !input.entrance &&
        !input.add_column
      ) {
        throw new AppError('VALIDATION_FAILED', '请指定要修改的内容')
      }
      let space: Space = { ...current }
      const notes: string[] = []
      if (input.width_mm || input.depth_mm) {
        if (!isRectangle(current)) {
          throw new AppError(
            'VALIDATION_FAILED',
            '只有矩形空间可以直接改宽深，异形边界请在工作台里修改',
          )
        }
        const xs = current.boundary.map((p) => p[0])
        const zs = current.boundary.map((p) => p[1])
        const width = input.width_mm ? input.width_mm / 1000 : Math.max(...xs) - Math.min(...xs)
        const depth = input.depth_mm ? input.depth_mm / 1000 : Math.max(...zs) - Math.min(...zs)
        space = {
          ...rectangleSpace(width, depth, current.height),
          calibration: current.calibration,
        }
        notes.push('尺寸已改，柱子已清空，入口重置为前边整边')
      }
      if (input.height_mm) space = { ...space, height: roundM(input.height_mm / 1000) }
      if (input.entrance) {
        if (!isRectangle(space)) {
          throw new AppError('VALIDATION_FAILED', '只有矩形空间可以这样设置入口，请在工作台里修改')
        }
        space = {
          ...space,
          entrances: [
            entranceOn(space, input.entrance.side, (input.entrance.width_mm ?? 0) / 1000),
          ],
        }
      }
      if (input.add_column) {
        const half = (input.add_column.size_mm ?? 400) / 2000
        const cx = input.add_column.cx_mm / 1000
        const cz = input.add_column.cz_mm / 1000
        const polygon: [number, number][] = [
          [roundM(cx - half), roundM(cz - half)],
          [roundM(cx + half), roundM(cz - half)],
          [roundM(cx + half), roundM(cz + half)],
          [roundM(cx - half), roundM(cz + half)],
        ]
        space = {
          ...space,
          obstacles: [...space.obstacles, { kind: 'column', polygon, height: null, label: '柱子' }],
        }
      }
      const name = freshName(
        '空间 · Agent',
        await namesUnder(tools.db, tools.project.id, tools.spaceNodeId),
      )
      const created = await createNode(
        tools.db,
        tools.ctx,
        tools.project.id,
        { parentId: tools.spaceNodeId, kind: 'space', name, space },
        { origin: 'agent' },
      )
      return {
        nodeId: created.node.id,
        result: {
          done: '已修改空间，生成新的空间节点（原空间与方案不变）',
          nodeId: created.node.id,
          nodeName: name,
          notes,
          space: describeSpace(created.node.space ?? space),
          issues: created.issues.map((i) => i.message),
        },
      }
    },
  }),
  tool({
    name: 'list_views',
    description: '列出当前白模或渲染节点的视角（相机位置与目标，毫米；默认 8 个）。',
    schema: z.object({}),
    run: async (tools) => {
      const node = requireViewNode(tools)
      const list = await listCameras(tools.db, tools.ctx, node.id, false)
      return { result: { views: list.cameras.map(describeCamera) } }
    },
  }),
  tool({
    name: 'add_view',
    description:
      '给当前白模或渲染节点增加一个视角：across 0–1 从左到右，along 0–1 从后墙到入口（大于 1 在店外），height 为相机高度占平面长边的倍数（俯瞰约 1，平视约 0.3）；相机看向店中心。可撤销。',
    schema: z.object({
      name: z.string().trim().min(1).max(40),
      across: z.number().min(-1).max(2),
      along: z.number().min(-1).max(2),
      height: z.number().min(0.1).max(3).optional(),
      fovDeg: z.number().min(10).max(120).optional(),
    }),
    run: async (tools, input) => {
      const node = requireViewNode(tools)
      const space = requireSpace(tools)
      const f = sceneFrame(space)
      const a = (input.across - 0.5) * f.width
      const b = (input.along - 0.5) * f.depth
      const span = Math.max(f.width, f.depth)
      const camera = await addCamera(tools.db, tools.ctx, node.id, {
        name: input.name,
        position: [
          roundM(f.center[0] + f.right[0] * a + f.front[0] * b),
          roundM(span * (input.height ?? 1)),
          roundM(f.center[1] + f.right[1] * a + f.front[1] * b),
        ],
        target: [roundM(f.center[0]), roundM(space.height * 0.25), roundM(f.center[1])],
        fovDeg: input.fovDeg ?? 48,
      })
      return {
        result: {
          done: `已添加视角「${input.name}」`,
          cameraId: camera.id,
          view: describeCamera(camera),
        },
      }
    },
  }),
  tool({
    name: 'remove_view',
    description: '删除当前白模或渲染节点的一个视角（可撤销恢复）。',
    schema: z.object({ cameraId: z.string() }),
    run: async (tools, input) => {
      const node = requireViewNode(tools)
      const list = await listCameras(tools.db, tools.ctx, node.id, false)
      if (!list.cameras.some((c) => c.id === input.cameraId)) {
        throw new AppError('VALIDATION_FAILED', '当前节点没有这个视角')
      }
      const camera = await setCameraDeleted(tools.db, tools.ctx, input.cameraId, true)
      return {
        result: { done: `已删除视角「${camera.camera.name}」`, restoreCameraId: camera.id },
      }
    },
  }),
  tool({
    name: 'export_project',
    description: '给出项目文件的下载地址（含全部节点与草稿）。',
    schema: z.object({}),
    run: async (tools) => ({ result: { url: `/api/v1/projects/${tools.project.id}/export` } }),
  }),
]

export const toolSpecs: ToolSpec[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.schema),
}))

export function findTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name)
}

/** Loads what the tools need for a project and the node the user is looking at. */
export async function buildToolContext(
  db: Database,
  ctx: RequestContext,
  config: AppConfig,
  project: Project,
  nodeId: string | null,
  selectedItemIds: string[],
): Promise<ToolContext> {
  const node = nodeId ? await getNode(db, ctx, nodeId) : null
  if (node && node.projectId !== project.id)
    throw new AppError('VALIDATION_FAILED', '节点不属于这个项目')
  const spaceNodeId = node ? await spaceNodeOf(db, node.id) : null
  const space = spaceNodeId ? await resolveSpace(db, spaceNodeId) : null
  return {
    db,
    ctx,
    config,
    project,
    node,
    space,
    spaceNodeId,
    selectedItemIds,
    catalog: await catalogAssets(db),
  }
}

/** The tools see the node a change just made. */
export async function refreshNode(tools: ToolContext, nodeId: string): Promise<void> {
  tools.node = await getNode(tools.db, tools.ctx, nodeId)
  tools.spaceNodeId = await spaceNodeOf(tools.db, nodeId)
  tools.space = tools.spaceNodeId ? await resolveSpace(tools.db, tools.spaceNodeId) : null
}
