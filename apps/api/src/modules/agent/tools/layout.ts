import { z } from 'zod'
import {
  PLAN_STRATEGY_LABELS,
  RotationSchema,
  defaultElevation,
  defaultEmbeddedElevation,
  facingAfter,
  freshName,
  rotatedFootprint,
  roundM,
} from '@store/shared'
import type { LayoutItem } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { generateLayouts } from '../../layouts/service.ts'
import { createNode } from '../../nodes/service.ts'
import { requireSpace, tool } from './context.ts'
import { describeItem } from './describe.ts'
import { EMPTY_LAYOUT, namesUnder, saveLayout } from './persist.ts'
import { ALONG, placeAlong, unrotated, wallGap } from './placement.ts'

export const generatePlansTool = tool({
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
      const name = freshName(`方案 · ${PLAN_STRATEGY_LABELS[candidate.strategy]}`, taken)
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
})

export const placeItemTool = tool({
  name: 'place_item',
  description:
    '把一个模型放进当前布局：靠后墙 back、前边 front、左墙 left、右墙 right 或中央 center，position 为沿墙 0–1 的位置（0.5 居中）。程序按这面墙的真实边（见空间 edges）计算坐标，并让道具正面朝向店内；异形店的一面墙可能分成几段，position 按各段总长分布；斜墙上道具取最接近的直角朝向；center 为店内最空旷处，position 沿横向移动。放不下（超出店铺或压住柱子）时报错且不保存，请换位置或换墙。结果保存为新节点。',
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
    // A wall piece (墙面 LOGO, 画面) hangs right on the wall; a ceiling piece hangs from above.
    const mount =
      asset.installation === 'floor' || asset.installation === null ? null : asset.installation
    const placed = placeAlong(
      space,
      asset,
      input.along,
      input.position ?? 0.5,
      mount === 'wall' || mount === 'embedded' ? 0 : wallGap(tools.project.shopType),
      input.rotation,
    )
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
    if (mount === 'embedded') {
      // Placed with its back on the wall, then sunk in by its depth: the front is on the wall face.
      const [fx, fz] = facingAfter(
        asset.front && asset.front !== 'any' ? asset.front : '+Z',
        item.rotation,
      )
      const depth = fx !== 0 ? item.w : item.d
      item.cx = roundM(item.cx - fx * depth)
      item.cz = roundM(item.cz - fz * depth)
      item.mount = mount
      item.elevation = defaultEmbeddedElevation(item, space)
    } else if (mount) {
      item.mount = mount
      item.elevation = defaultElevation(item, base.items, space)
    }
    const outcome = await saveLayout(
      tools,
      { ...base, items: [...base.items, item] },
      `已放入「${asset.name}」`,
    )
    return { ...outcome, result: { ...outcome.result, item: describeItem(item) } }
  },
})

export const moveItemTool = tool({
  name: 'move_item',
  description:
    '移动布局中的一件道具：按 along/position 贴墙放（规则同 place_item，放不下时报错），或按 dx_mm/dz_mm 相对移动（x 向右，z 向下）。结果保存为新节点。',
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
        { name: item.name, footprint: unrotated(item), front },
        input.along,
        input.position ?? 0.5,
        wallGap(tools.project.shopType),
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
})

export const rotateItemTool = tool({
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
})

export const removeItemTool = tool({
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
})
