import { SpaceSchema, distance, openingPieces } from '@store/shared'
import type { Obstacle, Point, ShopType, Space } from '@store/shared'
import { polygonToSpace } from '../space-form.ts'
import type { OpeningKind, OpeningRow } from '../space-form.ts'

type SketchOpening = ({ mode: 'full' } | { mode: 'partial'; start: number; width: number }) & {
  kind?: OpeningKind
  group?: string
}

export interface SketchColumn {
  kind: 'square' | 'circle'
  x: number
  y: number
  width: number
  depth: number
  rotation?: number
  source?: number
}

export interface SpaceSketch {
  shop: ShopType
  closed: boolean
  height: number
  points: Point[]
  columns: SketchColumn[]
  openings: (SketchOpening | null)[]
  edge: number
  mainEdge: number
}

interface Span {
  start: number
  end: number
  kind: OpeningKind
  group: string
}

const tolerance = 0.01
const circleSides = 32
const mm = ([x, z]: Point): Point => [x * 1000, z * 1000]
const metres = ([x, z]: Point): [number, number] => [x / 1000, z / 1000]

function along(a: Point, b: Point, offset: number, length: number): Point {
  return length === 0
    ? a
    : [a[0] + ((b[0] - a[0]) * offset) / length, a[1] + ((b[1] - a[1]) * offset) / length]
}

function fitColumn(obstacle: Obstacle, source: number): SketchColumn | null {
  if (obstacle.kind !== 'column') return null
  const polygon = obstacle.polygon.map(mm)
  const xs = polygon.map((p) => p[0]),
    zs = polygon.map((p) => p[1])
  const minX = Math.min(...xs),
    maxX = Math.max(...xs)
  const minZ = Math.min(...zs),
    maxZ = Math.max(...zs)
  const width = maxX - minX,
    depth = maxZ - minZ
  const x = (maxX + minX) / 2,
    y = (maxZ + minZ) / 2
  if (polygon.length === 4) {
    const [a, b, c, d] = polygon
    if (a && b && c && d) {
      const ux = (b[0] - a[0] + c[0] - d[0]) / 2
      const uy = (b[1] - a[1] + c[1] - d[1]) / 2
      const vx = (c[0] - b[0] + d[0] - a[0]) / 2
      const vy = (c[1] - b[1] + d[1] - a[1]) / 2
      const width = Math.hypot(ux, uy)
      const depth = Math.hypot(vx, vy)
      const perpendicular = Math.abs(ux * vx + uy * vy) / Math.max(width, depth)
      const closure = Math.hypot(a[0] + c[0] - b[0] - d[0], a[1] + c[1] - b[1] - d[1])
      // 保存时各顶点分别取整到毫米，允许相对边产生轻微误差。
      const rectangleTolerance = 2
      if (
        Math.min(width, depth) > rectangleTolerance &&
        perpendicular <= rectangleTolerance &&
        closure <= Math.SQRT2 * rectangleTolerance
      ) {
        const direction = Math.sign(ux * vy - uy * vx)
        const angle = (Math.atan2(uy - direction * vx, ux + direction * vy) * 180) / Math.PI
        const rotation = angle < 0 ? angle + 360 : angle
        return {
          kind: 'square',
          x: (a[0] + b[0] + c[0] + d[0]) / 4,
          y: (a[1] + b[1] + c[1] + d[1]) / 4,
          width,
          depth,
          ...(rotation ? { rotation } : {}),
          source,
        }
      }
    }
  }
  if (
    polygon.length === circleSides &&
    Math.abs(width - depth) <= 2 &&
    polygon.every((p) => Math.abs(distance(p, [x, y]) - width / 2) <= 2)
  ) {
    return { kind: 'circle', x, y, width, depth: width, source }
  }
  return null
}

export function spaceToSketch(shop: ShopType, space?: Space) {
  const sketch: SpaceSketch = {
    shop: space?.shopType ?? shop,
    closed: Boolean(space),
    height: space ? space.height * 1000 : 3200,
    points: [],
    columns: [],
    openings: [],
    edge: 0,
    mainEdge: -1,
  }
  const fixedObstacles: { source: number; obstacle: Obstacle }[] = []
  if (!space) return { sketch, fixedObstacles }

  const spans = new Map<number, Span[]>()
  const takeOpening = (segment: { a: Point; b: Point }, kind: OpeningKind, group: string) => {
    for (const piece of openingPieces(space, segment) ?? []) {
      const a = space.boundary[piece.edge]
      if (!a) continue
      const first = distance(a, piece.a) * 1000,
        last = distance(a, piece.b) * 1000
      const values = spans.get(piece.edge) ?? []
      values.push({ start: Math.min(first, last), end: Math.max(first, last), kind, group })
      spans.set(piece.edge, values)
    }
  }
  space.entrances.forEach((e, i) => takeOpening(e, e.kind, `entrance-${i}`))
  space.openEdges.forEach((e, i) => takeOpening(e, 'open', `open-${i}`))
  space.boundary.forEach((a, edge) => {
    const b = space.boundary[(edge + 1) % space.boundary.length] ?? a
    const size = distance(a, b) * 1000
    const from = mm(a),
      to = mm(b)
    const parts = (spans.get(edge) ?? []).sort((p, q) => p.start - q.start)
    let cursor = 0
    if (!parts.length) {
      sketch.points.push(from)
      sketch.openings.push(null)
      return
    }
    for (const [i, part] of parts.entries()) {
      const next = parts[i + 1]
      // Additional editable nodes are only needed when one source edge has separate openings.
      const end = next ? Math.max(cursor, (part.end + next.start) / 2) : size
      if (end - cursor < tolerance) continue
      const start = Math.max(cursor, part.start),
        finish = Math.min(end, part.end)
      sketch.points.push(along(from, to, cursor, size))
      if (part.kind === 'main' && sketch.mainEdge < 0) sketch.mainEdge = sketch.openings.length
      const descriptor = { kind: part.kind, group: part.group }
      sketch.openings.push(
        finish - start <= tolerance
          ? null
          : start - cursor < tolerance && end - finish < tolerance
            ? { mode: 'full', ...descriptor }
            : { mode: 'partial', start: start - cursor, width: finish - start, ...descriptor },
      )
      cursor = end
    }
  })
  sketch.edge = Math.max(0, sketch.mainEdge)
  space.obstacles.forEach((obstacle, source) => {
    const column = fitColumn(obstacle, source)
    if (column) sketch.columns.push(column)
    else fixedObstacles.push({ obstacle, source })
  })
  return { sketch, fixedObstacles }
}

function sketchOpenings(sketch: SpaceSketch, original: SpaceSketch): OpeningRow[] {
  const rows: (OpeningRow & { group?: string })[] = []
  const n = sketch.points.length
  const mainGroup = sketch.openings[sketch.mainEdge]?.group
  const oldMainGroup = original.openings[original.mainEdge]?.group
  sketch.openings.forEach((opening, edge) => {
    const a = sketch.points[edge],
      b = sketch.points[(edge + 1) % n]
    if (!opening || !a || !b) return
    const size = distance(a, b)
    const startMm = opening.mode === 'full' ? 0 : opening.start
    const endMm = opening.mode === 'full' ? size : opening.start + opening.width
    const kind =
      edge === sketch.mainEdge || (mainGroup && mainGroup === opening.group)
        ? 'main'
        : opening.kind === 'main' && oldMainGroup && mainGroup === oldMainGroup
          ? 'main'
          : opening.kind === 'side'
            ? 'side'
            : 'open'
    const previous = rows.at(-1)
    const prevA = previous ? sketch.points[previous.toEdge] : undefined
    const prevB = previous ? sketch.points[(previous.toEdge + 1) % n] : undefined
    if (
      previous &&
      prevA &&
      prevB &&
      opening.group &&
      previous.group === opening.group &&
      previous.kind === kind &&
      previous.toEdge + 1 === edge &&
      startMm <= tolerance &&
      distance(prevA, prevB) - previous.endMm <= tolerance
    ) {
      previous.toEdge = edge
      previous.endMm = endMm
    } else {
      rows.push({
        edge,
        toEdge: edge,
        startMm,
        endMm,
        kind,
        ...(opening.group ? { group: opening.group } : {}),
      })
    }
  })
  const first = rows[0],
    last = rows.at(-1)
  const lastStart = sketch.points[n - 1],
    firstPoint = sketch.points[0]
  if (
    first &&
    last &&
    first !== last &&
    first.group &&
    first.group === last.group &&
    first.kind === last.kind &&
    first.edge === 0 &&
    last.toEdge === n - 1 &&
    first.startMm <= tolerance &&
    lastStart &&
    firstPoint &&
    distance(lastStart, firstPoint) - last.endMm <= tolerance
  ) {
    last.toEdge = first.toEdge
    last.endMm = first.endMm
    rows.shift()
  }
  return rows
}

function polygonForColumn(column: SketchColumn): Obstacle['polygon'] {
  const { x, y, width, depth } = column
  if (column.kind === 'circle') {
    return Array.from({ length: circleSides }, (_, i) => {
      const angle = (Math.PI * 2 * i) / circleSides
      return metres([x + (Math.cos(angle) * width) / 2, y + (Math.sin(angle) * width) / 2])
    })
  }
  const angle = ((column.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const corners: Point[] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ]
  return corners.map(([u, v]) => metres([x + u * cos - v * sin, y + u * sin + v * cos]))
}

export function sketchToSpace(sketch: SpaceSketch, initial?: Space, initialShop = sketch.shop) {
  const loaded = spaceToSketch(initialShop, initial)
  const original = loaded.sketch
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const samePoints = initial && same(sketch.points, original.points)
  const sameOpenings =
    samePoints && sketch.mainEdge === original.mainEdge && same(sketch.openings, original.openings)
  const converted = polygonToSpace({
    vertices: (sameOpenings ? initial.boundary.map(mm) : sketch.points).map(([xMm, zMm]) => ({
      xMm,
      zMm,
    })),
    openings: sameOpenings ? [] : sketchOpenings(sketch, original),
    heightMm: sketch.height,
    obstacles: [],
  })
  if (!converted.success) return converted
  const obstacles = loaded.fixedObstacles.map(({ source, obstacle }) => ({ source, obstacle }))
  for (const column of sketch.columns) {
    const source = column.source
    const previous = source === undefined ? undefined : initial?.obstacles[source]
    const unchanged = previous && original.columns.some((c) => same(c, column))
    obstacles.push({
      source: source ?? Infinity,
      obstacle: unchanged
        ? previous
        : {
            kind: 'column',
            polygon: polygonForColumn(column),
            height: previous?.height ?? null,
            label: previous?.label ?? (column.kind === 'circle' ? '圆柱' : '方柱'),
            ...(previous?.addedLater !== undefined ? { addedLater: previous.addedLater } : {}),
          },
    })
  }
  return SpaceSchema.safeParse({
    ...initial,
    ...converted.data,
    ...(!initial || initial.shopType !== undefined || sketch.shop !== original.shop
      ? { shopType: sketch.shop }
      : {}),
    height: sketch.height / 1000,
    boundary: samePoints ? initial.boundary : sketch.points.map(metres),
    entrances: sameOpenings ? initial.entrances : converted.data.entrances,
    openEdges: sameOpenings ? initial.openEdges : converted.data.openEdges,
    calibration: initial?.calibration ?? null,
    obstacles: obstacles.sort((a, b) => a.source - b.source).map((item) => item.obstacle),
  })
}
