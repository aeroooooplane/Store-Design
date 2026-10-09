import { z } from 'zod'
import {
  distanceToBoundary,
  isSimplePolygon,
  polygonArea,
  polygonInsidePolygon,
  toClockwise,
} from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import { roundM } from '../units.ts'
import { PointSchema, SegmentSchema, SizeSchema } from './common.ts'

export const OBSTACLE_KINDS = ['column', 'shaft', 'stair', 'fixed', 'other'] as const
export const ENTRANCE_KINDS = ['main', 'side'] as const
export const CALIBRATION_METHODS = ['manual', 'dimension', 'item_label', 'area'] as const

export const ObstacleSchema = z.object({
  kind: z.enum(OBSTACLE_KINDS),
  polygon: z.array(PointSchema).min(3).max(100),
  height: SizeSchema.nullable().default(null),
  label: z.string().trim().max(100).nullable().default(null),
})

export const EntranceSchema = SegmentSchema.extend({ kind: z.enum(ENTRANCE_KINDS) })

export const CalibrationSchema = z.object({
  method: z.enum(CALIBRATION_METHODS),
  reference: z.string().trim().max(500),
  verified: z.boolean(),
})

/**
 * A store space: polygon boundary, entrances and open edges lying on the boundary,
 * obstacles inside it. Units are metres; x right, z down, y up.
 */
export const SpaceSchema = z.object({
  schemaVersion: z.literal(1),
  boundary: z.array(PointSchema).min(3).max(200),
  height: z.number().finite().min(1.5).max(20),
  entrances: z.array(EntranceSchema).max(20).default([]),
  openEdges: z.array(SegmentSchema).max(50).default([]),
  obstacles: z.array(ObstacleSchema).max(100).default([]),
  calibration: CalibrationSchema.nullable().default(null),
})

export type Space = z.output<typeof SpaceSchema>
export type SpaceInput = z.input<typeof SpaceSchema>
export type Obstacle = z.output<typeof ObstacleSchema>
export type Entrance = z.output<typeof EntranceSchema>

export type IssueSeverity = 'error' | 'warning'

export type SpaceIssueCode =
  | 'boundary_not_simple'
  | 'boundary_too_small'
  | 'obstacle_not_simple'
  | 'obstacle_outside_boundary'
  | 'entrance_not_on_boundary'
  | 'open_edge_not_on_boundary'
  | 'height_unusual'

export interface SpaceIssue {
  code: SpaceIssueCode
  severity: IssueSeverity
  message: string
  path: (string | number)[]
}

const MIN_AREA_M2 = 1
const ON_BOUNDARY_TOLERANCE_M = 0.02
const TYPICAL_HEIGHT_M = { min: 2.4, max: 6 } as const

function onBoundary(a: Point, b: Point, boundary: readonly Point[]): boolean {
  const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return [a, b, middle].every((p) => distanceToBoundary(p, boundary) <= ON_BOUNDARY_TOLERANCE_M)
}

/**
 * Geometric checks that a schema cannot express. Errors block saving; warnings are shown
 * to the user (for example an unusual ceiling height may still be correct).
 */
export function validateSpace(space: Space): SpaceIssue[] {
  const issues: SpaceIssue[] = []
  const boundaryOk = isSimplePolygon(space.boundary)
  if (!boundaryOk) {
    issues.push({
      code: 'boundary_not_simple',
      severity: 'error',
      message: '空间边界不闭合或存在自相交，请检查边界顶点顺序',
      path: ['boundary'],
    })
  } else if (polygonArea(space.boundary) < MIN_AREA_M2) {
    issues.push({
      code: 'boundary_too_small',
      severity: 'error',
      message: `空间面积小于 ${MIN_AREA_M2} ㎡，请检查尺寸单位`,
      path: ['boundary'],
    })
  }

  space.obstacles.forEach((obstacle, index) => {
    const name = obstacle.label ?? `障碍物 ${index + 1}`
    if (!isSimplePolygon(obstacle.polygon)) {
      issues.push({
        code: 'obstacle_not_simple',
        severity: 'error',
        message: `${name}的轮廓不闭合或存在自相交`,
        path: ['obstacles', index, 'polygon'],
      })
    } else if (boundaryOk && !polygonInsidePolygon(obstacle.polygon, space.boundary)) {
      issues.push({
        code: 'obstacle_outside_boundary',
        severity: 'error',
        message: `${name}超出空间边界`,
        path: ['obstacles', index, 'polygon'],
      })
    }
  })

  if (boundaryOk) {
    space.entrances.forEach((entrance, index) => {
      if (!onBoundary(entrance.a, entrance.b, space.boundary)) {
        issues.push({
          code: 'entrance_not_on_boundary',
          severity: 'error',
          message: `入口 ${index + 1} 不在空间边界上`,
          path: ['entrances', index],
        })
      }
    })
    space.openEdges.forEach((edge, index) => {
      if (!onBoundary(edge.a, edge.b, space.boundary)) {
        issues.push({
          code: 'open_edge_not_on_boundary',
          severity: 'error',
          message: `开放边 ${index + 1} 不在空间边界上`,
          path: ['openEdges', index],
        })
      }
    })
  }

  if (space.height < TYPICAL_HEIGHT_M.min || space.height > TYPICAL_HEIGHT_M.max) {
    issues.push({
      code: 'height_unusual',
      severity: 'warning',
      message: `层高 ${space.height} m 超出常见范围 ${TYPICAL_HEIGHT_M.min}–${TYPICAL_HEIGHT_M.max} m，请确认`,
      path: ['height'],
    })
  }
  return issues
}

const roundPoint = (p: Point): [number, number] => [roundM(p[0]), roundM(p[1])]

/** Canonical form for storage: millimetre precision and clockwise rings. */
export function normalizeSpace(space: Space): Space {
  return {
    ...space,
    height: roundM(space.height),
    boundary: toClockwise(space.boundary).map(roundPoint),
    entrances: space.entrances.map((e) => ({ ...e, a: roundPoint(e.a), b: roundPoint(e.b) })),
    openEdges: space.openEdges.map((e) => ({ a: roundPoint(e.a), b: roundPoint(e.b) })),
    obstacles: space.obstacles.map((o) => ({
      ...o,
      height: o.height === null ? null : roundM(o.height),
      polygon: toClockwise(o.polygon).map(roundPoint),
    })),
  }
}

/**
 * Quick rectangular space. Like the legacy workbench, the whole front edge (largest z)
 * is the main entrance until the user edits it.
 */
export function rectangleSpace(width: number, depth: number, height: number): Space {
  const w = roundM(width)
  const d = roundM(depth)
  return SpaceSchema.parse({
    schemaVersion: 1,
    boundary: [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ],
    height: roundM(height),
    entrances: [{ a: [0, d], b: [w, d], kind: 'main' }],
  })
}
