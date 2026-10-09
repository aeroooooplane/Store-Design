import { SpaceSchema, distance, mmToM, mToMm } from '@store/shared'
import type { Point, Space, SpaceInput } from '@store/shared'

/** Forms work in millimetres; spaces are stored in metres. */
export type EntranceSide = 'front' | 'back' | 'left' | 'right' | 'none'

export const ENTRANCE_SIDE_LABELS: Record<EntranceSide, string> = {
  front: '前边（下）',
  back: '后边（上）',
  left: '左边',
  right: '右边',
  none: '暂不设置',
}

export interface RectangleForm {
  widthMm: number
  depthMm: number
  heightMm: number
  entranceSide: EntranceSide
  /** Opening width, centred on the side; 0 = the whole side. */
  entranceWidthMm: number
}

export interface VertexRow {
  xMm: number
  zMm: number
}

export interface EntranceRow {
  /** Index of the boundary edge (from vertex i to vertex i + 1). */
  edge: number
  /** Opening start and end, measured along the edge from its first vertex. */
  startMm: number
  endMm: number
}

export interface ColumnRow {
  label: string
  xMm: number
  zMm: number
  wMm: number
  dMm: number
}

export interface PolygonForm {
  vertices: VertexRow[]
  heightMm: number
  entrances: EntranceRow[]
  columns: ColumnRow[]
}

const point = (xMm: number, zMm: number): [number, number] => [mmToM(xMm), mmToM(zMm)]

/** Corners clockwise from the top-left, so edges are 0 top, 1 right, 2 bottom (front), 3 left. */
export function rectangleToPolygon(form: RectangleForm): PolygonForm {
  const { widthMm: w, depthMm: d } = form
  const vertices = [
    { xMm: 0, zMm: 0 },
    { xMm: w, zMm: 0 },
    { xMm: w, zMm: d },
    { xMm: 0, zMm: d },
  ]
  const edge = { back: 0, right: 1, front: 2, left: 3, none: -1 }[form.entranceSide]
  const sideLength = edge === 0 || edge === 2 ? w : d
  const opening = form.entranceWidthMm > 0 ? Math.min(form.entranceWidthMm, sideLength) : sideLength
  const start = (sideLength - opening) / 2
  return {
    vertices,
    heightMm: form.heightMm,
    entrances: edge < 0 ? [] : [{ edge, startMm: start, endMm: start + opening }],
    columns: [],
  }
}

function along(a: Point, b: Point, mm: number): [number, number] {
  const length = distance(a, b)
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, mmToM(mm) / length))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Builds a space; schema errors (too few vertices, bad numbers) surface to the form. */
export function polygonToSpace(form: PolygonForm): ReturnType<typeof SpaceSchema.safeParse> {
  const boundary = form.vertices.map((v) => point(v.xMm, v.zMm))
  const entrances = form.entrances.flatMap((row, index) => {
    const a = boundary[row.edge]
    const b = boundary[(row.edge + 1) % boundary.length]
    if (!a || !b) return []
    return [
      {
        a: along(a, b, row.startMm),
        b: along(a, b, row.endMm),
        kind: index === 0 ? ('main' as const) : ('side' as const),
      },
    ]
  })
  const obstacles = form.columns.map((c) => ({
    kind: 'column' as const,
    label: c.label.trim() || null,
    height: null,
    polygon: [
      point(c.xMm, c.zMm),
      point(c.xMm + c.wMm, c.zMm),
      point(c.xMm + c.wMm, c.zMm + c.dMm),
      point(c.xMm, c.zMm + c.dMm),
    ],
  }))
  const input: SpaceInput = {
    schemaVersion: 1,
    boundary,
    height: mmToM(form.heightMm),
    entrances,
    obstacles,
  }
  return SpaceSchema.safeParse(input)
}

/** Opens an existing space for editing; non-rectangular obstacles keep their bounding box. */
export function spaceToPolygonForm(space: Space): PolygonForm {
  const vertices = space.boundary.map(([x, z]) => ({ xMm: mToMm(x), zMm: mToMm(z) }))
  const entrances = space.entrances.flatMap((e) => {
    for (let edge = 0; edge < space.boundary.length; edge++) {
      const a = space.boundary[edge]
      const b = space.boundary[(edge + 1) % space.boundary.length]
      if (!a || !b) continue
      const length = distance(a, b)
      const onEdge = [e.a, e.b].every(
        (p) => Math.abs(distance(a, p) + distance(p, b) - length) < 0.01,
      )
      if (onEdge) {
        const s = mToMm(distance(a, e.a))
        const t = mToMm(distance(a, e.b))
        return [{ edge, startMm: Math.min(s, t), endMm: Math.max(s, t) }]
      }
    }
    return []
  })
  const columns = space.obstacles.map((o) => {
    const xs = o.polygon.map((p) => p[0])
    const zs = o.polygon.map((p) => p[1])
    const x = Math.min(...xs)
    const z = Math.min(...zs)
    return {
      label: o.label ?? '',
      xMm: mToMm(x),
      zMm: mToMm(z),
      wMm: mToMm(Math.max(...xs) - x),
      dMm: mToMm(Math.max(...zs) - z),
    }
  })
  return { vertices, heightMm: mToMm(space.height), entrances, columns }
}
