import { z } from 'zod'
import { freshName, rectangleSpace, roundM, validateSpace } from '@store/shared'
import type { Entrance, Point, Space } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { createNode } from '../../nodes/service.ts'
import { requireSpace, tool } from './context.ts'
import { describeSpace } from './describe.ts'
import { namesUnder } from './persist.ts'
import { SIDES } from './walls.ts'
import type { Side } from './walls.ts'

/** Most vertices a boundary may have (SpaceSchema). */
const MAX_VERTICES = 200

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

const samePoint = (p: Point, q: Point) =>
  Math.abs(p[0] - q[0]) < 0.0005 && Math.abs(p[1] - q[1]) < 0.0005

const fromMm = (x: number, z: number): [number, number] => [roundM(x / 1000), roundM(z / 1000)]

/** Moves vertex `index`; entrance and open-edge ends at that corner go with it. */
function moveVertex(space: Space, index: number, to: [number, number]): Space {
  const from = space.boundary[index]
  if (!from) {
    throw new AppError(
      'VALIDATION_FAILED',
      `没有顶点 ${index}（共 ${space.boundary.length} 个，编号 0–${space.boundary.length - 1}）`,
    )
  }
  const follow = <T extends { a: Point; b: Point }>(s: T): T => ({
    ...s,
    a: samePoint(s.a, from) ? to : s.a,
    b: samePoint(s.b, from) ? to : s.b,
  })
  return {
    ...space,
    boundary: space.boundary.map((p, i) => (i === index ? to : p)),
    entrances: space.entrances.map(follow),
    openEdges: space.openEdges.map(follow),
  }
}

/** Inserts a vertex after vertex `edge` (on edge `edge`), at its middle unless `at` is given. */
function insertVertex(space: Space, edge: number, at: [number, number] | null): Space {
  const n = space.boundary.length
  const a = space.boundary[edge]
  const b = space.boundary[(edge + 1) % n]
  if (!a || !b) {
    throw new AppError('VALIDATION_FAILED', `没有边 ${edge}（共 ${n} 条，编号 0–${n - 1}）`)
  }
  if (n >= MAX_VERTICES) {
    throw new AppError('VALIDATION_FAILED', `边界最多 ${MAX_VERTICES} 个顶点，不能再插入`)
  }
  const point = at ?? [roundM((a[0] + b[0]) / 2), roundM((a[1] + b[1]) / 2)]
  return {
    ...space,
    boundary: [...space.boundary.slice(0, edge + 1), point, ...space.boundary.slice(edge + 1)],
  }
}

export const editSpaceTool = tool({
  name: 'edit_space',
  description:
    '修改当前空间：层高 height_mm；矩形空间的宽 width_mm / 深 depth_mm（改尺寸会重建矩形，柱子清空、入口重置为前边整边，除非同时指定 entrance）；主入口 entrance（矩形空间，所在边与宽度，0 为整边）；add_column 添加一根方柱（中心与边长，毫米）；任意形状的空间可用 move_vertex 把编号 index 的顶点移到新坐标（毫米，落在该顶点上的入口端点随之移动），insert_vertex 在边 edge（顶点 edge 到 edge+1）上插入顶点（默认边的中点，可给坐标），新顶点编号为 edge+1；编号见空间的 boundary_mm 与 edges，同时给出时按修改前的编号先移动后插入。修改后的空间须合法（边界不自相交、入口和柱子在边界上或内），否则报错。结果保存为新的空间节点，原空间与方案不变。',
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
    move_vertex: z
      .object({ index: z.number().int().min(0), x_mm: z.number(), z_mm: z.number() })
      .optional(),
    insert_vertex: z
      .object({
        edge: z.number().int().min(0),
        x_mm: z.number().optional(),
        z_mm: z.number().optional(),
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
      !input.add_column &&
      !input.move_vertex &&
      !input.insert_vertex
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
    if (input.move_vertex) {
      const { index, x_mm, z_mm } = input.move_vertex
      space = moveVertex(space, index, fromMm(x_mm, z_mm))
      notes.push(`顶点 ${index} 已移到 (${x_mm}, ${z_mm})`)
    }
    if (input.insert_vertex) {
      const { edge, x_mm, z_mm } = input.insert_vertex
      if ((x_mm === undefined) !== (z_mm === undefined)) {
        throw new AppError(
          'VALIDATION_FAILED',
          '插入顶点的坐标须同时给出 x_mm 和 z_mm，或都不给（取边的中点）',
        )
      }
      const at = x_mm !== undefined && z_mm !== undefined ? fromMm(x_mm, z_mm) : null
      space = insertVertex(space, edge, at)
      notes.push(`已在边 ${edge} 上插入顶点 ${edge + 1}，其后的顶点编号加 1`)
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
    const errors = validateSpace(space).filter((i) => i.severity === 'error')
    if (errors.length) {
      throw new AppError(
        'VALIDATION_FAILED',
        `修改后的空间不合法：${errors.map((i) => i.message).join('；')}。请换一个坐标，或先调整入口、柱子`,
        errors,
      )
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
