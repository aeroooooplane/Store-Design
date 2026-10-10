import { describe, expect, it } from 'vitest'
import { rectangleSpace, validateSpace } from '@store/shared'
import { polygonToSpace, rectangleToPolygon, spaceToPolygonForm } from './space-form.ts'

const RECT = { widthMm: 8000, depthMm: 6000, heightMm: 3200, entranceWidthMm: 0 } as const

describe('rectangleToPolygon', () => {
  it('opens the whole front edge when no entrance width is given', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    expect(form.vertices).toEqual([
      { xMm: 0, zMm: 0 },
      { xMm: 8000, zMm: 0 },
      { xMm: 8000, zMm: 6000 },
      { xMm: 0, zMm: 6000 },
    ])
    expect(form.entrances).toEqual([{ edge: 2, startMm: 0, endMm: 8000 }])
  })

  it('centres a narrower entrance and caps it at the side length', () => {
    const left = rectangleToPolygon({ ...RECT, entranceSide: 'left', entranceWidthMm: 2000 })
    expect(left.entrances).toEqual([{ edge: 3, startMm: 2000, endMm: 4000 }])
    const wide = rectangleToPolygon({ ...RECT, entranceSide: 'right', entranceWidthMm: 9000 })
    expect(wide.entrances).toEqual([{ edge: 1, startMm: 0, endMm: 6000 }])
  })

  it('has no entrance when none is chosen', () => {
    expect(rectangleToPolygon({ ...RECT, entranceSide: 'none' }).entrances).toEqual([])
  })
})

describe('polygonToSpace', () => {
  it('converts millimetres to metres and places entrances on their edge', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'back', entranceWidthMm: 2000 })
    form.columns.push({ label: ' 柱 1 ', xMm: 1000, zMm: 1000, wMm: 500, dMm: 400 })
    const parsed = polygonToSpace(form)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.boundary).toEqual([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    expect(parsed.data.height).toBe(3.2)
    expect(parsed.data.entrances).toEqual([{ a: [3, 0], b: [5, 0], kind: 'main' }])
    expect(parsed.data.obstacles[0]).toMatchObject({
      kind: 'column',
      label: '柱 1',
      polygon: [
        [1, 1],
        [1.5, 1],
        [1.5, 1.4],
        [1, 1.4],
      ],
    })
    expect(validateSpace(parsed.data).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('marks every entrance after the first as a side entrance', () => {
    const form = rectangleToPolygon({ ...RECT, entranceSide: 'front' })
    form.entrances.push({ edge: 1, startMm: 1000, endMm: 2000 })
    const parsed = polygonToSpace(form)
    expect(parsed.success && parsed.data.entrances.map((e) => e.kind)).toEqual(['main', 'side'])
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
    form.columns.push({ label: '柱', xMm: 2000, zMm: 2000, wMm: 600, dMm: 600 })
    const parsed = polygonToSpace(form)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(spaceToPolygonForm(parsed.data)).toEqual(form)
  })

  it('keeps entrances that run against the edge direction', () => {
    const space = rectangleSpace(5, 4, 3)
    space.entrances = [{ a: [4, 4], b: [2, 4], kind: 'main' }]
    const edge = space.boundary.findIndex(
      (p, i) => p[1] === 4 && space.boundary[(i + 1) % space.boundary.length]?.[1] === 4,
    )
    const [entrance] = spaceToPolygonForm(space).entrances
    expect(entrance?.edge).toBe(edge)
    expect((entrance?.endMm ?? 0) - (entrance?.startMm ?? 0)).toBe(2000)
  })
})
