import type { Point } from '../geometry/types.ts'
import { facingAfter } from '../planner/orientation.ts'
import type { FrontAxis } from '../schemas/asset.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import type { Space } from '../schemas/space.ts'
import { EPSILON_M, roundM } from '../units.ts'
import { ON_WALL_M, WALL_SNAP_M, wallFaces, wallMountSnap } from './index.ts'
import type { WallFace, WallPlacement } from './index.ts'

/**
 * Pieces built into a wall (内嵌: 广告机, KV 灯箱): the front lies on the wall face, the body is
 * inside the wall. They take no floor space and only meet other built-in pieces. Kept apart
 * from the wall-piece rules so arbitrary angles can replace both independently.
 */

/** Default centre height of a built-in screen or light box. */
export const EMBEDDED_CENTRE_M = 1.5
/** Light boxes taller than this stand almost on the floor instead. */
const TALL_EMBEDDED_M = 2
const TALL_BOTTOM_M = 0.1

/** Where the front of a model points after its rotation (+Z when the model has no front). */
function facing(front: FrontAxis | null, rotation: LayoutItem['rotation']) {
  return facingAfter(front && front !== 'any' ? front : '+Z', rotation)
}

/**
 * Dragging a built-in piece: like a wall piece it turns its front into the shop, but it sinks
 * into the wall so its front is flush with the wall face. Null when no wall is near.
 */
export function embeddedSnap(
  item: Pick<LayoutItem, 'w' | 'd' | 'rotation'>,
  cx: number,
  cz: number,
  space: Pick<Space, 'boundary' | 'openEdges'>,
  front: FrontAxis | null,
  reach = WALL_SNAP_M,
): WallPlacement | null {
  const onWall = wallMountSnap(item, cx, cz, space, front, reach)
  if (!onWall) return null
  const [fx, fz] = facing(front, onWall.rotation)
  // From "back on the wall" to "front on the wall": one depth further out.
  const depth = fx !== 0 ? onWall.w : onWall.d
  return {
    ...onWall,
    cx: roundM(onWall.cx - fx * depth),
    cz: roundM(onWall.cz - fz * depth),
  }
}

const coord = (p: Point, axis: 'x' | 'z') => (axis === 'x' ? p[0] : p[1])

/** The wall face a built-in piece's front is flush with, or null. */
export function embeddedWall(
  item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'>,
  space: Pick<Space, 'boundary' | 'openEdges'>,
): WallFace | null {
  let best: { face: WallFace; contact: number } | null = null
  for (const face of wallFaces(space)) {
    const at = face.along === 'x' ? item.cx : item.cz
    const s0 = coord(face.a, face.along)
    const s1 = coord(face.b, face.along)
    if (at < Math.min(s0, s1) - EPSILON_M || at > Math.max(s0, s1) + EPSILON_M) continue
    if (face.open.some(([from, to]) => at > from + EPSILON_M && at < to - EPSILON_M)) continue
    const across = face.along === 'x' ? 'z' : 'x'
    const t = s1 === s0 ? 0 : (at - s0) / (s1 - s0)
    const line = coord(face.a, across) + (coord(face.b, across) - coord(face.a, across)) * t
    const inwardSign = face.along === 'x' ? face.inward[1] : face.inward[0]
    const half = face.along === 'x' ? item.d / 2 : item.w / 2
    const centre = face.along === 'x' ? item.cz : item.cx
    if (Math.abs(centre + inwardSign * half - line) > ON_WALL_M + EPSILON_M) continue
    const contact = face.along === 'x' ? item.w : item.d
    if (!best || contact > best.contact) best = { face, contact }
  }
  return best?.face ?? null
}

/**
 * Default bottom height: the picture's centre at EMBEDDED_CENTRE_M; a light box taller than
 * 2 m starts TALL_BOTTOM_M above the floor. Never above the ceiling.
 */
export function defaultEmbeddedElevation(
  item: Pick<LayoutItem, 'h'>,
  space: Pick<Space, 'height'>,
): number {
  const bottom = item.h > TALL_EMBEDDED_M ? TALL_BOTTOM_M : EMBEDDED_CENTRE_M - item.h / 2
  return roundM(Math.max(0, Math.min(bottom, space.height - item.h)))
}
