import { z } from 'zod'
import { ITEM_FUNCTIONS, ITEM_FUNCTION_LABELS, validateLayout } from '@store/shared'
import { requireSpace, tool } from './context.ts'
import { mm, stateSummary } from './describe.ts'
import { EMPTY_LAYOUT } from './persist.ts'

export const getStateTool = tool({
  name: 'get_state',
  description:
    '查看项目当前状态：空间尺寸、入口、障碍物、当前节点、布局中的道具（位置与尺寸为毫米）和检查问题。',
  schema: z.object({}),
  run: async (tools) => ({ result: stateSummary(tools) }),
})

export const listModelsTool = tool({
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
})

export const validateTool = tool({
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
})

export const exportProjectTool = tool({
  name: 'export_project',
  description: '给出项目文件的下载地址（含全部节点与草稿）。',
  schema: z.object({}),
  run: async (tools) => ({ result: { url: `/api/v1/projects/${tools.project.id}/export` } }),
})
