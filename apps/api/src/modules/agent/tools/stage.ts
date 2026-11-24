import { z } from 'zod'
import { freshName, nodeSiStyle, siSwapName, stageOf, swapLayoutSi } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { createNode } from '../../nodes/service.ts'
import { updateProject } from '../../projects/service.ts'
import { tool } from './context.ts'
import { EMPTY_LAYOUT, namesUnder, stageParentOf } from './persist.ts'

export const setStyleTool = tool({
  name: 'set_style',
  description:
    '切换项目的 SI 风格（SI1.0 / SI2.0）或市场（domestic 国内 / overseas 海外）。当前在方案阶段时，按映射表把软装道具换成新风格的对应款，另存为新节点，原节点保留。',
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
    const node = tools.node
    const stage = node && stageOf(node.kind)
    if (!input.siStyle || !node?.layout || !node.parentId || stage !== 'plan') {
      return { result: { siStyle: updated.siStyle, market: updated.market } }
    }
    // Same as the SI switch on the project card: the step is copied with its props swapped.
    const swap = swapLayoutSi(node.layout, input.siStyle, tools.catalog)
    const kept = [...new Set(swap.kept)]
    if (!swap.swapped) {
      return { result: { siStyle: updated.siStyle, market: updated.market, swapped: 0, kept } }
    }
    const parentId = await stageParentOf(tools.db, node)
    const name = freshName(
      siSwapName(node.name, input.siStyle),
      await namesUnder(tools.db, tools.project.id, parentId),
    )
    const created = await createNode(
      tools.db,
      tools.ctx,
      tools.project.id,
      {
        parentId,
        kind: 'plan',
        name,
        layout: swap.layout,
        siStyle: input.siStyle,
        sourceNodeId: node.id,
      },
      { origin: 'agent' },
    )
    return {
      nodeId: created.node.id,
      result: {
        done: `已切换为 ${input.siStyle}，另存为「${name}」并换了 ${swap.swapped} 件道具`,
        siStyle: updated.siStyle,
        market: updated.market,
        nodeId: created.node.id,
        nodeName: name,
        swapped: swap.swapped,
        kept,
        issues: created.issues.map((i) => i.message),
      },
    }
  },
})

export const startRenderTool = tool({
  name: 'start_render',
  description: '从当前方案创建渲染节点；渲染图在打开该节点时由浏览器生成。',
  schema: z.object({}),
  run: async (tools) => {
    const node = tools.node
    if (!node || stageOf(node.kind) !== 'plan')
      throw new AppError('INVALID_STATE', '只能从方案开始渲染')
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
        siStyle: nodeSiStyle(node, tools.project.siStyle),
      },
      { origin: 'agent' },
    )
    return {
      nodeId: created.node.id,
      result: { done: '已创建渲染节点，打开它即可渲染', nodeId: created.node.id, nodeName: name },
    }
  },
})
