import { z } from 'zod'
import { DemandSchema } from './demand.ts'
import { ShopTypeSchema } from '../enums.ts'
import {
  boundaryPath,
  isSimplePolygon,
  polygonArea,
  polygonInsidePolygon,
  toClockwise,
} from '../geometry/index.ts'
import type { BoundaryPiece, Point } from '../geometry/index.ts'
import { roundM } from '../units.ts'
import { PointSchema, SegmentSchema, SizeSchema } from './common.ts'
import { FacadeConfigSchema, isStraightFacade } from './facade.ts'
import type { DoubleFacade, Facade, FacadeConfig, FacadeFace } from './facade.ts'
import { facadePlacementError } from '../facade/forms.ts'
import { facadeRun } from '../facade/geometry.ts'

export const OBSTACLE_KINDS = ['column', 'shaft', 'stair', 'fixed', 'other'] as const
export const ENTRANCE_KINDS = ['main', 'side'] as const
/** Where the drawing's scale came from; 'llm' when a model read it off the picture. */
export const CALIBRATION_METHODS = ['manual', 'dimension', 'item_label', 'area', 'llm'] as const

export const ObstacleSchema = z.object({
  kind: z.enum(OBSTACLE_KINDS),
  polygon: z.array(PointSchema).min(3).max(100),
  height: SizeSchema.nullable().default(null),
  label: z.string().trim().max(100).nullable().default(null),
  /**
   * A fixture added on site after the shell (a showcase platform, hollow cladding): it counts
   * as floor area (props are simply kept off it), unlike columns and shafts of the shell, which
   * take their floor away. Default false: part of the shell.
   */
  addedLater: z.boolean().optional(),
})

export const EntranceSchema = SegmentSchema.extend({ kind: z.enum(ENTRANCE_KINDS) })

export const CalibrationSchema = z.object({
  method: z.enum(CALIBRATION_METHODS),
  reference: z.string().trim().max(500),
  verified: z.boolean(),
})

/**
 * A store space: polygon boundary, entrances and open edges lying on the boundary (each given
 * by its two ends; it may run along several edges, see `openingPieces`) and obstacles.
 * Columns can cross or stand outside the boundary.
 * Units are metres; x right, z down, y up.
 */
export const SpaceSchema = z.object({
  schemaVersion: z.literal(1),
  /** Old spaces use the project’s saved site form until edited. */
  shopType: ShopTypeSchema.optional(),
  demand: DemandSchema.optional(),
  boundary: z.array(PointSchema).min(3).max(200),
  height: z.number().finite().min(1.5).max(20),
  entrances: z.array(EntranceSchema).max(20).default([]),
  openEdges: z.array(SegmentSchema).max(50).default([]),
  facade: FacadeConfigSchema.optional(),
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
  | 'facade_not_on_boundary'
  | 'facade_opening_too_wide'

export interface SpaceIssue {
  code: SpaceIssueCode
  severity: IssueSeverity
  message: string
  path: (string | number)[]
}

const MIN_AREA_M2 = 1
const ON_BOUNDARY_TOLERANCE_M = 0.02
const TYPICAL_HEIGHT_M = { min: 2.4, max: 6 } as const

/**
 * The boundary an entrance or open edge covers, one piece per edge. An opening is stored by its
 * two ends and runs along the boundary between them the shorter way round, so a single opening
 * can span several edges (an arc storefront drawn as a polyline, or round a corner) and still
 * count as one entrance. Null when an end is off the boundary.
 */
export function openingPieces(
  space: { boundary: readonly Point[] },
  opening: { a: Point; b: Point },
): BoundaryPiece[] | null {
  return boundaryPath(space.boundary, opening.a, opening.b, ON_BOUNDARY_TOLERANCE_M)
}

const onBoundary = (a: Point, b: Point, boundary: readonly Point[]): boolean =>
  openingPieces({ boundary }, { a, b }) !== null

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
        severity: obstacle.kind === 'column' ? 'warning' : 'error',
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
  if (boundaryOk && space.facade) {
    const placementError = facadePlacementError(space, space.facade)
    const run = isStraightFacade(space.facade) && facadeRun(space.boundary, space.facade)
    if (placementError) {
      issues.push({
        code: 'facade_not_on_boundary',
        severity: 'warning',
        message: placementError,
        path: ['facade'],
      })
    } else if (
      run &&
      isStraightFacade(space.facade) &&
      space.facade.openingWidth > run.width + 0.003
    ) {
      issues.push({
        code: 'facade_opening_too_wide',
        severity: 'warning',
        message: '门头入口净宽超过门头总宽',
        path: ['facade', 'openingWidth'],
      })
    }
  }
  return issues
}

const roundPoint = (p: Point): [number, number] => [roundM(p[0]), roundM(p[1])]

function roundFacade(facade: FacadeConfig): FacadeConfig {
  const optional = (value: number | undefined) => (value === undefined ? undefined : roundM(value))
  const span = (value: { a: Point; b: Point }) => ({
    a: roundPoint(value.a),
    b: roundPoint(value.b),
  })
  const straight = <T extends Facade>(value: T): T => ({
    ...value,
    ...span(value),
    openingWidth: roundM(value.openingWidth),
    clearHeight: roundM(value.clearHeight),
    fasciaHeight: roundM(value.fasciaHeight),
    screenInset: roundM(value.screenInset),
    screenWidth: optional(value.screenWidth),
  })
  if (isStraightFacade(facade)) return straight(facade)
  if (facade.kind === 'corner') {
    const face = (value: FacadeFace) => ({
      ...straight(value),
      openingOffset: optional(value.openingOffset),
    })
    return { ...facade, faces: [face(facade.faces[0]), face(facade.faces[1])] }
  }
  if (facade.kind === 'double') {
    function opening(value: DoubleFacade['openings'][number]) {
      return {
        ...value,
        offset: roundM(value.offset),
        width: roundM(value.width),
        clearHeight: roundM(value.clearHeight),
        screenWidth: optional(value.screenWidth),
      }
    }
    return {
      ...facade,
      ...span(facade),
      fasciaHeight: roundM(facade.fasciaHeight),
      screenInset: roundM(facade.screenInset),
      openings: [opening(facade.openings[0]), opening(facade.openings[1])],
    }
  }
  return {
    ...facade,
    ...span(facade),
    top: roundM(facade.top),
    beamHeight: roundM(facade.beamHeight),
    postWidth: optional(facade.postWidth),
    si1LogoHeight: optional(facade.si1LogoHeight),
    si1Drop: optional(facade.si1Drop),
    si2LogoHeight: optional(facade.si2LogoHeight),
  }
}

/** Clockwise rings; millimetre precision only when rounding preserves valid topology. */
export function normalizeSpace(space: Space): Space {
  const rounded: Space = {
    ...space,
    height: roundM(space.height),
    boundary: toClockwise(space.boundary).map(roundPoint),
    entrances: space.entrances.map((e) => ({ ...e, a: roundPoint(e.a), b: roundPoint(e.b) })),
    openEdges: space.openEdges.map((e) => ({ a: roundPoint(e.a), b: roundPoint(e.b) })),
    ...(space.facade ? { facade: roundFacade(space.facade) } : {}),
    obstacles: space.obstacles.map((o) => ({
      ...o,
      height: o.height === null ? null : roundM(o.height),
      polygon: toClockwise(o.polygon).map(roundPoint),
    })),
  }
  // Independently rounding a clipped wall and its diagonal boundary can make them cross,
  // or collapse a thin wall. Keep the valid source geometry rather than move/delete a wall.
  if (
    validateSpace(rounded).some((i) => i.severity === 'error') &&
    !validateSpace(space).some((i) => i.severity === 'error')
  ) {
    return {
      ...space,
      height: roundM(space.height),
      boundary: toClockwise(space.boundary).map(([x, z]): [number, number] => [x, z]),
      obstacles: space.obstacles.map((o) => ({
        ...o,
        polygon: toClockwise(o.polygon).map(([x, z]): [number, number] => [x, z]),
      })),
    }
  }
  return rounded
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
