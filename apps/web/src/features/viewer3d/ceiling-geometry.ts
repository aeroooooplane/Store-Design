import {
  distance,
  edges,
  effectiveCeiling,
  mainEntrance,
  sceneFrame,
  signedArea,
  subtractPlanRegions,
} from '@store/shared'
import type { Point, ShopType, SiStyle, Space } from '@store/shared'

const FILM_GAP = 0.2
const TRACK_WIDTH = 0.055
const EPS = 1e-6

export type CeilingFinish = 'gypsum' | 'slot' | 'film' | 'frame' | 'track' | 'strip'
type Part = {
  polygon: readonly Point[]
  holes?: Point[][]
  bottom: number
  thickness: number
  finish: CeilingFinish
}
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

function axes(space: Space) {
  const first = mainEntrance(space)
  const longest = first
    ? undefined
    : edges(space.boundary).reduce<[Point, Point] | undefined>(
        (best, edge) => (!best || distance(...edge) > distance(...best) ? edge : best),
        undefined,
      )
  const { right, front } = longest
    ? sceneFrame({
        ...space,
        entrances: [{ kind: 'main', a: [...longest[0]], b: [...longest[1]] }],
      })
    : sceneFrame(space)
  const local = (point: Point): Point => [dot(point, right), dot(point, front)]
  const world = ([x, z]: Point): Point => [x * right[0] + z * front[0], x * right[1] + z * front[1]]
  return { local, world, front, right }
}

function bounds(ring: readonly Point[]) {
  return {
    minX: Math.min(...ring.map(([x]) => x)),
    maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)),
    maxZ: Math.max(...ring.map(([, z]) => z)),
  }
}

/** Edge bands give the true offset off a diagonal wall. Polygonal round corners are
 * conservative at a concave return, where a perpendicular offset changes edge. */
function edgeSetbacks(ring: readonly Point[], amount: number): Point[][] {
  const winding = Math.sign(signedArea(ring))
  const boundary = edges(ring)
  return boundary.flatMap(([a, b], i) => {
    const length = distance(a, b)
    if (length < EPS) return []
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const [x, z] = [-Math.sin(angle) * amount, Math.cos(angle) * amount]
    const band: Point[] = [
      [a[0] - x, a[1] - z],
      [b[0] - x, b[1] - z],
      [b[0] + x, b[1] + z],
      [a[0] + x, a[1] + z],
    ]
    const next = boundary[(i + 1) % boundary.length]![1]
    const turn = (b[0] - a[0]) * (next[1] - b[1]) - (b[1] - a[1]) * (next[0] - b[0])
    if (turn * winding >= -EPS) return [band]
    const sides = 12
    const radius = amount / Math.cos(Math.PI / sides)
    const round: Point[] = Array.from({ length: sides }, (_, j) => {
      const t = angle + (j / sides) * 2 * Math.PI
      return [b[0] + radius * Math.cos(t), b[1] + radius * Math.sin(t)]
    })
    return [band, round]
  })
}

function inset(ring: readonly Point[], amount: number) {
  return subtractPlanRegions(ring, edgeSetbacks(ring, amount))
}

function trace(rings: readonly (readonly Point[])[], x: number): [number, number][] {
  const zs = rings
    .flatMap((ring) =>
      edges(ring).flatMap(([a, b]) =>
        (a[0] <= x && x < b[0]) || (b[0] <= x && x < a[0])
          ? [a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]
          : [],
      ),
    )
    .sort((a, b) => a - b)
  return zs.flatMap((z, i) =>
    i % 2 === 0 && zs[i + 1] !== undefined && zs[i + 1]! - z >= 0.1 ? [[z, zs[i + 1]!]] : [],
  )
}

function filmPanels(ring: readonly Point[], si: SiStyle): Point[][] {
  const { minX, maxX, minZ, maxZ } = bounds(ring)
  const width = maxX - minX - 2 * FILM_GAP
  if (width <= 0) return []
  const minCount = Math.max(1, Math.ceil((width + FILM_GAP) / (1.8 + FILM_GAP) - EPS))
  const maxCount = Math.max(1, Math.floor((width + FILM_GAP) / (1 + FILM_GAP) + EPS))
  const ideal = Math.round((width + FILM_GAP) / (1.4 + FILM_GAP))
  const count = Math.min(100, Math.max(1, Math.min(maxCount, Math.max(minCount, ideal))))
  const pane = Math.min(si === 'SI1.0' ? 1.8 : Infinity, (width - FILM_GAP * (count - 1)) / count)
  const extra = Math.max(0, (width - count * pane - (count - 1) * FILM_GAP) / 2)
  const first = minX + FILM_GAP + extra
  const cuts = edgeSetbacks(ring, FILM_GAP)
  if (extra > EPS) {
    cuts.push(
      rect(minX - 1, minZ - 1, first, maxZ + 1),
      rect(maxX - FILM_GAP - extra, minZ - 1, maxX + 1, maxZ + 1),
    )
  }
  for (let i = 1; i < count; i++) {
    const start = first + (i - 1) * (pane + FILM_GAP) + pane
    cuts.push(rect(start, minZ - 1, start + FILM_GAP, maxZ + 1))
  }
  return subtractPlanRegions(ring, cuts)
}

function trackPositions(min: number, max: number) {
  const span = max - min
  if (span < 1) return [(min + max) / 2]
  const lower = Math.ceil(span / 1.4 - EPS)
  const upper = Math.floor(span / 1 + EPS)
  const steps = Math.min(80, Math.max(1, Math.min(upper, Math.max(lower, Math.round(span / 1.2)))))
  return Array.from({ length: steps + 1 }, (_, i) =>
    Math.min(max - EPS, min + EPS + (i * span) / steps),
  )
}

export function ceilingModel(space: Space, shop: ShopType, si: SiStyle) {
  const kind = effectiveCeiling(space, shop, si)
  const parts: Part[] = []
  const dots: { point: Point; y: number }[] = []
  if (kind === 'none') return { kind, parts, dots }
  const { local, world } = axes(space)
  const ring = space.boundary.map(local)
  const { minX, maxX, minZ, maxZ } = bounds(ring)
  const top = space.height
  const add = (
    polygon: readonly Point[],
    bottom: number,
    thickness: number,
    finish: CeilingFinish,
    holes?: Point[][],
  ) =>
    parts.push({
      polygon: polygon.map(world),
      bottom,
      thickness,
      finish,
      ...(holes ? { holes: holes.map((hole) => hole.map(world)) } : {}),
    })

  if (kind === 'film') {
    add(ring, top + 0.2, 0.018, 'slot')
    for (const polygon of filmPanels(ring, si)) add(polygon, top, 0.022, 'film')
    return { kind, parts, dots }
  }

  const frame = kind === 'frame'
  const frameWidth = 0.12
  if (frame) add(ring, top, 0.12, 'frame', inset(ring, frameWidth))
  else add(ring, top + 0.004, 0.09, 'gypsum')
  // The center line uses a slightly deeper setback so the full profile stays inside the outline.
  const wallClear = frame ? 0.24 : si === 'SI1.0' ? 0.6 : 0.68
  const allowed = inset(ring, wallClear + TRACK_WIDTH / 2)
  const {
    minX: x0,
    maxX: x1,
    minZ: z0,
    maxZ: z1,
  } = allowed.length ? bounds(allowed.flat()) : { minX, maxX, minZ, maxZ }
  if (allowed.length) {
    for (const x of trackPositions(x0, x1)) {
      for (const [start, end] of trace(allowed, x)) {
        add(rect(x - TRACK_WIDTH / 2, start, x + TRACK_WIDTH / 2, end), top - 0.012, 0.017, 'track')
        const length = end - start
        const module = 1.2
        const count = Math.min(100, Math.floor((length + 0.28) / (module + 0.28)))
        if (!count) continue
        const gap = (length - count * module) / (count + 1)
        for (let i = 0; i < count; i++) {
          const at = start + gap + i * (module + gap)
          add(rect(x - 0.014, at, x + 0.014, at + module), top - 0.016, 0.008, 'strip')
          if (!frame || top > 2.8 + EPS) {
            const middleGap = at + module + gap / 2
            if (gap >= 0.08) dots.push({ point: world([x, middleGap]), y: top - 0.026 })
          }
        }
      }
    }
  }
  if (frame) {
    const interior = inset(ring, frameWidth - 0.01)
    const width = x1 - x0
    const depth = z1 - z0
    if (width > 0.4 && depth > 1) {
      const swapped = interior.map((zone) => zone.map(([x, z]): Point => [z, x]))
      const crossbars = Math.min(20, Math.max(0, Math.ceil(depth / 1.7) - 1))
      for (let i = 1; i <= crossbars; i++) {
        const z = z0 + (i * depth) / (crossbars + 1)
        for (const [start, end] of trace(swapped, z)) {
          add(rect(start, z - 0.035, end, z + 0.035), top, 0.066, 'frame')
        }
      }
    }
  }
  return { kind, parts, dots }
}

/** Move below the head of the room so a solid top doesn't cover the interior on first display. */
export function ceilingInspectionView(space: Space, shop: ShopType) {
  const { local, world } = axes(space)
  const { minX, maxX, minZ, maxZ } = bounds(space.boundary.map(local))
  const axis = (minX + maxX) / 2
  const depth = maxZ - minZ
  const width = maxX - minX
  const eye = Math.min(1.55, space.height * 0.6)
  // An open island can be inspected from its aisle, with the frame and platform both in view.
  const outside =
    shop === 'island'
      ? Math.max(1.5, 0.3 * depth, 0.43 * width, 1.45 * (space.height - eye))
      : -depth * 0.12
  const [ex, ez] = world([axis + Math.min(0.35, width * 0.06), maxZ + outside])
  const [x, z] = world([axis, minZ + depth * 0.44])
  return {
    position: [ex, eye, ez] as [number, number, number],
    target: [x, space.height * (shop === 'island' ? 0.62 : 0.81), z] as [number, number, number],
    fovDeg: shop === 'island' ? 62 : 57,
  }
}
