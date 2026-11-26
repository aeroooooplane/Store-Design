export type { Point, Polygon, Rect } from './types.ts'
export {
  closestPointOnSegment,
  cross,
  distance,
  distanceToBoundary,
  distanceToSegment,
  edges,
  isClockwise,
  isSimplePolygon,
  locatePoint,
  polygonArea,
  polygonInsidePolygon,
  polygonIntersectionArea,
  segmentsIntersect,
  segmentsProperlyCross,
  signedArea,
  toClockwise,
} from './polygon.ts'
export type { PointLocation } from './polygon.ts'
export { boundaryPath, pathMidpoint } from './path.ts'
export type { BoundaryPiece } from './path.ts'
export {
  polygonOverlapsRect,
  rectCorners,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
} from './rect.ts'
export {
  obbBounds,
  obbCorners,
  obbGap,
  obbInsidePolygon,
  obbsOverlap,
  nearestQuarter,
  placedBox,
  quarterTilt,
  polygonOverlapsObb,
  segmentIntersectsObbInterior,
  turnPoint,
} from './obb.ts'
export type { Obb } from './obb.ts'
export { interiorPoint } from './interior.ts'
export type { InteriorPointOptions } from './interior.ts'
export { AGAINST_WALL_M, wallShift } from './follow-walls.ts'
