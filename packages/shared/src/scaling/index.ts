import { turnPoint } from '../geometry/obb.ts'
import type { Point } from '../geometry/types.ts'
import { MAX_ITEM_SCALE, MIN_ITEM_SCALE } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { roundM } from '../units.ts'

/**
 * Resizing a LOGO by dragging (user 10-16): on the plan by one end of its width, the other
 * end's centre staying put; in 3D by a corner of its front, the opposite corner staying put.
 * The scale is uniform (see scaleItem); these work out the scale and where the piece goes.
 * Directions follow the item's rotation through turnPoint, so any angle works.
 */

/** The model's size at scale 1 (Asset.footprint: width along its X, height, depth along Z). */
export interface ModelSize {
  w: number
  d: number
  h: number
}

type Sized = Pick<LayoutItem, 'cx' | 'cz' | 'rotation' | 'scale'>

export interface ScaledPlacement {
  scale: number
  cx: number
  cz: number
}

const clampScale = (s: number) => Math.min(MAX_ITEM_SCALE, Math.max(MIN_ITEM_SCALE, s))

/** The unit direction of the model's width (its +X) on the plan. */
export function widthAxis(item: Pick<LayoutItem, 'rotation'>): Point {
  return turnPoint(1, 0, item.rotation)
}

/** The centres of the two ends of the width on the plan: the model's −X end, then its +X end. */
export function widthEnds(item: Sized, model: ModelSize): [Point, Point] {
  const [ux, uz] = widthAxis(item)
  const half = (model.w * (item.scale ?? 1)) / 2
  return [
    [item.cx - ux * half, item.cz - uz * half],
    [item.cx + ux * half, item.cz + uz * half],
  ]
}

/**
 * Dragging an end (−1: the −X end, +1: the +X end) to `pointer`: the width becomes the
 * distance from the other end measured along the width, within the scale limits; that other
 * end's centre stays where it was.
 */
export function scaleFromEnd(
  item: Sized,
  model: ModelSize,
  end: -1 | 1,
  pointer: Point,
): ScaledPlacement {
  const [low, high] = widthEnds(item, model)
  const anchor = end > 0 ? low : high
  const [ux, uz] = widthAxis(item)
  const along = ((pointer[0] - anchor[0]) * ux + (pointer[1] - anchor[1]) * uz) * end
  const scale = Math.round(clampScale(along / model.w) * 1000) / 1000
  const half = (model.w * scale) / 2
  return {
    scale,
    cx: roundM(anchor[0] + ux * end * half),
    cz: roundM(anchor[1] + uz * end * half),
  }
}

/** A corner of the front: across the width (−1 the −X side, +1 the +X side) and up or down. */
export interface Corner {
  x: -1 | 1
  y: -1 | 1
}

/**
 * The four corners of the front face in 3D (x, y, z with y up): the front is the model's +Z
 * face at `elevation` above the floor.
 */
export function frontCorners(
  item: Sized & Pick<LayoutItem, 'elevation'>,
  model: ModelSize,
): { corner: Corner; at: [number, number, number] }[] {
  const s = item.scale ?? 1
  const bottom = item.elevation ?? 0
  return ([-1, 1] as const).flatMap((x) =>
    ([-1, 1] as const).map((y) => {
      const [dx, dz] = turnPoint((x * model.w * s) / 2, (model.d * s) / 2, item.rotation)
      return {
        corner: { x, y },
        at: [item.cx + dx, y > 0 ? bottom + model.h * s : bottom, item.cz + dz] as [
          number,
          number,
          number,
        ],
      }
    }),
  )
}

/**
 * Dragging a corner of the front to a point on the front's plane (plan position and height):
 * the scale follows the pointer along the diagonal from the opposite corner, which stays put.
 * Returns the new centre and the new height of the bottom above the floor.
 */
export function scaleFromCorner(
  item: Sized & Pick<LayoutItem, 'elevation'>,
  model: ModelSize,
  corner: Corner,
  pointer: { plan: Point; y: number },
): ScaledPlacement & { elevation: number } {
  const s = item.scale ?? 1
  const [ux, uz] = widthAxis(item)
  const bottom = item.elevation ?? 0
  // The fixed corner: the other end of the width, the other edge of the height.
  const anchor: Point = [
    item.cx - (ux * corner.x * model.w * s) / 2,
    item.cz - (uz * corner.x * model.w * s) / 2,
  ]
  const anchorY = corner.y > 0 ? bottom : bottom + model.h * s
  const across =
    ((pointer.plan[0] - anchor[0]) * ux + (pointer.plan[1] - anchor[1]) * uz) * corner.x
  const up = (pointer.y - anchorY) * corner.y
  // Projected on the diagonal (w, h): its length at scale 1 is |(w, h)|.
  const along = (across * model.w + up * model.h) / (model.w * model.w + model.h * model.h)
  const scale = Math.round(clampScale(along) * 1000) / 1000
  const half = (model.w * scale) / 2
  return {
    scale,
    cx: roundM(anchor[0] + ux * corner.x * half),
    cz: roundM(anchor[1] + uz * corner.x * half),
    elevation: roundM(Math.max(0, corner.y > 0 ? anchorY : anchorY - model.h * scale)),
  }
}
