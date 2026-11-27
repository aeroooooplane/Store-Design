import {
  distance,
  distanceToBoundary,
  distanceToSegment,
  edges,
  isSimplePolygon,
  effectiveCeiling,
  mainEntrance,
  locatePoint,
  polygonInsidePolygon,
  sceneFrame,
  signedArea,
  subtractPlanRegions,
} from '@store/shared'
import type { Point, ShopType, SiStyle, Space } from '@store/shared'

const FILM_GAP = 0.2
const TRACK_WIDTH = 0.055
const FRAME_WIDTH = 0.12
const EPS = 1e-6

export type CeilingFinish = 'gypsum' | 'slot' | 'film' | 'frame' | 'track' | 'strip'
type Part = {
  polygon: readonly Point[]
  holes?: Point[][]
  lining?: true
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

function boundsCenter(ring: readonly Point[]): Point {
  const { minX, maxX, minZ, maxZ } = bounds(ring)
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

function rectangular(ring: readonly Point[]) {
  const box = bounds(ring)
  const area = (box.maxX - box.minX) * (box.maxZ - box.minZ)
  return area > EPS && Math.abs(Math.abs(signedArea(ring)) - area) < EPS ? box : null
}

/** Clip a convex ring along an inward half-plane. Rounded convex shops stay on this fast path. */
function clip(polygon: readonly Point[], side: (point: Point) => number): Point[] {
  return edges(polygon).flatMap(([a, b]) => {
    const d = side(a)
    const e = side(b)
    const inside = d >= -EPS
    if (inside === e >= -EPS) return inside ? [a] : []
    const t = Math.min(1, Math.max(0, d / (d - e)))
    const crossing: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    return inside ? [a, crossing] : [crossing]
  })
}

function convex(ring: readonly Point[]) {
  const sign = Math.sign(signedArea(ring))
  return edges(ring).every(([a, b], i) => {
    const c = ring[(i + 2) % ring.length]!
    return sign * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) >= -EPS
  })
}

function convexInset(ring: readonly Point[], amount: number) {
  let kept = [...ring]
  const winding = Math.sign(signedArea(ring))
  for (const [a, b] of edges(ring)) {
    const length = distance(a, b)
    if (length < EPS) continue
    const x = ((a[1] - b[1]) / length) * winding
    const z = ((b[0] - a[0]) / length) * winding
    kept = clip(kept, (p) => (p[0] - a[0]) * x + (p[1] - a[1]) * z - amount)
    if (kept.length < 3) return []
  }
  return Math.abs(signedArea(kept)) > EPS ? [kept] : []
}

const repairedContours = new WeakMap<readonly Point[], { ring: Point[]; clearance: number }>()

function cutCeiling(
  original: readonly Point[],
  cuts: (ring: readonly Point[], extra: number) => Point[][],
): Point[][] {
  const repaired = repairedContours.get(original)
  const starting = repaired?.ring ?? original
  const clearance = repaired?.clearance ?? 0
  try {
    const parts = subtractPlanRegions(starting, cuts(starting, clearance))
    return repaired ? parts.filter((piece) => polygonInsidePolygon(piece, original)) : parts
  } catch {
    // Surveyed arcs can contain tiny zigzags. Retry a simpler contour with extra clearance;
    // only use pieces that still fit the actual outline.
    for (const tolerance of [0.01, 0.04, 0.06]) {
      const ring = [...original]
      let i = 0
      while (i < ring.length && ring.length > 3) {
        if (
          distanceToSegment(
            ring[i]!,
            ring[(i - 1 + ring.length) % ring.length]!,
            ring[(i + 1) % ring.length]!,
          ) < tolerance
        )
          ring.splice(i, 1)
        else i++
      }
      if (ring.length === original.length || !isSimplePolygon(ring)) continue
      try {
        const result = subtractPlanRegions(ring, cuts(ring, tolerance))
        repairedContours.set(original, { ring, clearance: tolerance })
        return result.filter((piece) => polygonInsidePolygon(piece, original))
      } catch {
        // Try the next survey tolerance.
      }
    }
    return []
  }
}

function inset(ring: readonly Point[], amount: number, box: ReturnType<typeof rectangular>) {
  if (!box)
    return convex(ring)
      ? convexInset(ring, amount)
      : cutCeiling(ring, (contour, extra) => edgeSetbacks(contour, amount + extra))
  const { minX, maxX, minZ, maxZ } = box
  return maxX - minX > 2 * amount && maxZ - minZ > 2 * amount
    ? [rect(minX + amount, minZ + amount, maxX - amount, maxZ - amount)]
    : []
}

function frameSupports(ring: readonly Point[], box: ReturnType<typeof rectangular>) {
  if (box) {
    const { minX, minZ, maxX, maxZ } = box
    const size = Math.min(FRAME_WIDTH, (maxX - minX) / 3, (maxZ - minZ) / 3)
    return [minX, maxX - size].flatMap((x) =>
      [minZ, maxZ - size].map((z) => rect(x, z, x + size, z + size)),
    )
  }

  const winding = Math.sign(signedArea(ring))
  const corners = edges(ring).flatMap(([a, b], i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!
    const inLength = distance(prev, a)
    const outLength = distance(a, b)
    if (inLength < EPS || outLength < EPS) return []
    const before: Point = [(a[0] - prev[0]) / inLength, (a[1] - prev[1]) / inLength]
    const after: Point = [(b[0] - a[0]) / outLength, (b[1] - a[1]) / outLength]
    const turn = Math.atan2(before[0] * after[1] - before[1] * after[0], dot(before, after))
    const east = (-before[1] - after[1]) * winding
    const south = (before[0] + after[0]) * winding
    return [
      {
        point: a,
        along: outLength >= inLength ? after : before,
        inward: [east, south] as Point,
        turn: turn * winding,
      },
    ]
  })
  const distanceBetweenPosts = 4 * FRAME_WIDTH
  const chosen: typeof corners = []
  const append = (candidate: (typeof corners)[number]) => {
    if (!chosen.some(({ point }) => distance(point, candidate.point) < distanceBetweenPosts))
      chosen.push(candidate)
  }
  corners
    .filter(({ turn }) => turn > Math.PI / 5)
    .sort((a, b) => b.turn - a.turn)
    .forEach(append)
  // Rounded footprints may have no sharp corners. Use an outer point in each diagonal direction.
  if (chosen.length < 3) {
    for (const corner of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const outer = corners
        .filter(({ turn }) => turn >= -EPS)
        .reduce<(typeof corners)[number] | undefined>(
          (best, next) =>
            !best || dot(next.point, corner) > dot(best.point, corner) ? next : best,
          undefined,
        )
      if (outer) append(outer)
    }
  }
  return chosen.flatMap(({ point, along, inward }) => {
    const length = Math.hypot(...inward)
    if (length < EPS) return []
    const axis: Point = [-along[1], along[0]]
    const half = FRAME_WIDTH / 2
    for (const offset of [0.51, 0.71, 0.85, 1, 1.25, 1.5, 2, 3]) {
      const center: Point = [
        point[0] + (inward[0] / length) * FRAME_WIDTH * offset,
        point[1] + (inward[1] / length) * FRAME_WIDTH * offset,
      ]
      const footprint = rect(-half, -half, half, half).map(([x, z]): Point => [
        center[0] + x * along[0] + z * axis[0],
        center[1] + x * along[1] + z * axis[1],
      ])
      if (
        footprint.some((p) => distanceToBoundary(p, ring) <= FRAME_WIDTH + EPS) &&
        polygonInsidePolygon(footprint, ring)
      )
        return [footprint]
    }
    return []
  })
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

function filmPanels(
  ring: readonly Point[],
  si: SiStyle,
  box: ReturnType<typeof rectangular>,
): Point[][] {
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
  if (box)
    return maxZ - minZ > 2 * FILM_GAP
      ? Array.from({ length: count }, (_, i) => {
          const start = first + i * (pane + FILM_GAP)
          return rect(start, minZ + FILM_GAP, start + pane, maxZ - FILM_GAP)
        })
      : []
  if (convex(ring)) {
    const inner = convexInset(ring, FILM_GAP)[0]
    if (!inner) return []
    return Array.from({ length: count }, (_, i) => {
      const start = first + i * (pane + FILM_GAP)
      return clip(
        clip(inner, ([x]) => x - start),
        ([x]) => start + pane - x,
      )
    }).filter((part) => part.length >= 3 && Math.abs(signedArea(part)) > EPS)
  }
  const slots: Point[][] = []
  if (extra > EPS) {
    slots.push(
      rect(minX - 1, minZ - 1, first, maxZ + 1),
      rect(maxX - FILM_GAP - extra, minZ - 1, maxX + 1, maxZ + 1),
    )
  }
  for (let i = 1; i < count; i++) {
    const start = first + (i - 1) * (pane + FILM_GAP) + pane
    slots.push(rect(start, minZ - 1, start + FILM_GAP, maxZ + 1))
  }
  return cutCeiling(ring, (contour, clearance) => [
    ...edgeSetbacks(contour, FILM_GAP + clearance),
    ...slots,
  ])
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
  const box = rectangular(ring)
  const { minX, maxX, minZ, maxZ } = box ?? bounds(ring)
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
    const recessDepth = 0.2
    add(ring, top + recessDepth, 0.018, 'slot')
    const line = (polygon: readonly Point[]) =>
      parts.push({
        polygon: polygon.map(world),
        bottom: top,
        thickness: recessDepth,
        finish: 'slot',
        lining: true,
      })
    line(ring)
    for (const polygon of filmPanels(ring, si, box)) {
      add(polygon, top, 0.022, 'film')
      line(polygon)
    }
    return { kind, parts, dots }
  }

  const frame = kind === 'frame'
  const interior = frame ? inset(ring, FRAME_WIDTH, box) : []
  if (frame) {
    add(ring, top, FRAME_WIDTH, 'frame', interior)
    for (const post of frameSupports(ring, box)) {
      const centre = world(boundsCenter(post))
      const existing = space.obstacles.some(
        (obstacle) =>
          obstacle.kind === 'column' &&
          (obstacle.height ?? top) >= top - EPS &&
          locatePoint(centre, obstacle.polygon) !== 'outside',
      )
      if (!existing) add(post, 0, top, 'frame')
    }
  } else add(ring, top + 0.004, 0.09, 'gypsum')
  // The center line uses a slightly deeper setback so the full profile stays inside the outline.
  const wallClear = frame ? 0.24 : si === 'SI1.0' ? 0.6 : 0.68
  const allowed = inset(ring, wallClear + TRACK_WIDTH / 2, box)
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
    const width = x1 - x0
    const depth = z1 - z0
    if (width > 0.4 && depth > 1) {
      const swapped = interior.map((zone) => zone.map(([x, z]): Point => [z, x]))
      const crossbars = Math.min(20, Math.max(0, Math.ceil(depth / 1.7) - 1))
      for (let i = 1; i <= crossbars; i++) {
        const z = z0 + (i * depth) / (crossbars + 1)
        for (const [start, end] of trace(swapped, z)) {
          add(rect(start - 0.01, z - 0.035, end + 0.01, z + 0.035), top, 0.066, 'frame')
        }
      }
    }
  }
  return { kind, parts, dots }
}
