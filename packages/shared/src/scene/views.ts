import { interiorPoint, locatePoint, segmentsProperlyCross } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type { ShopType } from '../enums.ts'
import type { Camera } from '../schemas/camera.ts'
import type { Entrance, Space } from '../schemas/space.ts'
import { roundM } from '../units.ts'
import { WALL_THICKNESS_M, wallSegments } from './walls.ts'
import type { WallSegment } from './walls.ts'

/**
 * The shop seen from its main entrance: `front` points out through the entrance, `right` is
 * the visitor's right when walking in. Extents are measured along these axes, so the same
 * view names work for any polygon and any entrance side. Without an entrance the front is
 * the bottom of the plan (+z), as in the legacy viewer.
 */
export interface SceneFrame {
  front: Point
  right: Point
  center: Point
  width: number
  depth: number
  /** Midpoint of the main entrance, or of the front side when there is none. */
  entrance: Point
}

export function mainEntrance(space: Space): Entrance | null {
  return space.entrances.find((e) => e.kind === 'main') ?? space.entrances[0] ?? null
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
/** Direction with -0 folded into 0, so axis-aligned directions compare equal. */
const unit = (x: number, z: number): Point => [x + 0, z + 0]

/** Unit normal of the entrance pointing out of the shop. */
function outwardNormal(space: Space, entrance: Entrance): Point | null {
  const dx = entrance.b[0] - entrance.a[0]
  const dz = entrance.b[1] - entrance.a[1]
  const length = Math.hypot(dx, dz)
  if (length === 0) return null
  const normal = unit(dz / length, -dx / length)
  const mid: Point = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
  const probe: Point = [mid[0] + normal[0] * 0.05, mid[1] + normal[1] * 0.05]
  return locatePoint(probe, space.boundary) === 'inside' ? unit(-normal[0], -normal[1]) : normal
}

export function sceneFrame(space: Space): SceneFrame {
  const entrance = mainEntrance(space)
  const front = (entrance && outwardNormal(space, entrance)) ?? [0, 1]
  const right = unit(front[1], -front[0])
  const us = space.boundary.map((p) => dot(p, right))
  const vs = space.boundary.map((p) => dot(p, front))
  const [uMin, uMax, vMin, vMax] = [
    Math.min(...us),
    Math.max(...us),
    Math.min(...vs),
    Math.max(...vs),
  ]
  const u = (uMin + uMax) / 2
  const v = (vMin + vMax) / 2
  const center: Point = [right[0] * u + front[0] * v, right[1] * u + front[1] * v]
  const depth = vMax - vMin
  return {
    front,
    right,
    center,
    width: uMax - uMin,
    depth,
    entrance: entrance
      ? [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2]
      : [center[0] + (front[0] * depth) / 2, center[1] + (front[1] * depth) / 2],
  }
}

/**
 * The legacy default views, as [name, across, height, along]: `across` runs 0 → 1 from the
 * visitor's left to right, `along` 0 → 1 from the back wall to the entrance, `height` is a
 * multiple of the larger plan extent. Values outside 0–1 stand outside the shop.
 */
const ORBIT_VIEWS: readonly [string, number, number, number][] = [
  ['正面鸟瞰', 0.5, 1.15, 1.8],
  ['左前方', -0.7, 1, 1.4],
  ['右前方', 1.7, 1, 1.4],
  ['右后方', 1.7, 1, -0.4],
  ['左后方', -0.7, 1, -0.4],
  ['背面鸟瞰', 0.5, 1.3, -0.85],
  ['顶部俯视', 0.5, 2.4, 0.501],
]

export const DEFAULT_VIEW_NAMES = [...ORBIT_VIEWS.map((v) => v[0]), '入口方向'] as const

/** Image aspect ratio of every view (legacy 960 × 640). */
export const VIEW_ASPECT = 1.5

const vec = (p: Point, y: number): [number, number, number] => [
  roundM(p[0]),
  roundM(y),
  roundM(p[1]),
]

type Vec3 = readonly [number, number, number]

/** Where a → b crosses the segment c → d, as a fraction of a → b, or null. */
function crossing(a: Point, b: Point, c: Point, d: Point): number | null {
  if (!segmentsProperlyCross(a, b, c, d)) return null
  const rx = b[0] - a[0]
  const rz = b[1] - a[1]
  const sx = d[0] - c[0]
  const sz = d[1] - c[1]
  return ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / (rx * sz - rz * sx)
}

/**
 * True when the sight line from `eye` to `target` passes through a full-height wall (either
 * face of it). Cut-away walls are low enough to look over and are ignored.
 */
export function sightBlocked(eye: Vec3, target: Vec3, walls: readonly WallSegment[]): boolean {
  const from: Point = [eye[0], eye[2]]
  const to: Point = [target[0], target[2]]
  return walls.some((wall) => {
    if (wall.kind !== 'full') return false
    const shift = (p: Point): Point => [
      p[0] + wall.outward[0] * WALL_THICKNESS_M,
      p[1] + wall.outward[1] * WALL_THICKNESS_M,
    ]
    const faces: [Point, Point][] = [
      [wall.a, wall.b],
      [shift(wall.a), shift(wall.b)],
    ]
    return faces.some(([c, d]) => {
      const t = crossing(from, to, c, d)
      return t !== null && eye[1] + (target[1] - eye[1]) * t < wall.height
    })
  })
}

/** Turns of the camera around the target tried, in order, when its view is blocked. */
const DETOURS_DEG = [15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90]

/**
 * The camera moved along its circle around the target (same height and distance) to the
 * first place with a clear view, or left where it is when no place is clear.
 */
function clearPosition(
  position: [number, number, number],
  target: Vec3,
  walls: readonly WallSegment[],
): [number, number, number] {
  if (!sightBlocked(position, target, walls)) return position
  const dx = position[0] - target[0]
  const dz = position[2] - target[2]
  for (const deg of DETOURS_DEG) {
    const r = (deg * Math.PI) / 180
    const [c, s] = [Math.cos(r), Math.sin(r)]
    const moved = vec([target[0] + dx * c - dz * s, target[2] + dx * s + dz * c], position[1])
    if (!sightBlocked(moved, target, walls)) return moved
  }
  return position
}

/**
 * The end of the entrance view: `reach` into the shop straight from the entrance, pulled
 * back towards the entrance while the sight line would leave the shop (U shapes, entrances
 * in a notch); the inside point of the shop when even a short look leaves it.
 */
function entranceTarget(space: Space, f: SceneFrame, reach: number): Point {
  const ring = space.boundary
  const start: Point = [f.entrance[0] - f.front[0] * 0.05, f.entrance[1] - f.front[1] * 0.05]
  const steps = 15
  for (let i = steps; i >= 1; i--) {
    const k = (reach * i) / steps
    const end: Point = [f.entrance[0] - f.front[0] * k, f.entrance[1] - f.front[1] * k]
    if (locatePoint(end, ring) !== 'inside') continue
    const clear = ring.every((a, j) => {
      const b = ring[(j + 1) % ring.length] ?? a
      return !segmentsProperlyCross(start, end, a, b)
    })
    if (clear) return end
  }
  return interiorPoint(ring, { prefer: f.center })
}

/**
 * The eight default views of a white model, deterministic for a given space. The orbit views
 * look at the point of the floor farthest from the walls (the plan centre of a rectangle);
 * one whose sight line runs through a full-height wall moves along its circle until it is
 * clear. Island shops have no walls; without a shop type every shop is treated as walled.
 */
export function defaultCameras(space: Space, shopType?: ShopType): Camera[] {
  const f = sceneFrame(space)
  const at = (across: number, along: number): Point => {
    const a = (across - 0.5) * f.width
    const b = (along - 0.5) * f.depth
    return [
      f.center[0] + f.right[0] * a + f.front[0] * b,
      f.center[1] + f.right[1] * a + f.front[1] * b,
    ]
  }
  const span = Math.max(f.width, f.depth)
  const walls = wallSegments(space, shopType ?? 'side_hall')
  const target = vec(interiorPoint(space.boundary, { prefer: f.center }), space.height * 0.25)
  const orbit = ORBIT_VIEWS.map(([name, across, height, along]) => ({
    name,
    position: clearPosition(vec(at(across, along), span * height), target, walls),
    target,
    fovDeg: 48,
    source: 'auto' as const,
  }))
  const outside: Point = [f.entrance[0] + f.front[0] * 0.8, f.entrance[1] + f.front[1] * 0.8]
  const inside = entranceTarget(space, f, f.depth * 0.75)
  return [
    ...orbit,
    {
      name: '入口方向',
      position: vec(outside, Math.min(1.65, space.height * 0.6)),
      target: vec(inside, Math.min(1.35, space.height * 0.45)),
      fovDeg: 72,
      source: 'auto',
    },
  ]
}
