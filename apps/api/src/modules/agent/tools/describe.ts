import {
  ITEM_FUNCTION_LABELS,
  SHOP_TYPE_LABELS,
  STAGE_LABELS,
  polygonArea,
  stageOf,
  validateLayout,
} from '@store/shared'
import type { LayoutItem, NodeCamera, Point, Space } from '@store/shared'
import type { ToolContext } from './context.ts'
import { overlapOnEdge, wallEdges } from './walls.ts'
import type { WallEdge } from './walls.ts'

export const mm = (m: number) => Math.round(m * 1000)

export function describeItem(item: LayoutItem) {
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

/** Shorter than this an entrance or open edge is not worth a mention on an edge. */
const MIN_OVERLAP_M = 0.01

/** What of an edge is an entrance or open: the whole edge, or so many millimetres of it. */
function edgeMarks(space: Space, edge: WallEdge): string[] {
  const marks: [string, { a: Point; b: Point }[]][] = [
    ['入口', space.entrances.filter((e) => e.kind === 'main')],
    ['侧入口', space.entrances.filter((e) => e.kind === 'side')],
    ['开放边', space.openEdges],
  ]
  return marks.flatMap(([label, segments]) => {
    const length = segments.reduce((sum, s) => sum + overlapOnEdge(s.a, s.b, edge), 0)
    if (length < MIN_OVERLAP_M) return []
    return [length >= edge.length - MIN_OVERLAP_M ? label : `${label}${mm(length)}mm`]
  })
}

/**
 * One short line per boundary edge: "e2 4000mm 90° right 入口" is edge 2 (vertex 2 → 3), its
 * length, its heading (0° = +x, 90° = +z), the wall it belongs to seen from the entrance
 * ("斜向(近right)" for a slanted edge) and how much of it is an entrance or open edge.
 */
export function describeEdges(space: Space): string[] {
  return wallEdges(space).map((edge) => {
    const degrees = Math.round((Math.atan2(edge.tangent[1], edge.tangent[0]) * 180) / Math.PI)
    const wall = edge.slanted ? `斜向(近${edge.side})` : edge.side
    const parts = [`e${edge.index}`, `${mm(edge.length)}mm`, `${(degrees + 360) % 360}°`, wall]
    return [...parts, ...edgeMarks(space, edge)].join(' ')
  })
}

export function describeSpace(space: Space) {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  return {
    boundary_mm: space.boundary.map((p) => [mm(p[0]), mm(p[1])]),
    size_mm: [mm(Math.max(...xs) - Math.min(...xs)), mm(Math.max(...zs) - Math.min(...zs))],
    edges: describeEdges(space),
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

export function describeCamera(c: NodeCamera) {
  return {
    id: c.id,
    name: c.camera.name,
    position_mm: c.camera.position.map(mm),
    target_mm: c.camera.target.map(mm),
    fovDeg: c.camera.fovDeg,
    source: c.camera.source,
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
          stage: STAGE_LABELS[stageOf(tools.node.kind)],
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
