import { rotatedFootprint, rotationFacing, roundM, sceneFrame } from '@store/shared'
import type { FrontAxis, LayoutItem, Point, Rotation, Space } from '@store/shared'

const WALL_GAP_M = 0.02

export const ALONG = ['back', 'front', 'left', 'right', 'center'] as const
type Along = (typeof ALONG)[number]

interface Placeable {
  footprint: { w: number; d: number; h: number }
  front: FrontAxis | null
}

interface Placed {
  cx: number
  cz: number
  rotation: Rotation
  w: number
  d: number
}

const flip = (v: Point): Point => [-v[0] + 0, -v[1] + 0]

/**
 * Centre, rotation and size of a prop set against a wall (or in the middle): the program
 * works out the coordinates so the model never has to. `position` runs 0 → 1 along the wall
 * (left to right seen from the entrance, back to front on the side walls); the prop's front
 * faces into the shop, or its long side lies along the wall when it has no front.
 */
export function placeAlong(
  space: Space,
  asset: Placeable,
  along: Along,
  position: number,
  rotationOverride?: Rotation,
): Placed {
  const f = sceneFrame(space)
  const side = along === 'left' || along === 'right'
  // Inward normal of the wall and the direction along it.
  const n: Point =
    along === 'back' || along === 'center'
      ? f.front
      : along === 'front'
        ? flip(f.front)
        : along === 'left'
          ? f.right
          : flip(f.right)
  const t: Point = side ? f.front : f.right
  const longAlongWall = Math.abs(t[0]) > 0 === asset.footprint.w >= asset.footprint.d ? 0 : 90
  const rotation = rotationOverride ?? rotationFacing(asset.front, n) ?? longAlongWall
  const size = rotatedFootprint(asset, rotation)
  const across = Math.abs(t[0]) * size.w + Math.abs(t[1]) * size.d
  const deep = Math.abs(n[0]) * size.w + Math.abs(n[1]) * size.d
  const length = side ? f.depth : f.width
  const half = side ? f.width / 2 : f.depth / 2
  const wanted = (Math.max(0, Math.min(1, position)) - 0.5) * length
  const u = Math.max(-length / 2 + across / 2, Math.min(length / 2 - across / 2, wanted))
  // The wall lies `half` from the centre against the normal; the prop sits just inside it.
  const off = along === 'center' ? 0 : half - deep / 2 - WALL_GAP_M
  return {
    cx: roundM(f.center[0] - n[0] * off + t[0] * u),
    cz: roundM(f.center[1] - n[1] * off + t[1] * u),
    rotation,
    w: size.w,
    d: size.d,
  }
}

/** An item's footprint before its rotation (a quarter turn swaps the sides back). */
export const unrotated = (item: Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation'>) =>
  rotatedFootprint({ footprint: item }, item.rotation)
