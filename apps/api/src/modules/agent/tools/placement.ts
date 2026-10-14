import {
  DEFAULT_RULES,
  edges,
  locatePoint,
  rotatedFootprint,
  rotationFacing,
  roundM,
  sceneFrame,
} from '@store/shared'
import type { FrontAxis, LayoutItem, Point, Rotation, ShopType, Space } from '@store/shared'

/** Gap between a prop and its wall: the planner's, per shop type (an island keeps off the lease line). */
export const wallGap = (shopType: ShopType) => DEFAULT_RULES[shopType].wallGap

/** Distance from `from` along the unit direction `dir` to the nearest boundary edge; null if none. */
function rayToBoundary(from: Point, dir: Point, space: Space): number | null {
  let nearest: number | null = null
  for (const [a, b] of edges(space.boundary)) {
    const e: Point = [b[0] - a[0], b[1] - a[1]]
    const denom = dir[0] * e[1] - dir[1] * e[0]
    if (Math.abs(denom) < 1e-12) continue
    const w: Point = [a[0] - from[0], a[1] - from[1]]
    const t = (w[0] * e[1] - w[1] * e[0]) / denom
    const s = (w[0] * dir[1] - w[1] * dir[0]) / denom
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && (nearest === null || t < nearest)) nearest = t
  }
  return nearest
}

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
  gap: number,
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
  // The wall: the real boundary behind the prop's width (the nearest of its two ends and middle),
  // so an L-shaped shop is not walled by its bounding box; `half` (the box) when a sample lies
  // outside the shop. The prop sits `gap` inside it.
  let wall = half
  if (along !== 'center') {
    const away = flip(n)
    const hits = [u - across / 2, u, u + across / 2].map((s) => {
      const p: Point = [f.center[0] + t[0] * s, f.center[1] + t[1] * s]
      return locatePoint(p, space.boundary) === 'inside' ? rayToBoundary(p, away, space) : null
    })
    if (hits.every((h) => h !== null)) wall = Math.min(...hits)
  }
  const off = along === 'center' ? 0 : wall - deep / 2 - gap
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
