import {
  DEFAULT_RULES,
  NEAR_AXIS_DEG,
  normalizeRotation,
  obbInsidePolygon,
  placedBox,
  polygonOverlapsObb,
  rotatedFootprint,
  rotationFacing,
  roundM,
  sceneFrame,
  turnPoint,
} from '@store/shared'
import type { FrontAxis, LayoutItem, Point, Rotation, ShopType, Space } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import {
  SIDE_LABELS,
  dot,
  interiorPoint,
  neg,
  rayToBoundary,
  sideDirections,
  wallEdges,
} from './walls.ts'
import type { Side, WallEdge } from './walls.ts'

/** Gap between a prop and its wall: the planner's, per shop type (an island keeps off the lease line). */
export const wallGap = (shopType: ShopType) => DEFAULT_RULES[shopType].wallGap

export const ALONG = ['back', 'front', 'left', 'right', 'center'] as const
type Along = (typeof ALONG)[number]

interface Placeable {
  name: string
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

/** Step when a prop slides along its wall away from a corner it does not fit into. */
const SLIDE_M = 0.05
const OUTSIDE = '会超出店铺边界'

const AXES: readonly Point[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
]

/** The plan axis nearest to `v`; ties go to the one nearest to `prefer`. */
function nearestAxis(v: Point, prefer: Point): Point {
  let best = AXES[0] ?? [0, 1]
  let score = -Infinity
  for (const axis of AXES) {
    const s = dot(v, axis) + 1e-6 * dot(prefer, axis)
    if (s > score) {
      score = s
      best = axis
    }
  }
  return best
}

/**
 * Rotation and rotated size of a prop facing `inward`: its front faces into the shop (when
 * `inward` is a plan axis), or its long side lies across `inward` when it has no front.
 */
function orient(asset: Placeable, inward: Point, override?: Rotation) {
  const wallAlongX = Math.abs(inward[0]) < Math.abs(inward[1])
  const longAlongWall: Rotation = wallAlongX === asset.footprint.w >= asset.footprint.d ? 0 : 90
  const rotation = override ?? rotationFacing(asset.front, inward) ?? longAlongWall
  return { rotation, size: rotatedFootprint(asset, rotation) }
}

/** Half the extent of an axis-aligned w × d rectangle along the unit direction `v`. */
const halfExtent = (v: Point, w: number, d: number) => (Math.abs(v[0]) * w + Math.abs(v[1]) * d) / 2

/** Half the extent along the unit direction `v` of a model turned to `rotation` (any angle). */
function turnedHalfExtent(v: Point, footprint: { w: number; d: number }, rotation: number) {
  const ux = turnPoint(1, 0, rotation)
  const uz = turnPoint(0, 1, rotation)
  return (
    (Math.abs(v[0] * ux[0] + v[1] * ux[1]) * footprint.w +
      Math.abs(v[0] * uz[0] + v[1] * uz[1]) * footprint.d) /
    2
  )
}

const NEAR_AXIS_TAN = Math.tan((NEAR_AXIS_DEG * Math.PI) / 180)

/** A slanted edge: more than NEAR_AXIS_DEG off both plan axes (straighter ones count as straight). */
const slanted = (v: Point) =>
  Math.min(Math.abs(v[0]), Math.abs(v[1])) >
  Math.max(Math.abs(v[0]), Math.abs(v[1])) * NEAR_AXIS_TAN

const FRONTS: Record<Exclude<FrontAxis, 'any'>, Point> = {
  '+Z': [0, 1],
  '-Z': [0, -1],
  '+X': [1, 0],
  '-X': [-1, 0],
}
const degrees = (v: Point) => (Math.atan2(v[1], v[0]) * 180) / Math.PI

/**
 * Rotation of a prop against a slanted edge, at the edge's own angle: its front faces `inward`,
 * or its long side lies along `tangent` when it has no front.
 */
function alongSlant(asset: Placeable, inward: Point, tangent: Point, override?: Rotation) {
  if (override !== undefined) return override
  if (asset.front && asset.front !== 'any')
    return normalizeRotation(degrees(inward) - degrees(FRONTS[asset.front]))
  return normalizeRotation(degrees(tangent) + (asset.footprint.w >= asset.footprint.d ? 0 : 90))
}

/** Why a footprint cannot stand there, or null when it lies inside the shop clear of obstacles. */
function misfit(space: Space, p: Placed): string | null {
  const box = placedBox(p)
  if (!obbInsidePolygon(box, space.boundary)) return OUTSIDE
  const index = space.obstacles.findIndex((o) => polygonOverlapsObb(o.polygon, box))
  const hit = space.obstacles[index]
  return hit ? `会压住${hit.label ?? `障碍物 ${index + 1}`}` : null
}

/**
 * The prop at `from` on a line, or nearer to `to` in SLIDE_M steps while it pokes out of the
 * shop; the first spot inside, or the last one tried with its problem.
 */
function slide(space: Space, from: number, to: number, at: (s: number) => Placed) {
  let s = from
  let placed = at(s)
  let problem = misfit(space, placed)
  while (problem === OUTSIDE && Math.abs(to - s) > 1e-9) {
    s = Math.abs(to - s) <= SLIDE_M ? to : s + Math.sign(to - s) * SLIDE_M
    placed = at(s)
    problem = misfit(space, placed)
  }
  return { placed, problem }
}

/** A prop against one real edge of a wall. */
interface Option {
  edge: WallEdge
  /** Where the edge's position 0 lies and the unit direction it runs in. */
  start: Point
  dir: Point
  rotation: Rotation
  w: number
  d: number
  /** Half the prop along the edge and across it. */
  along: number
  across: number
}

/**
 * The edges of a wall, ordered by where they start along `run` (left to right seen from the
 * entrance, back to front on the side walls); of two starting level, the outer one first (the
 * outer left wall of a U before the side of its notch).
 */
function wallOptions(
  space: Space,
  asset: Placeable,
  side: Side,
  run: Point,
  override?: Rotation,
): Option[] {
  const f = sceneFrame(space)
  const wallIn = neg(sideDirections(f)[side])
  return wallEdges(space, f)
    .filter((e) => e.side === side && e.length > 0)
    .map((edge) => {
      // A slanted edge takes the prop at its own angle, flush with it; a straight one (within
      // NEAR_AXIS_DEG) at the nearest quarter turn.
      const rotation = slanted(edge.tangent)
        ? alongSlant(asset, edge.inward, edge.tangent, override)
        : orient(asset, nearestAxis(edge.inward, wallIn), override).rotation
      const size = rotatedFootprint(asset, rotation)
      const forward = dot(edge.tangent, run) >= 0
      return {
        edge,
        start: forward ? edge.a : edge.b,
        dir: forward ? edge.tangent : neg(edge.tangent),
        rotation,
        w: size.w,
        d: size.d,
        along: turnedHalfExtent(edge.tangent, asset.footprint, rotation),
        across: turnedHalfExtent(edge.inward, asset.footprint, rotation),
      }
    })
    .sort((x, y) => {
      const ahead = dot(x.start, run) - dot(y.start, run)
      return Math.abs(ahead) > 1e-6
        ? ahead
        : dot(x.edge.inward, x.start) - dot(y.edge.inward, y.start)
    })
}

/** The prop `s` metres along an edge, its nearest corner `gap` off the wall. */
function onEdge(o: Option, s: number, gap: number): Placed {
  const off = o.across + gap
  return {
    cx: roundM(o.start[0] + o.dir[0] * s + o.edge.inward[0] * off),
    cz: roundM(o.start[1] + o.dir[1] * s + o.edge.inward[1] * off),
    rotation: o.rotation,
    w: o.w,
    d: o.d,
  }
}

function againstWall(
  space: Space,
  asset: Placeable,
  side: Side,
  position: number,
  gap: number,
  override?: Rotation,
): Placed {
  const f = sceneFrame(space)
  const run = side === 'left' || side === 'right' ? f.front : f.right
  const all = wallOptions(space, asset, side, run, override)
  // Only edges long enough for the prop count.
  const options = all.filter((o) => o.edge.length >= 2 * o.along - 1e-9)
  const label = SIDE_LABELS[side]
  if (!options.length) {
    const need = Math.round(
      Math.min(...all.map((o) => 2 * o.along), 2 * Math.max(asset.footprint.w, asset.footprint.d)) *
        1000,
    )
    throw new AppError(
      'VALIDATION_FAILED',
      `${label}没有放得下「${asset.name}」的墙段（沿墙至少需要 ${need} 毫米），请换一面墙或放在中央`,
    )
  }
  // position runs over the total length of the wall's edges; the prop stays on the edge it falls on.
  let s = position * options.reduce((sum, o) => sum + o.edge.length, 0)
  let option = options[0] as Option
  for (const [i, o] of options.entries()) {
    option = o
    if (s < o.edge.length || i === options.length - 1) break
    s -= o.edge.length
  }
  const { edge, along } = option
  s = Math.max(along, Math.min(edge.length - along, s))
  // A slanted or inner corner may not take the prop at the end of the edge: it slides towards
  // the middle of the edge.
  const { placed, problem } = slide(space, s, edge.length / 2, (at) => onEdge(option, at, gap))
  if (problem) {
    throw new AppError(
      'VALIDATION_FAILED',
      `「${asset.name}」放在${label}（position ${position}）${problem}，请换一个位置或换一面墙`,
    )
  }
  return placed
}

/**
 * Centre, rotation and size of a prop set against a wall (or in the middle): the program
 * works out the coordinates so the model never has to. `position` runs 0 → 1 over the wall's
 * real edges (left to right seen from the entrance, back to front on the side walls); the
 * prop's front faces into the shop, or its long side lies along the wall when it has no front.
 * On an edge more than NEAR_AXIS_DEG off the plan axes it stands at the edge's own angle, flush
 * with it at `gap` (confirmed by the user, 2026-10-15). 'center' is the most open point of the floor, `position`
 * running across the shop through it. Throws when the prop would leave the shop or cover an
 * obstacle, so nothing out of bounds is saved.
 */
export function placeAlong(
  space: Space,
  asset: Placeable,
  along: Along,
  position: number,
  gap: number,
  rotationOverride?: Rotation,
): Placed {
  const p = Math.max(0, Math.min(1, position))
  if (along !== 'center') return againstWall(space, asset, along, p, gap, rotationOverride)
  const f = sceneFrame(space)
  const t = f.right
  const { rotation, size } = orient(asset, f.front, rotationOverride)
  const pole = interiorPoint(space, f.center)
  // The chord across the shop through that point: 0.5 is the point itself, each step of
  // position moves the prop by that share of the chord, kept on it.
  const back = rayToBoundary(pole, neg(t), space.boundary) ?? 0
  const chord = back + (rayToBoundary(pole, t, space.boundary) ?? 0)
  const half = halfExtent(t, size.w, size.d)
  const wanted = back + (p - 0.5) * chord
  const s = chord >= 2 * half ? Math.max(half, Math.min(chord - half, wanted)) : back
  // Off the point the prop may reach into a narrower part of the shop: it slides back towards it.
  const { placed, problem } = slide(space, s, back, (at) => ({
    cx: roundM(pole[0] + t[0] * (at - back)),
    cz: roundM(pole[1] + t[1] * (at - back)),
    rotation,
    w: size.w,
    d: size.d,
  }))
  if (problem) {
    throw new AppError(
      'VALIDATION_FAILED',
      `「${asset.name}」放在中央（position ${position}）${problem}，请换一个位置或贴墙放`,
    )
  }
  return placed
}

/** An item's footprint before its rotation (a quarter turn swaps the sides back). */
export const unrotated = (item: Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation'>) =>
  rotatedFootprint({ footprint: item }, item.rotation)
