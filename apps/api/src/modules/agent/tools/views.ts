import { z } from 'zod'
import { roundM, sceneFrame } from '@store/shared'
import type { DesignNode } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { addCamera, listCameras, setCameraDeleted } from '../../cameras/service.ts'
import { requireSpace, tool } from './context.ts'
import type { ToolContext } from './context.ts'
import { describeCamera } from './describe.ts'

function requireViewNode(tools: ToolContext): DesignNode {
  const node = tools.node
  if (!node || (node.kind !== 'white' && node.kind !== 'render')) {
    throw new AppError('INVALID_STATE', '只有三维效果或渲染节点有视角，请先进入三维效果')
  }
  return node
}

export const listViewsTool = tool({
  name: 'list_views',
  description: '列出当前白模或渲染节点的视角（相机位置与目标，毫米；默认 8 个）。',
  schema: z.object({}),
  run: async (tools) => {
    const node = requireViewNode(tools)
    const list = await listCameras(tools.db, tools.ctx, node.id, false)
    return { result: { views: list.cameras.map(describeCamera) } }
  },
})

export const addViewTool = tool({
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
})

export const removeViewTool = tool({
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
})
