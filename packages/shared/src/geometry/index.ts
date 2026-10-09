export type { Point, Polygon, Rect } from './types.ts'
export {
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
  segmentsIntersect,
  segmentsProperlyCross,
  signedArea,
  toClockwise,
} from './polygon.ts'
export type { PointLocation } from './polygon.ts'
export {
  polygonOverlapsRect,
  rectCorners,
  rectFromCenter,
  rectGap,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
} from './rect.ts'
