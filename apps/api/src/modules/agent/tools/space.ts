import { z } from 'zod'
import { freshName, rectangleSpace, roundM } from '@store/shared'
import type { Entrance, Space } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { createNode } from '../../nodes/service.ts'
import { requireSpace, tool } from './context.ts'
import { describeSpace } from './describe.ts'
import { namesUnder } from './persist.ts'

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

export const editSpaceTool = tool({
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
        entrances: [entranceOn(space, input.entrance.side, (input.entrance.width_mm ?? 0) / 1000)],
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
})
