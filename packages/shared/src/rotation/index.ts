import { nearestQuarter, placedBox, obbCorners, turnPoint } from '../geometry/obb.ts'
import { distanceToSegment, edges, locatePoint } from '../geometry/polygon.ts'
import type { Point } from '../geometry/types.ts'
import { normalizeRotation } from '../schemas/layout.ts'
import { openingPieces } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'

/**
 * Turning a prop to any angle by hand (confirmed by the user, 2026-10-15): near a wall the angle
 * jumps to lie parallel or square to it; elsewhere to 15° steps; with Alt held it turns freely.
 * The plan's rotation handle and the 3D rotation ring share these rules.
 */

/** Within this many degrees of parallel or square to a nearby wall, the angle snaps to it. */
export const WALL_ANGLE_SNAP_DEG = 5
/** Away from walls the angle snaps to steps of this many degrees… */
export const ANGLE_STEP_DEG = 15
/** …when within this many degrees of one. */
export const ANGLE_STEP_SNAP_DEG = 2.5
/** Walls this far from the prop's outline (metres) count as nearby. */
export const WALL_ANGLE_REACH_M = 1.5
/** A dragged tilted prop's side jumps flush onto a parallel wall within this distance. */
export const WALL_FLUSH_SNAP_M = 0.1

/**
 * A straight piece of wall: part of a boundary edge without an entrance or open edge on it.
 * `angle` is its direction a → b in the layout's convention (a prop at that rotation runs along
 * it); `inward` points into the shop.
 */
export interface WallLine {
  edge: number
  a: Point
  b: Point
  angle: number
  inward: [number, number]
}

/** The walls of a space as straight pieces, entrances and open edges cut out. */
export function wallLines(space: Pick<Space, 'boundary' | 'entrances' | 'openEdges'>): WallLine[] {
  const gaps = new Map<number, [number, number][]>()
  for (const opening of [...space.entrances, ...space.openEdges]) {
    for (const piece of openingPieces(space, opening) ?? []) {
      const [a] = edges(space.boundary)[piece.edge] ?? []
      if (!a) continue
      const t = (p: Point) => Math.hypot(p[0] - a[0], p[1] - a[1])
      const [s, e] = [t(piece.a), t(piece.b)].sort((x, y) => x - y) as [number, number]
      gaps.set(piece.edge, [...(gaps.get(piece.edge) ?? []), [s, e]])
    }
  }
  const lines: WallLine[] = []
  edges(space.boundary).forEach(([a, b], edge) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 1e-6) return
    const u: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const left: [number, number] = [-u[1], u[0]]
    const probe: Point = [mid[0] + left[0] * 0.01, mid[1] + left[1] * 0.01]
    const inward: [number, number] =
      locatePoint(probe, space.boundary) === 'inside' ? left : [-left[0] + 0, -left[1] + 0]
    const angle = normalizeRotation((Math.atan2(u[1], u[0]) * 180) / Math.PI)
    const cuts = (gaps.get(edge) ?? []).sort((x, y) => x[0] - y[0])
    let from = 0
    const at = (t: number): Point => [a[0] + u[0] * t, a[1] + u[1] * t]
    for (const [s, e] of [...cuts, [length, length] as [number, number]]) {
      if (s - from > 1e-6)
        lines.push({ edge, a: at(from), b: at(Math.min(s, length)), angle, inward })
      from = Math.max(from, e)
    }
  })
  return lines
}

/** Difference between two angles in degrees, 0–180. */
export function angleBetween(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

export interface RotationSnap {
  rotation: number
  /** The wall the angle lies parallel or square to, when it snapped to one. */
  wall: WallLine | null
  kind: 'wall' | 'step' | 'free'
}

/**
 * The angle a prop turned to `angle` (degrees) settles at: parallel or square to the nearest
 * wall within WALL_ANGLE_REACH_M when within WALL_ANGLE_SNAP_DEG of it, else a 15° step when
 * within ANGLE_STEP_SNAP_DEG, else the angle itself (to a tenth of a degree). `free` (Alt held)
 * skips snapping.
 */
export function snapRotation(
  angle: number,
  item: { cx: number; cz: number; w: number; d: number },
  space: Pick<Space, 'boundary' | 'entrances' | 'openEdges'>,
  free = false,
): RotationSnap {
  const rotation = normalizeRotation(angle)
  if (free) return { rotation, wall: null, kind: 'free' }
  const reach = WALL_ANGLE_REACH_M + Math.hypot(item.w, item.d) / 2
  let best: { rotation: number; wall: WallLine; off: number; distance: number } | null = null
  for (const wall of wallLines(space)) {
    const distance = distanceToSegment([item.cx, item.cz], wall.a, wall.b)
    if (distance > reach) continue
    for (const k of [0, 90, 180, 270]) {
      const candidate = normalizeRotation(wall.angle + k)
      const off = angleBetween(rotation, candidate)
      if (off > WALL_ANGLE_SNAP_DEG + 1e-9) continue
      if (
        !best ||
        off < best.off - 1e-9 ||
        (Math.abs(off - best.off) <= 1e-9 && distance < best.distance)
      )
        best = { rotation: candidate, wall, off, distance }
    }
  }
  if (best) return { rotation: best.rotation, wall: best.wall, kind: 'wall' }
  const step = normalizeRotation(Math.round(rotation / ANGLE_STEP_DEG) * ANGLE_STEP_DEG)
  if (angleBetween(rotation, step) <= ANGLE_STEP_SNAP_DEG + 1e-9)
    return { rotation: step, wall: null, kind: 'step' }
  return { rotation, wall: null, kind: 'free' }
}

/**
 * A prop turned to `rotation`: width and depth swap when its nearest quarter turn moves by a
 * quarter (they are stored as at the nearest quarter turn); the size, LOGO scale included, is
 * kept otherwise.
 */
export function turnItem<T extends { rotation: number; w: number; d: number }>(
  item: T,
  rotation: number,
): T {
  const next = normalizeRotation(rotation)
  const swap = (nearestQuarter(item.rotation) - nearestQuarter(next)) % 180 !== 0
  return swap ? { ...item, rotation: next, w: item.d, d: item.w } : { ...item, rotation: next }
}

/**
 * Where the plan's rotation handle sits: `gap` beyond the prop, behind it (its local −Z side),
 * so the handle turns with the prop.
 */
export function rotationHandle(
  item: { cx: number; cz: number; w: number; d: number; rotation: number },
  gap: number,
): Point {
  const [dx, dz] = turnPoint(0, -(Math.max(item.w, item.d) / 2 + gap), item.rotation)
  return [item.cx + dx, item.cz + dz]
}

/** The rotation that points the handle (see rotationHandle) from the prop's centre at `pointer`. */
export function rotationTowards(centre: Point, pointer: Point): number {
  const vx = pointer[0] - centre[0]
  const vz = pointer[1] - centre[1]
  return normalizeRotation((Math.atan2(vx, -vz) * 180) / Math.PI)
}

/**
 * A tilted prop dragged near a wall it lies parallel to: the nearest side moves flush onto the
 * wall when within `reach`. Axis-aligned props snap with the editor's own magnet instead. Null
 * when no parallel wall is that near.
 */
export function wallFlushSnap(
  item: { w: number; d: number; rotation: number },
  cx: number,
  cz: number,
  space: Pick<Space, 'boundary' | 'entrances' | 'openEdges'>,
  reach = WALL_FLUSH_SNAP_M,
): { cx: number; cz: number; wall: WallLine } | null {
  const corners = obbCorners(placedBox({ ...item, cx, cz }))
  let best: { shift: number; wall: WallLine } | null = null
  for (const wall of wallLines(space)) {
    // Parallel or square: one pair of sides runs along the wall.
    if (
      angleBetween(item.rotation % 90, wall.angle % 90) > 0.05 &&
      angleBetween(item.rotation % 90, wall.angle % 90) < 89.95
    )
      continue
    const [nx, nz] = wall.inward
    const across = (p: Point) => (p[0] - wall.a[0]) * nx + (p[1] - wall.a[1]) * nz
    const gap = Math.min(...corners.map(across))
    if (Math.abs(gap) > reach + 1e-9) continue
    // Only along the stretch of wall: some of the prop must lie beside it.
    const ux = wall.b[0] - wall.a[0]
    const uz = wall.b[1] - wall.a[1]
    const length = Math.hypot(ux, uz)
    const along = corners.map((p) => ((p[0] - wall.a[0]) * ux + (p[1] - wall.a[1]) * uz) / length)
    if (Math.max(...along) <= 1e-6 || Math.min(...along) >= length - 1e-6) continue
    if (!best || Math.abs(gap) < Math.abs(best.shift)) best = { shift: gap, wall }
  }
  if (!best) return null
  const [nx, nz] = best.wall.inward
  const round = (v: number) => Math.round(v * 1000) / 1000 + 0
  return { cx: round(cx - nx * best.shift), cz: round(cz - nz * best.shift), wall: best.wall }
}

/** Read or imported angles within this many degrees of a quarter turn count as that turn. */
export const QUARTER_SNAP_DEG = 3

/**
 * An angle read from a drawing or an older file: within `within` degrees of a quarter turn it is
 * that turn (drawings are rarely exact), otherwise kept, to a tenth of a degree (confirmed by the
 * user, 2026-10-15).
 */
export function settleNearQuarter(angle: number, within = QUARTER_SNAP_DEG): number {
  const rotation = normalizeRotation(angle)
  const quarter = nearestQuarter(rotation)
  return angleBetween(rotation, quarter) <= within + 1e-9 ? quarter : rotation
}
