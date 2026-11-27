import { describe, expect, it } from 'vitest'
import {
  distanceToBoundary,
  effectiveCeiling,
  rectangleSpace,
  recommendedCeiling,
  SpaceSchema,
} from '@store/shared'
import type { Facade, Space } from '@store/shared'
import { ceilingModel } from './ceiling-geometry.ts'

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
