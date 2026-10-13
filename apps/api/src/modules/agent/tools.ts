import { z } from 'zod'
import type { ToolSpec } from '../../ai/chat.ts'
import type { AgentTool } from './tools/context.ts'
import { exportProjectTool, getStateTool, listModelsTool, validateTool } from './tools/query.ts'
import {
  generatePlansTool,
  moveItemTool,
  placeItemTool,
  removeItemTool,
  rotateItemTool,
} from './tools/layout.ts'
import { confirmWhiteTool, setStyleTool, startRenderTool } from './tools/stage.ts'
import { editSpaceTool } from './tools/space.ts'
import { addViewTool, listViewsTool, removeViewTool } from './tools/views.ts'

export { buildToolContext, refreshNode, spaceNodeOf } from './tools/context.ts'
export type { AgentTool, ToolContext, ToolOutcome } from './tools/context.ts'
export { stateSummary } from './tools/describe.ts'

export const TOOLS: AgentTool[] = [
  getStateTool,
  listModelsTool,
  generatePlansTool,
  placeItemTool,
  moveItemTool,
  rotateItemTool,
  removeItemTool,
  validateTool,
  setStyleTool,
  confirmWhiteTool,
  startRenderTool,
  editSpaceTool,
  listViewsTool,
  addViewTool,
  removeViewTool,
  exportProjectTool,
]

export const toolSpecs: ToolSpec[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.schema),
}))

export function findTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name)
}
