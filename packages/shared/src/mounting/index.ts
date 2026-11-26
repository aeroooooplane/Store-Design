import { locatePoint } from '../geometry/polygon.ts'
import { nearestQuarter, obbsOverlap, placedBox } from '../geometry/obb.ts'
import { rectFromCenter, rectsOverlap } from '../geometry/rect.ts'
import type { Point } from '../geometry/types.ts'
import { rotationFacing } from '../planner/orientation.ts'
import type { PlanDirection } from '../planner/orientation.ts'
import type { FrontAxis, Installation } from '../schemas/asset.ts'
import type { Fixture, LayoutItem, Rotation } from '../schemas/layout.ts'
import { wallLines } from '../rotation/index.ts'
import type { Space } from '../schemas/space.ts'
import { EPSILON_M, roundM } from '../units.ts'
import { WALL_THICKNESS_M } from '../scene/walls.ts'

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
/** Panels on a wall strictly below this height initially align with its vertical centre. */
export const LOW_WALL_HEIGHT_M = 1.6
/** Default top edge of display panels and wall logos on a full-height support. */
export const DISPLAY_TOP_M = 2.4
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
 * an axis. `along` is the axis it runs along; `inward` points away from the wall's solid body.
 */
export interface WallFace {
  edge: number
  a: Point
  b: Point
  along: 'x' | 'z'
  inward: PlanDirection
  /** Stretches of this edge without a wall (open edges), as [from, to] along `along`. */
  open: [number, number][]
  /** Outer face of a drawn partition; normals point away from its solid footprint. */
  fixtureId?: string
  height?: number
  cutouts?: { from: number; to: number; top: number }[]
}

type FaceItem = Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd' | 'h'> &
  Partial<Pick<LayoutItem, 'function' | 'mount'>>

const coord = (p: Point, axis: 'x' | 'z') => (axis === 'x' ? p[0] : p[1])

/** Both faces of perimeter walls and partitions, with openings marked. */
export function wallFaces(
  space: Pick<Space, 'boundary' | 'openEdges'> & Partial<Pick<Space, 'entrances' | 'height'>>,
  fixtures: readonly Fixture[] = [],
  items: readonly FaceItem[] = [],
): WallFace[] {
  const tan = Math.tan((STRAIGHT_WALL_DEG * Math.PI) / 180)
  const faces: WallFace[] = []
  for (const { a, b, edge } of wallLines({ ...space, entrances: space.entrances ?? [] })) {
    const dx = Math.abs(b[0] - a[0])
    const dz = Math.abs(b[1] - a[1])
    if (Math.hypot(dx, dz) < EPSILON_M) continue
    let along: 'x' | 'z'
    if (dz <= dx * tan) along = 'x'
    else if (dx <= dz * tan) along = 'z'
    else continue
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const normal: PlanDirection = along === 'x' ? [0, 1] : [1, 0]
    const probe: Point = [mid[0] + normal[0] * 0.01, mid[1] + normal[1] * 0.01]
    const inward: PlanDirection =
      locatePoint(probe, space.boundary) === 'inside' ? normal : [-normal[0] + 0, -normal[1] + 0]
    const face: WallFace = {
      edge,
      a,
      b,
      along,
      inward,
      open: [],
      ...(space.height === undefined ? {} : { height: space.height }),
    }
    faces.push(face, {
      ...face,
      a: [a[0] - inward[0] * WALL_THICKNESS_M, a[1] - inward[1] * WALL_THICKNESS_M],
      b: [b[0] - inward[0] * WALL_THICKNESS_M, b[1] - inward[1] * WALL_THICKNESS_M],
      inward: [-inward[0] + 0, -inward[1] + 0],
    })
  }
  for (const f of fixtures) {
    const l = f.cx - f.w / 2
    const r = f.cx + f.w / 2
    const t = f.cz - f.d / 2
    const b = f.cz + f.d / 2
    const common = { edge: -1, open: [], fixtureId: f.id, height: f.h }
    const outer: WallFace[] = [
      { ...common, a: [l, t], b: [r, t], along: 'x', inward: [0, -1] },
      { ...common, a: [l, b], b: [r, b], along: 'x', inward: [0, 1] },
      { ...common, a: [l, t], b: [l, b], along: 'z', inward: [-1, 0] },
      { ...common, a: [r, t], b: [r, b], along: 'z', inward: [1, 0] },
    ]
    // The same accessory-cabinet niches as fixtureSolids, restricted to the outer skin.
    const cabinets = items.filter(
      (item) =>
        itemMount(item) === 'floor' &&
        (item.function === 'accessory_cabinet' || item.function === 'side_cabinet') &&
        rectsOverlap(
          rectFromCenter(f.cx, f.cz, f.w, f.d),
          rectFromCenter(item.cx, item.cz, item.w, item.d),
        ),
    )
    for (const face of outer) {
      const across = face.along === 'x' ? 'z' : 'x'
      const line = coord(face.a, across)
      face.cutouts = cabinets.flatMap((cabinet) => {
        const centre = across === 'x' ? cabinet.cx : cabinet.cz
        const half = (across === 'x' ? cabinet.w : cabinet.d) / 2
        if (line < centre - half - EPSILON_M || line > centre + half + EPSILON_M) return []
        const at = face.along === 'x' ? cabinet.cx : cabinet.cz
        const length = face.along === 'x' ? cabinet.w : cabinet.d
        return [{ from: at - length / 2, to: at + length / 2, top: cabinet.h }]
      })
      faces.push(face)
    }
  }
  return faces
}

/** A click uses the visible, nearby wall skin rather than searching the whole room. */
export function wallPlacementTarget(
  point: Point,
  space: Space,
  fixtures: readonly Fixture[],
  items: readonly FaceItem[],
  normal?: Point,
): WallFace | null {
  let best: WallFace | null = null
  let shortest = Infinity
  const faces = wallFaces(space, fixtures, items)
  for (const face of faces) {
    const at = coord(point, face.along)
    if (!hasWallAt(face, at)) continue
    if (face.fixtureId && buriedPanelFace(face, at, 0, 0.01, 0.01, faces, fixtures)) continue
    if (normal && normal[0] * face.inward[0] + normal[1] * face.inward[1] < 0.5) continue
    const axis = face.along === 'x' ? 'z' : 'x'
    const fixture = fixtures.find((entry) => entry.id === face.fixtureId)
    const thickness = fixture ? (axis === 'z' ? fixture.d : fixture.w) : WALL_THICKNESS_M
    const signed =
      (coord(point, axis) - faceLineAt(face, at)) * (axis === 'x' ? face.inward[0] : face.inward[1])
    const tolerance = 0.035
    if (signed < -thickness - tolerance || signed > tolerance) continue
    const distance = Math.abs(signed)
    if (
      distance < shortest - EPSILON_M ||
      (Math.abs(distance - shortest) <= EPSILON_M && face.fixtureId && !best?.fixtureId)
    ) {
      best = face
      shortest = distance
    }
  }
  return best
}

interface WallSnapOptions {
  target?: WallFace
  defaultTop?: boolean
  preferPartitions?: boolean
  adding?: boolean
}

/** A partition fixed against the clicked wall replaces that wall's mounting face. */
function onTarget(
  face: WallFace,
  target: WallFace | undefined,
  at: number,
  fixtures: readonly Fixture[],
): boolean {
  if (!target) return true
  if (
    face.along !== target.along ||
    face.inward[0] !== target.inward[0] ||
    face.inward[1] !== target.inward[1] ||
    !hasWallAt(face, at)
  )
    return false
  if (target.fixtureId) return face.fixtureId === target.fixtureId
  if (!face.fixtureId) return face.edge === target.edge && hasWallAt(target, at)
  const fixture = fixtures.find((candidate) => candidate.id === face.fixtureId)
  if (!fixture) return false
  const axis = face.along === 'x' ? 'z' : 'x'
  const direction = axis === 'x' ? face.inward[0] : face.inward[1]
  const depth = axis === 'x' ? fixture.w : fixture.d
  const back = faceLineAt(face, at) - direction * depth
  return Math.abs(back - faceLineAt(target, at)) <= ON_WALL_M + EPSILON_M
}

/** Partition support must cover the full width and installed height, including cabinet niches. */
export function supportsPiece(
  face: WallFace,
  at: number,
  length: number,
  bottom: number,
  height: number,
): boolean {
  const low = at - length / 2
  const high = at + length / 2
  if (
    low < Math.min(coord(face.a, face.along), coord(face.b, face.along)) - EPSILON_M ||
    high > Math.max(coord(face.a, face.along), coord(face.b, face.along)) + EPSILON_M
  )
    return false
  if (!face.fixtureId) return true
  if (bottom < -EPSILON_M || bottom + height > (face.height ?? Infinity) + EPSILON_M) return false
  return !(face.cutouts ?? []).some(
    (cut) =>
      low < cut.to - EPSILON_M && high > cut.from + EPSILON_M && bottom < cut.top - EPSILON_M,
  )
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
  item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'> & Partial<Pick<LayoutItem, 'h' | 'elevation'>>,
  space: Pick<Space, 'boundary' | 'openEdges'>,
  fixtures: readonly Fixture[] = [],
  items: readonly FaceItem[] = [],
): WallFace | null {
  let best: { face: WallFace; contact: number } | null = null
  for (const face of wallFaces(space, fixtures, items)) {
    const at = face.along === 'x' ? item.cx : item.cz
    if (!hasWallAt(face, at)) continue
    const inwardSign = face.along === 'x' ? face.inward[1] : face.inward[0]
    const half = face.along === 'x' ? item.d / 2 : item.w / 2
    const centre = face.along === 'x' ? item.cz : item.cx
    const back = centre - inwardSign * half
    if (Math.abs(back - faceLineAt(face, at)) > ON_WALL_M + EPSILON_M) continue
    const contact = face.along === 'x' ? item.w : item.d
    if (!supportsPiece(face, at, contact, item.elevation ?? 0, item.h ?? 0)) continue
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
  elevation?: number
}

type PanelForSnap = Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation' | 'elevation'> &
  Partial<Pick<LayoutItem, 'cx' | 'cz' | 'mount'>>

/** Preserve a supported height on the same face; new faces use their default. */
function panelElevation(
  item: PanelForSnap,
  face: WallFace,
  rotation: Rotation,
  adding: boolean,
  defaultTop = false,
) {
  const low = face.height !== undefined && face.height < LOW_WALL_HEIGHT_M
  if (!low && !defaultTop) return undefined
  if (
    !adding &&
    item.cx !== undefined &&
    item.cz !== undefined &&
    (item.mount === 'wall' || item.mount === 'embedded') &&
    nearestQuarter(item.rotation) === rotation
  ) {
    const alongX = face.along === 'x'
    const at = alongX ? item.cx : item.cz
    const across = alongX ? item.cz : item.cx
    const inward = alongX ? face.inward[1] : face.inward[0]
    const depth = alongX ? item.d : item.w
    const target = faceLineAt(face, at) + inward * depth * (item.mount === 'wall' ? 0.5 : -0.5)
    if (
      Math.abs(across - target) <= ON_WALL_M + EPSILON_M &&
      supportsPiece(face, at, alongX ? item.w : item.d, item.elevation ?? 0, item.h)
    )
      return item.elevation
  }
  return roundM(
    Math.max(
      0,
      low ? (face.height! - item.h) / 2 : Math.min(DISPLAY_TOP_M, face.height ?? Infinity) - item.h,
    ),
  )
}

/** Adjacent/overlapping walls must not offer a face buried in the other wall's solid body. */
function buriedPanelFace(
  face: WallFace,
  at: number,
  length: number,
  bottom: number,
  height: number,
  faces: readonly WallFace[],
  fixtures: readonly Fixture[],
): boolean {
  return faces.some((other) => {
    if (
      face.fixtureId
        ? face.fixtureId === other.fixtureId
        : !other.fixtureId && face.edge === other.edge
    )
      return false
    const fixture = fixtures.find((f) => f.id === other.fixtureId)
    const thickness = fixture ? (other.along === 'x' ? fixture.d : fixture.w) : WALL_THICKNESS_M
    return [at - length / 2 + EPSILON_M, at, at + length / 2 - EPSILON_M].some((s) => {
      const line = faceLineAt(face, s)
      const x = (face.along === 'x' ? s : line) + face.inward[0] * EPSILON_M * 2
      const z = (face.along === 'x' ? line : s) + face.inward[1] * EPSILON_M * 2
      const run = other.along === 'x' ? x : z
      const signed =
        ((other.along === 'x' ? z : x) - faceLineAt(other, run)) *
        (other.along === 'x' ? other.inward[1] : other.inward[0])
      if (signed >= -EPSILON_M || signed <= -thickness + EPSILON_M) return false
      return [bottom + EPSILON_M, bottom + height / 2, bottom + height - EPSILON_M].some(
        (y) => y <= (other.height ?? Infinity) + EPSILON_M && supportsPiece(other, run, 0, y, 0),
      )
    })
  })
}

/** Choose the nearest exposed wall face before deciding inset/surface placement of its body. */
export function displayPanelSnap(
  item: PanelForSnap,
  cx: number,
  cz: number,
  space: Pick<Space, 'boundary' | 'openEdges'> & Partial<Pick<Space, 'height' | 'entrances'>>,
  front: FrontAxis | null,
  fixtures: readonly Fixture[] = [],
  items: readonly FaceItem[] = [],
  adding = false,
  options: WallSnapOptions = {},
): (WallPlacement & { mount: 'embedded' | 'wall' }) | null {
  const facing = front && front !== 'any' ? front : '+Z'
  let best: {
    placement: WallPlacement & { mount: 'embedded' | 'wall' }
    score: number
    side: number
  } | null = null
  const faces = wallFaces(space, fixtures, items)
  for (const face of faces) {
    const rotation = rotationFacing(facing, face.inward)
    if (rotation === null) continue
    const alongX = face.along === 'x'
    const at = alongX ? cx : cz
    if (!onTarget(face, options.target, at, fixtures)) continue
    const across = alongX ? cz : cx
    const inward = alongX ? face.inward[1] : face.inward[0]
    const size = turned(item, item.rotation, rotation)
    const length = alongX ? size.w : size.d
    const depth = alongX ? size.d : size.w
    const first = coord(face.a, face.along)
    const last = coord(face.b, face.along)
    let solid: [number, number][] = [[Math.min(first, last), Math.max(first, last)]]
    for (const [left, right] of face.open) {
      solid = solid.flatMap(([lo, hi]): [number, number][] =>
        right <= lo || left >= hi
          ? [[lo, hi]]
          : [
              [lo, left],
              [right, hi],
            ],
      )
    }
    for (const [lo, hi] of solid) {
      if (hi - lo + EPSILON_M < length) continue
      const centre = Math.max(lo + length / 2, Math.min(hi - length / 2, at))
      const line = faceLineAt(face, centre)
      const signed = (across - line) * inward
      const fixture = fixtures.find((f) => f.id === face.fixtureId)
      const canRecess = !fixture || (alongX ? fixture.d : fixture.w) + EPSILON_M >= depth
      const mount = (adding || signed < 0) && canRecess ? 'embedded' : 'wall'
      const target = line + inward * depth * (mount === 'embedded' ? -0.5 : 0.5)
      const distance = Math.hypot(centre - at, target - across)
      if (!adding && distance > WALL_SNAP_M) continue
      const elevation = panelElevation(item, face, rotation, adding, options.defaultTop)
      const bottom = elevation ?? item.elevation ?? 0
      if (
        options.defaultTop &&
        face.height !== undefined &&
        bottom + item.h > face.height + EPSILON_M
      )
        continue
      if (!supportsPiece(face, centre, length, bottom, item.h)) continue
      if (buriedPanelFace(face, centre, length, bottom, item.h, faces, fixtures)) continue
      // On add a usable partition outranks any perimeter wall. The nearest eligible face wins.
      const score =
        ((adding || options.preferPartitions) && !fixture ? 1000 : 0) +
        Math.hypot(centre - at, line - across)
      const side = signed >= 0 ? 0 : 1
      if (
        best &&
        (best.score < score - EPSILON_M ||
          (Math.abs(best.score - score) <= EPSILON_M && best.side <= side))
      )
        continue
      best = {
        score,
        side,
        placement: {
          ...size,
          rotation,
          mount,
          cx: roundM(alongX ? centre : target),
          cz: roundM(alongX ? target : centre),
          ...(elevation === undefined ? {} : { elevation }),
        },
      }
    }
  }
  return best?.placement ?? null
}

/**
 * Dragging a wall piece: when the dragged centre comes within `reach` of a wall face, the piece
 * turns its front (the model's `front`, +Z when unknown) away from the solid wall and its back lands on
 * the wall. Null when no wall is near.
 */
export function wallMountSnap(
  item: Pick<LayoutItem, 'w' | 'd' | 'rotation'> &
    Partial<Pick<LayoutItem, 'h' | 'elevation' | 'cx' | 'cz' | 'mount'>>,
  cx: number,
  cz: number,
  space: Pick<Space, 'boundary' | 'openEdges'>,
  front: FrontAxis | null,
  reach = WALL_SNAP_M,
  fixtures: readonly Fixture[] = [],
  items: readonly FaceItem[] = [],
  elevationAt?: (placement: WallPlacement) => number,
  options: WallSnapOptions = {},
): WallPlacement | null {
  const facing = front && front !== 'any' ? front : '+Z'
  let best: (WallPlacement & { score: number }) | null = null
  const faces = wallFaces(space, fixtures, items)
  for (const face of faces) {
    const at = face.along === 'x' ? cx : cz
    if (!hasWallAt(face, at) || !onTarget(face, options.target, at, fixtures)) continue
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
    const preferPartition = options.preferPartitions || options.target !== undefined
    const score = gap + (preferPartition && !face.fixtureId ? 1000 : 0)
    if (gap > reach + depth / 2 || (best && score >= best.score)) continue
    const placement: WallPlacement = {
      cx: roundM(face.along === 'x' ? middle : target),
      cz: roundM(face.along === 'x' ? target : middle),
      rotation,
      ...size,
    }
    const height = item.h ?? 0
    const bottom =
      (options.defaultTop
        ? panelElevation(
            { ...item, h: height, elevation: item.elevation },
            face,
            rotation,
            options.adding ?? false,
            true,
          )
        : elevationAt?.(placement)) ??
      item.elevation ??
      Math.min(DEFAULT_WALL_ELEVATION_M, Math.max(0, (face.height ?? Infinity) - height))
    if (
      options.defaultTop &&
      face.height !== undefined &&
      bottom + height > face.height + EPSILON_M
    )
      continue
    if (!supportsPiece(face, middle, length, bottom, height)) continue
    if (preferPartition && buriedPanelFace(face, middle, length, bottom, height, faces, fixtures))
      continue
    best = {
      ...placement,
      ...(face.fixtureId || options.defaultTop ? { elevation: bottom } : {}),
      score,
    }
  }
  if (!best) return null
  const { score: _score, ...placement } = best
  return placement
}

/**
 * Default height for a piece just placed: a ceiling piece hangs with its top at the ceiling; a
 * wall piece sits ABOVE_PROP_GAP_M above the tallest floor prop standing below it (within
 * BELOW_DEPTH_M of the wall), else at DEFAULT_WALL_ELEVATION_M. Never above the ceiling.
 */
export function defaultElevation(
  item: Pick<LayoutItem, 'id' | 'cx' | 'cz' | 'w' | 'd' | 'h' | 'mount'>,
  others: readonly (Pick<LayoutItem, 'id' | 'cx' | 'cz' | 'w' | 'd' | 'h' | 'mount'> &
    Partial<Pick<LayoutItem, 'function'>>)[],
  space: Pick<Space, 'boundary' | 'openEdges' | 'height'>,
  fixtures: readonly Fixture[] = [],
): number {
  const highest = Math.max(0, space.height - item.h)
  if (itemMount(item) === 'ceiling') return roundM(highest)
  if (itemMount(item) === 'floor') return 0
  // Find the footprint's support before choosing its default bottom height.
  const face = mountedWall({ ...item, h: 0, elevation: 0 }, space, fixtures)
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
  return roundM(Math.min(base, highest, Math.max(0, (face?.height ?? space.height) - item.h)))
}
