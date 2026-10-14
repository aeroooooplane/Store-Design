import { describe, expect, it } from 'vitest'
import { distance, polygonArea, rectangleSpace, validateSpace } from '@store/shared'
import type { Space } from '@store/shared'
import {
  DEFAULT_TEMPLATES,
  applyEdges,
  arcEdge,
  closure,
  deleteVertex,
  formWarnings,
  frontEdge,
  insertVertex,
  mainIsContinuous,
  normalizeTurn,
  polygonToSpace,
  rectangleToPolygon,
  selectionEdges,
  setStorefront,
  spaceToPolygonForm,
  splitAlongBoundary,
  templateToPolygon,
  unmappedOpenings,
  verticesToEdges,
} from './space-form.ts'
import type { ObstacleRow, PolygonForm, TemplateKind } from './space-form.ts'

const RECT = { widthMm: 8000, depthMm: 6000, heightMm: 3200, entranceWidthMm: 0 } as const

const column = (patch: Partial<ObstacleRow> = {}): ObstacleRow => ({
  kind: 'column',
  label: '柱',
  heightMm: null,
  xMm: 1000,
  zMm: 1000,
  wMm: 500,
  dMm: 500,
  polygon: null,
  ...patch,
})

function parse(form: PolygonForm): Space {
  const parsed = polygonToSpace(form)
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
}

const errorsOf = (space: Space) => validateSpace(space).filter((i) => i.severity === 'error')

describe('rectangleToPolygon', () => {
  it('opens the whole front edge when no entrance width is given', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    expect(form.vertices).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 8000, zMm: 0 },
      { xMm: 8000, zMm: 6000 },
      { xMm: 0, zMm: 6000 },
    ])
    expect(form.openings).toEqual([{ edge: 2, startMm: 0, endMm: 8000, kind: 'main' }])
  })

  it('centres a narrower entrance and caps it at the side length', () => {
    const left = rectangleToPolygon({ ...RECT, entranceSide: 'left', entranceWidthMm: 2000 })
    expect(left.openings).toEqual([{ edge: 3, startMm: 2000, endMm: 4000, kind: 'main' }])
    const wide = rectangleToPolygon({ ...RECT, entranceSide: 'right', entranceWidthMm: 9000 })
    expect(wide.openings).toEqual([{ edge: 1, startMm: 0, endMm: 6000, kind: 'main' }])
  })

  it('has no entrance when none is chosen', () => {
    expect(rectangleToPolygon({ ...RECT, entranceSide: 'none' }).openings).toEqual([])
  })
})

describe('polygonToSpace', () => {
  it('converts millimetres to metres and places entrances on their edge', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'back', entranceWidthMm: 2000 })
    form.obstacles.push(column({ label: ' 柱 1 ', wMm: 500, dMm: 400 }))
    const space = parse(form)
    expect(space.boundary).toEqual([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    expect(space.height).toBe(3.2)
    expect(space.entrances).toEqual([{ a: [3, 0], b: [5, 0], kind: 'main' }])
    expect(space.openEdges).toEqual([])
    expect(space.obstacles[0]).toEqual({
      kind: 'column',
      label: '柱 1',
      height: null,
      polygon: [
        [1, 1],
        [1.5, 1],
        [1.5, 1.4],
        [1, 1.4],
      ],
    })
    expect(errorsOf(space)).toEqual([])
  })

  it('writes each row by its kind: main and side entrances, open edges', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    form.openings.push(
      { edge: 1, startMm: 1000, endMm: 2000, kind: 'side' },
      { edge: 3, startMm: 0, endMm: 6000, kind: 'open' },
    )
    const space = parse(form)
    expect(space.entrances.map((e) => e.kind)).toEqual(['main', 'side'])
    expect(space.openEdges).toEqual([{ a: [0, 6], b: [0, 0] }])
    expect(errorsOf(space)).toEqual([])
  })

  it('keeps obstacle kind and height', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    form.obstacles.push(column({ kind: 'shaft', heightMm: 2400 }))
    expect(parse(form).obstacles[0]).toMatchObject({ kind: 'shaft', height: 2.4 })
  })

  it('rejects too few vertices and an impossible ceiling height', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'none' })
    expect(polygonToSpace({ ...form, vertices: form.vertices.slice(0, 2) }).success).toBe(false)
    expect(polygonToSpace({ ...form, heightMm: 1000 }).success).toBe(false)
  })
})

describe('spaceToPolygonForm', () => {
  it('round-trips a polygon with an entrance and a column', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'right', entranceWidthMm: 1500 })
    form.vertices.splice(2, 0, { xMm: 8000, zMm: 4000 }, { xMm: 6000, zMm: 6000 })
    form.vertices.splice(4, 1)
    form.obstacles.push(column({ xMm: 2000, zMm: 2000, wMm: 600, dMm: 600 }))
    expect(spaceToPolygonForm(parse(form))).toEqual(form)
  })

  it('keeps entrances that run against the edge direction', () => {
    const space = rectangleSpace(5, 4, 3)
    space.entrances = [{ a: [4, 4], b: [2, 4], kind: 'main' }]
    const edge = space.boundary.findIndex(
      (p, i) => p[1] === 4 && space.boundary[(i + 1) % space.boundary.length]?.[1] === 4,
    )
    const [entrance] = spaceToPolygonForm(space).openings
    expect(entrance?.edge).toBe(edge)
    expect((entrance?.endMm ?? 0) - (entrance?.startMm ?? 0)).toBe(2000)
  })

  it('keeps open edges, obstacle kinds, heights, outlines and entrances across edges', () => {
    const space: Space = {
      schemaVersion: 1,
      // The front edge is split at (4, 6), so the entrance spans edges 2 and 3.
      boundary: [
        [0, 0],
        [8, 0],
        [8, 6],
        [4, 6],
        [0, 6],
      ],
      height: 3.2,
      entrances: [{ a: [6, 6], b: [2, 6], kind: 'main' }],
      openEdges: [{ a: [8, 1], b: [8, 3] }],
      obstacles: [
        {
          kind: 'fixed',
          label: '展台',
          height: 1.2,
          polygon: [
            [2, 2],
            [3, 2],
            [2.5, 3],
          ],
        },
        {
          kind: 'shaft',
          label: null,
          height: 2.5,
          polygon: [
            [5, 1],
            [6, 1],
            [6, 2],
            [5, 2],
          ],
        },
      ],
      calibration: null,
    }
    const form = spaceToPolygonForm(space)
    expect(form.openings).toEqual([
      { edge: 1, startMm: 1000, endMm: 3000, kind: 'open' },
      { edge: 2, startMm: 2000, endMm: 4000, kind: 'main' },
      { edge: 3, startMm: 0, endMm: 2000, kind: 'main' },
    ])
    expect(form.obstacles[0]).toMatchObject({ kind: 'fixed', label: '展台', heightMm: 1200 })
    expect(form.obstacles[0]?.polygon).toEqual(space.obstacles[0]?.polygon)
    expect(form.obstacles[1]).toMatchObject({ kind: 'shaft', heightMm: 2500, polygon: null })

    const saved = parse(form)
    expect(saved.openEdges).toEqual(space.openEdges)
    expect(saved.entrances).toEqual([
      { a: [6, 6], b: [4, 6], kind: 'main' },
      { a: [4, 6], b: [2, 6], kind: 'main' },
    ])
    expect(saved.obstacles[0]).toEqual(space.obstacles[0])
    expect(saved.obstacles[1]).toMatchObject({ kind: 'shaft', height: 2.5, label: null })
    expect(errorsOf(saved)).toEqual([])
    expect(unmappedOpenings(space)).toBe(0)
  })

  it('counts entrances off the boundary, which cannot be edited', () => {
    const space = rectangleSpace(5, 4, 3)
    space.entrances.push({ a: [2, 2], b: [3, 2], kind: 'side' })
    expect(unmappedOpenings(space)).toBe(1)
    expect(spaceToPolygonForm(space).openings).toHaveLength(1)
  })

  it('splits along the short way round the boundary', () => {
    const boundary = [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ] as const
    const corner = [
      { edge: 1, startMm: 5000, endMm: 6000 },
      { edge: 2, startMm: 0, endMm: 1000 },
    ]
    // From the right side round the bottom-right corner onto the front, in either direction.
    expect(splitAlongBoundary(boundary, [8, 5], [7, 6])).toEqual(corner)
    expect(splitAlongBoundary(boundary, [7, 6], [8, 5])).toEqual(corner)
    expect(splitAlongBoundary(boundary, [4, 3], [8, 5])).toBeNull()
  })
})

describe('edge-by-edge entry', () => {
  const L = [
    { xMm: 0, zMm: 0 },
    { xMm: 6000, zMm: 0 },
    { xMm: 6000, zMm: 3000 },
    { xMm: 10000, zMm: 3000 },
    { xMm: 10000, zMm: 8000 },
    { xMm: 0, zMm: 8000 },
  ]

  it('derives lengths and turns, right turns positive and left turns negative', () => {
    expect(verticesToEdges(L)).toEqual([
      { lengthMm: 6000, turnDeg: 0 },
      { lengthMm: 3000, turnDeg: 90 },
      { lengthMm: 4000, turnDeg: -90 },
      { lengthMm: 5000, turnDeg: 90 },
      { lengthMm: 10000, turnDeg: 90 },
      { lengthMm: 8000, turnDeg: 90 },
    ])
    expect(applyEdges(L, verticesToEdges(L))).toEqual(L)
  })

  it('rebuilds the vertices after a changed edge and keeps those before it', () => {
    const rect = rectangleToPolygon({ ...RECT, entranceSide: 'front' }).vertices
    const edges = verticesToEdges(rect)
    edges[1] = { lengthMm: 4000, turnDeg: 90 }
    expect(applyEdges(rect, edges, 1)).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 8000, zMm: 0 },
      { xMm: 8000, zMm: 4000 },
      { xMm: 0, zMm: 4000 },
    ])
    // A 45° right turn turns everything after it.
    edges[1] = { lengthMm: 2000, turnDeg: 45 }
    const turned = applyEdges(rect, edges, 1)
    expect(turned.slice(0, 3)).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 8000, zMm: 0 },
      { xMm: 9414, zMm: 1414 },
    ])
    expect(verticesToEdges(turned)[1]?.turnDeg).toBe(45)
    expect(verticesToEdges(turned)[2]?.turnDeg).toBe(90)
  })

  it('closes on the first vertex and reports how far the entered last edge misses it', () => {
    const rect = rectangleToPolygon({ ...RECT, entranceSide: 'front' }).vertices
    const edges = verticesToEdges(rect)
    expect(closure(rect, edges)).toEqual({ lengthMm: 6000, turnDeg: 90, errorMm: 0 })
    edges[1] = { lengthMm: 4000, turnDeg: 90 }
    const shorter = applyEdges(rect, edges, 1)
    // The last edge was entered as 6000 mm but only 4000 mm closes the ring.
    expect(closure(shorter, edges)).toEqual({ lengthMm: 4000, turnDeg: 90, errorMm: 2000 })
  })

  it('folds angles into (-180, 180]', () => {
    expect(normalizeTurn(270)).toBe(-90)
    expect(normalizeTurn(-270)).toBe(90)
    expect(normalizeTurn(180)).toBe(180)
    expect(normalizeTurn(-180)).toBe(180)
  })
})

describe('templates', () => {
  const area = (form: PolygonForm) => polygonArea(parse(form).boundary)

  it('builds the L shape with the whole front edge as main entrance', () => {
    const form = templateToPolygon(DEFAULT_TEMPLATES.l)
    expect(form.vertices).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 6000, zMm: 0 },
      { xMm: 6000, zMm: 3000 },
      { xMm: 10000, zMm: 3000 },
      { xMm: 10000, zMm: 8000 },
      { xMm: 0, zMm: 8000 },
    ])
    expect(form.openings).toEqual([{ edge: 4, startMm: 0, endMm: 10000, kind: 'main' }])
    expect(area(form)).toBe(68)
  })

  it('builds a trapezoid with one slanted side', () => {
    const right = templateToPolygon(DEFAULT_TEMPLATES.trapezoid)
    expect(right.vertices).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 8000, zMm: 0 },
      { xMm: 10000, zMm: 8000 },
      { xMm: 0, zMm: 8000 },
    ])
    expect(area(right)).toBe(72)
    const left = templateToPolygon({ ...DEFAULT_TEMPLATES.trapezoid, slant: 'left' })
    expect(left.vertices[0]).toEqual({ xMm: 2000, zMm: 0 })
    expect(left.openings).toEqual([{ edge: 2, startMm: 0, endMm: 10000, kind: 'main' }])
  })

  it('cuts a chamfer and bumps the back wall out or in', () => {
    expect(area(templateToPolygon(DEFAULT_TEMPLATES.chamfer))).toBe(78)
    const inward = templateToPolygon(DEFAULT_TEMPLATES.bump)
    expect(area(inward)).toBe(62)
    expect(inward.vertices.slice(1, 5)).toEqual([
      { xMm: 3000, zMm: 0 },
      { xMm: 3000, zMm: 2000 },
      { xMm: 7000, zMm: 2000 },
      { xMm: 7000, zMm: 0 },
    ])
    const outward = templateToPolygon({ ...DEFAULT_TEMPLATES.bump, bump: 'out' })
    expect(area(outward)).toBe(78)
    expect(Math.min(...outward.vertices.map((v) => v.zMm))).toBe(0)
    expect(outward.openings[0]).toMatchObject({ edge: 6, endMm: 10000, kind: 'main' })
  })

  it('gives a valid space for every template and corner', () => {
    const kinds: TemplateKind[] = ['l', 'trapezoid', 'chamfer', 'bump']
    for (const kind of kinds)
      for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
        const space = parse(templateToPolygon({ ...DEFAULT_TEMPLATES[kind], corner }))
        expect(errorsOf(space), `${kind} ${corner}`).toEqual([])
        expect(space.entrances).toHaveLength(1)
      }
  })

  it('finds the front edge as the longest bottom edge', () => {
    const form = templateToPolygon({ ...DEFAULT_TEMPLATES.l, corner: 'br' })
    expect(frontEdge(form.vertices)).toBe(4)
    expect(form.openings[0]).toMatchObject({ edge: 4, startMm: 0, endMm: 6000 })
  })
})

describe('inserting and deleting vertices', () => {
  const base = () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    form.openings = [
      { edge: 0, startMm: 1000, endMm: 2000, kind: 'side' },
      { edge: 2, startMm: 0, endMm: 8000, kind: 'main' },
      { edge: 3, startMm: 0, endMm: 6000, kind: 'open' },
    ]
    return form
  }

  it('inserts a midpoint and splits the openings on that edge', () => {
    const form = insertVertex(base(), 2)
    expect(form.vertices[3]).toEqual({ xMm: 4000, zMm: 6000 })
    expect(form.openings).toEqual([
      { edge: 0, startMm: 1000, endMm: 2000, kind: 'side' },
      { edge: 2, startMm: 0, endMm: 4000, kind: 'main' },
      { edge: 3, startMm: 0, endMm: 4000, kind: 'main' },
      { edge: 4, startMm: 0, endMm: 6000, kind: 'open' },
    ])
    expect(errorsOf(parse(form))).toEqual([])
  })

  it('puts an opening on one half only when it does not cross the midpoint', () => {
    const form = insertVertex(base(), 0)
    expect(form.openings[0]).toEqual({ edge: 0, startMm: 1000, endMm: 2000, kind: 'side' })
    expect(form.openings.map((o) => o.edge)).toEqual([0, 3, 4])
  })

  it('removes only the openings on the two edges of a deleted vertex', () => {
    const form = deleteVertex(base(), 1)
    expect(form.vertices).toHaveLength(3)
    expect(form.openings).toEqual([
      { edge: 1, startMm: 0, endMm: 8000, kind: 'main' },
      { edge: 2, startMm: 0, endMm: 6000, kind: 'open' },
    ])
    // Deleting the first vertex merges the last and the first edge.
    expect(deleteVertex(base(), 0).openings).toEqual([
      { edge: 1, startMm: 0, endMm: 8000, kind: 'main' },
    ])
  })

  it('never goes below three vertices', () => {
    const triangle = deleteVertex(base(), 1)
    expect(deleteVertex(triangle, 0)).toBe(triangle)
  })
})

describe('arcEdge', () => {
  const rect = () => rectangleToPolygon({ ...RECT, entranceSide: 'front' })
  const out = { mode: 'sagitta', valueMm: 1000, segments: 4, direction: 'out' } as const

  it('replaces an edge by chords of an arc bulging out of the shop', () => {
    const result = arcEdge(rect(), 2, out)
    if (!result.ok) throw new Error(result.message)
    const { vertices, openings } = result.form
    expect(vertices).toHaveLength(7)
    // Chord 8000, sagitta 1000: radius 8500 about (4000, -1500); the apex is the middle point.
    expect(vertices[4]).toEqual({ xMm: 4000, zMm: 7000 })
    for (const v of vertices.slice(3, 6))
      expect(Math.abs(Math.hypot(v.xMm - 4000, v.zMm + 1500) - 8500)).toBeLessThanOrEqual(1)
    // The whole-edge entrance now covers every segment.
    expect(openings.map((o) => o.edge)).toEqual([2, 3, 4, 5])
    expect(openings.every((o) => o.kind === 'main' && o.startMm === 0)).toBe(true)

    const space = parse(result.form)
    expect(errorsOf(space)).toEqual([])
    expect(space.entrances).toHaveLength(4)
    expect(space.entrances.every((e) => e.kind === 'main')).toBe(true)
    // The middle of the storefront comes first: downstream takes it as the main entrance.
    expect(space.entrances[0]).toMatchObject({ b: [4, 7] })
    expect(mainIsContinuous(result.form)).toBe(true)
  })

  it('bulges into the shop and accepts a radius instead of the sagitta', () => {
    const inward = arcEdge(rect(), 2, {
      mode: 'radius',
      valueMm: 8500,
      segments: 2,
      direction: 'in',
    })
    expect(inward.ok && inward.form.vertices[3]).toEqual({ xMm: 4000, zMm: 5000 })
  })

  it('works the same on a counter-clockwise ring', () => {
    const form = rect()
    form.vertices.reverse()
    form.openings = []
    // Reversed, the front edge runs from vertex 0 (0, 6000) to vertex 1 (8000, 6000).
    const result = arcEdge(form, 0, { ...out, segments: 2 })
    expect(result.ok && result.form.vertices[1]).toEqual({ xMm: 4000, zMm: 7000 })
  })

  it('explains impossible arcs', () => {
    expect(arcEdge(rect(), 2, { ...out, mode: 'radius', valueMm: 3000 })).toEqual({
      ok: false,
      message: '半径不能小于弦长的一半（4000 mm）',
    })
    expect(arcEdge(rect(), 2, { ...out, segments: 1 }).ok).toBe(false)
    expect(arcEdge(rect(), 2, { ...out, valueMm: 0 }).ok).toBe(false)
  })
})

describe('storefront', () => {
  const rect = () => rectangleToPolygon({ ...RECT, entranceSide: 'front' })

  it('selects consecutive edges, wrapping round the ring', () => {
    expect(selectionEdges({ from: 3, to: 1, startMm: 0, endMm: null }, 4)).toEqual([3, 0, 1])
    expect(selectionEdges({ from: 2, to: 2, startMm: 0, endMm: null }, 4)).toEqual([2])
  })

  it('writes one span per edge and cuts what was there before', () => {
    const { form, replaced } = setStorefront(
      rect(),
      { from: 1, to: 2, startMm: 1000, endMm: 3000 },
      'open',
    )
    expect(replaced).toBe(0)
    expect(form.openings).toEqual([
      { edge: 1, startMm: 1000, endMm: 6000, kind: 'open' },
      { edge: 2, startMm: 0, endMm: 3000, kind: 'open' },
      { edge: 2, startMm: 3000, endMm: 8000, kind: 'main' },
    ])
    const space = parse(form)
    expect(space.openEdges).toEqual([
      { a: [8, 1], b: [8, 6] },
      { a: [8, 6], b: [5, 6] },
    ])
    expect(errorsOf(space)).toEqual([])
  })

  it('keeps one main entrance: a new one replaces the old, side entrances stay', () => {
    const start = rect()
    start.openings.push({ edge: 1, startMm: 1000, endMm: 2000, kind: 'side' })
    const moved = setStorefront(start, { from: 0, to: 0, startMm: 2000, endMm: 4000 }, 'main')
    expect(moved.replaced).toBe(1)
    expect(moved.form.openings).toEqual([
      { edge: 0, startMm: 2000, endMm: 4000, kind: 'main' },
      { edge: 1, startMm: 1000, endMm: 2000, kind: 'side' },
    ])
    expect(parse(moved.form).entrances.map((e) => e.kind)).toEqual(['main', 'side'])
    // Narrowing the whole-front entrance leaves wall on both sides.
    const narrowed = setStorefront(rect(), { from: 2, to: 2, startMm: 3000, endMm: 5000 }, 'main')
    expect(narrowed.replaced).toBe(2)
    expect(narrowed.form.openings).toEqual([{ edge: 2, startMm: 3000, endMm: 5000, kind: 'main' }])
  })

  it('turns a stretch back into wall and ignores an empty selection', () => {
    const cleared = setStorefront(rect(), { from: 2, to: 2, startMm: 0, endMm: null }, 'wall')
    expect(cleared.form.openings).toEqual([])
    const before = rect()
    const empty = setStorefront(before, { from: 2, to: 2, startMm: 500, endMm: 500 }, 'open')
    expect(empty.form).toBe(before)
  })

  it('warns about a broken main storefront but not about one round a corner', () => {
    const form = rect()
    form.openings.push({ edge: 0, startMm: 0, endMm: 1000, kind: 'main' })
    expect(mainIsContinuous(form)).toBe(false)
    expect(formWarnings(form)).toContain(
      '主入口不连续：一个空间只能有一段连续的主入口，请把其余段改为次入口',
    )
    const corner = setStorefront(rect(), { from: 1, to: 2, startMm: 3000, endMm: null }, 'main')
    expect(mainIsContinuous(corner.form)).toBe(true)
  })
})

describe('formWarnings', () => {
  it('warns about short and zero-length edges without blocking', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'none' })
    form.vertices.splice(2, 0, { xMm: 8000, zMm: 5800 })
    expect(formWarnings(form)).toEqual(['边 3 只有 200 mm，短于 0.3 m，请确认不是墙厚造成的锯齿'])
    expect(errorsOf(parse(form))).toEqual([])
    form.vertices.splice(3, 0, { xMm: 8000, zMm: 6000 })
    expect(formWarnings(form)[1]).toBe('边 4 长度为 0（顶点 4 与顶点 5 重合）')
    expect(validateSpace(parse(form)).map((i) => i.code)).toContain('boundary_not_simple')
  })

  it('warns about openings that do not fit their edge', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    form.openings.push(
      { edge: 1, startMm: 5000, endMm: 7000, kind: 'side' },
      { edge: 3, startMm: 100, endMm: 100, kind: 'open' },
    )
    expect(formWarnings(form)).toEqual([
      '边 2 上的次入口超出这条边，已截到边内',
      '边 4 上的开放边长度为 0，已忽略',
    ])
    const space = parse(form)
    expect(space.openEdges).toEqual([])
    const side = space.entrances[1]
    expect(side && distance(side.a, side.b)).toBe(1)
  })
})
