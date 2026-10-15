import { edges, locatePoint } from '../geometry/polygon.ts'
import { nearestQuarter, obbsOverlap, placedBox } from '../geometry/obb.ts'
import { rectFromCenter, rectsOverlap } from '../geometry/rect.ts'
import type { Point } from '../geometry/types.ts'
import { rotationFacing } from '../planner/orientation.ts'
import type { PlanDirection } from '../planner/orientation.ts'
import type { FrontAxis, Installation } from '../schemas/asset.ts'
import type { LayoutItem, Rotation } from '../schemas/layout.ts'
import { openingPieces } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { EPSILON_M, roundM } from '../units.ts'

/**
 * Wall and ceiling pieces (墙面 LOGO, 画面, 吊挂 LOGO). They are placed like props, by footprint
 * centre and quarter-turn rotation, plus a height above the floor. Each rule lives in its own
 * function so that arbitrary angles can later replace the axis-aligned versions one by one.
 */

/** A dragged wall piece jumps onto a wall face within this distance (metres). */
export const WALL_SNAP_M = 0.3
/** A wall piece whose back is this close to a wall face counts as on the wall. */
export const ON_WALL_M = 0.01
/** Boundary edges within this angle of an axis count as straight walls. */
export const STRAIGHT_WALL_DEG = 3
/** Default bottom height of a wall piece with nothing standing below it. */
export const DEFAULT_WALL_ELEVATION_M = 1.8
/** Clearance above the tallest prop standing below a wall piece. */
export const ABOVE_PROP_GAP_M = 0.1
/** Floor props this far from the wall (or nearer) count as standing below a wall piece. */
const BELOW_DEPTH_M = 1

/** Fields of a placed item these rules read. */
export type MountedItem = Pick<
  LayoutItem,
  'id' | 'cx' | 'cz' | 'w' | 'd' | 'h' | 'rotation' | 'mount' | 'elevation'
>

export function itemMount(item: Pick<LayoutItem, 'mount'>): Installation {
  return item.mount ?? 'floor'
}

/** Bottom height above the floor; props standing on the floor are always at 0. */
export function itemElevation(item: Pick<LayoutItem, 'mount' | 'elevation'>): number {
  return itemMount(item) === 'floor' ? 0 : (item.elevation ?? 0)
}

/** Bottom and top height of an item. */
export function verticalRange(
  item: Pick<LayoutItem, 'mount' | 'elevation' | 'h'>,
): [number, number] {
  const bottom = itemElevation(item)
  return [bottom, bottom + item.h]
}

/** Fields itemsCollide reads; without a rotation an item counts as unturned. */
type Colliding = Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd' | 'h' | 'mount' | 'elevation'> & {
  rotation?: number | undefined
}

/**
 * Whether two items take up the same room. Floor props clash when their footprints overlap (as
 * turned boxes); a wall or ceiling piece never clashes with a floor prop (a LOGO above a cabinet
 * is normal); two raised pieces clash when both their footprints and their heights overlap. A
 * built-in piece (embedded) is inside the wall and only meets other built-in pieces, the same way.
 */
export function itemsCollide(a: Colliding, b: Colliding): boolean {
  if (!obbsOverlap(placedBox(a), placedBox(b))) return false
  const floorA = itemMount(a) === 'floor'
  const floorB = itemMount(b) === 'floor'
  if (floorA && floorB) return true
  // Built-in pieces are inside the wall: they only meet other built-in pieces.
  if ((itemMount(a) === 'embedded') !== (itemMount(b) === 'embedded')) return false
  if (floorA !== floorB) return false
  const [a0, a1] = verticalRange(a)
  const [b0, b1] = verticalRange(b)
  return a0 < b1 - EPSILON_M && b0 < a1 - EPSILON_M
}

/**
 * A straight stretch of wall a piece can hang on: a boundary edge within STRAIGHT_WALL_DEG of
 * an axis. `along` is the axis it runs along; `inward` points into the shop.
 */
export interface WallFace {
  edge: number
  a: Point
  b: Point
  along: 'x' | 'z'
  inward: PlanDirection
  /** Stretches of this edge without a wall (open edges), as [from, to] along `along`. */
  open: [number, number][]
}

const coord = (p: Point, axis: 'x' | 'z') => (axis === 'x' ? p[0] : p[1])

/** The straight wall faces of a space, open edges marked. */
export function wallFaces(space: Pick<Space, 'boundary' | 'openEdges'>): WallFace[] {
  const tan = Math.tan((STRAIGHT_WALL_DEG * Math.PI) / 180)
  const open = new Map<number, [Point, Point][]>()
  for (const opening of space.openEdges) {
    for (const piece of openingPieces(space, opening) ?? []) {
      open.set(piece.edge, [...(open.get(piece.edge) ?? []), [piece.a, piece.b]])
    }
  }
  const faces: WallFace[] = []
  edges(space.boundary).forEach(([a, b], edge) => {
    const dx = Math.abs(b[0] - a[0])
    const dz = Math.abs(b[1] - a[1])
    if (Math.hypot(dx, dz) < EPSILON_M) return
    let along: 'x' | 'z'
    if (dz <= dx * tan) along = 'x'
    else if (dx <= dz * tan) along = 'z'
    else return
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const normal: PlanDirection = along === 'x' ? [0, 1] : [1, 0]
    const probe: Point = [mid[0] + normal[0] * 0.01, mid[1] + normal[1] * 0.01]
    const inward: PlanDirection =
      locatePoint(probe, space.boundary) === 'inside' ? normal : [-normal[0] + 0, -normal[1] + 0]
    faces.push({
      edge,
      a,
      b,
      along,
      inward,
      open: (open.get(edge) ?? []).map(([p, q]) => {
        const [s, t] = [coord(p, along), coord(q, along)]
        return [Math.min(s, t), Math.max(s, t)]
      }),
    })
  })
  return faces
}

/** Where the wall face is across its run at `at` along it (sloping a little within 3°). */
function faceLineAt(face: WallFace, at: number): number {
  const across = face.along === 'x' ? 'z' : 'x'
  const s0 = coord(face.a, face.along)
  const s1 = coord(face.b, face.along)
  const t = s1 === s0 ? 0 : (at - s0) / (s1 - s0)
  return coord(face.a, across) + (coord(face.b, across) - coord(face.a, across)) * t
}

/** Whether `at` along the face has a wall: within the edge and not on an open stretch. */
function hasWallAt(face: WallFace, at: number): boolean {
  const s0 = coord(face.a, face.along)
  const s1 = coord(face.b, face.along)
  if (at < Math.min(s0, s1) - EPSILON_M || at > Math.max(s0, s1) + EPSILON_M) return false
  return !face.open.some(([from, to]) => at > from + EPSILON_M && at < to - EPSILON_M)
}

/**
 * The wall face this item's back is against, or null. A piece in a corner may touch two walls
 * (a long LOGO's end reaching the next wall): the one it runs along the furthest wins.
 */
export function mountedWall(
  item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'>,
  space: Pick<Space, 'boundary' | 'openEdges'>,
): WallFace | null {
  let best: { face: WallFace; contact: number } | null = null
  for (const face of wallFaces(space)) {
    const at = face.along === 'x' ? item.cx : item.cz
    if (!hasWallAt(face, at)) continue
    const inwardSign = face.along === 'x' ? face.inward[1] : face.inward[0]
    const half = face.along === 'x' ? item.d / 2 : item.w / 2
    const centre = face.along === 'x' ? item.cz : item.cx
    const back = centre - inwardSign * half
    if (Math.abs(back - faceLineAt(face, at)) > ON_WALL_M + EPSILON_M) continue
    const contact = face.along === 'x' ? item.w : item.d
    if (!best || contact > best.contact) best = { face, contact }
  }
  return best?.face ?? null
}

/**
 * Footprint after turning from `from` to the quarter turn `to`: width and depth swap when the
 * nearest quarter turn of `from` is a quarter off it.
 */
function turned(item: Pick<LayoutItem, 'w' | 'd'>, from: Rotation, to: Rotation) {
  return (nearestQuarter(from) - to) % 180 === 0
    ? { w: item.w, d: item.d }
    : { w: item.d, d: item.w }
}

export interface WallPlacement {
  cx: number
  cz: number
  rotation: Rotation
  w: number
  d: number
}

/**
 * Dragging a wall piece: when the dragged centre comes within `reach` of a wall face, the piece
 * turns its front (the model's `front`, +Z when unknown) into the shop and its back lands on
 * the wall. Null when no wall is near.
 */
export function wallMountSnap(
  item: Pick<LayoutItem, 'w' | 'd' | 'rotation'>,
  cx: number,
  cz: number,
  space: Pick<Space, 'boundary' | 'openEdges'>,
  front: FrontAxis | null,
  reach = WALL_SNAP_M,
): WallPlacement | null {
  const facing = front && front !== 'any' ? front : '+Z'
  let best: (WallPlacement & { gap: number }) | null = null
  for (const face of wallFaces(space)) {
    const at = face.along === 'x' ? cx : cz
    if (!hasWallAt(face, at)) continue
    const rotation = rotationFacing(facing, face.inward)
    if (rotation === null) continue
    const size = turned(item, item.rotation, rotation)
    const depth = face.along === 'x' ? size.d : size.w
    // The piece stays on this stretch of wall: a long LOGO slides back from a corner.
    const length = face.along === 'x' ? size.w : size.d
    const s0 = Math.min(coord(face.a, face.along), coord(face.b, face.along))
    const s1 = Math.max(coord(face.a, face.along), coord(face.b, face.along))
    const middle =
      s1 - s0 >= length ? Math.min(s1 - length / 2, Math.max(s0 + length / 2, at)) : (s0 + s1) / 2
    const inwardSign = face.along === 'x' ? face.inward[1] : face.inward[0]
    const target = faceLineAt(face, middle) + (inwardSign * depth) / 2
    const gap = Math.abs((face.along === 'x' ? cz : cx) - target)
    if (gap > reach + depth / 2 || (best && gap >= best.gap)) continue
    best = {
      cx: roundM(face.along === 'x' ? middle : target),
      cz: roundM(face.along === 'x' ? target : middle),
      rotation,
      ...size,
      gap,
    }
  }
  if (!best) return null
  const { gap: _gap, ...placement } = best
  return placement
}

/**
 * Default height for a piece just placed: a ceiling piece hangs with its top at the ceiling; a
 * wall piece sits ABOVE_PROP_GAP_M above the tallest floor prop standing below it (within
 * BELOW_DEPTH_M of the wall), else at DEFAULT_WALL_ELEVATION_M. Never above the ceiling.
 */
export function defaultElevation(
  item: Pick<LayoutItem, 'id' | 'cx' | 'cz' | 'w' | 'd' | 'h' | 'mount'>,
  others: readonly Pick<LayoutItem, 'id' | 'cx' | 'cz' | 'w' | 'd' | 'h' | 'mount'>[],
  space: Pick<Space, 'boundary' | 'openEdges' | 'height'>,
): number {
  const highest = Math.max(0, space.height - item.h)
  if (itemMount(item) === 'ceiling') return roundM(highest)
  if (itemMount(item) === 'floor') return 0
  const face = mountedWall(item, space)
  const reach = face
    ? rectFromCenter(
        item.cx + (face.inward[0] * BELOW_DEPTH_M) / 2,
        item.cz + (face.inward[1] * BELOW_DEPTH_M) / 2,
        face.along === 'x' ? item.w : item.w + BELOW_DEPTH_M,
        face.along === 'x' ? item.d + BELOW_DEPTH_M : item.d,
      )
    : rectFromCenter(item.cx, item.cz, item.w, item.d)
  const below = others.filter(
    (o) =>
      o.id !== item.id &&
      itemMount(o) === 'floor' &&
      rectsOverlap(reach, rectFromCenter(o.cx, o.cz, o.w, o.d)),
  )
  const base = below.length
    ? Math.max(...below.map((o) => o.h)) + ABOVE_PROP_GAP_M
    : DEFAULT_WALL_ELEVATION_M
  return roundM(Math.min(base, highest))
}
