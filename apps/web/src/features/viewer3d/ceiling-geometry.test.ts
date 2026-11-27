import { describe, expect, it } from 'vitest'
import {
  distanceToBoundary,
  effectiveCeiling,
  polygonInsidePolygon,
  rectangleSpace,
  recommendedCeiling,
  SpaceSchema,
} from '@store/shared'
import type { Facade, Space } from '@store/shared'
import { ceilingModel } from './ceiling-geometry.ts'
import { buildCeiling } from './ceiling-3d.ts'

const room = rectangleSpace(8, 6, 3.2)
const fascia: Facade = {
  a: [0, 6],
  b: [8, 6],
  openingWidth: 8,
  clearHeight: 2.6,
  fasciaHeight: 0.6,
  screenInset: 0.05,
}

describe('SI ceilings', () => {
  it('uses the SI1.0 height boundary, SI2.0 grade and each shop type', () => {
    const low = { ...room, height: 2.8 }
    expect(recommendedCeiling(room, 'side_hall', 'SI1.0')).toBe('film')
    expect(recommendedCeiling(low, 'side_hall', 'SI1.0')).toBe('linear')
    expect(recommendedCeiling(low, 'side_hall', 'SI2.0')).toBe('film')
    expect(
      recommendedCeiling(
        { ...room, facade: { ...fascia, si2: { grade: 'B' } } },
        'side_hall',
        'SI2.0',
      ),
    ).toBe('linear')
    expect(effectiveCeiling(room, 'island', 'SI2.0')).toBe('frame')
    const saved = SpaceSchema.parse({ ...room, ceiling: 'none' })
    expect(effectiveCeiling(saved, 'island', 'SI2.0')).toBe('none')
    expect(effectiveCeiling(saved, 'side_hall', 'SI2.0')).toBe('film')
    expect(effectiveCeiling({ ...room, ceiling: 'frame' }, 'zone', 'SI2.0')).toBe('none')
  })

  it('uses equal SI1.0 film panels and 200 mm walls and slots', () => {
    const model = ceilingModel(room, 'side_hall', 'SI1.0')
    const intervals = model.parts
      .filter((part) => part.finish === 'film')
      .map((part) => {
        const x = part.polygon.map(([x]) => x)
        return [Math.min(...x), Math.max(...x)]
      })
      .sort((a, b) => a[0]! - b[0]!)
    expect(intervals).toHaveLength(5)
    expect(intervals[0]?.[0]).toBeCloseTo(0.2)
    expect(intervals.at(-1)?.[1]).toBeCloseTo(7.8)
    intervals.forEach(([a, b], index) => {
      expect(b! - a!).toBeCloseTo(1.36)
      if (index > 0) expect(a! - intervals[index - 1]![1]!).toBeCloseTo(0.2)
    })
  })

  it('clips soft-film faces to the setbacks of an oblique concave boundary', () => {
    const shape: Space = {
      ...room,
      boundary: [
        [0, 0],
        [8, 0],
        [8, 6],
        [3, 6],
        [3, 3],
        [0, 4],
      ],
      entrances: [{ a: [3, 6], b: [8, 6], kind: 'main' }],
    }
    const { parts } = ceilingModel(shape, 'side_hall', 'SI2.0')
    const panels = parts.filter((part) => part.finish === 'film')
    expect(panels.length).toBeGreaterThan(2)
    panels.forEach((part) =>
      part.polygon.forEach((point) =>
        expect(distanceToBoundary(point, shape.boundary)).toBeGreaterThanOrEqual(0.1999),
      ),
    )
  })

  it('supports the island frame at four corners and reuses a full-height existing column', () => {
    const posts = (space: Space) =>
      ceilingModel(space, 'island', 'SI2.0').parts.filter(
        (p) => p.finish === 'frame' && p.bottom === 0,
      )
    const parts = posts(room)
    expect(parts).toHaveLength(4)
    expect(
      parts.every(
        (p) => p.thickness === room.height && polygonInsidePolygon(p.polygon, room.boundary),
      ),
    ).toBe(true)
    const existing: Space = {
      ...room,
      obstacles: [
        {
          kind: 'column',
          polygon: [
            [0, 0],
            [0.2, 0],
            [0.2, 0.2],
            [0, 0.2],
          ],
          height: room.height,
          label: null,
        },
      ],
    }
    expect(posts(existing)).toHaveLength(3)
    expect(posts({ ...room, ceiling: 'none' })).toHaveLength(0)
    expect(ceilingModel(room, 'side_hall', 'SI2.0').parts.some((p) => p.bottom === 0)).toBe(false)
  })

  it('keeps detailed outlines renderable and batches the ceiling by finish', () => {
    const space: Space = {
      ...room,
      entrances: [],
      boundary: Array.from({ length: 180 }, (_, i) => {
        const t = (i * 2 * Math.PI) / 180
        const radius = i % 2 === 0 ? 1 : 0.996
        return [7 + 7 * radius * Math.cos(t), 5 + 5 * radius * Math.sin(t)]
      }),
    }
    const model = ceilingModel(space, 'island', 'SI2.0')
    const frame = model.parts.find((part) => part.finish === 'frame')
    expect(frame?.holes?.length).toBeGreaterThan(0)
    const supports = model.parts.filter((part) => part.finish === 'frame' && part.bottom === 0)
    expect(supports).toHaveLength(4)
    expect(model.parts.length).toBeGreaterThan(25)
    expect(buildCeiling(space, 'island', 'SI2.0').children.length).toBeLessThanOrEqual(5)
  })

  it('lays out 1200 mm linear modules and leaves the island frame open', () => {
    const frame = ceilingModel({ ...room, height: 2.8 }, 'island', 'SI2.0')
    expect(frame.parts.some((part) => part.finish === 'gypsum')).toBe(false)
    expect(frame.parts.find((part) => part.finish === 'frame')?.holes).toHaveLength(1)
    expect(frame.dots).toHaveLength(0)
    expect(ceilingModel(room, 'island', 'SI2.0').dots.length).toBeGreaterThan(0)
    const strips = ceilingModel({ ...room, ceiling: 'linear' }, 'side_hall', 'SI2.0').parts.filter(
      (part) => part.finish === 'strip',
    )
    expect(strips.length).toBeGreaterThan(5)
    for (const part of strips) {
      const points = part.polygon.map(([, z]) => z)
      expect(Math.max(...points) - Math.min(...points)).toBeCloseTo(1.2)
    }
    expect(ceilingModel(room, 'zone', 'SI2.0').parts).toHaveLength(0)
  })
})
