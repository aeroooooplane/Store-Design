/** Plan coordinates in metres: x to the right, z downwards (towards the drawing bottom). */
export type Point = readonly [x: number, z: number]
export type Polygon = readonly Point[]

/** Axis-aligned rectangle on the plan. Items rotate in quarter turns, so footprints stay axis-aligned. */
export interface Rect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}
